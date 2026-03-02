import { useEffect, useRef } from 'react'
import { Eye, FolderOpen, Copy, Trash2 } from 'lucide-react'
import { useFileActions } from '../../hooks/useFileActions'
import { useUIStore } from '../../store/ui-store'
import type { FileNode } from '../../types/scan'

interface Props {
  x: number
  y: number
  node: FileNode
  onClose: () => void
}

export function ContextMenu({ x, y, node, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const { openInExplorer, deleteItem, copyPath, setShowPreview } = useFileActions()
  const setSelectedNode = useUIStore(s => s.setSelectedNode)

  // Adjust position to stay within viewport
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (rect.right > window.innerWidth) {
      el.style.left = `${x - rect.width}px`
    }
    if (rect.bottom > window.innerHeight) {
      el.style.top = `${y - rect.height}px`
    }
  }, [x, y])

  const items = [
    ...(node.type === 'file' ? [{
      icon: <Eye size={14} />,
      label: 'Preview',
      onClick: () => { setSelectedNode(node); setShowPreview(true); onClose() }
    }] : []),
    {
      icon: <FolderOpen size={14} />,
      label: 'Open in Explorer',
      onClick: () => { openInExplorer(node); onClose() }
    },
    {
      icon: <Copy size={14} />,
      label: 'Copy Path',
      onClick: () => { copyPath(node); onClose() }
    },
    { divider: true },
    {
      icon: <Trash2 size={14} />,
      label: 'Delete',
      danger: true,
      onClick: async () => { await deleteItem(node); onClose() }
    }
  ] as const

  return (
    <div
      ref={ref}
      className="fixed z-50 bg-surface-elevated border border-gray-700 rounded-lg shadow-2xl py-1 min-w-[180px]"
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
    >
      {items.map((item, i) => {
        if ('divider' in item) {
          return <div key={i} className="h-px bg-gray-700 my-1" />
        }
        return (
          <button
            key={i}
            onClick={item.onClick}
            className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors ${
              'danger' in item && item.danger
                ? 'text-red-400 hover:bg-red-500/10'
                : 'text-gray-300 hover:bg-surface-overlay'
            }`}
          >
            {item.icon}
            {item.label}
          </button>
        )
      })}
    </div>
  )
}
