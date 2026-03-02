import { useCallback, useEffect } from 'react'
import { useUIStore } from '../store/ui-store'
import type { FileNode } from '../types/scan'

export function useContextMenu() {
  const contextMenu = useUIStore(s => s.contextMenu)
  const setContextMenu = useUIStore(s => s.setContextMenu)

  const showContextMenu = useCallback((e: React.MouseEvent, node: FileNode) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, node })
  }, [setContextMenu])

  const hideContextMenu = useCallback(() => {
    setContextMenu(null)
  }, [setContextMenu])

  useEffect(() => {
    const handler = () => hideContextMenu()
    window.addEventListener('click', handler)
    window.addEventListener('contextmenu', handler)
    return () => {
      window.removeEventListener('click', handler)
      window.removeEventListener('contextmenu', handler)
    }
  }, [hideContextMenu])

  return { contextMenu, showContextMenu, hideContextMenu }
}
