import { useCallback } from 'react'
import { ipc } from '../lib/ipc'
import { useScanStore } from '../store/scan-store'
import { useUIStore } from '../store/ui-store'
import type { FileNode, FilePreview } from '../types/scan'

export function useFileActions() {
  const removeNode = useScanStore(s => s.removeNode)
  const setShowPreview = useUIStore(s => s.setShowPreview)

  const openInExplorer = useCallback(async (node: FileNode) => {
    await ipc.openInExplorer(node.path)
  }, [])

  const deleteItem = useCallback(async (node: FileNode): Promise<boolean> => {
    const deleted = await ipc.deleteItem(node.path)
    if (deleted) {
      removeNode(node.path)
    }
    return deleted
  }, [removeNode])

  const getPreview = useCallback(async (node: FileNode): Promise<FilePreview> => {
    return ipc.getFilePreview(node.path)
  }, [])

  const copyPath = useCallback((node: FileNode) => {
    navigator.clipboard.writeText(node.path)
  }, [])

  return { openInExplorer, deleteItem, getPreview, copyPath, setShowPreview }
}
