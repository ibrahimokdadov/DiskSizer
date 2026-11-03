/** Experimental journal planner. It never marks a saved scan as current or writes a checkpoint. */
export type JournalInfo = { volumeId: string; journalId: string; firstUsn: string; lowestValidUsn: string; nextUsn: string }
export type JournalCheckpoint = Pick<JournalInfo, 'volumeId' | 'journalId' | 'nextUsn'>
export type NtfsProbe = ({ available: true; root: string; mftRecordBytes: number } & JournalInfo) |
  { available: false; root: string; reason: string; win32Error: number }
export type JournalRecord = { fileReference: string; parentReference: string; usn: bigint; reason: number; name: string; isDirectory: boolean }
export type JournalChange = { fileReference: string; parentReferences: string[]; reason: number; isDirectory: boolean; events: number }
export type JournalPlan = { kind: 'rebuild'; reason: string } |
  { kind: 'update'; changes: JournalChange[]; checkpointAfterCommit: JournalCheckpoint; events: number }

function usn(value: string): bigint {
  if (!/^[0-9]+$/.test(value)) throw Error('Invalid journal sequence number.')
  const number = BigInt(value)
  if (number > 0x7fffffffffffffffn) throw Error('Journal sequence number is out of range.')
  return number
}

export function parseUsnBatch(data: Buffer): { nextUsn: bigint; records: JournalRecord[] } {
  if (data.length < 8 || data.length > 65536) throw Error('Invalid USN buffer length.')
  const nextUsn = data.readBigInt64LE(0)
  if (nextUsn < 0n) throw Error('Invalid USN continuation.')
  const records: JournalRecord[] = []
  let previous = -1n
  for (let offset = 8; offset < data.length;) {
    if (data.length - offset < 8) throw Error('Truncated USN record.')
    const length = data.readUInt32LE(offset), version = data.readUInt16LE(offset + 4)
    const header = version === 2 ? 60 : version === 3 ? 76 : 0
    if (!header) throw Error(`Unsupported USN record version ${version}; a full scan is required.`)
    if (length < header || length % 8 || length > data.length - offset) throw Error('Invalid USN record length.')
    const record = data.subarray(offset, offset + length)
    const nameLength = record.readUInt16LE(header - 4), nameOffset = record.readUInt16LE(header - 2)
    if (nameOffset < header || nameOffset % 2 || !nameLength || nameLength % 2 || nameOffset + nameLength > length) throw Error('Invalid USN filename bounds.')
    const sequence = record.readBigInt64LE(version === 2 ? 24 : 40)
    if (sequence < 0n || sequence < previous || sequence >= nextUsn) throw Error('Invalid USN record sequence.')
    previous = sequence
    const name = record.toString('utf16le', nameOffset, nameOffset + nameLength)
    if (/[\0\\/]/.test(name) || name === '.' || name === '..') throw Error('Invalid USN filename.')
    const idLength = version === 2 ? 8 : 16
    const reference = (start: number) => record.subarray(start, start + idLength).toString('hex').padEnd(32, '0')
    records.push({ fileReference: reference(8), parentReference: reference(8 + idLength), usn: sequence,
      reason: record.readUInt32LE(version === 2 ? 40 : 56), name,
      isDirectory: !!(record.readUInt32LE(version === 2 ? 52 : 68) & 0x10) })
    offset += length
  }
  return { nextUsn, records }
}

function continuity(checkpoint: JournalCheckpoint, info: JournalInfo): string | undefined {
  if (checkpoint.volumeId !== info.volumeId) return 'The volume identity changed.'
  if (checkpoint.journalId !== info.journalId) return 'The change journal was replaced.'
  const start = usn(checkpoint.nextUsn)
  if (start < usn(info.firstUsn) || start < usn(info.lowestValidUsn)) return 'The journal no longer contains the saved checkpoint.'
  if (start > usn(info.nextUsn)) return 'The journal moved backwards.'
  return undefined
}

/** Coalesce lookups, but retain every affected parent (including both sides of a rename).
 * The caller must remeasure objects, resolve links/moves, update summaries, and atomically
 * commit the returned checkpoint with those updates. USN records do not contain file sizes.
 */
export async function planJournalChanges(checkpoint: JournalCheckpoint, current: JournalInfo,
  read: (startUsn: string) => Promise<JournalInfo & { data: Buffer }>, signal: AbortSignal,
  maxChanges = 50000): Promise<JournalPlan> {
  if (!Number.isSafeInteger(maxChanges) || maxChanges < 1 || maxChanges > 100000) throw Error('Invalid journal change limit.')
  const invalid = continuity(checkpoint, current)
  if (invalid) return { kind: 'rebuild', reason: invalid }
  const end = usn(current.nextUsn)
  let start = usn(checkpoint.nextUsn), events = 0, retainedParents = 0
  const changes = new Map<string, JournalChange>()
  while (start < end) {
    signal.throwIfAborted()
    const page = await read(start.toString())
    signal.throwIfAborted()
    // Validate the original checkpoint as well as this page: no missed history is acceptable.
    const gap = continuity(checkpoint, page)
    if (gap) return { kind: 'rebuild', reason: gap }
    const parsed = parseUsnBatch(page.data)
    if (parsed.nextUsn <= start || parsed.nextUsn > usn(page.nextUsn)) return { kind: 'rebuild', reason: 'The journal did not provide a valid continuation.' }
    for (const record of parsed.records) {
      if (record.usn < start) return { kind: 'rebuild', reason: 'The journal returned an older record.' }
      if (record.usn >= end) break // Changes after the captured endpoint belong to the next update.
      let change = changes.get(record.fileReference)
      if (!change) {
        if (changes.size >= maxChanges) return { kind: 'rebuild', reason: 'Too many changed objects for a bounded incremental update.' }
        change = { fileReference: record.fileReference, parentReferences: [], reason: 0, isDirectory: record.isDirectory, events: 0 }
        changes.set(record.fileReference, change)
      }
      if (!change.parentReferences.includes(record.parentReference)) {
        // Bound rename/hardlink fanout as well as the number of distinct file identities.
        if (++retainedParents > maxChanges * 4) return { kind: 'rebuild', reason: 'Too many affected parent directories.' }
        change.parentReferences.push(record.parentReference)
      }
      change.reason = (change.reason | record.reason) >>> 0
      change.isDirectory ||= record.isDirectory
      change.events++; events++
    }
    start = parsed.nextUsn
  }
  signal.throwIfAborted()
  return { kind: 'update', changes: [...changes.values()], events,
    checkpointAfterCommit: { volumeId: current.volumeId, journalId: current.journalId, nextUsn: current.nextUsn } }
}
