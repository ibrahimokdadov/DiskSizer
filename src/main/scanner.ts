import { promises as fs } from 'fs'
import * as path from 'path'
import { BrowserWindow } from 'electron'

export interface FileNode {
  name: string
  path: string
  size: number
  type: 'file' | 'directory'
  extension?: string
  modified?: number
  children?: FileNode[]
  itemCount?: number
}

export interface ScanResult {
  root: FileNode
  totalSize: number
  totalFiles: number
  totalDirectories: number
  scanDurationMs: number
  errors: string[]
}

export interface ScanProgress {
  phase: 'counting' | 'scanning' | 'building'
  currentPath: string
  filesScanned: number
  directoriesScanned: number
  totalSizeBytes: number
  elapsedMs: number
}

const SKIP_DIRS = new Set([
  '$Recycle.Bin', 'System Volume Information', '$WINDOWS.~BT',
  '$WinREAgent', '$SysReset', 'DumpStack.log.tmp'
])
const BATCH_SIZE = 20
const MAX_CHILDREN_PER_DIR = 40
const MAX_DEPTH = 8
const MAX_ERRORS = 50

export class DiskScanner {
  private abortController: AbortController | null = null
  private window: BrowserWindow | null = null
  private filesScanned = 0
  private directoriesScanned = 0
  private totalSize = 0
  private errors: string[] = []
  private lastProgressUpdate = 0
  private startTime = 0
  private visitedPaths = new Set<string>()

  get isScanning(): boolean {
    return this.abortController !== null
  }

  cancel(): void {
    this.abortController?.abort()
  }

  async scan(dirPath: string, window: BrowserWindow): Promise<ScanResult> {
    this.window = window
    this.abortController = new AbortController()
    this.filesScanned = 0
    this.directoriesScanned = 0
    this.totalSize = 0
    this.errors = []
    this.lastProgressUpdate = 0
    this.startTime = Date.now()
    this.visitedPaths.clear()

    try {
      this.window?.webContents.send('scan-progress', {
        phase: 'scanning',
        currentPath: dirPath,
        filesScanned: 0,
        directoriesScanned: 0,
        totalSizeBytes: 0,
        elapsedMs: 0
      } as ScanProgress)

      const root = await this.scanDirectory(dirPath, 0)
      const scanDurationMs = Date.now() - this.startTime

      const result: ScanResult = {
        root,
        totalSize: this.totalSize,
        totalFiles: this.filesScanned,
        totalDirectories: this.directoriesScanned,
        scanDurationMs,
        errors: this.errors
      }

      this.window?.webContents.send('scan-complete', result)
      return result
    } catch (err: any) {
      if (err.name === 'AbortError' || this.abortController?.signal.aborted) {
        this.window?.webContents.send('scan-error', 'Scan cancelled')
        throw new Error('Scan cancelled')
      }
      this.window?.webContents.send('scan-error', err.message)
      throw err
    } finally {
      this.abortController = null
      this.window = null
      this.visitedPaths.clear()
    }
  }

  private sendProgress(currentPath: string): void {
    const now = Date.now()
    if (now - this.lastProgressUpdate < 100) return
    this.lastProgressUpdate = now

    const progress: ScanProgress = {
      phase: 'scanning',
      currentPath,
      filesScanned: this.filesScanned,
      directoriesScanned: this.directoriesScanned,
      totalSizeBytes: this.totalSize,
      elapsedMs: now - this.startTime
    }
    this.window?.webContents.send('scan-progress', progress)
  }

  /**
   * Quick size aggregation for directories beyond MAX_DEPTH.
   * Walks the tree counting sizes but does NOT build FileNode children.
   */
  private async aggregateSize(dirPath: string): Promise<{ size: number; files: number; dirs: number }> {
    if (this.abortController?.signal.aborted) {
      throw new Error('AbortError')
    }

    let totalSize = 0
    let files = 0
    let dirs = 0

    let entries: any[]
    try {
      entries = await fs.readdir(dirPath, { withFileTypes: true })
    } catch {
      return { size: 0, files: 0, dirs: 0 }
    }

    for (let i = 0; i < entries.length; i += BATCH_SIZE) {
      if (this.abortController?.signal.aborted) throw new Error('AbortError')

      const batch = entries.slice(i, i + BATCH_SIZE)
      const results = await Promise.allSettled(batch.map(async (entry: any) => {
        const fullPath = path.join(dirPath, entry.name)
        if (entry.isDirectory()) {
          if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('$')) return
          dirs++
          this.directoriesScanned++
          this.sendProgress(fullPath)
          const sub = await this.aggregateSize(fullPath)
          totalSize += sub.size
          files += sub.files
          dirs += sub.dirs
        } else if (entry.isFile()) {
          try {
            const stat = await fs.stat(fullPath)
            totalSize += stat.size
            this.totalSize += stat.size
            files++
            this.filesScanned++
          } catch { /* skip */ }
        }
      }))
    }

    return { size: totalSize, files, dirs }
  }

  private async scanDirectory(dirPath: string, depth: number): Promise<FileNode> {
    if (this.abortController?.signal.aborted) {
      throw new Error('AbortError')
    }

    this.directoriesScanned++
    this.sendProgress(dirPath)

    // Symlink loop prevention
    let realPath: string
    try {
      realPath = await fs.realpath(dirPath)
    } catch {
      realPath = dirPath
    }
    if (this.visitedPaths.has(realPath)) {
      return { name: path.basename(dirPath), path: dirPath, size: 0, type: 'directory', children: [], itemCount: 0 }
    }
    this.visitedPaths.add(realPath)

    // Beyond max depth: just aggregate size, no child nodes
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

    let entries: any[]
    try {
      entries = await fs.readdir(dirPath, { withFileTypes: true })
    } catch (err: any) {
      if (this.errors.length < MAX_ERRORS) {
        this.errors.push(`${dirPath}: ${err.message}`)
      }
      return { name: path.basename(dirPath), path: dirPath, size: 0, type: 'directory', children: [], itemCount: 0 }
    }

    const children: FileNode[] = []
    let dirSize = 0
    let itemCount = 0

    for (let i = 0; i < entries.length; i += BATCH_SIZE) {
      if (this.abortController?.signal.aborted) throw new Error('AbortError')

      const batch = entries.slice(i, i + BATCH_SIZE)
      const results = await Promise.allSettled(
        batch.map(entry => this.processEntry(dirPath, entry, depth))
      )

      for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
          children.push(result.value)
          dirSize += result.value.size
          itemCount += result.value.type === 'directory' ? (result.value.itemCount || 0) + 1 : 1
        }
      }
    }

    // Sort by size descending
    children.sort((a, b) => b.size - a.size)

    // Prune: keep top N children, merge rest into "Other"
    let finalChildren: FileNode[]
    if (children.length > MAX_CHILDREN_PER_DIR) {
      const kept = children.slice(0, MAX_CHILDREN_PER_DIR)
      const rest = children.slice(MAX_CHILDREN_PER_DIR)
      const otherSize = rest.reduce((s, c) => s + c.size, 0)
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

  private async processEntry(parentPath: string, entry: any, depth: number): Promise<FileNode | null> {
    const fullPath = path.join(parentPath, entry.name)

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('$')) {
        return null
      }

      try {
        return await this.scanDirectory(fullPath, depth + 1)
      } catch (err: any) {
        if (err.message === 'AbortError') throw err
        if (this.errors.length < MAX_ERRORS) {
          this.errors.push(`${fullPath}: ${err.message}`)
        }
        return null
      }
    } else if (entry.isFile()) {
      try {
        const stat = await fs.stat(fullPath)
        this.filesScanned++
        this.totalSize += stat.size

        return {
          name: entry.name,
          path: fullPath,
          size: stat.size,
          type: 'file',
          extension: path.extname(entry.name).toLowerCase().slice(1) || undefined,
          modified: stat.mtimeMs
        }
      } catch (err: any) {
        if (this.errors.length < MAX_ERRORS) {
          this.errors.push(`${fullPath}: ${err.message}`)
        }
        return null
      }
    }

    return null
  }
}

export const scanner = new DiskScanner()
