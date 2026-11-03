// Exercise the actual packaged executable, including startup and normal shutdown.
// Run: node tests/packaged-smoke.cjs [path/to/DiskSizer.exe]
// Optional: DISKVISION_SMOKE_IDLE_MS=120000 DISKVISION_SMOKE_ROUNDS=5
// Optional bounded additional UI scan: DISKVISION_SMOKE_TARGET=C:\
// DISKVISION_SMOKE_SCAN_MS=30000 DISKVISION_SMOKE_MAX_FILES=150000
// Optional utility-process crash containment check: DISKVISION_SMOKE_FAULT=1
// Optional staged-build testing without showing its window: DISKVISION_SMOKE_HIDDEN=1
// Verify the production memory guard on TARGET: DISKVISION_SMOKE_EXPECT_MEMORY_LIMIT=1
// Require a fully traversed TARGET (protected/skipped items allowed): DISKVISION_SMOKE_EXPECT_FULL_SCAN=1
// Uses Chromium's loopback debugging API only for this test process. It does not
// disable Electron's sandbox, alter the normal profile, or scan unrelated folders.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')

const workspace = path.resolve(__dirname, '..')
const executable = path.resolve(process.argv[2] || path.join(workspace, 'dist/win-unpacked/DiskSizer.exe'))
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'diskvision-packaged-'))
const fixture = path.join(temporaryRoot, 'fixture')
const profile = path.join(temporaryRoot, 'profile')
const output = path.join(workspace, '.qa')
fs.mkdirSync(fixture, { recursive: true })
fs.mkdirSync(profile, { recursive: true })
fs.mkdirSync(output, { recursive: true })
const logPath = path.join(output, 'packaged-smoke-runtime.log')
const reportPath = path.join(output, 'packaged-smoke-result.json')
const idleMs = Math.max(30000, Number(process.env.DISKVISION_SMOKE_IDLE_MS) || 30000)
const rounds = Math.max(1, Math.min(20, Number(process.env.DISKVISION_SMOKE_ROUNDS) || 3))
const hidden = process.env.DISKVISION_SMOKE_HIDDEN === '1'
const expectMemoryLimit = process.env.DISKVISION_SMOKE_EXPECT_MEMORY_LIMIT === '1'
const expectFullScan = process.env.DISKVISION_SMOKE_EXPECT_FULL_SCAN === '1'
const additionalTarget = process.env.DISKVISION_SMOKE_TARGET ? path.resolve(process.env.DISKVISION_SMOKE_TARGET) : null
const scanMs = Math.max(1000, Math.min(240000, Number(process.env.DISKVISION_SMOKE_SCAN_MS) || 30000))
const maxFiles = Math.max(1000, Math.min(6000000, Number(process.env.DISKVISION_SMOKE_MAX_FILES) || 150000))
let fixtureFiles = 0
let fixtureBytes = 0
for (let directory = 0; directory < 64; directory++) {
  for (let file = 0; file < 8; file++) {
    const filename = path.join(fixture, `$folder-${directory}`, `file-${file}-é.txt`)
    fs.mkdirSync(path.dirname(filename), { recursive: true })
    const content = Buffer.alloc(128 + directory + file, directory % 256)
    fs.writeFileSync(filename, content)
    fixtureFiles++
    fixtureBytes += content.length
  }
}
const deepFile = path.join(fixture, ...Array.from({ length: 12 }, (_, index) => `deep-${index}`), 'leaf.txt')
fs.mkdirSync(path.dirname(deepFile), { recursive: true })
fs.writeFileSync(deepFile, 'deep')
fixtureFiles++
fixtureBytes += 4
for (let file = 0; file < 240; file++) {
  const content = Buffer.alloc(file + 1, 42)
  fs.writeFileSync(path.join(fixture, `top-${String(file).padStart(3, '0')}.log`), content)
  fixtureFiles++
  fixtureBytes += content.length
}

const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const deadline = async (promise, milliseconds, label) => {
  let timer
  try {
    return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out after ${milliseconds} ms`)), milliseconds) })])
  } finally { clearTimeout(timer) }
}

class CDP {
  constructor(url) {
    this.pending = new Map()
    this.pauses = []
    this.pauseWaiters = []
    this.nextId = 0
    this.socket = new WebSocket(url)
    this.ready = new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true })
      this.socket.addEventListener('error', reject, { once: true })
    })
    this.socket.addEventListener('message', event => {
      const message = JSON.parse(event.data)
      if (message.method === 'Debugger.paused') {
        const waiter = this.pauseWaiters.shift()
        if (waiter) waiter(message.params)
        else this.pauses.push(message.params)
        return
      }
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      if (message.error) pending.reject(new Error(`${pending.method}: ${JSON.stringify(message.error)}`))
      else pending.resolve(message.result)
    })
    this.socket.addEventListener('close', () => {
      for (const pending of this.pending.values()) pending.reject(new Error(`CDP closed during ${pending.method}`))
      this.pending.clear()
    })
  }
  async call(method, params = {}) {
    await this.ready
    const id = ++this.nextId
    return deadline(new Promise((resolve, reject) => {
      this.pending.set(id, { method, resolve, reject })
      this.socket.send(JSON.stringify({ id, method, params }))
    }), 45000, method)
  }
  async evaluate(expression) {
    const response = await this.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true })
    if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails))
    return response.result.value
  }
  async waitForPause() {
    if (this.pauses.length) return this.pauses.shift()
    return deadline(new Promise(resolve => this.pauseWaiters.push(resolve)), 15000, 'Initial main-process debugger pause')
  }
  close() { this.socket.close() }
}

let child
let browser
let page
let inspector
let exitRecord
let combinedLog = ''
const report = { executable, startedAt: new Date().toISOString(), rounds, idleMs, hidden, scans: [], memorySamples: [], checks: [], success: false }
const assertAlive = () => {
  if (exitRecord) throw new Error(`Packaged app exited unexpectedly: ${JSON.stringify(exitRecord)}`)
}

async function main() {
  assert.equal(fs.existsSync(executable), true, `Build the packaged app first: ${executable}`)
  if (expectMemoryLimit || expectFullScan) assert.ok(additionalTarget, 'Scan-outcome verification needs an explicit additional target')
  assert.ok(!(expectMemoryLimit && expectFullScan), 'Choose either full-scan or memory-limit verification')
  const environment = { ...process.env }
  delete environment.ELECTRON_RUN_AS_NODE
  child = spawn(executable, [
    hidden ? '--inspect-brk=127.0.0.1:0' : '--inspect=127.0.0.1:0',
    '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0',
    `--user-data-dir=${profile}`, '--enable-logging=file', `--log-file=${logPath}`
  ], { cwd: path.dirname(executable), env: environment, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  const exited = new Promise(resolve => child.once('exit', (code, signal) => { exitRecord = { code, signal }; resolve(exitRecord) }))
  child.on('error', error => { exitRecord = { error: error.message } })
  const log = chunk => { combinedLog += chunk.toString() }
  child.stdout.on('data', log)
  child.stderr.on('data', log)
  const startedAt = Date.now()
  let inspectorUrl
  while (!inspectorUrl && Date.now() - startedAt < 20000) {
    assertAlive()
    inspectorUrl = combinedLog.match(/Debugger listening on (ws:\/\/127\.0\.0\.1:\d+\/[^\s]+)/)?.[1]
    if (!inspectorUrl) await pause(100)
  }
  assert.ok(inspectorUrl, 'The test needs the packaged main-process inspector')
  inspector = new CDP(inspectorUrl)
  await inspector.ready
  if (hidden) {
    // inspect-brk stops before product startup. Install the test-only visibility
    // guard in that module's call frame before its BrowserWindow is constructed.
    // No security preference or packaged application source is changed.
    await inspector.call('Debugger.enable')
    const paused = inspector.waitForPause()
    await inspector.call('Runtime.runIfWaitingForDebugger')
    const frame = (await paused).callFrames[0]
    const installed = await inspector.call('Debugger.evaluateOnCallFrame', {
      callFrameId: frame.callFrameId,
      expression: `(()=>{const electron=typeof require==='function'?require('electron'):process.mainModule.require('electron');globalThis.__packagedHiddenWindows=0;electron.app.on('browser-window-created',(_event,window)=>{globalThis.__packagedHiddenWindows++;window.on('show',()=>window.hide());window.show=()=>{};window.showInactive=()=>{};window.webContents.setBackgroundThrottling(false);});return true;})()`,
      returnByValue: true
    })
    if (installed.exceptionDetails) throw new Error(JSON.stringify(installed.exceptionDetails))
    assert.equal(installed.result.value, true)
    await inspector.call('Debugger.resume')
    await inspector.call('Debugger.disable')
  }
  const rendererStartedAt = Date.now()
  let browserUrl
  while (!browserUrl && Date.now() - rendererStartedAt < 20000) {
    assertAlive()
    browserUrl = combinedLog.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[^\s]+)/)?.[1]
    if (!browserUrl) await pause(100)
  }
  assert.ok(browserUrl, `No debugging endpoint from packaged app. Output: ${combinedLog}`)
  browser = new CDP(browserUrl)
  await browser.ready
  const actualProfile = await inspector.evaluate(`process.mainModule.require('electron').app.getPath('userData')`)
  report.appVersion = await inspector.evaluate(`process.mainModule.require('electron').app.getVersion()`)
  assert.equal(path.resolve(actualProfile).toLowerCase(), profile.toLowerCase(), 'Packaged test must use its disposable profile')
  report.checks.push('isolated disposable application profile')
  const endpoint = new URL(browserUrl)
  let target
  while (!target && Date.now() - rendererStartedAt < 20000) {
    assertAlive()
    const targets = await fetch(`http://${endpoint.host}/json/list`).then(response => response.json())
    target = targets.find(item => item.type === 'page' && /app\.asar.*renderer.*index\.html/.test(item.url))
    if (!target) await pause(100)
  }
  assert.ok(target, 'The actual packaged renderer must load from app.asar')
  page = new CDP(target.webSocketDebuggerUrl)
  await page.ready
  let ready = false
  while (!ready && Date.now() - rendererStartedAt < 25000) {
    ready = await page.evaluate(`!!(window.api?.startScan && document.querySelector('.empty-state .button-primary'))`)
    if (!ready) await pause(100)
  }
  assert.equal(ready, true, 'The actual packaged UI and preload must initialize')
  if (hidden) {
    assert.equal(await inspector.evaluate(`globalThis.__packagedHiddenWindows===1&&process.mainModule.require('electron').BrowserWindow.getAllWindows().every(window=>!window.isVisible())`), true)
    report.checks.push('staged test window remains hidden')
  }
  report.checks.push('actual packaged executable and renderer startup')
  const drives = await page.evaluate('window.api.getDrives()')
  assert.ok(Array.isArray(drives))
  report.driveCount = drives.length
  report.checks.push('native drive discovery')
  // Observe shallow terminal messages without changing scanner limits or behavior.
  await inspector.evaluate(`(()=>{const utility=process.mainModule.require('electron').utilityProcess;const original=utility.fork;globalThis.__packagedLastResult=null;utility.fork=function(...args){const child=Reflect.apply(original,utility,args);if(String(args[0]).endsWith('scanner-worker.js'))child.on('message',message=>{if(message?.type==='result'){const r=message.result;globalThis.__packagedLastResult={scanId:r.scanId,status:r.status,indexed:r.indexed,stopReason:r.stopReason,files:r.totalFiles,directories:r.totalDirectories,bytes:r.totalSize,errorCount:r.errorCount,skippedCount:r.skippedCount,scanDurationMs:r.scanDurationMs,serializedBytes:Buffer.byteLength(JSON.stringify(r),'utf8')};}});return child;};return true;})()`)
  const scanSummary = `({status:r.status,engine:r.engine,files:r.totalFiles,directories:r.totalDirectories,bytes:r.totalSize,rootBytes:r.root.size,errors:r.errorCount,skipped:r.skippedCount,durationMs:r.scanDurationMs,indexed:r.indexed===true,rootChildren:(r.root.children||[]).length,nestedChildren:(r.root.children||[]).some(child=>(child.children||[]).length>0),serializedBytes:JSON.stringify(r).length})`
  const signatures = new Map()
  for (let round = 0; round < rounds; round++) {
    for (const [name, directory] of [['fixture', fixture], ['source', path.join(workspace, 'src')], ['dependencies', path.join(workspace, 'node_modules')]]) {
      const scanId = `packaged-${round}-${name}`
      const result = await page.evaluate(`window.api.startScan(${JSON.stringify(directory)},${JSON.stringify(scanId)}).then(r=>${scanSummary})`)
      assert.equal(result.engine, 'native', `${name}: packaged native addon must load`)
      assert.equal(result.status, 'complete', `${name}: scan completes`)
      assert.equal(result.bytes, result.rootBytes, `${name}: root total agrees`)
      assert.equal(result.errors, 0, `${name}: generated/repository tree must be readable`)
      assert.equal(result.indexed, true, `${name}: final results retain a queryable index`)
      assert.equal(result.nestedChildren, false, `${name}: final IPC result must not contain descendants`)
      assert.ok(result.rootChildren <= 100, `${name}: root summary is bounded`)
      assert.ok(result.serializedBytes < 128 * 1024, `${name}: final metadata payload is bounded`)
      if (name === 'fixture') {
        assert.equal(result.files, fixtureFiles)
        assert.equal(result.bytes, fixtureBytes)
        const pages = await page.evaluate(`(async()=>{const request={scanId:${JSON.stringify(scanId)},path:${JSON.stringify(fixture)},limit:17};const first=await window.api.getScanDirectory(request);const next=await window.api.getScanDirectory({...request,offset:17});const filtered=await window.api.getScanDirectory({...request,query:'top-23',descending:false});const nested=await window.api.getScanDirectory({...request,path:${JSON.stringify(path.join(fixture, '$folder-0'))}});return {first,next,filtered,nested};})()`)
        assert.equal(pages.first.node.children.length, 17)
        assert.equal(pages.next.node.children.length, 17)
        assert.equal(pages.next.offset, 17)
        assert.equal(pages.first.totalChildren, 305)
        assert.equal(pages.first.totalMatches, 305)
        assert.equal(pages.first.root.size, fixtureBytes)
        assert.ok(pages.first.node.children.every((item, index, items) => index === 0 || items[index - 1].size >= item.size))
        assert.ok(pages.first.node.children.every(item => !(item.children?.length)), 'Directory pages contain shallow rows only')
        assert.ok(!pages.first.node.children.some(item => pages.next.node.children.some(other => other.path === item.path)), 'Directory pages do not overlap')
        assert.equal(pages.filtered.totalMatches, 10)
        assert.equal(pages.filtered.node.children.length, 10)
        assert.equal(pages.filtered.node.children[0].name, 'top-230.log')
        assert.equal(pages.filtered.node.children[9].name, 'top-239.log')
        assert.equal(pages.nested.totalChildren, 8)
        assert.equal(pages.nested.ancestors.length, 2)
        assert.ok(pages.nested.node.children.every(item => item.type === 'file'))
      }
      const signature = JSON.stringify([result.files, result.directories, result.bytes, result.errors, result.skipped])
      if (signatures.has(name)) assert.equal(signature, signatures.get(name), `${name}: repeated scans agree`)
      else signatures.set(name, signature)
      report.scans.push({ round, name, ...result })
      console.log(JSON.stringify({ phase: 'scan', round, name, ...result }))
      assertAlive()
    }
  }
  report.checks.push('repeated native scans with exact fixture bytes and stable repository totals')
  report.checks.push('bounded shallow result metadata, directory paging, backend filtering and size sorting')
  const dependencies = JSON.stringify(path.join(workspace, 'node_modules'))
  const cancelled = await page.evaluate(`(async()=>{const promise=window.api.startScan(${dependencies},'packaged-cancel');await window.api.cancelScan('packaged-cancel');const r=await promise;return ${scanSummary};})()`)
  assert.equal(cancelled.status, 'cancelled')
  assert.equal(cancelled.bytes, cancelled.rootBytes)
  report.checks.push('cancel acknowledgement and partial totals')
  const replacement = await page.evaluate(`(async()=>{const old=window.api.startScan(${dependencies},'packaged-old');const next=window.api.startScan(${JSON.stringify(fixture)},'packaged-new');const [a,b]=await Promise.all([old,next]);return {oldStatus:a.status,newStatus:b.status,files:b.totalFiles,bytes:b.totalSize};})()`)
  assert.equal(replacement.oldStatus, 'cancelled')
  assert.equal(replacement.newStatus, 'complete')
  assert.equal(replacement.files, fixtureFiles)
  assert.equal(replacement.bytes, fixtureBytes)
  report.checks.push('scan replacement')
  const uiScan = async (directory, name, bounded = false, expectedFailure = false) => {
    // Only the folder picker is stubbed; the production controller, worker,
    // progress subscriptions, tree transfer, Zustand updates and React rendering run.
    await inspector.evaluate(`(()=>{const {ipcMain}=process.mainModule.require('electron');ipcMain.removeHandler('select-folder');ipcMain.handle('select-folder',async()=>${JSON.stringify(directory)});return true;})()`)
    await page.evaluate(`(()=>{window.__packagedProgress=null;window.__packagedProgressUnsubscribe?.();window.__packagedProgressUnsubscribe=window.api.onScanProgress(p=>{window.__packagedProgress={files:p.filesScanned,directories:p.directoriesScanned,bytes:p.totalSizeBytes,engine:p.engine,elapsedMs:p.elapsedMs};});document.querySelector('.sidebar-folder button').click();return true;})()`)
    const started = Date.now()
    let stopRequested = false
    let state
    let lastMemorySample = 0
    let lastProgressLog = 0
    let memory
    while (Date.now() - started < scanMs + 20000) {
      await pause(100)
      assertAlive()
      state = await page.evaluate(`(()=>{const status=document.querySelector('.status-bar')?.innerText||'';return {busy:!!document.querySelector('.scan-activity'),error:!!document.querySelector('.notice-error'),complete:status.includes('Scan complete'),stopped:status.includes('Scan stopped'),partial:status.includes('Partial scan'),memoryLimit:status.includes('memory limit'),files:Number(status.match(/([\\d,]+) files/)?.[1]?.replaceAll(',','')),rows:document.querySelectorAll('[data-file-row]').length,progress:window.__packagedProgress};})()`)
      if (Date.now() - lastMemorySample >= 1000 || !state.busy) {
        memory = await inspector.evaluate(`(()=>{const metrics=process.mainModule.require('electron').app.getAppMetrics();const usage=process.memoryUsage();return {mainRssMiB:Math.round(usage.rss/1048576),mainHeapUsedMiB:Math.round(usage.heapUsed/1048576),processes:metrics.map(m=>({type:m.type,name:m.name,serviceName:m.serviceName,workingSetMiB:Math.round(m.memory.workingSetSize/1024),peakWorkingSetMiB:Math.round(m.memory.peakWorkingSetSize/1024),privateMiB:Math.round(m.memory.privateBytes/1024)}))};})()`)
        report.memorySamples.push({ phase: name, elapsedMs: Date.now() - started, files: state.progress?.files || state.files || 0, ...memory })
        lastMemorySample = Date.now()
      }
      if (bounded && Date.now() - lastProgressLog >= 5000) {
        console.log(JSON.stringify({ phase: 'ui-progress', name, files: state.progress?.files || 0, elapsedMs: Date.now() - started, mainRssMiB: memory?.mainRssMiB, scannerRssMiB: memory?.processes.find(item => /DiskSizer\s*Scanner/.test(item.name || ''))?.workingSetMiB }))
        lastProgressLog = Date.now()
      }
      if (expectedFailure && state.error) break
      if (!expectedFailure) assert.equal(state.error, false, `${name}: UI must not report a scan error`)
      if (!state.busy && (state.complete || state.stopped || state.partial)) break
      const memoryLimit = memory?.mainRssMiB >= 1536 || memory?.mainHeapUsedMiB >= 1024
      if (bounded && !stopRequested && (Date.now() - started >= scanMs || (state.progress?.files || 0) >= maxFiles || memoryLimit)) {
        stopRequested = await page.evaluate(`(()=>{const stop=document.querySelector('.scan-activity button');if(!stop||stop.disabled)return false;stop.click();return true;})()`)
        console.log(JSON.stringify({ phase: 'ui-stop', name, reason: memoryLimit ? 'memory-limit' : (state.progress?.files || 0) >= maxFiles ? 'file-limit' : 'time-limit', files: state.progress?.files || 0 }))
      }
    }
    assert.equal(state?.busy, false, `${name}: UI must finish or acknowledge Stop`)
    if (expectedFailure) {
      assert.equal(state.error, true, `${name}: scanner process failure must become a visible error`)
      report.scans.push({ phase: 'ui', name, durationMs: Date.now() - started, expectedFailure: true, ...state })
      console.log(JSON.stringify({ phase: 'ui-scan', name, durationMs: Date.now() - started, expectedFailure: true, ...state }))
      await page.evaluate('window.__packagedProgressUnsubscribe?.();true')
      return
    }
    assert.ok(state.complete || state.stopped || state.partial, `${name}: UI must show a terminal scan state`)
    if (name === 'fixture') {
      assert.equal(state.complete, true)
      assert.equal(state.files, fixtureFiles)
      assert.ok(state.rows > 0)
    }
    if (stopRequested) assert.equal(state.stopped, true, `${name}: stopped scan must stay explicitly partial`)
    await page.evaluate('window.__packagedProgressUnsubscribe?.();true')
    report.scans.push({ phase: 'ui', name, durationMs: Date.now() - started, stopRequested, ...state })
    console.log(JSON.stringify({ phase: 'ui-scan', name, durationMs: Date.now() - started, stopRequested, ...state }))
    return { stopRequested, ...state }
  }
  await uiScan(fixture, 'fixture')
  const waitForUI = async (expression, message) => {
    const until = Date.now() + 10000
    while (Date.now() < until) {
      assertAlive()
      if (await page.evaluate(expression)) return
      await pause(100)
    }
    throw new Error(message)
  }
  const filterUI = async query => {
    await page.evaluate(`(()=>{const input=document.querySelector('input[aria-label="Filter files and folders by name"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(query)});input.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`)
  }
  await waitForUI(`document.querySelectorAll('[data-file-row]').length===100&&!document.querySelector('.table-empty[role="status"]')`, 'Fixture page should show 100 loaded rows')
  await page.evaluate(`document.querySelector('button[aria-label="Next page"]').click();true`)
  await waitForUI(`document.querySelector('.table-pagination')?.innerText.includes('101')&&!document.querySelector('.table-empty[role="status"]')`, 'Next page should fetch rows 101 onward')
  await filterUI('top-23')
  await waitForUI(`document.querySelectorAll('[data-file-row]').length===10&&document.querySelector('[data-file-row] .file-name')?.textContent==='top-239.log'&&!document.querySelector('.table-empty[role="status"]')`, 'Filter should search the entire indexed directory')
  await page.evaluate(`document.querySelector('button[aria-label="Sort file size smallest first"]').click();true`)
  await waitForUI(`document.querySelector('[data-file-row] .file-name')?.textContent==='top-230.log'&&!document.querySelector('.table-empty[role="status"]')`, 'Ascending sort should reorder filtered results')
  await filterUI('$folder-0')
  await waitForUI(`document.querySelectorAll('[data-file-row]').length===1&&!!document.querySelector('button[aria-label="Open folder $folder-0"]')&&!document.querySelector('.table-empty[role="status"]')`, 'Indexed directory summaries remain navigable')
  await page.evaluate(`document.querySelector('button[aria-label="Open folder $folder-0"]').click();true`)
  await waitForUI(`document.querySelector('h1')?.textContent==='$folder-0'&&document.querySelectorAll('[data-file-row]').length===8&&!document.querySelector('.table-empty[role="status"]')`, 'Opening a folder should load its own page')
  await page.evaluate(`document.querySelector('.breadcrumbs button').click();true`)
  await waitForUI(`document.querySelector('h1')?.textContent==='fixture'&&document.querySelectorAll('[data-file-row]').length===100&&!document.querySelector('.table-empty[role="status"]')`, 'Breadcrumb navigation should reload the parent page')
  report.checks.push('UI paging, filtering, sorting, folder navigation and parent navigation')
  await uiScan(path.join(workspace, 'node_modules'), 'dependencies')
  report.checks.push('actual UI controller, completion transport, list and status rendering')
  if (additionalTarget) {
    const result = await uiScan(additionalTarget, 'additional-target', true)
    report.checks.push(`bounded additional target via UI (stop at ${maxFiles} files or ${scanMs} ms)`)
    if (expectMemoryLimit) {
      assert.equal(result.stopRequested, false, 'The production memory guard must stop before a manual test stop')
      assert.equal(result.partial, true)
      assert.equal(result.memoryLimit, true, 'The UI must explain the memory-limited partial result')
      const terminal = await inspector.evaluate('globalThis.__packagedLastResult')
      assert.equal(terminal.status, 'partial')
      assert.equal(terminal.stopReason, 'memory-limit')
      assert.equal(terminal.indexed, true)
      const directory = await page.evaluate(`window.api.getScanDirectory({scanId:${JSON.stringify(terminal.scanId)},path:${JSON.stringify(additionalTarget)},limit:17}).then(p=>({rows:p.node.children.length,available:p.node.detailsAvailable,bytes:p.root.size,totalChildren:p.totalChildren}))`)
      assert.ok(directory.rows > 0 && directory.rows <= 17)
      assert.equal(directory.available, true)
      assert.equal(directory.bytes, terminal.bytes)
      await waitForUI(`document.querySelectorAll('[data-file-row]').length>0&&!document.querySelector('.table-empty[role="status"]')`, 'Memory-limited results remain browsable in the UI')
      report.memoryLimitResult = { ...terminal, directory }
      report.checks.push('production memory guard stops automatically with indexed, browsable partial results')
      console.log(JSON.stringify({ phase: 'production-memory-guard', ...report.memoryLimitResult }))
    }
    if (expectFullScan) {
      assert.equal(result.stopRequested, false, 'Full-scan verification must not require a manual test stop')
      assert.equal(result.memoryLimit, false, 'Full-scan verification must not reach the memory limit')
      const terminal = await inspector.evaluate('globalThis.__packagedLastResult')
      assert.ok(['complete', 'partial'].includes(terminal.status), 'Protected locations may produce a partial result, but traversal must end normally')
      assert.equal(terminal.stopReason, undefined)
      assert.equal(terminal.indexed, true)
      assert.ok(terminal.files > 0)
      assert.ok(terminal.serializedBytes < 128 * 1024, 'A whole-drive terminal result remains bounded')
      const deepBrowse = await page.evaluate(`(async()=>{
        const scanId=${JSON.stringify(terminal.scanId)},root=${JSON.stringify(additionalTarget)};
        const pending=[{path:root,chain:[]}];let directoriesVisited=0,filesChecked=0;
        window.__packagedDeepTarget=null;
        while(pending.length&&directoriesVisited<40){
          const current=pending.pop();const directory=await window.api.getScanDirectory({scanId,path:current.path,limit:100,descending:true});directoriesVisited++;
          if(directory.node.path!==current.path||directory.ancestors.at(-1)?.path!==current.path)throw new Error('Indexed directory ancestry does not match its requested path');
          const files=(directory.node.children||[]).filter(item=>item.type==='file'&&!['error','skipped','pending','scanning'].includes(item.status));
          for(const item of files){const expected=directory.node.path.replace(/[\\\\/]+$/,'')+'\\\\'+item.name;if(item.path!==expected)throw new Error('Lazy file path does not match its containing directory');filesChecked++;}
          if(current.chain.length>=3&&files.length){window.__packagedDeepTarget={chain:current.chain,parentPath:current.path,fileName:files[0].name,filePath:files[0].path};return {directoriesVisited,filesChecked,depth:current.chain.length,pathsValid:true};}
          if(current.chain.length<8){const children=(directory.node.children||[]).filter(item=>item.type==='directory'&&item.detailsAvailable&&!['error','skipped','pending','scanning'].includes(item.status));for(let index=children.length-1;index>=0;index--)pending.push({path:children[index].path,chain:[...current.chain,children[index].name]});}
        }
        throw new Error('No readable deep indexed file was found within the bounded traversal check');
      })()`)
      assert.ok(deepBrowse.depth >= 3 && deepBrowse.filesChecked > 0)
      for (let level = 0; level < deepBrowse.depth; level++) {
        await page.evaluate(`(()=>{const input=document.querySelector('input[aria-label="Filter files and folders by name"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,window.__packagedDeepTarget.chain[${level}]);input.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`)
        await waitForUI(`!document.querySelector('.table-empty[role="status"]')&&[...document.querySelectorAll('.file-table button')].some(button=>button.getAttribute('aria-label')==='Open folder '+window.__packagedDeepTarget.chain[${level}])`, 'Deep indexed folder should be available through the UI')
        await page.evaluate(`[...document.querySelectorAll('.file-table button')].find(button=>button.getAttribute('aria-label')==='Open folder '+window.__packagedDeepTarget.chain[${level}]).click();true`)
        await waitForUI(`document.querySelector('h1')?.textContent===window.__packagedDeepTarget.chain[${level}]&&!document.querySelector('.table-empty[role="status"]')`, 'Deep folder navigation should finish loading')
      }
      await page.evaluate(`(()=>{const input=document.querySelector('input[aria-label="Filter files and folders by name"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,window.__packagedDeepTarget.fileName);input.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`)
      await waitForUI(`!document.querySelector('.table-empty[role="status"]')&&[...document.querySelectorAll('[data-file-row] .file-name')].some(item=>item.textContent===window.__packagedDeepTarget.fileName)`, 'Deep indexed file should appear in the filtered UI page')
      await page.evaluate(`[...document.querySelectorAll('[data-file-row]')].find(row=>row.querySelector('.file-name')?.textContent===window.__packagedDeepTarget.fileName).click();true`)
      await waitForUI(`document.querySelector('.inspector-path')?.textContent===window.__packagedDeepTarget.filePath`, 'Inspector should show the reconstructed full path of a deep file')
      await page.evaluate(`document.querySelector('button[aria-label="Close details"]').click();true`)
      await page.evaluate(`document.querySelector('.breadcrumbs button').click();true`)
      await waitForUI(`document.querySelectorAll('[data-file-row]').length>0&&!document.querySelector('.table-empty[role="status"]')`, 'Parent root remains browsable after deep navigation')
      report.fullScanResult = { ...terminal, deepBrowse }
      report.checks.push('whole target traversal without memory/manual stop; deep indexed paths and UI browsing verified')
      console.log(JSON.stringify({ phase: 'full-scan-verified', ...report.fullScanResult }))
    }
  }
  if (process.env.DISKVISION_SMOKE_FAULT === '1') {
    await inspector.evaluate(`(()=>{const utility=process.mainModule.require('electron').utilityProcess;const original=utility.fork;globalThis.__packagedFault={injected:false};utility.fork=function(...args){const child=Reflect.apply(original,utility,args);if(String(args[0]).endsWith('scanner-worker.js')){utility.fork=original;child.on('message',message=>{if(message?.type==='progress'&&!globalThis.__packagedFault.injected){globalThis.__packagedFault.injected=true;child.kill();}});}return child;};return true;})()`)
    await uiScan(path.join(workspace, 'node_modules'), 'deliberate-scanner-failure', false, true)
    assert.equal(await inspector.evaluate('globalThis.__packagedFault.injected'), true, 'Only the scanner utility process was deliberately killed')
    assertAlive()
    await uiScan(fixture, 'fixture')
    report.checks.push('scanner process termination contained; visible error and subsequent UI scan succeeds')
  }
  // Do not capture filenames from an optionally supplied real drive.
  if (!additionalTarget && !hidden) {
    const screenshot = await page.call('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(output, 'packaged-smoke-startup.png'), Buffer.from(screenshot.data, 'base64'))
  }
  await inspector.evaluate(`(()=>{process.mainModule.require('v8').setFlagsFromString('--expose-gc');process.mainModule.require('vm').runInNewContext('gc')();return true;})()`)
  await pause(100)
  assertAlive()
  assert.equal(await inspector.evaluate(`process.mainModule.require('electron').BrowserWindow.getAllWindows().length`), 1, 'Main window survives forced post-scan garbage collection')
  assert.equal(await page.evaluate('document.title'), 'DiskSizer')
  report.checks.push('main window remains open after forced post-scan garbage collection')
  const idleStarted = Date.now()
  while (Date.now() - idleStarted < idleMs) {
    await pause(Math.min(5000, idleMs - (Date.now() - idleStarted)))
    assertAlive()
    assert.equal(await page.evaluate('document.title'), 'DiskSizer')
    console.log(JSON.stringify({ phase: 'idle', elapsedMs: Date.now() - idleStarted, alive: true }))
  }
  report.checks.push(`responsive idle for ${idleMs} ms after scans`)
  inspector.close()
  inspector = null
  try { await browser.call('Browser.close') } catch (error) { if (!/CDP closed/.test(error.message)) throw error }
  const exit = await deadline(exited, 15000, 'Normal packaged app shutdown')
  assert.equal(exit.code, 0, `App must exit normally: ${JSON.stringify(exit)}`)
  report.exit = exit
  report.checks.push('normal exit code zero')
  report.success = true
}

main().catch(error => {
  report.error = error.stack || error.message
  report.exit = exitRecord
  console.error(error)
  process.exitCode = 1
}).finally(async () => {
  page?.close()
  browser?.close()
  inspector?.close()
  if (child && !exitRecord) {
    child.kill()
    const deadlineAt = Date.now() + 10000
    while (!exitRecord && Date.now() < deadlineAt) await pause(100)
  }
  report.finishedAt = new Date().toISOString()
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))
  fs.writeFileSync(path.join(output, 'packaged-smoke-process.log'), combinedLog)
  const diagnosticLog = path.join(profile, 'logs', 'diskvision.log')
  if (fs.existsSync(diagnosticLog)) fs.copyFileSync(diagnosticLog, path.join(output, 'packaged-smoke-diagnostics.log'))
  if (!report.success) {
    const crashDumps = path.join(profile, 'Crashpad')
    if (fs.existsSync(crashDumps)) fs.cpSync(crashDumps, path.join(output, `packaged-smoke-crashpad-${Date.now()}`), { recursive: true })
  }
  // Never remove a profile until the owning app process has exited.
  if (!child || exitRecord) {
    const resolved = path.resolve(temporaryRoot)
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()))
    assert.match(path.basename(resolved), /^diskvision-packaged-[A-Za-z0-9]+$/)
    fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  } else {
    console.error(`App did not exit; preserved test profile at ${temporaryRoot}`)
  }
  console.log(JSON.stringify({ success: report.success, checks: report.checks, report: reportPath }))
})
