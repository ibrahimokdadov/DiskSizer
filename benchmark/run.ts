/**
 * DiskVision Scanner Benchmark
 * Compares original batch-based scanner vs. IMF-style concurrent scanner.
 *
 * Usage:
 *   npx ts-node --project tsconfig.benchmark.json benchmark/run.ts [path]
 *
 * Examples:
 *   npx ts-node --project tsconfig.benchmark.json benchmark/run.ts C:/Users
 *   npx ts-node --project tsconfig.benchmark.json benchmark/run.ts C:/
 */

import { promises as fs } from 'fs'
import * as path from 'path'
import { FastDiskScanner } from '../src/main/scanner-fast'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FileNode {
  name: string; path: string; size: number; type: 'file' | 'directory'
  extension?: string; modified?: number; children?: FileNode[]; itemCount?: number
}

interface OrigState {
  filesScanned: number; dirsScanned: number; totalSize: number
  errors: string[]; startTime: number; visited: Set<string>
}

interface BenchResult {
  elapsed: number; totalFiles: number; totalDirs: number
  totalSize: number; errors: number; memDeltaMb: number
}

// ---------------------------------------------------------------------------
// Original scanner — self-contained, no Electron imports.
// Mirrors scanner.ts: BATCH_SIZE=20, realpath dedup, sequential batches.
// ---------------------------------------------------------------------------

const SKIP_DIRS_ORIG = new Set([
  '$Recycle.Bin', 'System Volume Information', '$WINDOWS.~BT',
  '$WinREAgent', '$SysReset', 'DumpStack.log.tmp'
])
const BATCH_SIZE_ORIG = 20
const MAX_DEPTH_ORIG = 8
const MAX_CHILDREN_ORIG = 40
const MAX_ERRORS_ORIG = 50

// Extracted as a named async function so the top-level try/catch
// correctly wraps the awaited stat call under all transpilation modes.
// Surrogate-pair regex: detects emoji and other characters outside the BMP.
// Node.js 20 on Windows has a bug where fs.lstat on such paths leaks an
// orphaned ENOENT rejection that cannot be caught by try/catch.
const SURROGATE_RE = /[\uD800-\uDFFF]/

async function processOrigEntry(
  parentPath: string,
  entry: any,
  depth: number,
  state: OrigState
): Promise<FileNode | null> {
  try {
    if (entry.isSymbolicLink()) return null
    if (SURROGATE_RE.test(entry.name)) return null
    const fullPath = path.join(parentPath, entry.name)

    if (entry.isDirectory()) {
      if (SKIP_DIRS_ORIG.has(entry.name) || entry.name.startsWith('$')) return null
      return await origScanDirectory(fullPath, depth + 1, state)
    }

    if (entry.isFile()) {
      const stat = await fs.lstat(fullPath)
      state.filesScanned++
      state.totalSize += stat.size
      return {
        name: entry.name, path: fullPath, size: stat.size, type: 'file',
        extension: path.extname(entry.name).toLowerCase().slice(1) || undefined,
        modified: stat.mtimeMs
      }
    }

    return null
  } catch (_e) {
    return null
  }
}

async function origAggregateSize(
  dirPath: string,
  state: OrigState
): Promise<{ size: number; files: number; dirs: number }> {
  let totalSize = 0; let files = 0; let dirs = 0

  let entries: any[]
  try { entries = await fs.readdir(dirPath, { withFileTypes: true }) }
  catch (_e) { return { size: 0, files: 0, dirs: 0 } }

  for (let i = 0; i < entries.length; i += BATCH_SIZE_ORIG) {
    await Promise.allSettled(
      entries.slice(i, i + BATCH_SIZE_ORIG).map(
        (entry: any) => processOrigAggEntry(dirPath, entry, state)
          .then(r => { if (r) { totalSize += r.size; files += r.files; dirs += r.dirs } })
          .catch(() => null)
      )
    )
  }
  return { size: totalSize, files, dirs }
}

async function processOrigAggEntry(
  parentPath: string, entry: any, state: OrigState
): Promise<{ size: number; files: number; dirs: number } | null> {
  try {
    if (entry.isSymbolicLink()) return null
    if (SURROGATE_RE.test(entry.name)) return null
    const fullPath = path.join(parentPath, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRS_ORIG.has(entry.name) || entry.name.startsWith('$')) return null
      state.dirsScanned++
      return await origAggregateSize(fullPath, state)
    }
    if (entry.isFile()) {
      const stat = await fs.lstat(fullPath)
      state.totalSize += stat.size
      state.filesScanned++
      return { size: stat.size, files: 1, dirs: 0 }
    }
    return null
  } catch (_e) {
    return null
  }
}

async function origScanDirectory(
  dirPath: string,
  depth: number,
  state: OrigState
): Promise<FileNode> {
  state.dirsScanned++

  // realpath for symlink loop detection — this is the extra I/O call
  // we eliminate in the fast scanner.
  let realPath = dirPath
  try { realPath = await fs.realpath(dirPath) } catch (_e) {}
  if (state.visited.has(realPath)) {
    return { name: path.basename(dirPath), path: dirPath, size: 0, type: 'directory', children: [], itemCount: 0 }
  }
  state.visited.add(realPath)

  if (depth >= MAX_DEPTH_ORIG) {
    const agg = await origAggregateSize(dirPath, state)
    return { name: path.basename(dirPath) || dirPath, path: dirPath, size: agg.size, type: 'directory', children: [], itemCount: agg.files + agg.dirs }
  }

  let entries: any[]
  try { entries = await fs.readdir(dirPath, { withFileTypes: true }) }
  catch (e: any) {
    if (state.errors.length < MAX_ERRORS_ORIG) state.errors.push(`${dirPath}: ${e.message}`)
    return { name: path.basename(dirPath), path: dirPath, size: 0, type: 'directory', children: [], itemCount: 0 }
  }

  const children: FileNode[] = []
  let dirSize = 0; let itemCount = 0

  // BATCH processing: waits for full batch of 20 before starting next 20.
  // This is the key bottleneck vs. the fast scanner's continuous concurrency.
  for (let i = 0; i < entries.length; i += BATCH_SIZE_ORIG) {
    const batch = entries.slice(i, i + BATCH_SIZE_ORIG)
    const results = await Promise.allSettled(
      batch.map((entry: any) => processOrigEntry(dirPath, entry, depth, state).catch(() => null))
    )
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) {
        const node = r.value
        children.push(node)
        dirSize += node.size
        itemCount += node.type === 'directory' ? (node.itemCount || 0) + 1 : 1
      }
    }
  }

  children.sort((a, b) => b.size - a.size)

  let finalChildren = children
  if (children.length > MAX_CHILDREN_ORIG) {
    const kept = children.slice(0, MAX_CHILDREN_ORIG)
    const rest = children.slice(MAX_CHILDREN_ORIG)
    kept.push({
      name: `Other (${rest.length} items)`, path: dirPath + '/__other__',
      size: rest.reduce((s, c) => s + c.size, 0), type: 'directory', children: [],
      itemCount: rest.reduce((s, c) => s + (c.type === 'directory' ? (c.itemCount || 0) + 1 : 1), 0)
    })
    finalChildren = kept
  }

  return { name: path.basename(dirPath) || dirPath, path: dirPath, size: dirSize, type: 'directory', children: finalChildren, itemCount }
}

async function runOriginal(targetDir: string) {
  const state: OrigState = {
    filesScanned: 0, dirsScanned: 0, totalSize: 0,
    errors: [], startTime: Date.now(), visited: new Set()
  }
  const root = await origScanDirectory(targetDir, 0, state)
  return {
    root, totalFiles: state.filesScanned, totalDirectories: state.dirsScanned,
    totalSize: state.totalSize, scanDurationMs: Date.now() - state.startTime, errors: state.errors
  }
}

// ---------------------------------------------------------------------------
// Benchmark harness
// ---------------------------------------------------------------------------

async function bench(fn: () => Promise<any>): Promise<BenchResult> {
  if (typeof global.gc === 'function') global.gc()
  const memBefore = process.memoryUsage().heapUsed
  const t0 = performance.now()
  const result = await fn()
  const elapsed = performance.now() - t0
  const memDeltaMb = (process.memoryUsage().heapUsed - memBefore) / 1e6
  return {
    elapsed,
    totalFiles: result.totalFiles,
    totalDirs: result.totalDirectories,
    totalSize: result.totalSize,
    errors: result.errors?.length ?? 0,
    memDeltaMb
  }
}

function fmt(n: number, decimals = 0): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

function printResults(orig: BenchResult, fast: BenchResult) {
  const timeSpeedup = orig.elapsed / fast.elapsed
  const tpOrig = orig.totalFiles / (orig.elapsed / 1000)
  const tpFast = fast.totalFiles / (fast.elapsed / 1000)

  const COL = [30, 18, 18, 14]
  const row = (a: string, b: string, c: string, d: string) =>
    a.padEnd(COL[0]) + b.padStart(COL[1]) + c.padStart(COL[2]) + d.padStart(COL[3])
  const div = '─'.repeat(COL[0] + COL[1] + COL[2] + COL[3])

  console.log('\n' + div)
  console.log(row('Metric', 'Original', 'Fast (IMF)', 'Improvement'))
  console.log(div)
  console.log(row('Scan time (s)',       fmt(orig.elapsed / 1000, 2), fmt(fast.elapsed / 1000, 2), `${fmt(timeSpeedup, 2)}x faster`))
  console.log(row('Files found',         fmt(orig.totalFiles),        fmt(fast.totalFiles),         ''))
  console.log(row('Dirs found',          fmt(orig.totalDirs),         fmt(fast.totalDirs),          ''))
  console.log(row('Total size (GB)',      fmt(orig.totalSize / 1e9, 2), fmt(fast.totalSize / 1e9, 2), ''))
  console.log(row('Throughput (files/s)', fmt(tpOrig),                fmt(tpFast),                 `${fmt(tpFast / tpOrig, 2)}x`))
  console.log(row('Heap delta (MB)',      fmt(orig.memDeltaMb, 1),    fmt(fast.memDeltaMb, 1),     ''))
  console.log(row('Errors',              String(orig.errors),         String(fast.errors),          ''))
  console.log(div)

  if (timeSpeedup > 1) {
    const pct = ((1 - 1 / timeSpeedup) * 100).toFixed(0)
    console.log(`\n✓ Fast scanner is ${fmt(timeSpeedup, 2)}x faster — ${pct}% reduction in scan time`)
    console.log(`  Throughput: ${fmt(tpOrig)}/s  →  ${fmt(tpFast)}/s`)
  } else {
    console.log(`\n~ Scanners performed similarly (${fmt(timeSpeedup, 2)}x ratio)`)
    console.log('  Note: on cached or small directories the gains are less pronounced.')
    console.log('  Run on a fresh boot or a larger path for real-world results.')
  }
  console.log()
}

async function main() {
  // Node.js 20 bug on Windows: filenames with emoji (surrogate-pair code points)
  // cause pathModule.toNamespacedPath() to throw synchronously AND leak an orphaned
  // libuv async operation that resolves as ENOENT. The synchronous throw is caught by
  // our try/catch, but the orphaned libuv ENOENT becomes an unhandled rejection.
  // We suppress it here; the data loss is negligible (those files are skipped anyway).
  process.on('unhandledRejection', () => { /* suppress Windows emoji-path Node.js bug */ })

  const target = process.argv[2] || process.env.USERPROFILE || 'C:/Users'

  try { await fs.access(target) }
  catch (_e) { console.error(`Error: cannot access "${target}"`); process.exit(1) }

  console.log('\nDiskVision Scanner Benchmark')
  console.log('============================')
  console.log(`Target  : ${target}`)
  console.log(`Mode: original=batch/20  fast=batch/64 (no semaphore overhead)`)
  console.log()

  process.stdout.write('[ 1/2 ] Original scanner (batch=20, realpath dedup)... ')
  const origResult = await bench(() => runOriginal(target))
  console.log(`done in ${(origResult.elapsed / 1000).toFixed(2)}s`)

  await new Promise(r => setTimeout(r, 500))

  process.stdout.write('[ 2/2 ] Fast scanner    (concurrent=32, no realpath)... ')
  const fastResult = await bench(() => new FastDiskScanner().scanBench(target))
  console.log(`done in ${(fastResult.elapsed / 1000).toFixed(2)}s`)

  printResults(origResult, fastResult)
}

main().catch(err => {
  console.error('\nBenchmark error:', err.message)
  process.exit(1)
})
