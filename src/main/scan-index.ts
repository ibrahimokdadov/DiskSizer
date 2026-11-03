import * as path from 'path'
import type { DirectoryPage, DirectoryPageRequest, FileNode, ScanResult } from '../preload/types'
import { fileRecordPath, isScanDirectory, shallowScanNode, type ScanDirectory, type ScanNode, type StoredScanResult } from './scan-records'

interface DirectoryRecord {
  node: ScanDirectory
  parent?: DirectoryRecord
  descending?: boolean
}

const DEFAULT_PAGE_SIZE = 100
const MAX_PAGE_SIZE = 1000
const observedFile = (node: ScanNode): boolean => !['pending', 'scanning', 'error', 'skipped'].includes(node.status || '')
const observedDirectory = (node: ScanDirectory): boolean => !['pending', 'skipped'].includes(node.status || '')
const yieldWork = (): Promise<void> => new Promise(resolve => setImmediate(resolve))

/** Lives only inside the utility process. File records are never copied into a second index. */
export class ScanIndex {
  private readonly directories = new Map<string, DirectoryRecord>()
  private readonly compactFiles: boolean
  private constructor(private readonly result: StoredScanResult) {
    this.compactFiles = 'compactFiles' in result && result.compactFiles === true
  }

  static async create(result: StoredScanResult): Promise<ScanIndex> {
    const index = new ScanIndex(result)
    await index.build()
    return index
  }

  private async build(): Promise<void> {
    if (!isScanDirectory(this.result.root)) throw new Error('A scan index must have a directory root.')
    const root: DirectoryRecord = { node: this.result.root }
    const records: DirectoryRecord[] = [root]
    this.directories.set(root.node.path, root)
    let visited = 0
    // Iterative preorder establishes parent links with O(directory count) extra storage.
    for (let index = 0; index < records.length; index++) {
      const record = records[index]
      let fileCount = 0
      let sortedDescending = true
      let previous: ScanNode | undefined
      for (const child of record.node.children || []) {
        if (child.path === undefined && !this.compactFiles) throw new Error('Unmarked compact file record in scan results.')
        if (sortedDescending && previous && (previous.size < child.size ||
          (previous.size === child.size && previous.name.localeCompare(child.name) > 0))) sortedDescending = false
        previous = child
        if (isScanDirectory(child) && child.kind !== 'aggregate') {
          const childRecord = { node: child, parent: record }
          if (this.directories.has(child.path)) throw new Error('The scan contains a duplicate directory path.')
          this.directories.set(child.path, childRecord)
          records.push(childRecord)
        } else if (child.type === 'file' && observedFile(child)) {
          fileCount++
        }
        if (++visited % 4096 === 0) await yieldWork()
      }
      record.node.fileCount = fileCount
      record.node.directoryCount = observedDirectory(record.node) ? 1 : 0
      record.node.itemCount = record.node.children?.length || 0
      // The scanner normally supplies this ordering already, making the first
      // and all subsequent default pages a bounded slice with no re-sort.
      record.descending = sortedDescending ? true : undefined
      if (index % 128 === 0) await yieldWork()
    }
    for (let index = records.length - 1; index > 0; index--) {
      const { node, parent } = records[index]
      parent!.node.fileCount! += node.fileCount || 0
      parent!.node.directoryCount! += node.directoryCount || 0
      parent!.node.itemCount! += node.itemCount || 0
      if (index % 128 === 0) await yieldWork()
    }
    // A cancellation before root enumeration has no attempted directories, even
    // though the root is marked partial. Preserve the scanner's exact counters.
    this.result.root.fileCount = this.result.totalFiles
    this.result.root.directoryCount = this.result.totalDirectories
  }

  private shallow(node: ScanNode, parentPath?: string): FileNode {
    return {
      ...shallowScanNode(node, this.compactFiles, parentPath),
      detailsAvailable: node.type === 'directory' && node.kind !== 'aggregate' &&
        !['pending', 'scanning', 'error', 'skipped'].includes(node.status || '')
    }
  }

  summary(): ScanResult {
    // The compact marker and tree are helper-local storage details.
    const { compactFiles: _compactFiles, ...result } = { ...this.result, compactFiles: this.compactFiles }
    return { ...result, indexed: true, root: this.shallow(this.result.root) }
  }

  markCancelled(): void {
    this.result.status = 'cancelled'
    this.result.root.status = 'partial'
  }

  page(request: DirectoryPageRequest): DirectoryPage {
    if (request.scanId !== this.result.scanId) throw new Error('These scan results are no longer active. Start a new scan.')
    if (typeof request.path !== 'string' || request.path.includes('\0')) throw new Error('Invalid directory path.')
    const record = this.directories.get(request.path)
    if (!record) throw new Error('This directory is not part of the retained scan.')
    if (!this.shallow(record.node).detailsAvailable) throw new Error('This directory was not read. Rescan its parent to inspect it.')
    if (request.offset !== undefined && (!Number.isInteger(request.offset) || request.offset < 0)) throw new Error('Invalid page offset.')
    if (request.limit !== undefined && (!Number.isInteger(request.limit) || request.limit < 1)) throw new Error('Invalid page size.')
    if (request.query !== undefined && (typeof request.query !== 'string' || request.query.length > 1024)) throw new Error('Invalid search query.')
    if (request.descending !== undefined && typeof request.descending !== 'boolean') throw new Error('Invalid sort direction.')
    const limit = Math.min(request.limit || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE)
    const descending = request.descending !== false
    const children = record.node.children || []
    if (record.descending !== descending) {
      // Sort the authoritative sibling list in place; never allocate a second
      // array containing every file merely to return a page.
      children.sort((a, b) => (descending ? b.size - a.size : a.size - b.size) || a.name.localeCompare(b.name))
      record.descending = descending
    }
    const query = (request.query || '').trim().toLocaleLowerCase()
    let totalMatches = children.length
    if (query) {
      totalMatches = 0
      for (const child of children) if (child.name.toLocaleLowerCase().includes(query)) totalMatches++
    }
    const lastOffset = totalMatches ? Math.floor((totalMatches - 1) / limit) * limit : 0
    const offset = Math.min(request.offset || 0, lastOffset)
    const pageChildren: FileNode[] = []
    if (!query) {
      for (let index = offset; index < Math.min(offset + limit, children.length); index++) pageChildren.push(this.shallow(children[index], record.node.path))
    } else {
      let matched = 0
      for (const child of children) {
        if (!child.name.toLocaleLowerCase().includes(query)) continue
        if (matched++ >= offset) pageChildren.push(this.shallow(child, record.node.path))
        if (pageChildren.length === limit) break
      }
    }
    const ancestors: FileNode[] = []
    let ancestor: DirectoryRecord | undefined = record
    while (ancestor) {
      ancestors.push(this.shallow(ancestor.node))
      ancestor = ancestor.parent
    }
    ancestors.reverse()
    return {
      scanId: this.result.scanId, node: { ...this.shallow(record.node), children: pageChildren },
      ancestors, root: this.shallow(this.result.root), totalMatches, totalChildren: children.length, offset, limit
    }
  }

  private locate(targetPath: string): { node: ScanNode; parent?: DirectoryRecord } {
    if (typeof targetPath !== 'string' || targetPath.includes('\0')) throw new Error('Invalid item path.')
    const directory = this.directories.get(targetPath)
    if (directory) return { node: directory.node, parent: directory.parent }
    const parent = this.directories.get(path.dirname(targetPath))
    const name = path.basename(targetPath)
    // Compare an exact reconstructed child path. Prefix checks or normalized
    // basename-only matches could authorize an unscanned/stale filesystem path.
    const node = parent?.node.children?.find(child => child.type === 'file' && child.name === name &&
      fileRecordPath(child, parent.node.path) === targetPath)
    if (!node) throw new Error('This item is not part of the retained scan. Refresh the folder before acting on it.')
    return { node, parent }
  }

  validateDeletion(targetPath: string): FileNode {
    const { node, parent } = this.locate(targetPath)
    if (!parent) throw new Error('The scan root cannot be moved to the Recycle Bin.')
    if (node.kind === 'aggregate' || (node.status && node.status !== 'complete') ||
      (node.type === 'directory' && node.childrenLoaded === false)) {
      throw new Error('This item was not fully scanned. Rescan its folder before deleting it.')
    }
    return this.shallow(node, parent.node.path)
  }

  remove(targetPath: string): ScanResult {
    this.validateDeletion(targetPath)
    const { node, parent } = this.locate(targetPath)
    const removedFiles = node.type === 'file' ? (observedFile(node) ? 1 : 0) : node.fileCount || 0
    const removedDirectories = node.type === 'directory' ? node.directoryCount || 0 : 0
    const removedItems = node.type === 'directory' ? (node.itemCount || 0) + 1 : 1
    const siblings = parent!.node.children!
    siblings.splice(siblings.indexOf(node), 1)
    let ancestor = parent
    while (ancestor) {
      ancestor.node.size -= node.size
      ancestor.node.fileCount! -= removedFiles
      ancestor.node.directoryCount! -= removedDirectories
      ancestor.node.itemCount! -= removedItems
      ancestor.descending = undefined
      ancestor = ancestor.parent
    }
    if (isScanDirectory(node)) {
      const pending = [node]
      while (pending.length) {
        const directory = pending.pop()!
        this.directories.delete(directory.path)
        for (const child of directory.children || []) if (isScanDirectory(child)) pending.push(child)
      }
    }
    this.result.totalSize = this.result.root.size
    this.result.totalFiles = this.result.root.fileCount || 0
    this.result.totalDirectories = this.result.root.directoryCount || 0
    return this.summary()
  }
}
