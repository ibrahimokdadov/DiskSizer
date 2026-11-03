require('./register-ts.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { FastDiskScanner } = require('../src/main/scanner-fast.ts')
const { NativeDiskScanner, nativeAddon } = require('../src/main/scanner-native.ts')
const { MetadataScanner } = require('../src/main/scanner-core.ts')
const { shallowScanNode } = require('../src/main/scan-records.ts')

async function fixture(t) {
  const base = path.resolve(os.tmpdir())
  const root = await fs.mkdtemp(path.join(base, 'diskvision-scanner-test-'))
  t.after(async () => {
    const resolved = path.resolve(root)
    assert.ok(resolved.startsWith(base + path.sep) && path.basename(resolved).startsWith('diskvision-scanner-test-'))
    await fs.rm(resolved, { recursive: true, force: true })
  })
  return root
}

function find(root, targetPath) {
  const pending = [root]
  while (pending.length) {
    const node = pending.pop()
    if (node.path === targetPath) return node
    pending.push(...(node.children || []))
  }
}

test('memory pressure returns explicit partial results with consistent totals and unloaded directories', async t => {
  const root = await fixture(t)
  for (const method of ['scanBench', 'scanCompactBench']) {
    let heapBytes = 0
    const scanner = new MetadataScanner('standard', async dir => {
      if (dir === root) return [
        { name: 'known.txt', isDir: false, isSymlink: false, size: 91, mtime: 0 },
        { name: 'unfinished', isDir: true, isSymlink: false, size: 0, mtime: 0 }
      ]
      heapBytes = 200
      return [{ name: 'unaccounted.txt', isDir: false, isSymlink: false, size: 50, mtime: 0 }]
    }, 1, { maxHeapBytes: 100, heapUsed: () => heapBytes })
    const result = await scanner[method](root)
    assert.equal(result.status, 'partial')
    assert.equal(result.stopReason, 'memory-limit')
    assert.equal(result.totalSize, 91)
    assert.equal(result.root.size, 91)
    assert.equal(result.totalFiles, 1)
    assert.equal(result.errorCount, 1)
    assert.match(result.errors[0], /memory limit/)
    const unfinished = find(result.root, path.join(root, 'unfinished'))
    assert.equal(unfinished.status, 'partial')
    assert.equal(unfinished.childrenLoaded, false)
    assert.equal(scanner.isScanning, false)
  }
})

test('retains more than 40 entries, deep descendants, dollar folders and Unicode names', async t => {
  const root = await fixture(t)
  await Promise.all(Array.from({ length: 65 }, (_, index) => fs.writeFile(path.join(root, `file-${index}.txt`), Buffer.alloc(index + 1))))
  const deep = path.join(root, '$budget', ...Array.from({ length: 10 }, (_, index) => `level-${index}`))
  await fs.mkdir(deep, { recursive: true })
  const unicode = path.join(deep, '資料-😀.txt')
  await fs.writeFile(unicode, Buffer.alloc(123))
  const expected = 65 * 66 / 2 + 123
  for (const Scanner of nativeAddon ? [FastDiskScanner, NativeDiskScanner] : [FastDiskScanner]) {
    let preview
    const result = await new Scanner().scanBench(root, progress => { if (progress.partialRoot) preview = progress.partialRoot }, 'full-fixture')
    assert.equal(result.totalFiles, 66)
    assert.equal(result.totalSize, expected)
    assert.equal(result.root.size, expected)
    assert.equal(result.root.children.length, 66)
    assert.equal(result.totalDirectories, 12)
    assert.equal(result.status, 'complete')
    assert.equal(find(result.root, unicode).size, 123)
    assert.ok(preview.children.length <= 41)
    assert.equal(preview.children.reduce((sum, child) => sum + child.size, 0), preview.size)
    assert.equal(preview.children.find(child => child.kind === 'aggregate').childrenLoaded, false)
  }
})

test('compact records preserve metadata, statuses, and full preview paths without retaining file defaults', async t => {
  const root = await fixture(t)
  const entries = dir => dir === root ? [
    { name: '資料-😀.TXT', size: 11, mtime: 1234, isDir: false, isSymlink: false },
    { name: 'no-extension', size: 13, mtime: 2345, isDir: false, isSymlink: false },
    { name: '.hidden', size: 7, mtime: 3456, isDir: false, isSymlink: false },
    { name: 'denied.txt', size: 8, mtime: 4567, isDir: false, isSymlink: false, error: 'Denied metadata' },
    { name: 'cloud.txt', size: 9, mtime: 5678, isDir: false, isSymlink: false, skipReason: 'Offline placeholder' },
    { name: 'nested', size: 0, mtime: 0, isDir: true, isSymlink: false }
  ] : [{ name: 'deep.log', size: 19, mtime: 6789, isDir: false, isSymlink: false }]
  const full = await new MetadataScanner('standard', async dir => entries(dir)).scanBench(root, undefined, 'compact-comparison')
  let preview
  const compact = await new MetadataScanner('standard', async dir => entries(dir)).scanCompactBench(root, progress => {
    if (progress.phase === 'building') preview = progress.partialRoot
  }, 'compact-comparison')
  assert.equal(compact.compactFiles, true)
  assert.equal('compactFiles' in full, false)
  for (const key of ['status', 'totalSize', 'totalFiles', 'totalDirectories', 'errorCount', 'skippedCount']) assert.equal(compact[key], full[key], key)
  assert.equal(compact.totalFiles, 4)
  assert.equal(compact.totalSize, 50)
  assert.equal(compact.root.status, 'partial')
  assert.deepEqual(compact.errors, full.errors)
  assert.match(compact.errors[0], new RegExp('denied\\.txt: Denied metadata$'))
  const pending = [[full.root, compact.root]]
  while (pending.length) {
    const [fullDir, compactDir] = pending.pop()
    assert.equal(compactDir.path, fullDir.path)
    assert.equal(compactDir.status, fullDir.status)
    for (let index = 0; index < fullDir.children.length; index++) {
      const normal = fullDir.children[index], stored = compactDir.children[index]
      if (normal.type === 'directory') pending.push([normal, stored])
      else {
        for (const key of ['path', 'extension', 'childrenLoaded']) assert.equal(key in stored, false, key)
        if (normal.status === 'complete') assert.equal('status' in stored, false)
        else assert.equal(stored.status, normal.status)
        assert.deepEqual(shallowScanNode(stored, true, compactDir.path), normal)
      }
    }
  }
  assert.ok(preview)
  for (const node of preview.children.filter(node => node.type === 'file')) {
    assert.equal(node.path, path.join(root, node.name))
    assert.equal(node.childrenLoaded, true)
    assert.equal(node.status, full.root.children.find(child => child.name === node.name).status)
  }
  assert.equal(preview.children.find(node => node.name === '資料-😀.TXT').extension, 'txt')
})

test('both filesystem backends opt into compact records without changing default full results', async t => {
  const root = await fixture(t)
  const nested = path.join(root, 'one', 'two')
  await fs.mkdir(nested, { recursive: true })
  await fs.writeFile(path.join(nested, 'deep.DATA'), Buffer.alloc(17))
  for (const Scanner of nativeAddon ? [FastDiskScanner, NativeDiskScanner] : [FastDiskScanner]) {
    const scanner = new Scanner()
    const full = await scanner.scanBench(root)
    const compact = await scanner.scanCompactBench(root)
    assert.equal(full.status, 'complete')
    assert.equal(compact.status, 'complete')
    assert.equal(compact.root.status, 'complete')
    assert.equal(compact.totalSize, full.totalSize)
    assert.equal(compact.totalFiles, full.totalFiles)
    assert.equal(compact.totalDirectories, full.totalDirectories)
    const stored = compact.root.children[0].children[0].children[0]
    assert.deepEqual(Object.keys(stored).sort(), ['modified', 'name', 'size', 'type'])
    assert.equal(find(full.root, path.join(nested, 'deep.DATA')).extension, 'data')
    assert.deepEqual(shallowScanNode(stored, true, nested), find(full.root, path.join(nested, 'deep.DATA')))
  }
})

test('cancel emits a cancelled terminal event, never successful completion', async t => {
  const root = await fixture(t)
  await fs.writeFile(path.join(root, 'file.txt'), 'hello')
  for (const Scanner of nativeAddon ? [FastDiskScanner, NativeDiskScanner] : [FastDiskScanner]) {
    const scanner = new Scanner()
    const events = []
    const result = await scanner.scan(root, { webContents: { send(channel, payload) {
      events.push(channel)
      assert.equal(payload.scanId, 'cancel-fixture')
      if (channel === 'scan-progress') scanner.cancel()
    } } }, 'cancel-fixture')
    assert.equal(result.status, 'cancelled')
    assert.equal(scanner.isScanning, false)
    assert.ok(events.includes('scan-cancelled'))
    assert.ok(!events.includes('scan-complete'))
  }
})

test('missing scan targets fail rather than reporting an empty complete scan', async t => {
  const root = await fixture(t)
  const missing = path.join(root, 'missing')
  await assert.rejects(new FastDiskScanner().scanBench(missing), /ENOENT/)
  if (nativeAddon) {
    await assert.rejects(nativeAddon.readdirWithStats(missing), /Win32 error/)
    await assert.rejects(new NativeDiskScanner().scanBench(missing), /ENOENT/)
  }
})

test('directory worker concurrency stays globally bounded on a branching tree', async t => {
  const root = await fixture(t)
  let active = 0, peak = 0
  const scanner = new MetadataScanner('standard', async dir => {
    active++
    peak = Math.max(peak, active)
    await new Promise(resolve => setTimeout(resolve, 2))
    active--
    const depth = dir === root ? 0 : path.relative(root, dir).split(path.sep).length
    return depth < 2
      ? Array.from({ length: 8 }, (_, index) => ({ name: `dir-${index}`, isDir: true, isSymlink: false, size: 0, mtime: 0 }))
      : [{ name: 'file', isDir: false, isSymlink: false, size: 7, mtime: 0 }]
  }, 4)
  const result = await scanner.scanBench(root)
  assert.ok(peak > 1 && peak <= 4)
  assert.equal(result.totalFiles, 64)
  assert.equal(result.totalDirectories, 73)
  assert.equal(result.totalSize, 448)
  assert.equal(result.root.size, 448)
})

test('unreadable directories retain explicit error state and partial totals', async t => {
  const root = await fixture(t)
  const scanner = new MetadataScanner('standard', async dir => {
    if (dir !== root) throw new Error('Access denied')
    return [
      { name: 'blocked', isDir: true, isSymlink: false, size: 0, mtime: 0 },
      { name: 'readable.txt', isDir: false, isSymlink: false, size: 91, mtime: 0 }
    ]
  })
  const result = await scanner.scanBench(root)
  assert.equal(result.status, 'partial')
  assert.equal(result.errorCount, 1)
  assert.equal(result.totalSize, 91)
  assert.equal(result.root.status, 'partial')
  assert.equal(find(result.root, path.join(root, 'blocked')).status, 'error')
  assert.match(result.errors[0], /Access denied/)
})

test('starting a new scan isolates counters and cancels the previous invocation', async t => {
  const root = await fixture(t)
  let release
  const blocked = new Promise(resolve => { release = resolve })
  let calls = 0
  const scanner = new MetadataScanner('standard', async () => {
    calls++
    if (calls === 1) await blocked
    return [{ name: 'item', size: 19, mtime: 0, isDir: false, isSymlink: false }]
  })
  const first = scanner.scanBench(root, undefined, 'first')
  while (!calls) await new Promise(resolve => setImmediate(resolve))
  const second = await scanner.scanBench(root, undefined, 'second')
  release()
  const old = await first
  assert.equal(second.status, 'complete')
  assert.equal(second.scanId, 'second')
  assert.equal(second.totalSize, 19)
  assert.equal(old.status, 'cancelled')
  assert.equal(old.scanId, 'first')
  assert.equal(old.totalSize, 0)
})

test('junctions are reported as skipped and never followed into loops', async t => {
  if (process.platform !== 'win32') return t.skip('Windows junction semantics')
  const root = await fixture(t)
  await fs.writeFile(path.join(root, 'file.txt'), '12345')
  await fs.symlink(root, path.join(root, 'loop'), 'junction')
  for (const Scanner of nativeAddon ? [FastDiskScanner, NativeDiskScanner] : [FastDiskScanner]) {
    const result = await new Scanner().scanBench(root)
    assert.equal(result.totalSize, 5)
    assert.equal(result.totalFiles, 1)
    assert.equal(result.skippedCount, 1)
    assert.equal(result.status, 'partial')
    assert.equal(find(result.root, path.join(root, 'loop')).status, 'skipped')
  }
})

test('cancelling an in-flight directory preserves unloaded and queued directory states', async t => {
  const root = await fixture(t)
  for (const [rejectRead, method] of [false, true].flatMap(rejectRead => ['scanBench', 'scanCompactBench'].map(method => [rejectRead, method]))) {
    let release
    const blocked = new Promise(resolve => { release = resolve })
    let childStarted = false
    const scanner = new MetadataScanner('standard', async dir => {
      if (dir === root) return ['running', 'queued'].map(name => ({ name, isDir: true, isSymlink: false, size: 0, mtime: 0 }))
      childStarted = true
      await blocked
      if (rejectRead) throw new Error('Read interrupted')
      return [{ name: 'unprocessed.txt', isDir: false, isSymlink: false, size: 37, mtime: 0 }]
    }, 1)
    const scanning = scanner[method](root)
    while (!childStarted) await new Promise(resolve => setImmediate(resolve))
    scanner.cancel()
    release()
    const result = await scanning
    const running = find(result.root, path.join(root, 'running'))
    const queued = find(result.root, path.join(root, 'queued'))
    assert.equal(result.status, 'cancelled')
    assert.equal(result.root.status, 'partial')
    assert.equal(result.root.childrenLoaded, true)
    assert.equal(running.status, 'partial')
    assert.equal(running.childrenLoaded, false)
    assert.equal(queued.status, 'pending')
    assert.equal(queued.childrenLoaded, false)
    assert.equal(result.totalDirectories, 2)
    assert.equal(result.totalFiles, 0)
    assert.equal(result.errorCount, 0)
  }
})
