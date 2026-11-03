import * as path from 'path'
import type { FileNode, ScanResult } from '../preload/types'

/** Internal file metadata. The enclosing result, not every file, marks this format. */
export interface CompactFileRecord extends Omit<FileNode, 'path' | 'extension' | 'children' | 'childrenLoaded' | 'status' | 'type'> {
  type: 'file'
  path?: never
  extension?: never
  children?: never
  childrenLoaded?: never
  status?: Exclude<FileNode['status'], 'complete'>
}

export interface ScanDirectory extends Omit<FileNode, 'children' | 'type'> {
  type: 'directory'
  children?: ScanNode[]
}

export type ScanNode = FileNode | ScanDirectory | CompactFileRecord
export interface CompactScanResult extends Omit<ScanResult, 'root'> {
  compactFiles: true
  root: ScanDirectory
}
export type StoredScanResult = ScanResult | CompactScanResult

export const isScanDirectory = (node: ScanNode): node is ScanDirectory => node.type === 'directory'

/** Exact child membership; never accept a basename that changes its parent. */
export function fileRecordPath(node: ScanNode, parentPath: string): string {
  if (node.type !== 'file' || !node.name || node.name === '.' || node.name === '..' ||
    node.name.includes('\0') || path.basename(node.name) !== node.name) throw new Error('Invalid file record name.')
  const fullPath = path.join(parentPath, node.name)
  if (node.path !== undefined && node.path !== fullPath) throw new Error('File record path does not match its parent.')
  return fullPath
}

/** Materialize only bounded preview/page records at the process boundary. */
export function shallowScanNode(node: ScanNode, compactFiles: boolean, parentPath?: string): FileNode {
  if (node.path === undefined) {
    if (!compactFiles || !parentPath) throw new Error('Compact file records require their scan and parent directory.')
    return {
      name: node.name, path: fileRecordPath(node, parentPath), size: node.size, type: 'file',
      modified: node.modified, extension: path.extname(node.name).toLowerCase().slice(1) || undefined,
      status: node.status ?? 'complete', childrenLoaded: true,
      ...(node.skipReason === undefined ? {} : { skipReason: node.skipReason })
    }
  }
  const { children: _children, ...summary } = node
  return summary
}
