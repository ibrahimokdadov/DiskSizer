import { app, crashReporter, type BrowserWindow } from 'electron'
import { appendFileSync, mkdirSync, renameSync, statSync } from 'fs'
import { join } from 'path'

let logPath: string | undefined

/** Local diagnostics only. Logging failures must never interrupt a scan. */
export function logDiagnostic(event: string, details: Record<string, unknown> = {}): void {
  if (!logPath) return
  try {
    if ((statSync(logPath, { throwIfNoEntry: false })?.size ?? 0) > 2 * 1024 * 1024) {
      renameSync(logPath, `${logPath}.previous`)
    }
    appendFileSync(logPath, `${JSON.stringify({ time: new Date().toISOString(), event, ...details })}\n`)
  } catch { /* A full or inaccessible log directory must not affect the app. */ }
}

export function initializeDiagnostics(): void {
  try {
    const directory = join(app.getPath('userData'), 'logs')
    mkdirSync(directory, { recursive: true })
    logPath = join(directory, 'diskvision.log')
    logDiagnostic('app-start', { version: app.getVersion(), electron: process.versions.electron, pid: process.pid,
      executable: process.execPath, scanArchitecture: 'paged-utility-process' })
    crashReporter.start({ productName: 'DiskSizer', uploadToServer: false })
  } catch (error) { logDiagnostic('diagnostics-unavailable', { message: String(error) }) }

  process.on('uncaughtExceptionMonitor', error => logDiagnostic('uncaught-exception', { message: error.message, stack: error.stack }))
  app.on('child-process-gone', (_event, details) => logDiagnostic('child-process-gone', { ...details }))
  app.on('before-quit', () => logDiagnostic('app-before-quit'))
  app.on('will-quit', () => logDiagnostic('app-will-quit'))
  app.on('quit', (_event, exitCode) => logDiagnostic('app-quit', { exitCode }))
}

export function observeWindow(window: BrowserWindow): void {
  window.on('closed', () => logDiagnostic('window-closed'))
  window.on('unresponsive', () => logDiagnostic('window-unresponsive'))
  window.webContents.on('render-process-gone', (_event, details) => logDiagnostic('renderer-gone', { ...details }))
  window.webContents.on('did-fail-load', (_event, errorCode, description) => logDiagnostic('renderer-load-failed', { errorCode, description }))
  window.webContents.on('did-finish-load', () => logDiagnostic('renderer-ready'))
}
