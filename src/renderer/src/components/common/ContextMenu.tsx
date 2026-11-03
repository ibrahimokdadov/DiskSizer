import { useEffect, useRef } from 'react'
import { Eye, FolderOpen, Copy, Trash2 } from 'lucide-react'
import { useFileActions } from '../../hooks/useFileActions'
import { useUIStore } from '../../store/ui-store'
import { useScanStore } from '../../store/scan-store'
import type { FileNode } from '../../types/scan'
import { canRecycleNode } from '../../lib/scan-tree'

interface Props { x: number; y: number; node: FileNode; onClose: () => void }

export function ContextMenu({ x, y, node, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const { openInExplorer, deleteItem, copyPath, setShowPreview } = useFileActions()
  const setSelectedNode = useUIStore(s => s.setSelectedNode)
  const isScanning = useScanStore(s => s.isScanning)
  const result = useScanStore(s => s.scanResult)
  const canDelete = canRecycleNode(node, result, isScanning)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    const rect = el.getBoundingClientRect()
    el.style.left = `${Math.max(8, Math.min(x, window.innerWidth - rect.width - 8))}px`
    el.style.top = `${Math.max(8, Math.min(y, window.innerHeight - rect.height - 8))}px`
    el.querySelector<HTMLButtonElement>('button')?.focus()
    return () => { if (previouslyFocused?.isConnected) previouslyFocused.focus() }
  }, [x, y])
  if (node.kind === 'aggregate') return null

  return (
    <div ref={ref} role="menu" aria-label={`Actions for ${node.name}`} className="fixed z-50 bg-[#1c293a] border border-[#3a4c66] rounded-lg shadow-2xl p-1.5 min-w-[205px]" style={{ left: x, top: y }} onClick={event => event.stopPropagation()} onKeyDown={event => {
      if (event.key === 'Escape') { event.stopPropagation(); event.preventDefault(); onClose() }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const buttons = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || [])
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
        buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus()
      }
    }}>
      <MenuItem icon={<FolderOpen size={14} />} label="Open in Explorer" onClick={() => { void openInExplorer(node); onClose() }} />
      <MenuItem icon={<Copy size={14} />} label="Copy path" onClick={() => { copyPath(node); onClose() }} />
      {node.type === 'file' && <MenuItem icon={<Eye size={14} />} label="Preview file" onClick={() => { setSelectedNode(node); setShowPreview(true); onClose() }} />}
      <div className="h-px bg-[#344359] my-1.5" />
      <MenuItem icon={<Trash2 size={14} />} label="Move to Recycle Bin" disabled={!canDelete} danger onClick={() => { void deleteItem(node); onClose() }} />
    </div>
  )
}

function MenuItem({ icon, label, onClick, disabled = false, danger = false }: { icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return <button role="menuitem" disabled={disabled} onClick={onClick} className={`w-full flex items-center gap-2.5 px-2.5 py-2.5 rounded-md text-[11px] transition-colors ${danger ? 'text-[#e3a2a8] hover:bg-[#48313c]' : 'text-[#c9d9ee] hover:bg-[#2a3d56]'}`}>{icon}{label}</button>
}
