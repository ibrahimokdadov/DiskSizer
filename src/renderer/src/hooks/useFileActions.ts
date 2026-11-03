import { useCallback } from 'react'
import { ipc } from '../lib/ipc'
import { useScanStore } from '../store/scan-store'
import { useUIStore } from '../store/ui-store'
import type { FileNode, FilePreview } from '../types/scan'
import { canRecycleNode } from '../lib/scan-tree'

export function useFileActions() {
  const removeNode = useScanStore(s => s.removeNode)
  const setShowPreview = useUIStore(s => s.setShowPreview)

  const openInExplorer = useCallback(async (node: FileNode) => {
    if (node.kind === 'aggregate') return
    try {
      await ipc.openInExplorer(node.path)
    } catch (error) {
      useScanStore.getState().setActionError(error instanceof Error ? error.message : String(error))
    }
  }, [])

  const deleteItem = useCallback(async (node: FileNode): Promise<boolean> => {
    const state = useScanStore.getState()
    if (!canRecycleNode(node, state.scanResult, state.isScanning)) return false
    try {
      state.setActionError(null)
      const deleted = await ipc.deleteItem(node.path)
      if (deleted) {
        // The helper updates its authoritative index before returning. Reload
        // summaries instead of subtracting through an incomplete page cache.
        if (useScanStore.getState().scanResult?.scanId === state.scanResult?.scanId) {
          if (state.scanResult?.indexed) useScanStore.getState().invalidateDirectoryPages()
          else removeNode(node.path)
        }
        // Recycling changes the tree, not necessarily the drive's available space.
        void ipc.getDrives().then(useScanStore.getState().setDrives).catch(() => {})
      }
      return deleted
    } catch (error) {
      state.setActionError(error instanceof Error ? error.message : String(error))
      return false
    }
  }, [removeNode])

  const getPreview = useCallback(async (node: FileNode): Promise<FilePreview> => {
    if (node.kind === 'aggregate' || node.type !== 'file') throw new Error('Select a file to preview.')
    return ipc.getFilePreview(node.path)
  }, [])

  const copyPath = useCallback((node: FileNode) => {
    if (node.kind === 'aggregate') return
    void navigator.clipboard.writeText(node.path).catch(error => {
      useScanStore.getState().setActionError(`Could not copy the path: ${String(error)}`)
    })
  }, [])

  return { openInExplorer, deleteItem, getPreview, copyPath, setShowPreview }
}
