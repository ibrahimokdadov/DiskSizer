require('./register-ts.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const { parseUsnBatch, planJournalChanges } = require('../src/main/ntfs-journal.ts')
const { nativeAddon } = require('../src/main/scanner-native.ts')

function record({ version = 2, id = 1n, parent = 2n, usn = 100n, name = 'file.txt', reason = 1, directory = false } = {}) {
  const header = version === 2 ? 60 : 76, text = Buffer.from(name, 'utf16le')
  const bytes = Buffer.alloc(Math.ceil((header + text.length) / 8) * 8)
  bytes.writeUInt32LE(bytes.length); bytes.writeUInt16LE(version, 4)
  bytes.writeBigUInt64LE(id, 8); bytes.writeBigUInt64LE(parent, version === 2 ? 16 : 24)
  bytes.writeBigInt64LE(usn, version === 2 ? 24 : 40)
  bytes.writeUInt32LE(reason, version === 2 ? 40 : 56)
  bytes.writeUInt32LE(directory ? 0x10 : 0, version === 2 ? 52 : 68)
  bytes.writeUInt16LE(text.length, header - 4); bytes.writeUInt16LE(header, header - 2)
  text.copy(bytes, header)
  return bytes
}
function batch(next, records = []) {
  const header = Buffer.alloc(8); header.writeBigInt64LE(BigInt(next))
  return Buffer.concat([header, ...records])
}
const info = { volumeId: 'abc', journalId: '18446744073709551600', firstUsn: '80', lowestValidUsn: '50', nextUsn: '300' }
const checkpoint = { volumeId: info.volumeId, journalId: info.journalId, nextUsn: '100' }
const signal = () => new AbortController().signal

test('USN V2 and V3 preserve 64/128-bit identities and Unicode without numeric truncation', () => {
  const id = 0x123456789abcdef0n
  const v3 = record({ version: 3, id, name: '影片-Ä.txt', usn: 200n, directory: true })
  v3.writeBigUInt64LE(0xfedcba9876543210n, 16)
  const parsed = parseUsnBatch(batch(300, [record({ id, usn: 100n }), v3]))
  assert.equal(parsed.nextUsn, 300n)
  assert.equal(parsed.records[0].fileReference, 'f0debc9a785634120000000000000000')
  assert.equal(parsed.records[1].fileReference, 'f0debc9a785634121032547698badcfe')
  assert.equal(parsed.records[1].name, '影片-Ä.txt'); assert.equal(parsed.records[1].isDirectory, true)
})

test('USN decoder rejects malformed/truncated/unsupported buffers and backwards sequences', () => {
  for (let size = 0; size < 8; size++) assert.throws(() => parseUsnBatch(Buffer.alloc(size)))
  const valid = batch(200, [record()])
  for (let size = 9; size < valid.length; size++) assert.throws(() => parseUsnBatch(valid.subarray(0, size)))
  for (const mutate of [b => b.writeUInt32LE(0, 8), b => b.writeUInt32LE(65536, 8), b => b.writeUInt16LE(4, 12),
    b => b.writeUInt16LE(59, 8 + 58), b => b.writeUInt16LE(65534, 8 + 56), b => b.writeBigInt64LE(-1n, 8 + 24)]) {
    const broken = Buffer.from(valid); mutate(broken); assert.throws(() => parseUsnBatch(broken))
  }
  assert.throws(() => parseUsnBatch(batch(300, [record({ usn: 200n }), record({ usn: 100n })])))
  assert.throws(() => parseUsnBatch(batch(100, [record()])))
})

test('journal planning coalesces updates, retains rename parents, and respects the captured endpoint', async () => {
  const pages = [batch(200, [record({ reason: 0x1000 }), record({ parent: 3n, usn: 150n, reason: 0x2000 })]),
    batch(400, [record({ usn: 250n }), record({ id: 9n, usn: 350n })])]
  const starts = []
  const result = await planJournalChanges(checkpoint, info, async start => {
    starts.push(start); return { ...info, nextUsn: '400', data: pages.shift() }
  }, signal())
  assert.deepEqual(starts, ['100', '200'])
  assert.equal(result.kind, 'update'); assert.equal(result.events, 3); assert.equal(result.changes.length, 1)
  assert.equal(result.changes[0].parentReferences.length, 2)
  assert.equal(result.changes[0].reason, 0x3001)
  assert.equal(result.checkpointAfterCommit.nextUsn, '300')
})

test('journal identity, retention gaps, backwards state, and gaps during reading require rebuilds', async () => {
  for (const changed of [{ volumeId: 'other' }, { journalId: 'other' }, { firstUsn: '101' }, { lowestValidUsn: '101' }, { nextUsn: '99' }]) {
    const result = await planJournalChanges(checkpoint, { ...info, ...changed }, async () => assert.fail('Must not read a discontinuous journal'), signal())
    assert.equal(result.kind, 'rebuild')
  }
  const result = await planJournalChanges(checkpoint, info, async () => ({ ...info, firstUsn: '101', data: batch(300) }), signal())
  assert.equal(result.kind, 'rebuild')
  const stalled = await planJournalChanges(checkpoint, info, async () => ({ ...info, data: batch(100) }), signal())
  assert.equal(stalled.kind, 'rebuild')
})

test('planning is bounded and cancellation cannot produce a committable checkpoint', async () => {
  const result = await planJournalChanges(checkpoint, info, async () => ({ ...info, data: batch(300, [record(), record({ id: 9n, usn: 200n })]) }), signal(), 1)
  assert.equal(result.kind, 'rebuild')
  const controller = new AbortController()
  await assert.rejects(planJournalChanges(checkpoint, info, async () => {
    controller.abort(); return { ...info, data: batch(300, [record()]) }
  }, controller.signal), { name: 'AbortError' })
  const unchanged = await planJournalChanges({ ...checkpoint, nextUsn: '300' }, info, async () => assert.fail('No changes to read'), signal())
  assert.equal(unchanged.kind, 'update'); assert.equal(unchanged.changes.length, 0)
})

test('native NTFS probe reports unavailable access explicitly and rejects non-root paths', async t => {
  if (!nativeAddon?.probeNtfs) { t.skip('Native NTFS prototype unavailable'); return }
  assert.throws(() => nativeAddon.probeNtfs('C:\\Users'), /root/)
  assert.throws(() => nativeAddon.readNtfsJournal('C:\\', 'not-an-id', '0'), /checkpoint/)
  const probe = await nativeAddon.probeNtfs(`${process.env.SystemDrive || 'C:'}\\`)
  if (!probe.available) assert.ok(probe.reason.length > 0)
  else {
    assert.ok(probe.volumeId); assert.ok(probe.journalId); assert.ok(probe.mftRecordBytes > 0)
    const page = await nativeAddon.readNtfsJournal(probe.root, probe.journalId, probe.nextUsn)
    assert.equal(page.available, true); parseUsnBatch(page.data)
  }
})
