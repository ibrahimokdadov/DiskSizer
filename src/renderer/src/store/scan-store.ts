import { create } from 'zustand'
import type { FileNode, ScanResult, ScanProgress, DriveInfo, DirectoryPage } from '../types/scan'
import { canNavigate, isDirectChild, removeTreeNode, restoreNavigation } from '../lib/scan-tree'
import { useUIStore } from './ui-store'

interface ScanState {
  scanResult: ScanResult | null
  currentNode: FileNode | null
  navigationStack: FileNode[]
  drives: DriveInfo[]
  drivesLoading: boolean
  drivesError: string | null
  activeScanId: string | null
  activePath: string | null
  isScanning: boolean
  isCancelling: boolean
  scanProgress: ScanProgress | null
  scanError: string | null
  actionError: string | null
  directoryRevision: number
  applyDirectoryPage: (page: DirectoryPage) => void
  invalidateDirectoryPages: () => void
  setScanResult: (result: ScanResult | null) => void
  setCurrentNode: (node: FileNode) => void
  navigateIn: (node: FileNode) => void
  navigateUp: () => void
  navigateTo: (index: number) => void
  setDrives: (drives: DriveInfo[]) => void
  setIsScanning: (scanning: boolean) => void
  setScanProgress: (progress: ScanProgress | null) => void
  setScanError: (error: string | null) => void
  setActionError: (error: string | null) => void
  removeNode: (path: string) => void
  reset: () => void
}

export const useScanStore = create<ScanState>((set, get) => ({
  scanResult: null,
  currentNode: null,
  navigationStack: [],
  drives: [],
  drivesLoading: true,
  drivesError: null,
  activeScanId: null,
  activePath: null,
  isScanning: false,
  isCancelling: false,
  scanProgress: null,
  scanError: null,
  actionError: null,
  directoryRevision: 0,

  setScanResult: result => {
    const stack = result ? result.indexed ? [result.root] : restoreNavigation(result.root, get().navigationStack) : []
    set({ scanResult: result, currentNode: stack[stack.length - 1] ?? null, navigationStack: stack, scanError: null, directoryRevision: get().directoryRevision + 1 })
  },
  applyDirectoryPage: page => {
    const state = get()
    if (!state.scanResult?.indexed || state.scanResult.scanId !== page.scanId || state.isScanning || state.currentNode?.path !== page.node.path) return
    const stack = page.ancestors.map(node => node.path === page.node.path ? page.node : node)
    if (!stack.length || stack[0].path !== state.scanResult.root.path || stack[stack.length - 1].path !== page.node.path) return
    set({
      currentNode: page.node, navigationStack: stack,
      scanResult: { ...state.scanResult, root: page.root, totalSize: page.root.size,
        totalFiles: page.root.fileCount ?? state.scanResult.totalFiles,
        totalDirectories: page.root.directoryCount ?? state.scanResult.totalDirectories }
    })
  },
  invalidateDirectoryPages: () => {
    useUIStore.getState().resetSelection()
    set(state => ({ directoryRevision: state.directoryRevision + 1 }))
  },
  setCurrentNode: node => set({ currentNode: node }),
  navigateIn: node => {
    const { currentNode, navigationStack, scanResult } = get()
    if (!canNavigate(node) || currentNode?.path === node.path) return
    const existing = navigationStack.findIndex(item => item.path === node.path)
    if (existing < 0 && !currentNode?.children?.some(child => child.path === node.path) &&
      !(scanResult?.indexed && currentNode && node.detailsAvailable && isDirectChild(currentNode.path, node.path))) return
    const stack = existing >= 0 ? navigationStack.slice(0, existing + 1) : [...navigationStack, node]
    useUIStore.getState().resetSelection()
    set({ currentNode: stack[stack.length - 1], navigationStack: stack })
  },
  navigateUp: () => {
    const stack = get().navigationStack
    if (stack.length > 1) get().navigateTo(stack.length - 2)
  },
  navigateTo: index => {
    const stack = get().navigationStack
    if (index < 0 || index >= stack.length) return
    useUIStore.getState().resetSelection()
    const next = stack.slice(0, index + 1)
    set({ currentNode: next[next.length - 1], navigationStack: next })
  },
  setDrives: drives => set({ drives }),
  setIsScanning: isScanning => set({ isScanning }),
  setScanProgress: progress => set(state => ({
    scanProgress: progress ? {
      ...progress,
      partialRoot: progress.partialRoot ?? (state.scanProgress?.scanId === progress.scanId ? state.scanProgress.partialRoot : undefined)
    } : null
  })),
  setScanError: scanError => set({ scanError }),
  setActionError: actionError => set({ actionError }),
  removeNode: targetPath => {
    const { scanResult, navigationStack } = get()
    if (!scanResult) return
    const change = removeTreeNode(scanResult.root, targetPath)
    if (!change.removed) return
    const stack = restoreNavigation(change.root, navigationStack)
    useUIStore.getState().resetSelection()
    set({
      scanResult: {
        ...scanResult, root: change.root, totalSize: change.root.size,
        totalFiles: Math.max(0, scanResult.totalFiles - change.files),
        totalDirectories: Math.max(0, scanResult.totalDirectories - change.directories)
      },
      currentNode: stack[stack.length - 1], navigationStack: stack
    })
  },
  reset: () => {
    useUIStore.getState().resetSelection()
    set({ scanResult: null, currentNode: null, navigationStack: [], activeScanId: null, activePath: null,
      isScanning: false, isCancelling: false, scanProgress: null, scanError: null, actionError: null, directoryRevision: 0 })
  }
}))
