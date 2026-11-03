import { promises as fs } from 'fs'
import * as os from 'os'
import * as path from 'path'
import { execFileSync } from 'child_process'
import Module from 'module'
import ts from 'typescript'
import { DiskScanIndex } from '../src/main/disk-index'
import { nativeAddon, readNativeDirectory } from '../src/main/scanner-native'
import { readStandardDirectory } from '../src/main/scanner-fast'

async function main() {
  const [folder, ref, count = '3'] = process.argv.slice(2)
  if (!folder || !ref) throw Error('Usage: tsx benchmark/compare-storage.ts <stable-folder> <baseline-git-ref> [rounds=3]')
  const rounds = Number(count)
  if (!Number.isSafeInteger(rounds) || rounds < 1 || rounds > 10) throw Error('Choose 1–10 rounds.')
  const source = execFileSync('git', ['show', '--end-of-options', `${ref}:src/main/disk-index.ts`], { encoding: 'utf8', windowsHide: true })
  // Both pipelines use the same current native reader. Only the index pipeline is compared.
  const filename = path.resolve('src/main/disk-index.ts')
  const baselineModule = new Module(filename, module) as Module & { _compile(code: string, file: string): void }
  baselineModule.filename = filename; baselineModule.paths = module.paths
  baselineModule._compile(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename)
  const baseline = baselineModule.exports.DiskScanIndex as typeof DiskScanIndex
  const native = !!nativeAddon?.DirectoryCursor
  const target = path.resolve(folder)
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'diskvision-compare-'))
  const results: { round: number; engine: string; elapsedMs: number; queryMs: number; databaseBytes: number }[] = []
  let expected: string | undefined
  try {
    for (let round = 1; round <= rounds; round++) {
      // Alternate order to reduce a systematic cache advantage for either pipeline.
      const engines = round % 2 ? ['baseline', 'current'] : ['current', 'baseline']
      for (const engine of engines) {
        let index: DiskScanIndex | undefined
        try {
          const start = performance.now()
          index = await (engine === 'baseline' ? baseline : DiskScanIndex).scan(path.join(temporary, `${round}-${engine}.diskvision`),
            target, 'comparison', native ? 'native' : 'standard', native ? readNativeDirectory : readStandardDirectory, new AbortController().signal, () => {})
          const summary = await index.summary()
          const elapsedMs = performance.now() - start
          const accounting = JSON.stringify([summary.totalFiles, summary.totalDirectories, summary.totalSize, summary.root.allocatedSize,
            summary.root.allocationUnknownFiles, summary.errorCount, summary.skippedCount, summary.status])
          if (expected && accounting !== expected) throw Error('Accounting changed: comparison invalid. Use a stable target.')
          expected = accounting
          const queryStart = performance.now()
          await index.page({ scanId: 'comparison', path: target, scope: 'scan', limit: 100 })
          const result = { round, engine, elapsedMs, queryMs: performance.now() - queryStart, databaseBytes: (await fs.stat(index.filePath)).size }
          results.push(result); console.log(JSON.stringify(result))
        } finally { await index?.close() }
      }
    }
    const median = (engine: string) => {
      const times = results.filter(row => row.engine === engine).map(row => row.elapsedMs).sort((a, b) => a - b)
      return (times[Math.floor((times.length - 1) / 2)] + times[Math.floor(times.length / 2)]) / 2
    }
    console.log(JSON.stringify({ target, baselineRef: ref, rounds, accounting: JSON.parse(expected!), baselineMedianMs: median('baseline'),
      currentMedianMs: median('current'), ratio: median('baseline') / median('current'),
      scope: 'Alternating index pipelines with the same current metadata reader under Node. Includes commit; excludes Electron/UI. Cache uncontrolled; not a competitor benchmark.' }))
  } finally {
    if (path.dirname(path.resolve(temporary)) !== path.resolve(os.tmpdir()) || !path.basename(temporary).startsWith('diskvision-compare-')) throw Error('Invalid cleanup path.')
    await fs.rm(temporary, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
