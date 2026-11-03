import * as path from 'path'
import { FastDiskScanner } from '../src/main/scanner-fast'
import { NativeDiskScanner, nativeAddon } from '../src/main/scanner-native'
import type { MetadataScanner } from '../src/main/scanner-core'

interface Measurement {
  engine: string
  elapsedMs: number
  files: number
  directories: number
  bytes: number
  errors: number
  skipped: number
  sampledRssMB: number
}

async function measure(scanner: MetadataScanner, target: string): Promise<Measurement> {
  let peakRss = process.memoryUsage().rss
  const sample = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss) }, 20)
  const start = performance.now()
  try {
    const result = await scanner.scanBench(target)
    const elapsedMs = performance.now() - start
    peakRss = Math.max(peakRss, process.memoryUsage().rss)
    if (result.status === 'cancelled') throw new Error('Benchmark was cancelled.')
    if (result.root.size !== result.totalSize) throw new Error('Root total differs from the scanner total.')
    return { engine: result.engine, elapsedMs, files: result.totalFiles, directories: result.totalDirectories,
      bytes: result.totalSize, errors: result.errorCount, skipped: result.skippedCount, sampledRssMB: peakRss / 1024 / 1024 }
  } finally {
    clearInterval(sample)
  }
}

function fingerprint(result: Measurement): string {
  return JSON.stringify([result.files, result.directories, result.bytes, result.errors, result.skipped])
}

async function main(): Promise<void> {
  const argument = process.argv[2]
  if (!argument) throw new Error('Choose a stable fixture: npm run benchmark -- "C:/path/to/folder" [rounds]')
  const rounds = process.argv[3] ? Number(process.argv[3]) : 5
  if (!Number.isInteger(rounds) || rounds < 2 || rounds > 20) throw new Error('Use between 2 and 20 rounds.')
  const target = path.resolve(argument)
  const engines: MetadataScanner[] = [new FastDiskScanner()]
  if (nativeAddon) engines.push(new NativeDiskScanner())
  console.log(`DiskVision metadata benchmark\nTarget: ${target}\nRuntime: ${process.version}`)
  console.log('Warm-cache comparison with one warmup per engine and alternating execution order.')
  console.log('Sampled RSS is process-wide, includes retained allocations, and is not an isolated engine memory benchmark.')
  if (!nativeAddon) console.log('Native addon unavailable or outdated. Run npm run build:native for a two-engine comparison.')

  const warmups: Measurement[] = []
  for (const engine of engines) warmups.push(await measure(engine, target))
  const expected = fingerprint(warmups[0])
  for (const result of warmups) {
    if (fingerprint(result) !== expected) {
      console.table(warmups)
      throw new Error('Engines observed different files, bytes, errors, or exclusions. Resolve semantics or fixture changes before comparing speed.')
    }
  }
  const measurements: Measurement[] = []
  for (let round = 0; round < rounds; round++) {
    for (const engine of round % 2 ? [...engines].reverse() : engines) {
      const result = await measure(engine, target)
      if (fingerprint(result) !== expected) throw new Error('Fixture changed or scan coverage differed. No speed comparison is valid.')
      measurements.push(result)
      console.log(`${round + 1}/${rounds} ${result.engine}: ${result.elapsedMs.toFixed(2)} ms`)
    }
  }
  console.table(engines.map(engine => {
    const rows = measurements.filter(row => row.engine === engine.engine)
    const times = rows.map(row => row.elapsedMs).sort((a, b) => a - b)
    const middle = Math.floor(times.length / 2)
    const median = times.length % 2 ? times[middle] : (times[middle - 1] + times[middle]) / 2
    return { engine: engine.engine, medianMs: +median.toFixed(2), minMs: +times[0].toFixed(2),
      maxMs: +times[times.length - 1].toFixed(2), files: rows[0].files, directories: rows[0].directories,
      logicalBytes: rows[0].bytes, errors: rows[0].errors, skipped: rows[0].skipped,
      sampledProcessRssMB: +Math.max(...rows.map(row => row.sampledRssMB)).toFixed(1) }
  }))
  console.log('Totals and coverage matched in every run. These timings exclude volume discovery, IPC, and rendering.')
}

void main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
