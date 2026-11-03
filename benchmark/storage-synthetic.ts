import { promises as fs } from 'fs'
import * as os from 'os'
import * as path from 'path'
import { DiskScanIndex, type EntryReader } from '../src/main/disk-index'

async function main() {
  const count = Number(process.argv[2] ?? 1000000)
  if (!Number.isSafeInteger(count) || count < 1 || count > 2000000) throw Error('Choose 1–2,000,000 synthetic records.')
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'diskvision-synthetic-'))
  const target = path.join(temporary, 'files'); await fs.mkdir(target)
  let index: DiskScanIndex | undefined, peakHeap = 0, peakRss = 0
  const sample = () => { const m = process.memoryUsage(); peakHeap = Math.max(peakHeap, m.heapUsed); peakRss = Math.max(peakRss, m.rss) }
  const timer = setInterval(sample, 20)
  try {
    const directories = Math.ceil(count / 10000)
    const read: EntryReader = async function* (dir) {
      if (dir === target) {
        yield Array.from({ length: directories }, (_, i) => ({ name: String(i), isDir: true, isSymlink: false, size: 0, mtime: 0 }))
      } else {
        const base = Number(path.basename(dir)) * 10000, end = Math.min(base + 10000, count)
        for (let start = base; start < end; start += 256) yield Array.from({ length: Math.min(256, end - start) }, (_, offset) => {
          const id = start + offset
          return { name: `file-${id}.bin`, isDir: false, isSymlink: false, size: id + 1, allocatedSize: 4096, fileIdentity: `id-${id}`, mtime: 100 }
        })
      }
    }
    const start = performance.now()
    index = await DiskScanIndex.scan(path.join(temporary, 'scan.diskvision'), target, 'synthetic', 'native', read, new AbortController().signal, () => {})
    const summary = await index.summary(), elapsedMs = performance.now() - start
    if (summary.totalFiles !== count || summary.totalDirectories !== directories + 1 || summary.totalSize !== count * (count + 1) / 2 ||
      summary.root.allocatedSize !== count * 4096 || summary.status !== 'complete') throw Error('Synthetic accounting mismatch.')
    const queries = []
    for (const query of ['', 'file-999']) {
      const before = performance.now()
      const page = await index.page({ scanId: 'synthetic', path: target, scope: 'scan', query })
      queries.push({ query, elapsedMs: performance.now() - before, matches: page.totalMatches })
    }
    sample()
    console.log(JSON.stringify({ files: count, directories: directories + 1, elapsedMs, peakHeapMiB: peakHeap / 1048576,
      peakRssMiB: peakRss / 1048576, databaseBytes: (await fs.stat(index.filePath)).size, queries,
      scope: 'Generated metadata, not physical filesystem enumeration. Includes database writes/commit. Queries are single observations, not p95.' }))
  } finally {
    clearInterval(timer); await index?.close()
    if (path.dirname(path.resolve(temporary)) !== path.resolve(os.tmpdir()) || !path.basename(temporary).startsWith('diskvision-synthetic-')) throw Error('Invalid cleanup path.')
    await fs.rm(temporary, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
