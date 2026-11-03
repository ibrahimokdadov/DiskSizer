require('./register-ts.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { ScanIndex } = require('../src/main/scan-index.ts')

const rootPath = path.resolve('scan-index-fixture')
const file = (parent, name, size, status = 'complete') => ({ name, path: path.join(parent, name), type: 'file', size, status, childrenLoaded: true })
const dir = (parent, name, children, status = 'complete') => ({ name, path: path.join(parent, name), type: 'directory', size: children.reduce((sum, child) => sum + child.size, 0), children, status, childrenLoaded: !['pending', 'error', 'skipped'].includes(status) })
function result(root, files, directories, extras = {}) {
  return { scanId: 'index-test', root, totalSize: root.size, totalFiles: files, totalDirectories: directories,
    status: 'complete', engine: 'native', sizeKind: 'logical', scanDurationMs: 1, errorCount: 0, skippedCount: 0, errors: [], ...extras }
}
function tree() {
  const aPath = path.join(rootPath, 'A'), bPath = path.join(rootPath, 'B'), nestedPath = path.join(bPath, 'nested')
  const a = dir(rootPath, 'A', [file(aPath, 'ten.txt', 10), file(aPath, 'twenty.txt', 20)])
  const nested = dir(bPath, 'nested', [file(nestedPath, 'fifty.txt', 50)])
  const b = dir(rootPath, 'B', [nested])
  const root = { name: 'root', path: rootPath, type: 'directory', size: 85, status: 'complete', childrenLoaded: true, children: [a, b, file(rootPath, 'five.txt', 5)] }
  return result(root, 4, 4)
}

function compactTree(data) {
  data.compactFiles = true
  const pending = [data.root]
  while (pending.length) {
    const directory = pending.pop()
    for (const node of directory.children || []) {
      if (node.type === 'directory') pending.push(node)
      else {
        delete node.path
        delete node.extension
        delete node.childrenLoaded
        if (node.status === 'complete') delete node.status
      }
    }
  }
  return data
}

test('terminal summaries and directory pages never contain descendant trees', async () => {
  const index = await ScanIndex.create(tree())
  const summary = index.summary()
  assert.equal(summary.indexed, true)
  assert.equal(summary.root.children, undefined)
  assert.equal(summary.root.fileCount, 4)
  assert.equal(summary.root.directoryCount, 4)
  const page = index.page({ scanId: 'index-test', path: rootPath })
  assert.equal(page.node.children.length, 3)
  assert.equal(page.root.children, undefined)
  assert.ok(page.node.children.every(child => child.children === undefined))
  assert.deepEqual(page.ancestors.map(node => node.path), [rootPath])
  assert.equal(page.node.children[0].detailsAvailable, true)
  const nestedPath = path.join(rootPath, 'B', 'nested')
  const nestedPage = index.page({ scanId: 'index-test', path: nestedPath })
  assert.deepEqual(nestedPage.ancestors.map(node => node.path), [rootPath, path.join(rootPath, 'B'), nestedPath])
  assert.ok(nestedPage.ancestors.every(node => node.children === undefined))
})

test('paging is bounded, sorted, filtered, and clamps stale offsets', async () => {
  const children = Array.from({ length: 1205 }, (_, number) => file(rootPath, `${number % 2 ? 'image' : 'log'}-${number}.txt`, number))
  const root = { name: 'root', path: rootPath, type: 'directory', size: children.reduce((sum, node) => sum + node.size, 0), children, status: 'complete', childrenLoaded: true }
  const index = await ScanIndex.create(result(root, children.length, 1))
  const first = index.page({ scanId: 'index-test', path: rootPath })
  assert.equal(first.limit, 100)
  assert.equal(first.node.children.length, 100)
  assert.equal(first.node.children[0].size, 1204)
  assert.equal(index.page({ scanId: 'index-test', path: rootPath, limit: 5000 }).node.children.length, 1000)
  const last = index.page({ scanId: 'index-test', path: rootPath, offset: 9999 })
  assert.equal(last.offset, 1200)
  assert.equal(last.node.children.length, 5)
  const filtered = index.page({ scanId: 'index-test', path: rootPath, query: 'LOG-', descending: false, offset: 9999 })
  assert.equal(filtered.totalMatches, 603)
  assert.equal(filtered.totalChildren, 1205)
  assert.equal(filtered.offset, 600)
  assert.deepEqual(filtered.node.children.map(node => node.size), [1200, 1202, 1204])
  const empty = index.page({ scanId: 'index-test', path: rootPath, query: 'nothing-matches', offset: 9999 })
  assert.equal(empty.offset, 0)
  assert.equal(empty.totalMatches, 0)
  assert.deepEqual(empty.node.children, [])
})

test('already sorted scanner lists serve default pages without sorting again', async () => {
  const data = tree()
  data.root.children.sort((a, b) => b.size - a.size)
  const index = await ScanIndex.create(data)
  data.root.children.sort = () => { throw new Error('Unexpected re-sort') }
  assert.equal(index.page({ scanId: 'index-test', path: rootPath, limit: 1 }).node.children[0].name, 'B')
  assert.equal(index.page({ scanId: 'index-test', path: rootPath, offset: 1, limit: 1 }).node.children[0].name, 'A')
})

test('rejects mismatched scan IDs, paths outside the index, and invalid query limits', async () => {
  const index = await ScanIndex.create(tree())
  assert.throws(() => index.page({ scanId: 'stale', path: rootPath }), /no longer active/)
  assert.throws(() => index.page({ scanId: 'index-test', path: path.join(rootPath, '..', 'outside') }), /not part/)
  assert.throws(() => index.page({ scanId: 'index-test', path: rootPath, limit: -1 }), /page size/)
  assert.throws(() => index.page({ scanId: 'index-test', path: rootPath, offset: Infinity }), /offset/)
  assert.throws(() => index.validateDeletion(rootPath), /scan root/)
  assert.throws(() => index.validateDeletion(path.join(rootPath, 'missing.txt')), /not part/)
})

test('subtree deletion updates ancestor bytes, observed counts, membership, and future pages', async () => {
  const index = await ScanIndex.create(tree())
  const after = index.remove(path.join(rootPath, 'A'))
  assert.equal(after.totalSize, 55)
  assert.equal(after.totalFiles, 2)
  assert.equal(after.totalDirectories, 3)
  assert.equal(after.root.fileCount, 2)
  assert.equal(after.root.directoryCount, 3)
  assert.equal(after.root.children, undefined)
  assert.throws(() => index.page({ scanId: 'index-test', path: path.join(rootPath, 'A') }), /not part/)
  const second = index.remove(path.join(rootPath, 'B', 'nested', 'fifty.txt'))
  assert.equal(second.totalSize, 5)
  assert.equal(second.totalFiles, 1)
  assert.equal(second.totalDirectories, 3)
  const root = index.page({ scanId: 'index-test', path: rootPath })
  assert.deepEqual(root.node.children.map(node => node.name), ['five.txt', 'B'])
  assert.equal(root.node.itemCount, 3)
  const b = index.page({ scanId: 'index-test', path: path.join(rootPath, 'B') })
  assert.equal(b.node.size, 0)
  assert.equal(b.node.fileCount, 0)
  assert.equal(b.node.directoryCount, 2)
  assert.equal(b.node.children[0].size, 0)
})

test('partial scans expose available lists while keeping pending/error/skipped lists unavailable', async () => {
  const children = [dir(rootPath, 'pending', [], 'pending'), dir(rootPath, 'error', [], 'error'), dir(rootPath, 'link', [], 'skipped'), dir(rootPath, 'partial', [], 'partial')]
  children[3].childrenLoaded = false
  const root = { name: 'root', path: rootPath, type: 'directory', size: 0, status: 'partial', childrenLoaded: true, children }
  const index = await ScanIndex.create(result(root, 0, 3, { status: 'partial', errorCount: 1, skippedCount: 1, stopReason: 'memory-limit' }))
  const page = index.page({ scanId: 'index-test', path: rootPath })
  assert.equal(page.root.directoryCount, 3)
  for (const name of ['pending', 'error', 'link']) {
    const child = page.node.children.find(node => node.name === name)
    assert.equal(child.detailsAvailable, false)
    assert.throws(() => index.page({ scanId: 'index-test', path: child.path }), /was not read/)
  }
  assert.equal(page.node.children.find(node => node.name === 'partial').detailsAvailable, true)
  assert.equal(index.page({ scanId: 'index-test', path: path.join(rootPath, 'partial') }).node.childrenLoaded, false)
  assert.throws(() => index.validateDeletion(path.join(rootPath, 'partial')), /not fully scanned/)
  assert.equal(index.summary().stopReason, 'memory-limit')
  index.markCancelled()
  assert.equal(index.summary().status, 'cancelled')
  assert.equal(index.summary().root.children, undefined)
})

test('a cancellation before root enumeration preserves zero observed directory count', async () => {
  const root = { name: 'root', path: rootPath, type: 'directory', size: 0, status: 'partial', childrenLoaded: false, children: [] }
  const index = await ScanIndex.create(result(root, 0, 0, { status: 'cancelled' }))
  assert.equal(index.summary().root.directoryCount, 0)
  assert.equal(index.summary().totalDirectories, 0)
})

test('compact pages reconstruct deep file details and deletion matches full records', async () => {
  const fullData = tree()
  // Production full records carry these values, including extension-less files.
  const pending = [fullData.root]
  while (pending.length) {
    for (const node of pending.pop().children || []) {
      if (node.type === 'directory') pending.push(node)
      else { node.extension = path.extname(node.name).slice(1); node.modified = 123456 }
    }
  }
  const compactData = compactTree(structuredClone(fullData))
  const full = await ScanIndex.create(fullData), compact = await ScanIndex.create(compactData)
  assert.deepEqual(compact.summary(), full.summary())
  assert.equal('compactFiles' in compact.summary(), false)
  const nestedPath = path.join(rootPath, 'B', 'nested')
  for (const folder of [rootPath, path.join(rootPath, 'A'), path.join(rootPath, 'B'), nestedPath]) {
    for (const request of [{}, { limit: 1, offset: 99 }, { query: '.TXT', descending: false }]) {
      const query = { scanId: 'index-test', path: folder, ...request }
      assert.deepEqual(compact.page(query), full.page(query))
    }
  }
  const deepFile = path.join(nestedPath, 'fifty.txt')
  assert.deepEqual(compact.validateDeletion(deepFile), full.validateDeletion(deepFile))
  assert.deepEqual(compact.remove(deepFile), full.remove(deepFile))
  assert.throws(() => compact.validateDeletion(deepFile), /not part/)
  assert.deepEqual(compact.remove(path.join(rootPath, 'A')), full.remove(path.join(rootPath, 'A')))
  assert.deepEqual(compact.page({ scanId: 'index-test', path: rootPath }), full.page({ scanId: 'index-test', path: rootPath }))
  assert.equal(compact.summary().totalSize, 5)
  assert.equal(compact.summary().totalFiles, 1)
  assert.equal(compact.summary().totalDirectories, 3)
})

test('compact membership rejects aliases, missing paths, stale files, and unmarked records', async () => {
  const index = await ScanIndex.create(compactTree(tree()))
  const folder = path.join(rootPath, 'B', 'nested')
  for (const target of [
    path.join(folder, 'missing.txt'),
    `${folder}${path.sep}.${path.sep}fifty.txt`,
    `${folder}${path.sep}fifty.txt${path.sep}`,
    path.join(rootPath, 'B', 'fifty.txt'),
    path.join(rootPath, '..', 'fifty.txt'),
    `${folder}${path.sep}fifty.txt\0`
  ]) assert.throws(() => index.validateDeletion(target), /not part|Invalid item path/)
  const unmarked = compactTree(tree())
  delete unmarked.compactFiles
  await assert.rejects(ScanIndex.create(unmarked), /Unmarked compact/)
  const malformed = compactTree(tree())
  malformed.root.children.push({ type: 'file', name: `..${path.sep}outside.txt`, size: 1, modified: 0 })
  const malformedIndex = await ScanIndex.create(malformed)
  assert.throws(() => malformedIndex.page({ scanId: 'index-test', path: rootPath }), /Invalid file record name/)
  const mismatched = tree()
  mismatched.root.children.find(node => node.type === 'file').path = path.join(rootPath, '..', 'five.txt')
  const mismatchedIndex = await ScanIndex.create(mismatched)
  assert.throws(() => mismatchedIndex.validateDeletion(path.join(rootPath, 'five.txt')), /does not match its parent/)
  assert.throws(() => mismatchedIndex.validateDeletion(path.join(rootPath, '..', 'five.txt')), /not part/)
})

test('compact error and skipped files keep explicit status and cannot be deleted', async () => {
  const data = compactTree(tree())
  data.root.children.push(
    { name: 'denied.txt', type: 'file', size: 0, modified: 0, status: 'error', skipReason: 'Access denied' },
    { name: 'cloud.txt', type: 'file', size: 0, modified: 0, status: 'skipped', skipReason: 'Offline placeholder' }
  )
  data.root.status = data.status = 'partial'
  data.errorCount = data.skippedCount = 1
  const index = await ScanIndex.create(data)
  const page = index.page({ scanId: 'index-test', path: rootPath })
  assert.equal(page.root.fileCount, 4)
  for (const [name, status] of [['denied.txt', 'error'], ['cloud.txt', 'skipped']]) {
    const node = page.node.children.find(child => child.name === name)
    assert.equal(node.path, path.join(rootPath, name))
    assert.equal(node.status, status)
    assert.equal(node.extension, 'txt')
    assert.throws(() => index.validateDeletion(node.path), /not fully scanned/)
  }
})
