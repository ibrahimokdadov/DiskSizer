import type { FileNode, ScanResult } from '../types/scan'

const key = (path: string) => path.replace(/\\/g, '/').replace(/\/$/, '')
const containsPath = (parent: string, child: string) => key(child).startsWith(`${key(parent)}/`)

export function isDirectChild(parent: string, child: string): boolean {
  const prefix = `${key(parent)}/`
  const relative = key(child).startsWith(prefix) ? key(child).slice(prefix.length) : ''
  return !!relative && !relative.includes('/')
}

export function canNavigate(node: FileNode): boolean {
  return node.type === 'directory' && node.kind !== 'aggregate' && (node.detailsAvailable === true || node.childrenLoaded !== false) &&
    node.status !== 'skipped' && node.status !== 'error' && node.status !== 'pending' && node.status !== 'scanning'
}

export function canRecycleNode(node: FileNode, result: ScanResult | null, isScanning: boolean): boolean {
  return !isScanning && result?.source !== 'snapshot' && node.kind !== 'aggregate' && node.childrenLoaded !== false && node.path !== result?.root.path &&
    node.status !== 'skipped' && node.status !== 'error' && node.status !== 'pending' && node.status !== 'scanning' &&
    (!result?.indexed || node.status === 'complete')
}

export function findNodeByPath(root: FileNode, targetPath: string): FileNode | null {
  let current: FileNode | undefined = root
  while (current) {
    if (key(current.path) === key(targetPath)) return current
    current = current.children?.find(child => key(child.path) === key(targetPath) ||
      (child.type === 'directory' && child.kind !== 'aggregate' && containsPath(child.path, targetPath)))
  }
  return null
}

export function restoreNavigation(root: FileNode, previous: FileNode[]): FileNode[] {
  if (previous[0]?.path !== root.path) return [root]
  const stack = [root]
  for (const oldNode of previous.slice(1)) {
    const next = stack[stack.length - 1].children?.find(child => child.path === oldNode.path)
    if (!next || !canNavigate(next)) break
    stack.push(next)
  }
  return stack
}

/** Subtract only the removed branch; unloaded and aggregate sibling totals stay intact. */
export function removeTreeNode(root: FileNode, targetPath: string): {
  root: FileNode; removed: FileNode | null; files: number; directories: number
} {
  const removed = findNodeByPath(root, targetPath)
  if (!removed || removed === root || removed.kind === 'aggregate') {
    return { root, removed: null, files: 0, directories: 0 }
  }
  let files = 0
  let directories = 0
  const pending = [removed]
  while (pending.length) {
    const node = pending.pop()!
    if (node.kind === 'aggregate') continue
    if (node.type === 'file') {
      if (node.status !== 'skipped' && node.status !== 'error') files++
    } else {
      if (node.status !== 'skipped' && node.status !== 'pending') directories++
      if (node.children) for (const child of node.children) pending.push(child)
    }
  }
  const itemCount = removed.type === 'file' ? 1 : (removed.itemCount ?? files + directories - 1) + 1
  function update(node: FileNode): FileNode {
    if (!node.children || !containsPath(node.path, targetPath)) return node
    return {
      ...node,
      size: Math.max(0, node.size - removed!.size),
      itemCount: node.itemCount === undefined ? undefined : Math.max(0, node.itemCount - itemCount),
      children: node.children.filter(child => child.path !== targetPath).map(child =>
        child.type === 'directory' && containsPath(child.path, targetPath) ? update(child) : child)
    }
  }
  return { root: update(root), removed, files, directories }
}
