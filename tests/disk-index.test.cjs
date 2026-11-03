require('./register-ts.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { DiskScanIndex } = require('../src/main/disk-index.ts')
const { readNativeDirectory, nativeAddon } = require('../src/main/scanner-native.ts')
const { readStandardDirectory } = require('../src/main/scanner-fast.ts')

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'diskvision-index-test-'))
  const opened = new Set()
  t.after(async () => {
    for (const index of opened) await index.close()
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()))
    assert.ok(path.basename(root).startsWith('diskvision-index-test-'))
    await fs.rm(root, { recursive: true, force: true })
  })
  const target = path.join(root, 'files'); await fs.mkdir(target)
  return { root, target, opened, database: path.join(root, 'scan.diskvision') }
}
const file = (name, size, allocatedSize, fileIdentity, mtime = 100) => ({ name, size, allocatedSize, fileIdentity, mtime, isDir: false, isSymlink: false })
const directory = name => ({ name, size: 0, mtime: 0, isDir: true, isSymlink: false })

test('disk index attributes allocation once, retains logical aliases, and transfers allocation after removal', async t => {
  const f = await fixture(t)
  async function* read(dir) {
    if (dir === f.target) yield [directory('A'), directory('B'), file('unknown.bin', 70), file('sparse.bin', 65536, 0, 'sparse')]
    else yield [file('same.dat', 100, 4096, 'shared')]
  }
  const index = await DiskScanIndex.scan(f.database, f.target, 'one', 'native', read, new AbortController().signal, () => {})
  f.opened.add(index)
  const summary = await index.summary()
  assert.equal(summary.totalSize, 65806)
  assert.equal(summary.root.allocatedSize, 4096)
  assert.equal(summary.root.allocationUnknownFiles, 1)
  assert.equal(summary.totalFiles, 4)
  assert.equal(summary.totalDirectories, 3)
  const a = await index.page({ scanId: 'one', path: path.join(f.target, 'A') })
  const b = await index.page({ scanId: 'one', path: path.join(f.target, 'B') })
  assert.equal(a.node.allocatedSize, 4096)
  assert.equal(b.node.allocatedSize, 0)
  assert.equal(b.node.children[0].allocatedSize, 4096)
  assert.equal(b.node.children[0].hardlinkCount, 2)
  assert.equal(b.node.children[0].allocationOwner, path.join(f.target, 'A', 'same.dat'))
  const removed = await index.remove(path.join(f.target, 'A'))
  assert.equal(removed.totalFiles, 3)
  assert.equal(removed.totalSize, 65706)
  assert.equal(removed.root.allocatedSize, 4096)
  assert.equal((await index.page({ scanId: 'one', path: path.join(f.target, 'B') })).node.allocatedSize, 4096)
  await assert.rejects(index.validateDeletion(f.target), /scan root/)
  await index.close(); f.opened.delete(index)
  const saved = await DiskScanIndex.open(f.database, 'reopened'); f.opened.add(saved)
  assert.equal((await saved.summary()).source, 'snapshot')
  assert.equal((await saved.summary()).root.allocatedSize, 4096)
  await assert.rejects(saved.validateDeletion(path.join(f.target, 'B')), /read-only/)
  await assert.rejects(saved.page({ scanId: 'one', path: f.target }), /no longer active/)
})

test('global pages search Unicode, combine type/age filters, sort allocation, and clamp offsets', async t => {
  const f = await fixture(t)
  async function* read(dir) {
    if (dir === f.target) yield [directory('nested'), file('root.zip', 5000, 4096, 'zip')]
    else for (let start = 0; start < 325; start += 50) yield Array.from({ length: Math.min(50, 325 - start) }, (_, i) => file(`Äpfel-${start + i}.jpg`, start + i, 4096, `id-${start + i}`, 10 + start + i))
  }
  const index = await DiskScanIndex.scan(f.database, f.target, 'search', 'native', read, new AbortController().signal, () => {}); f.opened.add(index)
  const page = await index.page({ scanId: 'search', path: f.target, scope: 'scan', query: 'äPFEL', category: 'image', modifiedBefore: 210, offset: 9900 })
  assert.equal(page.totalMatches, 200)
  assert.equal(page.offset, 100)
  assert.equal(page.node.children.length, 100)
  assert.equal(page.node.children[0].size, 99)
  assert.ok(page.node.children.every(node => node.path.startsWith(path.join(f.target, 'nested') + path.sep)))
  const all = await index.page({ scanId: 'search', path: f.target, scope: 'scan', limit: 2000, sizeMetric: 'allocated' })
  assert.equal(all.node.children.length, 326)
  assert.equal(all.node.children[0].allocatedSize, 4096)
  await assert.rejects(index.page({ scanId: 'search', path: f.target, scope: 'invalid' }), /scope/)
  await assert.rejects(index.page({ scanId: 'search', path: f.target, modifiedBefore: NaN }), /modification/)
})

test('cancelled streams retain observed entries and close their reader', async t => {
  const f = await fixture(t); const controller = new AbortController(); let closed = false
  async function* read() {
    try { yield [file('observed.txt', 91, 4096, 'observed'), directory('pending')]; controller.abort(); yield [file('unobserved.txt', 10)] }
    finally { closed = true }
  }
  const index = await DiskScanIndex.scan(f.database, f.target, 'cancel', 'native', read, controller.signal, () => {}); f.opened.add(index)
  const result = await index.summary()
  assert.equal(result.status, 'cancelled'); assert.equal(result.totalSize, 91); assert.equal(result.totalFiles, 1)
  assert.equal(result.root.status, 'partial'); assert.equal(closed, true)
  await assert.rejects(index.validateDeletion(path.join(f.target, 'pending')), /fully scanned/)
})

test('streaming backends agree on real files and native allocation identifies hardlinks and sparse files', async t => {
  const f = await fixture(t)
  await Promise.all(Array.from({ length: 520 }, (_, i) => fs.writeFile(path.join(f.target, `file-${i}.txt`), 'data')))
  await fs.link(path.join(f.target, 'file-0.txt'), path.join(f.target, 'alias.txt'))
  if (process.platform === 'win32') {
    const sparse = path.join(f.target, 'sparse.bin'); await fs.writeFile(sparse, '')
    assert.equal(spawnSync('fsutil.exe', ['sparse', 'setflag', sparse], { windowsHide: true }).status, 0)
    await fs.truncate(sparse, 64 * 1024 * 1024)
  }
  let standardBytes = 0, standardCount = 0
  for await (const batch of readStandardDirectory(f.target, new AbortController().signal)) {
    assert.ok(batch.length <= 128); for (const e of batch) { standardBytes += e.size; standardCount++ }
  }
  if (!nativeAddon?.DirectoryCursor) { t.skip('Native cursor unavailable on this host'); return }
  let nativeBytes = 0; const entries = []
  for await (const batch of readNativeDirectory(f.target, new AbortController().signal)) {
    assert.ok(batch.length <= 256); entries.push(...batch); for (const e of batch) nativeBytes += e.size
  }
  assert.equal(entries.length, standardCount); assert.equal(nativeBytes, standardBytes)
  const original = entries.find(e => e.name === 'file-0.txt'), alias = entries.find(e => e.name === 'alias.txt')
  assert.ok(original.fileIdentity); assert.equal(alias.fileIdentity, original.fileIdentity)
  assert.ok(original.allocatedSize >= original.size)
  if (process.platform === 'win32') assert.equal(entries.find(e => e.name === 'sparse.bin').allocatedSize, 0)
  const index = await DiskScanIndex.scan(f.database, f.target, 'native', 'native', readNativeDirectory, new AbortController().signal, () => {}); f.opened.add(index)
  assert.equal((await index.summary()).root.allocatedSize, entries.reduce((sum, e) => sum + e.allocatedSize, 0) - alias.allocatedSize)
  assert.equal((await index.summary()).root.allocationUnknownFiles, 0)
})

test('rejects foreign databases and existing output paths without overwriting them', async t => {
  const f = await fixture(t)
  await fs.writeFile(f.database, 'keep this data')
  await assert.rejects(DiskScanIndex.open(f.database, 'invalid'))
  await assert.rejects(DiskScanIndex.scan(f.database, f.target, 'invalid', 'standard', readStandardDirectory, new AbortController().signal, () => {}), /EEXIST/)
  assert.equal(await fs.readFile(f.database, 'utf8'), 'keep this data')
})

test('allocation without identity is shown per file but excluded from verified folder allocation', async t => {
  const f = await fixture(t)
  async function* read() { yield [file('no-identity.txt', 10, 4096), file('known.txt', 20, 4096, 'known')] }
  const index = await DiskScanIndex.scan(f.database, f.target, 'unknown', 'native', read, new AbortController().signal, () => {}); f.opened.add(index)
  const page = await index.page({ scanId: 'unknown', path: f.target })
  assert.equal(page.root.allocatedSize, 4096)
  assert.equal(page.root.allocationUnknownFiles, 1)
  assert.equal(page.node.children.find(n => n.name === 'no-identity.txt').allocatedSize, 4096)
})

test('mid-directory read failures retain browsable partial results', async t => {
  const f = await fixture(t)
  async function* read() { yield [file('available.txt', 17, 4096, 'file')]; throw new Error('Provider disconnected') }
  const index = await DiskScanIndex.scan(f.database, f.target, 'partial', 'native', read, new AbortController().signal, () => {}); f.opened.add(index)
  const result = await index.summary()
  assert.equal(result.status, 'partial'); assert.equal(result.errorCount, 1)
  assert.equal(result.root.status, 'partial'); assert.equal(result.totalSize, 17)
  assert.equal((await index.page({ scanId: 'partial', path: f.target })).node.children[0].name, 'available.txt')
})

test('a database inside its own scan target is explicitly excluded', async t => {
  const f = await fixture(t)
  const database = path.join(f.target, 'active.diskvision')
  await fs.writeFile(path.join(f.target, 'normal.txt'), 'keep')
  const index = await DiskScanIndex.scan(database, f.target, 'self', 'standard', readStandardDirectory, new AbortController().signal, () => {}); f.opened.add(index)
  const result = await index.summary()
  assert.equal(result.totalSize, 4); assert.equal(result.totalFiles, 1); assert.ok(result.skippedCount >= 1)
  assert.equal((await index.page({ scanId: 'self', path: f.target })).node.children.find(n => n.name === 'active.diskvision').status, 'skipped')
})

test('parallel ingestion agrees with sequential accounting across queue windows and closes all readers', async t => {
  const f = await fixture(t)
  let active = 0, peak = 0
  async function* read(dir) {
    active++; peak = Math.max(peak, active)
    try {
      await new Promise(resolve => setTimeout(resolve, 1))
      if (dir === f.target) yield Array.from({ length: 145 }, (_, i) => directory(`dir-${i}`))
      else {
        yield [file('alias.bin', 10, 4096, 'shared'), file('unknown.bin', 7)]
        if (dir.endsWith('dir-12')) throw Error('Disconnected after first batch')
        yield [file('unique.bin', 20, 8192, dir)]
      }
    } finally { active-- }
  }
  const totals = []
  for (const concurrency of [1, 4]) {
    const index = await DiskScanIndex.scan(path.join(f.root, `${concurrency}.diskvision`), f.target, 'parallel', 'native', read,
      new AbortController().signal, () => {}, { concurrency }); f.opened.add(index)
    const result = await index.summary()
    totals.push([result.totalFiles, result.totalDirectories, result.totalSize, result.root.allocatedSize, result.root.allocationUnknownFiles, result.errorCount, result.status])
    assert.equal(active, 0)
    assert.ok(peak <= concurrency)
    if (concurrency === 4) assert.equal(peak, 4)
  }
  assert.deepEqual(totals[1], totals[0])
  assert.deepEqual(totals[0], [434, 146, 5345, 1183744, 145, 1, 'partial'])
})

test('cancelling parallel reads drains in-flight readers and preserves partial/pending states', async t => {
  const f = await fixture(t); const controller = new AbortController()
  let active = 0, opened = 0
  async function* read(dir) {
    active++; opened++
    try {
      if (dir === f.target) { yield Array.from({ length: 100 }, (_, i) => directory(`dir-${i}`)); return }
      yield [file('observed.bin', 9, 4096, dir)]
      await new Promise(resolve => setTimeout(resolve, 5))
      controller.abort()
      yield [file('too-late.bin', 999)]
    } finally { active-- }
  }
  const index = await DiskScanIndex.scan(f.database, f.target, 'stop', 'native', read, controller.signal, () => {}); f.opened.add(index)
  const result = await index.summary()
  assert.equal(active, 0); assert.equal(opened, 5)
  assert.equal(result.status, 'cancelled'); assert.equal(result.totalDirectories, 5)
  assert.equal(result.totalFiles, 4); assert.equal(result.totalSize, 36)
  const page = await index.page({ scanId: 'stop', path: f.target, limit: 1000 })
  assert.equal(page.node.children.filter(n => n.status === 'partial').length, 4)
  assert.equal(page.node.children.filter(n => n.status === 'pending').length, 96)
})

test('database errors abort ingestion and close every parallel reader', async t => {
  const f = await fixture(t); let active = 0
  async function* read(dir) {
    active++
    try {
      if (dir === f.target) yield [directory('A'), directory('B'), directory('C'), directory('D')]
      else { yield [file('duplicate', 1), file('duplicate', 2)]; await new Promise(resolve => setTimeout(resolve, 1)) }
    } finally { active-- }
  }
  await assert.rejects(DiskScanIndex.scan(f.database, f.target, 'failure', 'native', read, new AbortController().signal, () => {}), /SQLITE_CONSTRAINT/)
  assert.equal(active, 0)
  await assert.rejects(fs.stat(f.database), { code: 'ENOENT' })
})

test('logical sorting uses its index; allocation unknowns remain last in either direction', async t => {
  const f = await fixture(t)
  async function* read() { yield [file('unknown', 100), file('small', 1, 4096, 'a'), file('large', 2, 8192, 'b')] }
  const index = await DiskScanIndex.scan(f.database, f.target, 'order', 'native', read, new AbortController().signal, () => {}); f.opened.add(index)
  const sql = []; const original = index.all.bind(index)
  index.all = async (statement, values) => { sql.push([statement, values]); return original(statement, values) }
  await index.page({ scanId: 'order', path: f.target, scope: 'scan' })
  const [statement, values] = sql.find(([query]) => query.startsWith('SELECT * FROM nodes WHERE') && query.includes('ORDER BY'))
  const plan = await original(`EXPLAIN QUERY PLAN ${statement}`, values)
  assert.ok(!plan.some(row => row.detail.includes('TEMP B-TREE')), JSON.stringify(plan))
  for (const descending of [true, false]) {
    const page = await index.page({ scanId: 'order', path: f.target, scope: 'scan', sizeMetric: 'allocated', descending })
    assert.deepEqual(page.node.children.map(n => n.name), descending ? ['large', 'small', 'unknown'] : ['small', 'large', 'unknown'])
  }
})
