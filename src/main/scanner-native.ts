/**
 * HDD-optimised scanner using the native fast-readdir addon.
 *
 * Key difference from scanner-fast.ts:
 *   Uses FindFirstFileExW (via native addon) instead of fs.readdir + fs.stat.
 *   WIN32_FIND_DATA includes file sizes, so we get sizes for free from the
 *   directory read — zero per-file stat() syscalls.
 *
 *   On HDDs this eliminates millions of random seeks (one per stat call).
 *   On a directory with 1000 files: 1001 syscalls → 1 bulk directory read.
 */

import * as path from 'path'
import type { BrowserWindow } from 'electron'
import type { FileNode, ScanResult, ScanProgress } from './scanner'

// ─── native addon loader ──────────────────────────────────────────────────────

interface NativeDirEntry {
  name: string
  size: number
  mtime: number
  isDir: boolean
  isSymlink: boolean
}

type NativeAddon = { readdirWithStats(dirPath: string): Promise<NativeDirEntry[]> }

function loadAddon(): NativeAddon | null {
  // Try a few likely locations (dev build vs packaged app)
  const candidates = [
    path.join(__dirname, '..', '..', 'build', 'Release', 'fast_readdir.node'),
    path.join(__dirname, '..', '..', '..', 'build', 'Release', 'fast_readdir.node'),
    path.join(process.resourcesPath ?? '', 'build', 'Release', 'fast_readdir.node'),
  ]
  for (const p of candidates) {
    try {
      return require(p) as NativeAddon
    } catch {
      // try next
    }
  }
  return null
}

export const nativeAddon = loadAddon()

// ─── semaphore (limits concurrent directory reads on HDD) ─────────────────────

class Semaphore {
  private permits: number
  private queue: Array<() => void> = []
  constructor(permits: number) { this.permits = permits }
  acquire(): Promise<void> {
    if (this.permits > 0) { this.permits--; return Promise.resolve() }
    return new Promise(resolve => this.queue.push(resolve))
  }
  release(): void {
    if (this.queue.length > 0) this.queue.shift()!()
    else this.permits++
  }
}

// ─── constants ───────────────────────────────────────────────────────────────

const SKIP_DIRS = new Set([
  '$Recycle.Bin', 'System Volume Information', '$WINDOWS.~BT',
  '$WinREAgent', '$SysReset', 'DumpStack.log.tmp'
])

const HDD_DIR_CONCURRENCY = 4   // concurrent directory reads on HDD
const ENTRIES_PER_BATCH   = 64
const MAX_CHILDREN_PER_DIR = 40
const MAX_DEPTH            = 8
const MAX_ERRORS           = 50

// ─── scanner ─────────────────────────────────────────────────────────────────

export class NativeDiskScanner {
  private aborted    = false
  private scanning   = false
  private filesScanned = 0
  private dirsScanned  = 0
  private totalSize    = 0
  private errors: string[] = []
  private startTime    = 0
  private lastProgressMs = 0
  private sem!: Semaphore

  get isScanning() { return this.scanning }

  cancel() {
    this.aborted  = false
    this.scanning = false
  }

  async scan(dirPath: string, window: BrowserWindow): Promise<ScanResult> {
    const onProgress = (p: ScanProgress) => window.webContents.send('scan-progress', p)
    try {
      const result = await this._scan(dirPath, onProgress)
      window.webContents.send('scan-complete', result)
      return result
    } catch (err: any) {
      if (this.aborted) {
        window.webContents.send('scan-error', 'Scan cancelled')
        throw new Error('Scan cancelled')
      }
      window.webContents.send('scan-error', err.message)
      throw err
    }
  }

  private async _scan(
    dirPath: string,
    onProgress?: (p: ScanProgress) => void
  ): Promise<ScanResult> {
    this.aborted      = false
    this.scanning     = true
    this.filesScanned = 0
    this.dirsScanned  = 0
    this.totalSize    = 0
    this.errors       = []
    this.startTime    = Date.now()
    this.lastProgressMs = 0
    this.sem          = new Semaphore(HDD_DIR_CONCURRENCY)

    const root = await this.scanDirectory(dirPath, 0, onProgress)
    this.scanning = false
    return {
      root,
      totalSize:        this.totalSize,
      totalFiles:       this.filesScanned,
      totalDirectories: this.dirsScanned,
      scanDurationMs:   Date.now() - this.startTime,
      errors:           this.errors
    }
  }

  private sendProgress(currentPath: string, onProgress?: (p: ScanProgress) => void) {
    const now = Date.now()
    if (now - this.lastProgressMs < 100) return
    this.lastProgressMs = now
    onProgress?.({
      phase:              'scanning',
      currentPath,
      filesScanned:       this.filesScanned,
      directoriesScanned: this.dirsScanned,
      totalSizeBytes:     this.totalSize,
      elapsedMs:          now - this.startTime
    })
  }

  private async scanDirectory(
    dirPath: string,
    depth: number,
    onProgress?: (p: ScanProgress) => void
  ): Promise<FileNode> {
    if (this.aborted) throw new Error('AbortError')
    this.dirsScanned++
    this.sendProgress(dirPath, onProgress)

    if (depth >= MAX_DEPTH) {
      const agg = await this.aggregateSize(dirPath)
      return {
        name: path.basename(dirPath) || dirPath,
        path: dirPath,
        size: agg.size,
        type: 'directory',
        children: [],
        itemCount: agg.files + agg.dirs
      }
    }

    // Acquire semaphore for this directory read
    await this.sem.acquire()
    let entries: NativeDirEntry[]
    try {
      entries = await nativeAddon!.readdirWithStats(dirPath)
    } catch (err: any) {
      if (this.errors.length < MAX_ERRORS) this.errors.push(`${dirPath}: ${err.message}`)
      return { name: path.basename(dirPath), path: dirPath, size: 0, type: 'directory', children: [], itemCount: 0 }
    } finally {
      this.sem.release()
    }

    const children: FileNode[] = []
    let dirSize   = 0
    let itemCount = 0

    // Process in batches to bound pending Promises
    const allResults: Array<PromiseSettledResult<FileNode | null>> = []
    for (let i = 0; i < entries.length; i += ENTRIES_PER_BATCH) {
      const batch = entries.slice(i, i + ENTRIES_PER_BATCH)
      const results = await Promise.allSettled(
        batch.map(entry => this.processEntry(dirPath, entry, depth, onProgress))
      )
      for (const r of results) allResults.push(r)
    }

    for (const result of allResults) {
      if (result.status === 'fulfilled' && result.value) {
        const node = result.value
        children.push(node)
        dirSize   += node.size
        itemCount += node.type === 'directory' ? (node.itemCount || 0) + 1 : 1
      }
    }

    children.sort((a, b) => b.size - a.size)

    let finalChildren: FileNode[]
    if (children.length > MAX_CHILDREN_PER_DIR) {
      const kept = children.slice(0, MAX_CHILDREN_PER_DIR)
      const rest = children.slice(MAX_CHILDREN_PER_DIR)
      const otherSize  = rest.reduce((s, c) => s + c.size, 0)
      const otherCount = rest.reduce((s, c) => s + (c.type === 'directory' ? (c.itemCount || 0) + 1 : 1), 0)
      kept.push({
        name: `Other (${rest.length} items)`,
        path: dirPath + path.sep + '__other__',
        size: otherSize,
        type: 'directory',
        children: [],
        itemCount: otherCount
      })
      finalChildren = kept
    } else {
      finalChildren = children
    }

    return {
      name: path.basename(dirPath) || dirPath,
      path: dirPath,
      size: dirSize,
      type: 'directory',
      children: finalChildren,
      itemCount
    }
  }

  private async processEntry(
    parentPath: string,
    entry: NativeDirEntry,
    depth: number,
    onProgress?: (p: ScanProgress) => void
  ): Promise<FileNode | null> {
    if (this.aborted) throw new Error('AbortError')
    if (entry.isSymlink) return null

    const fullPath = path.join(parentPath, entry.name)

    if (entry.isDir) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('$')) return null
      try {
        return await this.scanDirectory(fullPath, depth + 1, onProgress)
      } catch (err: any) {
        if (err.message === 'AbortError') throw err
        if (this.errors.length < MAX_ERRORS) this.errors.push(`${fullPath}: ${err.message}`)
        return null
      }
    }

    // File — size already from WIN32_FIND_DATA, no stat() needed
    this.filesScanned++
    this.totalSize += entry.size
    return {
      name:      entry.name,
      path:      fullPath,
      size:      entry.size,
      type:      'file',
      extension: path.extname(entry.name).toLowerCase().slice(1) || undefined,
      modified:  entry.mtime
    }
  }

  /** Beyond MAX_DEPTH: accumulate sizes without building child nodes. */
  private async aggregateSize(dirPath: string): Promise<{ size: number; files: number; dirs: number }> {
    if (this.aborted) throw new Error('AbortError')

    await this.sem.acquire()
    let entries: NativeDirEntry[]
    try {
      entries = await nativeAddon!.readdirWithStats(dirPath)
    } catch {
      return { size: 0, files: 0, dirs: 0 }
    } finally {
      this.sem.release()
    }

    let totalSize = 0, files = 0, dirs = 0

    for (let i = 0; i < entries.length; i += ENTRIES_PER_BATCH) {
      await Promise.allSettled(
        entries.slice(i, i + ENTRIES_PER_BATCH).map(async (entry) => {
          if (this.aborted || entry.isSymlink) return
          if (entry.isDir) {
            if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('$')) return
            dirs++
            this.dirsScanned++
            const sub = await this.aggregateSize(path.join(dirPath, entry.name))
            totalSize += sub.size
            files     += sub.files
            dirs      += sub.dirs
          } else {
            totalSize      += entry.size
            this.totalSize += entry.size
            files++
            this.filesScanned++
          }
        })
      )
    }

    return { size: totalSize, files, dirs }
  }
}

export const nativeScanner = new NativeDiskScanner()
