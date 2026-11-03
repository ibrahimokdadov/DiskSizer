import type { DirectoryEntry } from './scanner-core'

export type EntryReader = (directory: string, signal: AbortSignal) => AsyncIterable<DirectoryEntry[]>
type Event<T> = { directory: T } & ({ kind: 'entries'; entries: DirectoryEntry[] } | { kind: 'end' } | { kind: 'error'; error: unknown })

/** One outstanding batch per cursor; the consumer supplies backpressure. */
export async function* streamDirectories<T extends { path: string }>(directories: T[], read: EntryReader,
  signal: AbortSignal, concurrency: number, started: (directory: T) => void): AsyncGenerator<Event<T>> {
  type Slot = { directory: T; iterator: AsyncIterator<DirectoryEntry[]>; pending: Promise<void> }
  const active = new Set<Slot>()
  const ready: { slot: Slot; event: Event<T> }[] = []
  let wake: (() => void) | undefined
  let next = 0
  const advance = (slot: Slot) => {
    // Convert both synchronous reader failures and rejected reads to directory errors.
    slot.pending = Promise.resolve().then(() => slot.iterator.next()).then(
      result => ({ slot, event: result.done ? { directory: slot.directory, kind: 'end' as const } :
        { directory: slot.directory, kind: 'entries' as const, entries: result.value } }),
      error => ({ slot, event: { directory: slot.directory, kind: 'error' as const, error } })).then(result => {
        ready.push(result); wake?.(); wake = undefined
      })
  }
  try {
    while (!signal.aborted) {
      while (next < directories.length && active.size < concurrency && !signal.aborted) {
        const directory = directories[next++]
        started(directory)
        try {
          const slot = { directory, iterator: read(directory.path, signal)[Symbol.asyncIterator]() } as Slot
          active.add(slot); advance(slot)
        } catch (error) { yield { directory, kind: 'error', error } }
      }
      if (!active.size) break
      // Each read registers one continuation. Repeated Promise.race calls would
      // retain a handler on every slow read for each batch from faster readers.
      if (!ready.length) await new Promise<void>(resolve => { wake = resolve })
      const { slot, event } = ready.shift()!
      if (signal.aborted) break
      if (event.kind !== 'entries') {
        active.delete(slot)
        await slot.iterator.return?.()
      }
      yield event
      if (event.kind === 'entries' && !signal.aborted) advance(slot)
    }
  } finally {
    // Never close a native handle while its worker still owns a pending read.
    await Promise.all([...active].map(async slot => {
      await slot.pending
      await slot.iterator.return?.()
    }))
  }
}
