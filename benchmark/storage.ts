import { promises as fs } from 'fs'
import * as os from 'os'
import * as path from 'path'
import { DiskScanIndex } from '../src/main/disk-index'
import { nativeAddon, readNativeDirectory } from '../src/main/scanner-native'
import { readStandardDirectory } from '../src/main/scanner-fast'

async function main() {
  if (!process.argv[2]) throw new Error('Usage: npm run benchmark:storage -- <folder> [runs=3] [concurrency=4]')
  const target = path.resolve(process.argv[2])
  const runs = Number(process.argv[3] ?? 3)
  const concurrency = Number(process.argv[4] ?? 4)
  if (!Number.isSafeInteger(runs) || runs < 1 || runs > 20) throw new Error('Choose 1–20 runs.')
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'diskvision-storage-bench-'))
  const native = !!nativeAddon?.DirectoryCursor
  const measurements = []
  let expected: string | undefined
  try {
    for (let run = 0; run < runs; run++) {
      let peakHeap = 0, peakRss = 0
      const sample = () => { const m = process.memoryUsage(); peakHeap = Math.max(peakHeap, m.heapUsed); peakRss = Math.max(peakRss, m.rss) }
      const timer = setInterval(sample, 20)
      let index: DiskScanIndex | undefined
      try {
        const start = performance.now()
        index = await DiskScanIndex.scan(path.join(temporary, `${run}.diskvision`), target, `benchmark-${run}`, native ? 'native' : 'standard',
          native ? readNativeDirectory : readStandardDirectory, new AbortController().signal, () => {}, { concurrency })
        const result = await index.summary(); sample()
        const accounting = JSON.stringify([result.totalFiles, result.totalDirectories, result.totalSize, result.root.allocatedSize, result.root.allocationUnknownFiles, result.errorCount, result.skippedCount])
        if (expected && accounting !== expected) throw new Error('Counts or accounting changed between runs. Use a stable target before comparing timings.')
        expected = accounting
        const measurement = { run: run + 1, concurrency, engine: result.engine, status: result.status, files: result.totalFiles, directories: result.totalDirectories,
          logicalBytes: result.totalSize, allocatedBytes: result.root.allocatedSize, allocationUnknownFiles: result.root.allocationUnknownFiles,
          elapsedMs: performance.now() - start, peakHeapMiB: peakHeap / 1048576, peakRssMiB: peakRss / 1048576, databaseBytes: (await fs.stat(index.filePath)).size }
        measurements.push(measurement); console.log(JSON.stringify(measurement))
      } finally { clearInterval(timer); await index?.close() }
    }
    const times = measurements.map(m => m.elapsedMs).sort((a, b) => a - b)
    console.log(JSON.stringify({ target, runs, medianMs: (times[Math.floor((runs - 1) / 2)] + times[Math.floor(runs / 2)]) / 2,
      scope: 'Production storage engine under Node; includes index writes/finalization, excludes Electron/UI. Cache state is uncontrolled. RSS is process-wide.' }))
  } finally {
    const resolved = path.resolve(temporary)
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('diskvision-storage-bench-')) throw new Error('Invalid benchmark cleanup path.')
    await fs.rm(resolved, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
