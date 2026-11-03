import { nativeAddon } from '../src/main/scanner-native'
import { planJournalChanges } from '../src/main/ntfs-journal'
import { promises as fs } from 'fs'

async function main() {
  const root = process.argv[2]
  if (!root || !/^[a-z]:\\$/i.test(root)) throw Error('Usage: tsx benchmark/ntfs-journal.ts C:\\ [checkpoint.json]')
  const addon = nativeAddon
  if (!addon?.probeNtfs || !addon.readNtfsJournal) throw Error('Rebuild the native addon first.')
  const current = await addon.probeNtfs(root)
  console.log(JSON.stringify(current))
  if (!current.available) return
  // No old checkpoint means a capability check only; do not dump user filenames.
  if (!process.argv[3]) return
  const checkpoint = JSON.parse(await fs.readFile(process.argv[3], 'utf8'))
  const plan = await planJournalChanges(checkpoint, current, async start => {
    const page = await addon.readNtfsJournal!(root, current.journalId, start)
    if (!page.available || !page.data) throw Error('Journal access became unavailable.')
    return { ...page, data: page.data }
  }, new AbortController().signal)
  console.log(JSON.stringify(plan.kind === 'rebuild' ? plan : { kind: plan.kind, objects: plan.changes.length, events: plan.events,
    checkpointAfterCommit: plan.checkpointAfterCommit, note: 'Planning only. No index was updated and no checkpoint was committed.' }))
}
main().catch(error => { console.error(error); process.exitCode = 1 })
