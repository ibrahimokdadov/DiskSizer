import { contextBridge, ipcRenderer } from 'electron'
import type { ElectronAPI, ScanProgress, ScanResult, ScanError } from './types'

const api: ElectronAPI = {
  getDrives: () => ipcRenderer.invoke('get-drives'),
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  startScan: (dirPath: string, scanId: string) => ipcRenderer.invoke('start-scan', dirPath, scanId),
  cancelScan: (scanId?: string) => ipcRenderer.invoke('cancel-scan', scanId),
  openScan: () => ipcRenderer.invoke('open-scan'),
  saveScan: () => ipcRenderer.invoke('save-scan'),
  getScanDirectory: request => ipcRenderer.invoke('get-scan-directory', request),
  deleteItem: (filePath: string) => ipcRenderer.invoke('delete-item', filePath),
  openInExplorer: (filePath: string) => ipcRenderer.invoke('open-in-explorer', filePath),
  getFilePreview: (filePath: string) => ipcRenderer.invoke('get-file-preview', filePath),
  onScanProgress: (callback: (progress: ScanProgress) => void) => {
    const handler = (_event: any, progress: ScanProgress) => callback(progress)
    ipcRenderer.on('scan-progress', handler)
    return () => ipcRenderer.removeListener('scan-progress', handler)
  },
  onScanComplete: (callback: (result: ScanResult) => void) => {
    const handler = (_event: any, result: ScanResult) => callback(result)
    ipcRenderer.on('scan-complete', handler)
    return () => ipcRenderer.removeListener('scan-complete', handler)
  },
  onScanCancelled: (callback: (result: ScanResult) => void) => {
    const handler = (_event: any, result: ScanResult) => callback(result)
    ipcRenderer.on('scan-cancelled', handler)
    return () => ipcRenderer.removeListener('scan-cancelled', handler)
  },
  onScanError: (callback: (error: ScanError) => void) => {
    const handler = (_event: any, error: ScanError) => callback(error)
    ipcRenderer.on('scan-error', handler)
    return () => ipcRenderer.removeListener('scan-error', handler)
  }
}

contextBridge.exposeInMainWorld('api', api)
