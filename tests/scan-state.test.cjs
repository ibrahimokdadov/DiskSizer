require('./register-ts.cjs')
const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const { useScanStore } = require('../src/renderer/src/store/scan-store.ts')
const { useUIStore } = require('../src/renderer/src/store/ui-store.ts')
const { createScanController } = require('../src/renderer/src/lib/scan-controller.ts')
const { canNavigate, canRecycleNode } = require('../src/renderer/src/lib/scan-tree.ts')

function result(scanId, root = { name: 'root', path: 'C:/root', type: 'directory', size: 0, children: [] }) {
  return { scanId, root, status: 'complete', engine: 'standard', sizeKind: 'logical', totalSize: root.size,
    totalFiles: 0, totalDirectories: 1, scanDurationMs: 1, errors: [], errorCount: 0, skippedCount: 0 }
}
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function mockApi() {
  const listeners = {}
  const runs = new Map()
  const cancelCalls = []
  let driveCalls = 0
  const listen = name => callback => { listeners[name] = callback; return () => { delete listeners[name] } }
  return {
    listeners, runs, cancelCalls,
    get driveCalls() { return driveCalls },
    getDrives: async () => { driveCalls++; return [] },
    startScan: (_path, scanId) => { const pending = deferred(); runs.set(scanId, pending); return pending.promise },
    cancelScan: async id => { cancelCalls.push(id) },
    selectFolder: async () => null,
    onScanProgress: listen('progress'), onScanComplete: listen('complete'),
    onScanCancelled: listen('cancelled'), onScanError: listen('error')
  }
}
beforeEach(() => { useScanStore.getState().reset() })

test('saved scans are read-only and a late open cannot replace a newer scan', async () => {
  const api = mockApi(), saved = deferred()
  api.openScan = () => saved.promise
  let sequence = 0
  const controller = createScanController(api, () => `request-${++sequence}`)
  const opening = controller.openScan()
  const scanning = controller.startScan('C:/newer')
  saved.resolve({ ...result('saved'), source: 'snapshot', indexed: true })
  await opening
  assert.equal(useScanStore.getState().activeScanId, 'request-2')
  api.runs.get('request-2').resolve(result('request-2'))
  await scanning
  assert.equal(useScanStore.getState().scanResult.scanId, 'request-2')
  assert.equal(canRecycleNode({ name: 'file', path: 'C:/root/file', type: 'file', size: 1, status: 'complete' }, { ...result('saved'), source: 'snapshot', indexed: true }, false), false)
})

test('a retained index failure is visible without overwriting a newer scan', () => {
  const api = mockApi()
  const controller = createScanController(api)
  const disconnect = controller.connect()
  useScanStore.getState().setScanResult({ ...result('retained'), indexed: true })
  api.listeners.error({ scanId: 'retained', message: 'The results helper stopped. Please rescan.' })
  assert.match(useScanStore.getState().actionError, /results helper stopped/)
  assert.equal(useScanStore.getState().scanResult.scanId, 'retained')
  useScanStore.setState({ activeScanId: 'newer', isScanning: true, actionError: null })
  api.listeners.error({ scanId: 'retained', message: 'Late old helper failure' })
  assert.equal(useScanStore.getState().actionError, null)
  assert.equal(useScanStore.getState().activeScanId, 'newer')
  disconnect()
})

test('deleting one file preserves unrelated aggregated or unloaded bytes', () => {
  const file = { name: 'file', path: 'C:/root/file', type: 'file', size: 10 }
  const other = { name: 'Other', path: 'C:/root/other', type: 'directory', kind: 'aggregate', size: 100, children: [] }
  const deep = { name: 'deep', path: 'C:/root/deep', type: 'directory', size: 300, childrenLoaded: false, children: [] }
  const root = { name: 'root', path: 'C:/root', type: 'directory', size: 410, children: [file, other, deep], itemCount: 8 }
  useScanStore.getState().setScanResult({ ...result('one', root), totalFiles: 6, totalDirectories: 3 })
  useScanStore.getState().removeNode(file.path)
  const updated = useScanStore.getState().scanResult
  assert.equal(updated.totalSize, 400)
  assert.equal(updated.root.children[0].size, 100)
  assert.equal(updated.root.children[1].size, 300)
  assert.equal(updated.totalFiles, 5)
  assert.equal(updated.totalDirectories, 3)
})

test('deleting a nested directory updates only its ancestors and restores navigation', () => {
  const nested = { name: 'nested', path: 'C:/root/folder/nested', type: 'directory', size: 20, itemCount: 1,
    children: [{ name: 'data', path: 'C:/root/folder/nested/data', type: 'file', size: 20 }] }
  const folder = { name: 'folder', path: 'C:/root/folder', type: 'directory', size: 20, itemCount: 2, children: [nested] }
  const sibling = { name: 'keep', path: 'C:/root/keep', type: 'file', size: 30 }
  const root = { name: 'root', path: 'C:/root', type: 'directory', size: 50, itemCount: 4, children: [folder, sibling] }
  useScanStore.getState().setScanResult({ ...result('one', root), totalFiles: 2, totalDirectories: 3 })
  useScanStore.getState().navigateIn(folder)
  useScanStore.getState().navigateIn(nested)
  useScanStore.getState().removeNode(nested.path)
  assert.equal(useScanStore.getState().currentNode.path, folder.path)
  assert.equal(useScanStore.getState().scanResult.totalSize, 30)
  assert.equal(useScanStore.getState().scanResult.totalFiles, 1)
  assert.equal(useScanStore.getState().scanResult.totalDirectories, 2)
  assert.equal(useScanStore.getState().scanResult.root.children[1], sibling)
})

test('navigation rejects repeated current, stale, and unloaded targets', () => {
  const child = { name: 'child', path: 'C:/root/child', type: 'directory', size: 0, children: [] }
  const root = { name: 'root', path: 'C:/root', type: 'directory', size: 0, children: [child] }
  useScanStore.getState().setScanResult(result('one', root))
  useScanStore.getState().navigateIn(root)
  useScanStore.getState().navigateIn({ ...child, childrenLoaded: false })
  useScanStore.getState().navigateIn({ ...child, path: 'C:/unrelated' })
  assert.equal(useScanStore.getState().navigationStack.length, 1)
  useUIStore.getState().setSelectedNode(child)
  useScanStore.getState().navigateIn(child)
  useScanStore.getState().navigateIn(child)
  assert.equal(useScanStore.getState().navigationStack.length, 2)
  assert.equal(useUIStore.getState().selectedNode, null)
})

test('indexed navigation and page summaries stay bounded and reject stale paths or scans', () => {
  const root = { name: 'root', path: 'C:/root', type: 'directory', size: 1000, status: 'complete', detailsAvailable: true, fileCount: 10000, directoryCount: 100 }
  const child = { name: 'child', path: 'C:/root/child', type: 'directory', size: 300, status: 'partial', childrenLoaded: false, detailsAvailable: true }
  useScanStore.getState().setScanResult({ ...result('indexed', root), indexed: true })
  useScanStore.getState().navigateIn({ ...child, path: 'C:/root/child/deeper' })
  assert.equal(useScanStore.getState().currentNode.path, root.path)
  useScanStore.getState().navigateIn(child)
  assert.equal(useScanStore.getState().currentNode.path, child.path)
  const file = { name: 'one.txt', path: child.path + '/one.txt', type: 'file', size: 20, status: 'complete' }
  const page = { scanId: 'indexed', root, node: { ...child, children: [file] }, ancestors: [root, child], totalMatches: 800, totalChildren: 800, offset: 100, limit: 100 }
  useScanStore.getState().applyDirectoryPage(page)
  assert.equal(useScanStore.getState().currentNode.children.length, 1)
  assert.equal(useScanStore.getState().scanResult.root.children, undefined)
  assert.equal(useScanStore.getState().scanResult.totalFiles, 10000)
  useScanStore.getState().applyDirectoryPage({ ...page, scanId: 'old', root: { ...root, size: 999999 } })
  assert.equal(useScanStore.getState().scanResult.totalSize, 1000)
  useScanStore.getState().navigateUp()
  useScanStore.getState().applyDirectoryPage(page)
  assert.equal(useScanStore.getState().currentNode.path, root.path)
})

test('indexed deletion invalidation refreshes authoritative counts without subtracting from a shallow tree', () => {
  const root = { name: 'root', path: 'C:/root', type: 'directory', size: 1000, status: 'complete', detailsAvailable: true, fileCount: 10000, directoryCount: 100 }
  useScanStore.getState().setScanResult({ ...result('indexed', root), indexed: true })
  const beforeRevision = useScanStore.getState().directoryRevision
  useUIStore.getState().setSelectedNode({ name: 'removed', path: 'C:/root/removed', type: 'directory', size: 400 })
  useScanStore.getState().invalidateDirectoryPages()
  assert.equal(useScanStore.getState().directoryRevision, beforeRevision + 1)
  assert.equal(useUIStore.getState().selectedNode, null)
  assert.equal(useScanStore.getState().scanResult.totalSize, 1000)
  const updated = { ...root, size: 600, fileCount: 6000, directoryCount: 60 }
  useScanStore.getState().applyDirectoryPage({ scanId: 'indexed', root: updated, node: { ...updated, children: [] }, ancestors: [updated], totalMatches: 0, totalChildren: 0, offset: 0, limit: 100 })
  assert.equal(useScanStore.getState().scanResult.totalSize, 600)
  assert.equal(useScanStore.getState().scanResult.totalFiles, 6000)
  assert.equal(useScanStore.getState().scanResult.totalDirectories, 60)
})

test('partially scanned indexed folders can be inspected but cannot be recycled', () => {
  const scan = { ...result('indexed'), indexed: true }
  const folder = { name: 'partial', path: 'C:/root/partial', type: 'directory', size: 10, status: 'partial', childrenLoaded: true, detailsAvailable: true }
  assert.equal(canNavigate(folder), true)
  assert.equal(canRecycleNode(folder, scan, false), false)
  assert.equal(canRecycleNode({ ...folder, status: 'complete' }, scan, false), true)
  assert.equal(canRecycleNode({ ...folder, status: 'complete', childrenLoaded: false }, scan, false), false)
  assert.equal(canRecycleNode({ ...folder, status: 'complete' }, scan, true), false)
  assert.equal(canRecycleNode(scan.root, scan, false), false)
  assert.equal(canRecycleNode({ ...folder, status: undefined }, result('legacy'), false), true)
})

test('old completion, error, progress, and promise rejection cannot overwrite a newer scan', async () => {
  const api = mockApi()
  let sequence = 0
  const controller = createScanController(api, () => `scan-${++sequence}`)
  const disconnect = controller.connect()
  const first = controller.startScan('C:/old')
  const second = controller.startScan('C:/new')
  api.listeners.complete(result('scan-1'))
  api.listeners.error({ scanId: 'scan-1', message: 'Old failure' })
  api.listeners.progress({ scanId: 'scan-1', filesScanned: 10 })
  api.runs.get('scan-1').reject(new Error('Old rejected invocation'))
  await first
  assert.equal(useScanStore.getState().activeScanId, 'scan-2')
  assert.equal(useScanStore.getState().scanResult, null)
  assert.equal(useScanStore.getState().scanError, null)
  assert.equal(useScanStore.getState().scanProgress, null)
  api.runs.get('scan-2').resolve(result('scan-2'))
  await second
  assert.equal(useScanStore.getState().scanResult.scanId, 'scan-2')
  assert.equal(useScanStore.getState().isScanning, false)
  disconnect()
})

test('Stop stays pending until acknowledgement and retains a cancelled partial result', async () => {
  const api = mockApi()
  const controller = createScanController(api, () => 'stop-test')
  const disconnect = controller.connect()
  const scan = controller.startScan('C:/root')
  await controller.cancelScan()
  assert.deepEqual(api.cancelCalls, ['stop-test'])
  assert.equal(useScanStore.getState().isScanning, true)
  assert.equal(useScanStore.getState().isCancelling, true)
  const stopped = { ...result('stop-test'), status: 'cancelled' }
  api.listeners.cancelled(stopped)
  api.runs.get('stop-test').resolve(stopped)
  await scan
  assert.equal(useScanStore.getState().scanResult.status, 'cancelled')
  assert.equal(useScanStore.getState().isScanning, false)
  assert.equal(useScanStore.getState().isCancelling, false)
  disconnect()
})

test('refresh keeps the previous result visible and drive failures become visible state', async () => {
  const old = result('previous')
  useScanStore.getState().setScanResult(old)
  const api = mockApi()
  api.getDrives = async () => { throw new Error('Drive discovery unavailable') }
  const controller = createScanController(api, () => 'refresh')
  const disconnect = controller.connect()
  await controller.refreshDrives()
  assert.equal(useScanStore.getState().drivesLoading, false)
  assert.match(useScanStore.getState().drivesError, /unavailable/)
  const scan = controller.startScan('C:/root')
  assert.equal(useScanStore.getState().scanResult, old)
  api.runs.get('refresh').reject(new Error('Access denied'))
  await scan
  assert.equal(useScanStore.getState().scanResult, old)
  assert.match(useScanStore.getState().scanError, /Access denied/)
  disconnect()
})
