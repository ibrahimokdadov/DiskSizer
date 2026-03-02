const api = window.api

export const ipc = {
  getDrives: () => api.getDrives(),
  selectFolder: () => api.selectFolder(),
  startScan: (dirPath: string) => api.startScan(dirPath),
  cancelScan: () => api.cancelScan(),
  deleteItem: (filePath: string) => api.deleteItem(filePath),
  openInExplorer: (filePath: string) => api.openInExplorer(filePath),
  getFilePreview: (filePath: string) => api.getFilePreview(filePath),
  onScanProgress: (cb: Parameters<typeof api.onScanProgress>[0]) => api.onScanProgress(cb),
  onScanComplete: (cb: Parameters<typeof api.onScanComplete>[0]) => api.onScanComplete(cb),
  onScanError: (cb: Parameters<typeof api.onScanError>[0]) => api.onScanError(cb),
}
