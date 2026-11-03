import { readStandardDirectory } from './scanner-fast'
import { readNativeDirectory, nativeAddon } from './scanner-native'
import { DiskScanIndex } from './disk-index'
import { promises as fs } from 'fs'
import * as path from 'path'
import type { DirectoryPageRequest } from '../preload/types'

const parentPort = process.parentPort
const controller = new AbortController()
let activeScanId: string | undefined
let started = false
let finished = false
let shutdown = false
let index: DiskScanIndex | undefined
// Mutations, exports and reads are serialized against one SQLite connection.
let queries = Promise.resolve()
function maybeExit() { if (shutdown && finished) void queries.finally(async () => { await index?.close(); process.exit(0) }) }
parentPort.on('message', event => {
  const message = event.data as { type?: string; dirPath?: string; scanId?: string; databasePath?: string; snapshotPath?: string;
    requestId?: string; operation?: string; request?: DirectoryPageRequest; path?: string } | undefined
  if (!message || (activeScanId && message.scanId !== activeScanId)) return
  if (message.type === 'shutdown') { shutdown = true; controller.abort(); maybeExit(); return }
  if (message.type === 'cancel') { controller.abort(); return }
  if (message.type === 'index-request' && message.requestId) {
    queries = queries.then(async () => {
      try {
        if (!index) throw new Error('Scan results are not available.')
        let value: unknown
        if (message.operation === 'directory' && message.request) value = await index.page(message.request)
        else if (message.operation === 'validate-delete' && message.path) value = await index.validateDeletion(message.path)
        else if (message.operation === 'remove' && message.path) value = await index.remove(message.path)
        else if (message.operation === 'export' && message.path) {
          if (path.resolve(message.path).toLowerCase() !== path.resolve(index.filePath).toLowerCase()) await fs.copyFile(index.filePath, message.path)
          value = message.path
        } else throw new Error('Invalid scan index request.')
        parentPort.postMessage({ type: 'index-response', scanId: activeScanId, requestId: message.requestId, value, memory: process.memoryUsage() })
      } catch (error) {
        parentPort.postMessage({ type: 'index-response', scanId: activeScanId, requestId: message.requestId, error: String(error), memory: process.memoryUsage() })
      }
    })
    return
  }
  if (message.type !== 'start' || started || shutdown) return
  if (!message.scanId || !message.dirPath || !message.databasePath) {
    parentPort.postMessage({ type: 'error', scanId: message.scanId, message: 'Invalid scan helper configuration.' }); finished = true; return
  }
  started = true; activeScanId = message.scanId
  const scanId = message.scanId
  const native = !!nativeAddon?.DirectoryCursor
  const operation = message.snapshotPath ? DiskScanIndex.open(message.snapshotPath, scanId) :
    DiskScanIndex.scan(message.databasePath, message.dirPath, scanId, native ? 'native' : 'standard', native ? readNativeDirectory : readStandardDirectory,
      controller.signal, progress => parentPort.postMessage({ type: 'progress', scanId, progress, memory: process.memoryUsage() }))
  void operation.then(async ready => {
    index = ready; finished = true
    parentPort.postMessage({ type: 'result', scanId, result: await index.summary(), memory: process.memoryUsage() })
  }).catch(error => {
    finished = true
    parentPort.postMessage({ type: 'error', scanId, message: String(error), memory: process.memoryUsage() })
  }).finally(maybeExit)
})
