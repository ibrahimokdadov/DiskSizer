import { app, ipcMain, dialog, BrowserWindow, utilityProcess, type UtilityProcess, type WebContents } from 'electron'
import { randomUUID } from 'crypto'
import { promises as fs } from 'fs'
import * as path from 'path'
import { getDrives } from './drive-info'
import { deleteItem, openInExplorer, getFilePreview } from './file-actions'
import type { DirectoryPage, DirectoryPageRequest, FileNode, ScanProgress, ScanResult } from '../preload/types'
import { logDiagnostic } from './diagnostics'

interface ScanSession {
  scanId: string
  worker: UtilityProcess
  cancelled: boolean
  ready: boolean
  stop: () => void
  close: (reason: string) => void
  request: <T>(operation: 'directory' | 'validate-delete' | 'remove' | 'export', payload: { request?: DirectoryPageRequest; path?: string }) => Promise<T>
}

const sessions = new Map<number, ScanSession>()
const STDERR_TAIL_LIMIT = 16 * 1024

function startWorker(sender: WebContents, dirPath: string, scanId: string, snapshotPath?: string): Promise<ScanResult> {
  sessions.get(sender.id)?.close('replaced')
  const rootPath = path.resolve(/^[a-z]:$/i.test(dirPath) ? dirPath + path.sep : dirPath)
  let worker: UtilityProcess
  try {
    worker = utilityProcess.fork(path.join(__dirname, 'scanner-worker.js'), [], {
      serviceName: 'DiskSizer Scanner',
      stdio: ['ignore', 'ignore', 'pipe']
    })
  } catch (error) {
    logDiagnostic('scan-failed', { scanId, stage: 'helper-launch', message: String(error), memory: process.memoryUsage() })
    throw new Error('The scan helper could not be started. Please try again.')
  }
  logDiagnostic('scan-start', { scanId, isolation: 'utility-process' })
  return new Promise<ScanResult>((resolve, reject) => {
    let settled = false
    let spawned = false
    let exited = false
    let latest: ScanProgress | undefined
    let latestPreview: ScanProgress | undefined
    let stopTimer: ReturnType<typeof setTimeout> | undefined
    let shutdownTimer: ReturnType<typeof setTimeout> | undefined
    let stderrTail = ''
    let lastStderrLoggedAt = 0
    let workerMemory: NodeJS.MemoryUsage | undefined
    let nextRequestId = 0
    const pendingQueries = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
    const startedAt = Date.now()
    let lastLoggedAt = 0
    const send = (channel: string, value: unknown): void => {
      if (sessions.get(sender.id) === session && !sender.isDestroyed()) sender.send(channel, value)
    }
    const cancelledSnapshot = (): ScanResult => {
      // Keep the preview and its counters from the same observation.
      const snapshot = latestPreview || latest
      return {
        scanId, status: 'cancelled', indexed: false, engine: snapshot?.engine || 'standard', sizeKind: 'logical',
        root: snapshot?.partialRoot ? { ...snapshot.partialRoot, status: 'partial', detailsAvailable: false, fileCount: snapshot.filesScanned, directoryCount: snapshot.directoriesScanned } : { name: path.basename(rootPath) || rootPath, path: rootPath, type: 'directory', size: 0, children: [], childrenLoaded: false, detailsAvailable: false, status: 'partial' },
        totalSize: snapshot?.totalSizeBytes || 0, totalFiles: snapshot?.filesScanned || 0,
        totalDirectories: snapshot?.directoriesScanned || 0, scanDurationMs: Date.now() - startedAt,
        errors: [], errorCount: snapshot?.errorCount || 0, skippedCount: snapshot?.skippedCount || 0
      }
    }
    const cleanup = (queryError = new Error('These scan results are no longer available. Start a new scan.')): void => {
      if (stopTimer) clearTimeout(stopTimer)
      session.ready = false
      for (const pending of pendingQueries.values()) {
        clearTimeout(pending.timer)
        pending.reject(queryError)
      }
      pendingQueries.clear()
      if (exited) sender.removeListener('destroyed', onDestroyed)
      if (sessions.get(sender.id) === session) sessions.delete(sender.id)
    }
    const killHelper = (reason: string): void => {
      if (exited) return
      try {
        const pid = worker.pid
        const killed = worker.kill()
        logDiagnostic('scan-helper-kill', { scanId, pid, reason, killed })
      } catch (error) {
        logDiagnostic('scan-helper-kill-failed', { scanId, reason, message: String(error) })
      }
    }
    const shutdownHelper = (force: boolean): void => {
      if (exited) return
      if (force || !spawned) { killHelper(force ? 'forced-stop' : 'shutdown-before-spawn'); return }
      try {
        // Receipt of this message acknowledges that the terminal result arrived.
        worker.postMessage({ type: 'shutdown', scanId })
        shutdownTimer = setTimeout(() => killHelper('shutdown-timeout'), 1500)
        shutdownTimer.unref()
      } catch (error) {
        logDiagnostic('scan-helper-shutdown-failed', { scanId, message: String(error) })
        killHelper('shutdown-message-failed')
      }
    }
    const finish = (result: ScanResult, forceStop = false): void => {
      if (settled) return
      settled = true
      if (session.cancelled) {
        result.status = 'cancelled'
        result.root.status = 'partial'
      }
      // The invocation resolves the authoritative terminal result. Sending the
      // same tree as an event would serialize every record a second time.
      session.ready = result.indexed === true && !forceStop && !exited && !sender.isDestroyed()
      if (stopTimer) clearTimeout(stopTimer)
      if (!session.ready) cleanup()
      logDiagnostic('scan-finished', { scanId, status: result.status, stopReason: result.stopReason,
        indexed: result.indexed, files: result.totalFiles, memory: process.memoryUsage(), workerMemory })
      resolve(result)
      if (!session.ready) shutdownHelper(forceStop)
    }
    const fail = (error: Error): void => {
      if (settled) return
      if (session.cancelled) { finish(cancelledSnapshot()); return }
      settled = true
      send('scan-error', { scanId, message: error.message })
      cleanup()
      logDiagnostic('scan-failed', { scanId, message: error.message, memory: process.memoryUsage(), workerMemory, stderr: stderrTail || undefined })
      reject(error)
      shutdownHelper(false)
    }
    const session: ScanSession = {
      scanId, worker, cancelled: false, ready: false,
      close: reason => {
        session.ready = false
        if (!settled) {
          session.cancelled = true
          finish(cancelledSnapshot(), true)
        } else {
          cleanup()
          killHelper(reason)
        }
      },
      request: <T>(operation: 'directory' | 'validate-delete' | 'remove' | 'export', payload: { request?: DirectoryPageRequest; path?: string }): Promise<T> => {
        if (!session.ready || exited || sessions.get(sender.id) !== session) {
          return Promise.reject(new Error('These scan results are no longer available. Start a new scan.'))
        }
        if (pendingQueries.size >= 32) return Promise.reject(new Error('The results are busy. Please try again shortly.'))
        const requestId = `${scanId}:${++nextRequestId}`
        return new Promise<T>((resolveQuery, rejectQuery) => {
          const timer = setTimeout(() => {
            pendingQueries.delete(requestId)
            rejectQuery(new Error('Reading the scan results timed out. Try a smaller folder or start a new scan.'))
          }, 15000)
          pendingQueries.set(requestId, { resolve: value => resolveQuery(value as T), reject: rejectQuery, timer })
          try { worker.postMessage({ type: 'index-request', scanId, requestId, operation, ...payload }) }
          catch (error) {
            clearTimeout(timer)
            pendingQueries.delete(requestId)
            rejectQuery(error instanceof Error ? error : new Error(String(error)))
          }
        })
      },
      stop: () => {
        if (settled || session.cancelled) return
        session.cancelled = true
        if (spawned) {
          try { worker.postMessage({ type: 'cancel', scanId }) }
          catch (error) { logDiagnostic('scan-helper-cancel-failed', { scanId, message: String(error) }) }
        }
        // A disconnected/network provider can leave an OS read outstanding.
        // End the UI session promptly; any late result remains isolated here.
        stopTimer = setTimeout(() => {
          finish(cancelledSnapshot(), true)
        }, 1500)
      }
    }
    const onDestroyed = (): void => {
      session.close('window-destroyed')
    }
    sessions.set(sender.id, session)
    sender.once('destroyed', onDestroyed)
    worker.stderr?.on('data', (data: Buffer | string) => {
      const text = Buffer.isBuffer(data) ? data.subarray(-STDERR_TAIL_LIMIT).toString('utf8') : data.slice(-STDERR_TAIL_LIMIT)
      stderrTail = (stderrTail + text).slice(-STDERR_TAIL_LIMIT)
      if (exited || Date.now() - lastStderrLoggedAt >= 1000) {
        lastStderrLoggedAt = Date.now()
        logDiagnostic('scan-helper-stderr', { scanId, stderr: stderrTail })
      }
    })
    worker.stderr?.on('error', (error: Error) => {
      logDiagnostic('scan-helper-stderr-error', { scanId, message: error.message })
    })
    worker.once('spawn', () => {
      spawned = true
      logDiagnostic('scan-helper-spawn', { scanId, pid: worker.pid })
      if (settled) { killHelper('session-already-finished'); return }
      try {
        worker.postMessage(session.cancelled ? { type: 'shutdown', scanId } : { type: 'start', dirPath: rootPath, scanId,
          databasePath: path.join(app.getPath('userData'), 'scans', `${new Date().toISOString().replace(/[:.]/g, '-')}_${(path.basename(rootPath) || rootPath.slice(0, 1)).replace(/[<>:"/\\|?*]/g, '-').slice(0, 48)}_${randomUUID()}.diskvision`), snapshotPath })
      } catch (error) {
        logDiagnostic('scan-helper-start-message-failed', { scanId, message: String(error) })
        fail(new Error('The scan helper could not receive its configuration. Please try again.'))
      }
    })
    worker.on('message', (message: { type: string; scanId?: string; progress?: ScanProgress; result?: ScanResult; message?: string; memory?: NodeJS.MemoryUsage; requestId?: string; value?: unknown; error?: string }) => {
      if (!message || message.scanId !== scanId) return
      if (message.memory) workerMemory = message.memory
      if (message.type === 'index-response' && message.requestId) {
        const pending = pendingQueries.get(message.requestId)
        if (pending) {
          clearTimeout(pending.timer)
          pendingQueries.delete(message.requestId)
          if (message.error) pending.reject(new Error(message.error))
          else pending.resolve(message.value)
        }
        return
      }
      if (settled) return
      if (message.type === 'progress' && message.progress) {
        if (session.cancelled) return
        latest = message.progress
        if (latest.phase === 'building' || Date.now() - lastLoggedAt >= 5000) {
          lastLoggedAt = Date.now()
          logDiagnostic('scan-progress', { scanId, files: latest.filesScanned, directories: latest.directoriesScanned, phase: latest.phase, memory: process.memoryUsage(), workerMemory: message.memory })
        }
        if (message.progress.partialRoot) latestPreview = message.progress
        send('scan-progress', message.progress)
      } else if (message.type === 'result' && message.result) {
        finish(message.result)
      } else if (message.type === 'error') {
        fail(new Error(message.message || 'The scan could not be completed.'))
      }
    })
    worker.once('exit', (code) => {
      exited = true
      if (shutdownTimer) clearTimeout(shutdownTimer)
      sender.removeListener('destroyed', onDestroyed)
      logDiagnostic('scan-worker-exit', { scanId, code, isolation: 'utility-process', cancelled: session.cancelled, settled, workerMemory, stderr: stderrTail || undefined })
      if (!settled) fail(new Error(`The scan helper stopped unexpectedly (code ${code}). DiskSizer is still running; you can start a new scan.`))
      else if (session.ready) {
        const error = new Error(`The scan results helper stopped (code ${code}). Start a new scan to browse the files again.`)
        send('scan-error', { scanId, message: error.message })
        logDiagnostic('scan-index-lost', { scanId, code, stderr: stderrTail || undefined })
        cleanup(error)
      }
    })
  })
}

export function registerIpcHandlers(): void {
  ipcMain.handle('get-drives', () => getDrives())

  ipcMain.handle('open-scan', async event => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return null
    const previous = sessions.get(event.sender.id)
    const folder = path.join(app.getPath('userData'), 'scans')
    await fs.mkdir(folder, { recursive: true })
    const choice = await dialog.showOpenDialog(window, { title: 'Open saved scan', defaultPath: folder,
      filters: [{ name: 'DiskSizer scan', extensions: ['diskvision'] }], properties: ['openFile'] })
    if (choice.canceled || !choice.filePaths[0]) return null
    if (sessions.get(event.sender.id) !== previous) throw new Error('Another scan started while choosing this file. Open it again when that scan finishes.')
    return startWorker(event.sender, folder, randomUUID(), choice.filePaths[0])
  })
  ipcMain.handle('save-scan', async event => {
    const window = BrowserWindow.fromWebContents(event.sender), session = sessions.get(event.sender.id)
    if (!window || !session?.ready) throw new Error('Wait for a scan to finish before saving it.')
    const choice = await dialog.showSaveDialog(window, { title: 'Save scan copy', defaultPath: `DiskSizer-${new Date().toISOString().slice(0,10)}.diskvision`,
      filters: [{ name: 'DiskSizer scan', extensions: ['diskvision'] }] })
    if (choice.canceled || !choice.filePath) return null
    return session.request<string>('export', { path: choice.filePath })
  })

  ipcMain.handle('select-folder', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return null
    const result = await dialog.showOpenDialog(window, { properties: ['openDirectory'] })
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
  })

  ipcMain.handle('start-scan', async (event, dirPath: string, scanId: string) => {
    if (typeof dirPath !== 'string' || !dirPath.trim() || dirPath.includes('\0')) throw new Error('Choose a valid folder or drive.')
    if (typeof scanId !== 'string' || !scanId || scanId.length > 128) throw new Error('Invalid scan session.')
    return startWorker(event.sender, dirPath, scanId)
  })

  ipcMain.handle('cancel-scan', async (event, scanId?: string) => {
    const session = sessions.get(event.sender.id)
    if (session && (!scanId || session.scanId === scanId)) session.stop()
  })

  ipcMain.handle('get-scan-directory', async (event, request: DirectoryPageRequest) => {
    if (!request || typeof request.scanId !== 'string' || typeof request.path !== 'string') throw new Error('Invalid directory request.')
    const session = sessions.get(event.sender.id)
    if (!session || session.scanId !== request.scanId) throw new Error('These scan results are no longer available. Start a new scan.')
    return session.request<DirectoryPage>('directory', { request: {
      scanId: request.scanId, path: request.path, offset: request.offset, limit: request.limit,
      query: request.query, descending: request.descending, scope: request.scope, category: request.category,
      modifiedBefore: request.modifiedBefore, sizeMetric: request.sizeMetric
    } })
  })

  ipcMain.handle('delete-item', async (event, filePath: string) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return false
    const session = sessions.get(event.sender.id)
    if (!session?.ready) throw new Error('Scan results are no longer available. Rescan the folder before deleting an item.')
    await session.request<FileNode>('validate-delete', { path: filePath })
    const deleted = await deleteItem(filePath, window)
    if (!deleted) return false
    try {
      await session.request<ScanResult>('remove', { path: filePath })
    } catch {
      throw new Error('The item was moved to the Recycle Bin, but the scan results could not be updated. Please rescan the folder.')
    }
    return true
  })

  ipcMain.handle('open-in-explorer', async (_event, filePath: string) => openInExplorer(filePath))
  ipcMain.handle('get-file-preview', async (_event, filePath: string) => getFilePreview(filePath))
}
