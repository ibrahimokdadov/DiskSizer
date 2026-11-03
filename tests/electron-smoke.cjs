// End-to-end verification of the built app with disposable, generated files.
// Run: npm run build && node tests/electron-smoke.cjs
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')
const cleanup = (targets) => {
  for (const target of targets) {
    const resolved = path.resolve(target)
    if (path.dirname(resolved) === path.resolve(os.tmpdir()) && /^diskvision-(smoke|profile)-/.test(path.basename(resolved))) {
      fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  }
}
// The parent removes the profile only after Chromium exits and releases its files.
// Removing an active userData directory in Electron's exit hook can stall shutdown.
if (!process.versions.electron) {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'diskvision-smoke-'))
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'diskvision-profile-'))
  let exitCode = 1
  try {
    const environment = { ...process.env, DISKVISION_SMOKE_FIXTURE: fixture, DISKVISION_SMOKE_PROFILE: profile }
    delete environment.ELECTRON_RUN_AS_NODE
    const result = require('node:child_process').spawnSync(require('electron'), [__filename, ...process.argv.slice(2)], {
      cwd: path.resolve(__dirname, '..'), env: environment, stdio: 'inherit', windowsHide: true, timeout: 60000
    })
    if (result.error) console.error(result.error)
    exitCode = result.status ?? 1
  } finally { cleanup([fixture, profile]) }
  process.exit(exitCode)
}
const { app, ipcMain, dialog } = require('electron')
const fixture = process.env.DISKVISION_SMOKE_FIXTURE
const profile = process.env.DISKVISION_SMOKE_PROFILE
if (!fixture || !profile) {
  console.error('Run this check with: node tests/electron-smoke.cjs')
  app.exit(1)
}
app.setPath('userData', profile)
const output = path.resolve(__dirname, '../.qa')
fs.mkdirSync(output, { recursive: true })
const write = (name, bytes) => {
  const file = path.join(fixture, name)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, 'DiskVision generated test fixture.\n')
  fs.truncateSync(file, bytes)
}
write('Projects/application.zip', 128 * 1024 * 1024)
write('Projects/source.txt', 16 * 1024)
write('Media/recording.mp4', 80 * 1024 * 1024)
write('Documents/notes.txt', 4096)
write('$saved/keep.txt', 2048)
for (let index = 0; index < 110; index++) write(`sample-${String(index).padStart(3, '0')}.log`, (index + 1) * 1024)
fs.writeFileSync(path.join(fixture, 'Media/cover #1.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="160"><rect width="320" height="160" fill="#1d4ed8"/><text x="28" y="90" fill="white" font-size="28">Preview verified</text></svg>')
let completed = false
let timer
const waitFor = async (window, expression) => {
  const end = Date.now() + 15000
  while (Date.now() < end) {
    if (await window.webContents.executeJavaScript(expression)) return
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`Timed out: ${expression}`)
}
const screenshot = async (window, name) => {
  await new Promise(resolve => setTimeout(resolve, 150))
  fs.writeFileSync(path.join(output, name), (await window.webContents.capturePage()).toPNG())
}

app.on('browser-window-created', (_event, window) => {
  window.webContents.on('console-message', (_event, level, message) => {
    if (level >= 2) console.log(`RENDERER: ${message}`)
  })
  window.webContents.on('did-finish-load', async () => {
    if (completed) return
    try {
      console.log('Renderer loaded; initial visibility:', window.isVisible())
      const visibleDeadline = Date.now() + 5000
      while (!window.isVisible() && Date.now() < visibleDeadline) await new Promise(resolve => setTimeout(resolve, 50))
      assert.equal(window.isVisible(), true, 'App window must become visible without test intervention')
      await waitFor(window, `!!document.querySelector('.empty-state .button-primary')`)
      console.log(JSON.stringify(await window.webContents.executeJavaScript(`({ title: document.title, api: typeof window.api?.startScan, text: document.body.innerText.slice(0, 120) })`)))
      await screenshot(window, 'diskvision-empty.png')
      const actual = await window.webContents.executeJavaScript(`window.api.startScan(${JSON.stringify(fixture)}, 'smoke-native-check')`)
      assert.equal(actual.engine, 'native', 'The bundled native addon must load inside Electron')
      assert.equal(actual.totalFiles, 116)
      assert.equal(actual.totalSize, actual.root.size)
      assert.equal(actual.status, 'complete')
      assert.equal(actual.storage, 'sqlite')
      assert.equal(actual.root.allocationUnknownFiles, 0)
      const globalImages = await window.webContents.executeJavaScript(`window.api.getScanDirectory(${JSON.stringify({ scanId: 'smoke-native-check', path: fixture, scope: 'scan', category: 'image' })})`)
      assert.equal(globalImages.totalMatches, 1)
      assert.equal(globalImages.node.children[0].name, 'cover #1.svg')
      ipcMain.removeHandler('select-folder')
      ipcMain.handle('select-folder', async () => fixture)
      await window.webContents.executeJavaScript(`document.querySelector('.empty-state .button-primary').click()`)
      await waitFor(window, `document.querySelector('.status-bar')?.innerText.includes('Scan complete')`)
      await waitFor(window, `document.querySelectorAll('[data-file-row]').length === 100`)
      await screenshot(window, 'diskvision-list.png')
      await window.webContents.executeJavaScript(`for (const [label,value] of [['Search scope','scan'],['File type filter','image']]) { const select=document.querySelector('select[aria-label="'+label+'"]');select.value=value;select.dispatchEvent(new Event('change',{bubbles:true})); }`)
      await waitFor(window, `document.querySelectorAll('[data-file-row]').length === 1 && document.querySelector('[data-file-row]')?.innerText.includes('cover #1.svg')`)
      await screenshot(window, 'diskvision-global-search.png')
      await window.webContents.executeJavaScript(`for (const [label,value] of [['Search scope','folder'],['File type filter','all']]) { const select=document.querySelector('select[aria-label="'+label+'"]');select.value=value;select.dispatchEvent(new Event('change',{bubbles:true})); }`)
      await waitFor(window, `document.querySelectorAll('[data-file-row]').length === 100`)
      await window.webContents.executeJavaScript(`document.querySelector('button[aria-label="Next page"]').click()`)
      await waitFor(window, `document.querySelector('.table-pagination')?.innerText.includes('101')`)
      await window.webContents.executeJavaScript(`document.querySelector('button[aria-label="Previous page"]').click()`)
      await window.webContents.executeJavaScript(`document.querySelectorAll('.view-switch button')[1].click()`)
      await waitFor(window, `!document.querySelector('.file-table')`)
      await screenshot(window, 'diskvision-map.png')
      await window.webContents.executeJavaScript(`document.querySelectorAll('.view-switch button')[0].click()`)
      await waitFor(window, `!!document.querySelector('button[aria-label="Open folder Media"]')`)
      await window.webContents.executeJavaScript(`document.querySelector('button[aria-label="Open folder Media"]').click()`)
      await waitFor(window, `document.querySelector('h1')?.innerText === 'Media'`)
      await waitFor(window, `[...document.querySelectorAll('[data-file-row]')].some(row => row.innerText.includes('cover #1.svg'))`)
      await window.webContents.executeJavaScript(`[...document.querySelectorAll('[data-file-row]')].find(row => row.innerText.includes('cover #1.svg')).click()`)
      await waitFor(window, `!!document.querySelector('.inspector')`)
      await window.webContents.executeJavaScript(`[...document.querySelectorAll('.inspector button')].find(button => button.innerText.includes('Preview file')).click()`)
      await waitFor(window, `document.querySelector('.inspector img')?.naturalWidth > 0`)
      await screenshot(window, 'diskvision-inspector.png')
      window.setSize(1000, 700)
      await waitFor(window, `innerWidth <= 1000`)
      await screenshot(window, 'diskvision-compact.png')
      const exported = path.join(profile, 'exported.diskvision')
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: exported })
      await window.webContents.executeJavaScript(`[...document.querySelectorAll('button')].find(button => button.innerText === 'Save copy').click()`)
      await waitFor(window, `document.querySelector('.scan-freshness')?.innerText.includes('Scan copy saved')`)
      assert.ok(fs.statSync(exported).size > 0)
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [exported] })
      await window.webContents.executeJavaScript(`[...document.querySelectorAll('button')].find(button => button.innerText === 'Open scan').click()`)
      await waitFor(window, `document.querySelector('.scan-freshness')?.innerText.includes('Saved scan · read-only') && document.querySelectorAll('[data-file-row]').length === 100`)
      const denied = await window.webContents.executeJavaScript(`window.api.deleteItem(${JSON.stringify(path.join(fixture, 'Projects/application.zip'))}).then(() => false, error => String(error).includes('read-only'))`)
      assert.equal(denied, true, 'Imported snapshots must reject deletion before any file action')
      await screenshot(window, 'diskvision-saved-scan.png')
      console.log(JSON.stringify({ success: true, engine: actual.engine, files: actual.totalFiles,
        checks: ['native worker and SQLite in Electron', 'allocation metadata', 'file totals', 'global type search', 'list pagination', 'map', 'folder navigation', 'scoped SVG preview with #', 'compact layout', 'snapshot export/import', 'snapshot deletion rejected'], screenshots: output }))
      completed = true
      clearTimeout(timer)
      app.quit()
    } catch (error) {
      console.error(error)
      try { await screenshot(window, 'diskvision-failure.png') } catch {}
      completed = true
      clearTimeout(timer)
      app.exit(1)
    }
  })
})
timer = setTimeout(() => { console.error('App did not finish smoke checks.'); app.exit(1) }, 45000)
require(process.argv[2] ? path.resolve(process.argv[2]) : '../out/main/index.js')
