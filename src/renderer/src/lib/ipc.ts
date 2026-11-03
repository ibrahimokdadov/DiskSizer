const api = window.api

export const ipc = {
  getDrives: () => api.getDrives(),
  selectFolder: () => api.selectFolder(),
  startScan: (dirPath: string, scanId: string) => api.startScan(dirPath, scanId),
  cancelScan: (scanId?: string) => api.cancelScan(scanId),
  openScan: () => api.openScan(),
  saveScan: () => api.saveScan(),
  getScanDirectory: (request: Parameters<typeof api.getScanDirectory>[0]) => api.getScanDirectory(request),
  deleteItem: (filePath: string) => api.deleteItem(filePath),
  openInExplorer: (filePath: string) => api.openInExplorer(filePath),
  getFilePreview: (filePath: string) => api.getFilePreview(filePath),
  onScanProgress: (cb: Parameters<typeof api.onScanProgress>[0]) => api.onScanProgress(cb),
  onScanComplete: (cb: Parameters<typeof api.onScanComplete>[0]) => api.onScanComplete(cb),
  onScanCancelled: (cb: Parameters<typeof api.onScanCancelled>[0]) => api.onScanCancelled(cb),
  onScanError: (cb: Parameters<typeof api.onScanError>[0]) => api.onScanError(cb),
}
