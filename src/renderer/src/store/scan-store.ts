import { create } from 'zustand'
import type { FileNode, ScanResult, ScanProgress, DriveInfo } from '../types/scan'

interface ScanState {
  // Scan data
  scanResult: ScanResult | null
  currentNode: FileNode | null
  navigationStack: FileNode[]
  drives: DriveInfo[]

  // Scan status
  isScanning: boolean
  scanProgress: ScanProgress | null
  scanError: string | null

  // Actions
  setScanResult: (result: ScanResult | null) => void
  setCurrentNode: (node: FileNode) => void
  navigateIn: (node: FileNode) => void
  navigateUp: () => void
  navigateTo: (index: number) => void
  setDrives: (drives: DriveInfo[]) => void
  setIsScanning: (scanning: boolean) => void
  setScanProgress: (progress: ScanProgress | null) => void
  setScanError: (error: string | null) => void
  removeNode: (path: string) => void
  reset: () => void
}

export const useScanStore = create<ScanState>((set, get) => ({
  scanResult: null,
  currentNode: null,
  navigationStack: [],
  drives: [],
  isScanning: false,
  scanProgress: null,
  scanError: null,

  setScanResult: (result) => set({
    scanResult: result,
    currentNode: result?.root || null,
    navigationStack: result?.root ? [result.root] : [],
    scanError: null
  }),

  setCurrentNode: (node) => set({ currentNode: node }),

  navigateIn: (node) => {
    if (node.type !== 'directory') return
    const { navigationStack } = get()
    set({
      currentNode: node,
      navigationStack: [...navigationStack, node]
    })
  },

  navigateUp: () => {
    const { navigationStack } = get()
    if (navigationStack.length <= 1) return
    const newStack = navigationStack.slice(0, -1)
    set({
      currentNode: newStack[newStack.length - 1],
      navigationStack: newStack
    })
  },

  navigateTo: (index) => {
    const { navigationStack } = get()
    if (index < 0 || index >= navigationStack.length) return
    const newStack = navigationStack.slice(0, index + 1)
    set({
      currentNode: newStack[newStack.length - 1],
      navigationStack: newStack
    })
  },

  setDrives: (drives) => set({ drives }),
  setIsScanning: (scanning) => set({ isScanning: scanning }),
  setScanProgress: (progress) => set({ scanProgress: progress }),
  setScanError: (error) => set({ scanError: error }),

  removeNode: (targetPath) => {
    const { scanResult, currentNode, navigationStack } = get()
    if (!scanResult) return

    function removeFromTree(node: FileNode): FileNode {
      if (!node.children) return node
      const newChildren = node.children
        .filter(c => c.path !== targetPath)
        .map(c => removeFromTree(c))
      const newSize = newChildren.reduce((sum, c) => sum + c.size, 0)
      const newItemCount = newChildren.reduce((sum, c) => sum + (c.type === 'directory' ? (c.itemCount || 0) + 1 : 1), 0)
      return { ...node, children: newChildren, size: newSize, itemCount: newItemCount }
    }

    const newRoot = removeFromTree(scanResult.root)
    const newResult = {
      ...scanResult,
      root: newRoot,
      totalSize: newRoot.size
    }

    // Update navigation stack
    const newStack = navigationStack.map(n => {
      function findNode(tree: FileNode, path: string): FileNode | null {
        if (tree.path === path) return tree
        if (tree.children) {
          for (const child of tree.children) {
            const found = findNode(child, path)
            if (found) return found
          }
        }
        return null
      }
      return findNode(newRoot, n.path) || n
    })

    const newCurrentNode = newStack[newStack.length - 1] || newRoot

    set({
      scanResult: newResult,
      currentNode: newCurrentNode,
      navigationStack: newStack
    })
  },

  reset: () => set({
    scanResult: null,
    currentNode: null,
    navigationStack: [],
    isScanning: false,
    scanProgress: null,
    scanError: null
  })
}))
