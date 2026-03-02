import { contextBridge, ipcRenderer } from 'electron'
import type { ElectronAPI, ScanProgress, ScanResult } from './types'

const api: ElectronAPI = {
  getDrives: () => ipcRenderer.invoke('get-drives'),
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  startScan: (dirPath: string) => ipcRenderer.invoke('start-scan', dirPath),
  cancelScan: () => ipcRenderer.invoke('cancel-scan'),
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
  onScanError: (callback: (error: string) => void) => {
    const handler = (_event: any, error: string) => callback(error)
    ipcRenderer.on('scan-error', handler)
    return () => ipcRenderer.removeListener('scan-error', handler)
  }
}

contextBridge.exposeInMainWorld('api', api)
