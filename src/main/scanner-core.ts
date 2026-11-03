import { promises as fs } from 'fs'
import * as path from 'path'
import { randomUUID } from 'crypto'
import { getHeapStatistics } from 'v8'
import type { BrowserWindow } from 'electron'
import type { FileNode, ScanResult, ScanProgress } from '../preload/types'
import { isScanDirectory, shallowScanNode, type CompactScanResult, type ScanDirectory, type ScanNode, type StoredScanResult } from './scan-records'

export interface DirectoryEntry {
  name: string
  size: number
  mtime: number
  isDir: boolean
  isSymlink: boolean
  skipReason?: string
  error?: string
  allocatedSize?: number
  fileIdentity?: string
}

type DirectoryReader = (dirPath: string, signal: AbortSignal) => Promise<DirectoryEntry[]>
type Engine = 'native' | 'standard'
interface ScanMemoryBudget {
  maxHeapBytes?: number
  heapUsed?: () => number
}
const MAX_ERROR_SAMPLES = 100
const PREVIEW_ITEMS = 40

function directoryNode(dirPath: string): ScanDirectory {
  return { name: path.basename(dirPath) || dirPath, path: dirPath, size: 0, type: 'directory', children: [], itemCount: 0, status: 'pending', childrenLoaded: false }
}

/** Largest observed root children, without sorting/copying the entire directory. */
function previewChildren(root: ScanDirectory, compactFiles: boolean): FileNode[] {
  const children = root.children || []
  const heap: ScanNode[] = []
  const siftDown = (index: number): void => {
    while (index * 2 + 1 < heap.length) {
      let smaller = index * 2 + 1
      if (smaller + 1 < heap.length && heap[smaller + 1].size < heap[smaller].size) smaller++
      if (heap[index].size <= heap[smaller].size) break
      ;[heap[index], heap[smaller]] = [heap[smaller], heap[index]]
      index = smaller
    }
  }
  for (const child of children) {
    if (heap.length < PREVIEW_ITEMS) {
      heap.push(child)
      let index = heap.length - 1
      while (index > 0) {
        const parent = (index - 1) >> 1
        if (heap[parent].size <= heap[index].size) break
        ;[heap[parent], heap[index]] = [heap[index], heap[parent]]
        index = parent
      }
    } else if (child.size > heap[0].size) {
      heap[0] = child
      siftDown(0)
    }
  }
  const preview: FileNode[] = heap.sort((a, b) => b.size - a.size).map(child => ({
    ...shallowScanNode(child, compactFiles, root.path), childrenLoaded: child.type === 'file'
  }))
  if (children.length > preview.length) {
    preview.push({
      name: `${children.length - preview.length} more items`, path: `aggregate:${root.path}`,
      type: 'directory', kind: 'aggregate', size: Math.max(0, root.size - preview.reduce((sum, child) => sum + child.size, 0)),
      itemCount: children.length - preview.length, childrenLoaded: false, status: 'scanning'
    })
  }
  return preview
}

/** One global directory queue; workers never wait for child work while holding a slot. */
export class MetadataScanner {
  private activeController?: AbortController
  constructor(readonly engine: Engine, private readonly readDirectory: DirectoryReader, private readonly concurrency = 4,
    private readonly memoryBudget: ScanMemoryBudget = {}) {}

  get isScanning(): boolean { return !!this.activeController }
  cancel(): void { this.activeController?.abort() }

  async scan(dirPath: string, window: BrowserWindow, scanId: string = randomUUID()): Promise<ScanResult> {
    const send = (channel: string, value: unknown): void => {
      if (!window.isDestroyed?.() && !window.webContents.isDestroyed?.()) window.webContents.send(channel, value)
    }
    try {
      const result = await this.scanBench(dirPath, progress => send('scan-progress', progress), scanId)
      send(result.status === 'cancelled' ? 'scan-cancelled' : 'scan-complete', result)
      return result
    } catch (error) {
      send('scan-error', { scanId, message: error instanceof Error ? error.message : String(error) })
      throw error
    }
  }

  async scanBench(dirPath: string, onProgress?: (progress: ScanProgress) => void, scanId: string = randomUUID()): Promise<ScanResult> {
    return this.scanRecords(dirPath, onProgress, scanId, false)
  }

  /** Utility-process storage only. Public scans retain their full FileNode contract. */
  async scanCompactBench(dirPath: string, onProgress?: (progress: ScanProgress) => void, scanId: string = randomUUID()): Promise<CompactScanResult> {
    return this.scanRecords(dirPath, onProgress, scanId, true)
  }

  private scanRecords(dirPath: string, onProgress: ((progress: ScanProgress) => void) | undefined, scanId: string, compactFiles: false): Promise<ScanResult>
  private scanRecords(dirPath: string, onProgress: ((progress: ScanProgress) => void) | undefined, scanId: string, compactFiles: true): Promise<CompactScanResult>
  private async scanRecords(dirPath: string, onProgress: ((progress: ScanProgress) => void) | undefined, scanId: string, compactFiles: boolean): Promise<StoredScanResult> {
    this.cancel()
    const controller = new AbortController()
    this.activeController = controller
    const { signal } = controller
    const startTime = Date.now()
    const rootPath = path.resolve(/^[a-z]:$/i.test(dirPath) ? dirPath + path.sep : dirPath)
    const root = directoryNode(rootPath)
    const directories: ScanDirectory[] = [root]
    const parents = new WeakMap<ScanDirectory, ScanDirectory>()
    const errors: string[] = []
    let totalFiles = 0, totalDirectories = 0, totalSize = 0, errorCount = 0, skippedCount = 0
    let memoryLimitReached = false
    // Leave headroom for the directory being enumerated and the index metadata.
    // The UI requests shallow pages, so finishing never clones this entire heap.
    const heapLimit = this.memoryBudget.maxHeapBytes ?? Math.min(1536 * 1024 * 1024, getHeapStatistics().heap_size_limit / 2)
    const heapUsed = this.memoryBudget.heapUsed ?? (() => getHeapStatistics().used_heap_size)
    let currentPath = rootPath
    let timer: ReturnType<typeof setInterval> | undefined
    let lastPreviewAt = 0

    const recordError = (targetPath: string, message: string): void => {
      errorCount++
      if (errors.length < MAX_ERROR_SAMPLES) errors.push(`${targetPath}: ${message}`)
    }
    const withinMemoryBudget = (): boolean => {
      if (signal.aborted) return false
      if (heapUsed() <= heapLimit) return true
      memoryLimitReached = true
      recordError(rootPath, 'The scan reached its memory limit. These are partial results. Scan a smaller folder to continue.')
      controller.abort()
      return false
    }
    const addToAncestors = (node: ScanDirectory, size: number, items: number): void => {
      let current: ScanDirectory | undefined = node
      while (current) {
        current.size += size
        current.itemCount = (current.itemCount || 0) + items
        current = parents.get(current)
      }
    }
    const publish = (forcePreview = false, phase: ScanProgress['phase'] = 'scanning'): void => {
      if (signal.aborted) return
      const now = Date.now()
      const includePreview = forcePreview || now - lastPreviewAt >= 500
      if (includePreview) lastPreviewAt = now
      onProgress?.({
        scanId, phase, engine: this.engine, currentPath,
        filesScanned: totalFiles, directoriesScanned: totalDirectories,
        totalSizeBytes: totalSize, elapsedMs: now - startTime, errorCount, skippedCount,
        ...(includePreview ? { partialRoot: { ...root, status: 'scanning', childrenLoaded: false, children: previewChildren(root, compactFiles) } } : {})
      })
    }

    try {
      // A bad target is a failed scan, never an apparently successful empty result.
      const stat = await fs.stat(rootPath)
      if (!stat.isDirectory()) throw new Error('Choose a folder or drive to scan.')
      root.status = 'scanning'
      publish(true)
      timer = setInterval(() => publish(), 200)

      let nextDirectory = 0
      const processDirectory = async (node: ScanDirectory): Promise<void> => {
        if (!withinMemoryBudget()) return
        node.status = 'scanning'
        totalDirectories++
        currentPath = node.path
        let entries: DirectoryEntry[]
        try {
          entries = await this.readDirectory(node.path, signal)
        } catch (error) {
          if (signal.aborted) {
            node.status = 'partial'
            return
          }
          const message = error instanceof Error ? error.message : String(error)
          node.status = 'error'
          node.skipReason = message
          recordError(node.path, message)
          return
        }
        let directBytes = 0, directItems = 0
        for (let index = 0; index < entries.length && !signal.aborted; index++) {
          if (index % 1024 === 0 && !withinMemoryBudget()) break
          const entry = entries[index]
          const child: ScanNode = entry.isDir ? directoryNode(path.join(node.path, entry.name)) : compactFiles ? {
            name: entry.name, size: entry.size, type: 'file', modified: entry.mtime
          } : {
            name: entry.name, path: path.join(node.path, entry.name), size: entry.size, type: 'file',
            extension: path.extname(entry.name).toLowerCase().slice(1) || undefined,
            modified: entry.mtime, status: 'complete', childrenLoaded: true
          }
          // Files never receive ancestor updates directly; storing millions of
          // redundant WeakMap entries materially increases the retained heap.
          if (isScanDirectory(child)) parents.set(child, node)
          node.children!.push(child)
          directItems++
          if (entry.isSymlink || entry.skipReason) {
            child.status = 'skipped'
            child.size = 0
            child.skipReason = entry.skipReason || 'Link not followed to avoid duplicate counting and loops.'
            skippedCount++
          } else if (entry.error) {
            child.status = 'error'
            child.size = 0
            child.skipReason = entry.error
            recordError(path.join(node.path, entry.name), entry.error)
          } else if (isScanDirectory(child)) {
            directories.push(child)
          } else {
            totalFiles++
            totalSize += entry.size
            directBytes += entry.size
          }
          if ((index + 1) % 256 === 0) {
            addToAncestors(node, directBytes, directItems)
            directBytes = 0
            directItems = 0
            await new Promise<void>(resolve => setImmediate(resolve))
          }
        }
        addToAncestors(node, directBytes, directItems)
        node.childrenLoaded = !signal.aborted
        node.status = signal.aborted ? 'partial' : 'complete'
      }

      await new Promise<void>((resolve) => {
        let active = 0
        const pump = (): void => {
          while (!signal.aborted && active < this.concurrency && nextDirectory < directories.length) {
            const node = directories[nextDirectory++]
            active++
            void processDirectory(node).catch(error => {
              node.status = 'error'
              recordError(node.path, error instanceof Error ? error.message : String(error))
            }).finally(() => { active--; pump() })
          }
          if (active === 0 && (signal.aborted || nextDirectory >= directories.length)) resolve()
        }
        pump()
      })

      publish(true, 'building')
      // Postorder finalization, without recursion or a depth limit.
      for (let index = directories.length - 1; index >= 0; index--) {
        const node = directories[index]
        node.children!.sort((a, b) => b.size - a.size || a.name.localeCompare(b.name))
        if (node.status === 'complete') {
          node.status = node.children!.some(child => child.status !== 'complete' &&
            !(compactFiles && child.type === 'file' && child.path === undefined && child.status === undefined)) ? 'partial' : 'complete'
        } else if (node.status === 'scanning') {
          node.status = 'partial'
        }
        if (index % 128 === 0) await new Promise<void>(resolve => setImmediate(resolve))
      }
      if (signal.aborted) root.status = 'partial'
      const result: Omit<ScanResult, 'root'> = {
        scanId, totalSize, totalFiles, totalDirectories, errors, errorCount, skippedCount,
        scanDurationMs: Date.now() - startTime, engine: this.engine, sizeKind: 'logical',
        status: memoryLimitReached ? 'partial' : signal.aborted ? 'cancelled' : errorCount > 0 || skippedCount > 0 ? 'partial' : 'complete',
        ...(memoryLimitReached ? { stopReason: 'memory-limit' as const } : {})
      }
      if (compactFiles) return { ...result, compactFiles: true, root }
      // Only the false branch constructs full file records above. No compact
      // record is present in this tree; retain the existing public result type.
      return { ...result, root: root as FileNode }
    } finally {
      if (timer) clearInterval(timer)
      if (this.activeController === controller) this.activeController = undefined
    }
  }
}
