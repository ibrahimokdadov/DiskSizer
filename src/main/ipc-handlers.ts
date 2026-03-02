import { ipcMain, dialog, BrowserWindow } from 'electron'
import { getDrives } from './drive-info'
import { fastScanner } from './scanner-fast'
import { deleteItem, openInExplorer, getFilePreview } from './file-actions'

export function registerIpcHandlers(): void {
  ipcMain.handle('get-drives', async () => {
    return getDrives()
  })

  ipcMain.handle('select-folder', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return null
    const result = await dialog.showOpenDialog(window, {
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('start-scan', async (event, dirPath: string) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) throw new Error('No window')
    return fastScanner.scan(dirPath, window)
  })

  ipcMain.handle('cancel-scan', async () => {
    fastScanner.cancel()
  })

  ipcMain.handle('delete-item', async (event, filePath: string) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return false
    return deleteItem(filePath, window)
  })

  ipcMain.handle('open-in-explorer', async (_event, filePath: string) => {
    openInExplorer(filePath)
  })

  ipcMain.handle('get-file-preview', async (_event, filePath: string) => {
    return getFilePreview(filePath)
  })
}
