import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { mkdirSync } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerIpcHandlers } from './ipc-handlers'
import { registerMediaProtocol } from './media-protocol'
import { initializeDiagnostics, observeWindow } from './diagnostics'

// Keep existing scans/settings when upgrading from the DiskVision name. Honor
// explicitly configured profiles, including the isolated integration-test profile.
if (app.getPath('userData') === join(app.getPath('appData'), app.getName())) {
  const legacyUserData = join(app.getPath('appData'), 'diskvision')
  mkdirSync(legacyUserData, { recursive: true })
  app.setPath('userData', legacyUserData)
}
initializeDiagnostics()

// The bounded SVG/table UI does not need GPU compositing. Software rendering
// also works in Windows remote sessions where the compositor cannot paint.
if (process.platform === 'win32') app.disableHardwareAcceleration()

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    title: `DiskSizer ${app.getVersion()}`,
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    show: false,
    backgroundColor: '#0f131a',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0f131a',
      symbolColor: '#9ca3af',
      height: 36
    },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true
    }
  })
  observeWindow(mainWindow)
  // Keep the build identifiable in the Windows task switcher and diagnostics.
  mainWindow.on('page-title-updated', event => event.preventDefault())

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })
  // Some Windows compositor sessions never paint an initially hidden window.
  mainWindow.webContents.once('did-finish-load', () => {
    if (!mainWindow.isVisible()) mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    if (/^https?:\/\//i.test(details.url)) void shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.diskvision')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerMediaProtocol()
  registerIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
