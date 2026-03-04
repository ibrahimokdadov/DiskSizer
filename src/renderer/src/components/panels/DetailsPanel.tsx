import { useState, useEffect } from 'react'
import { X, Eye, FolderOpen, Trash2, Copy, File, Folder, ShieldCheck, ShieldAlert, ShieldQuestion } from 'lucide-react'
import { useUIStore } from '../../store/ui-store'
import { useFileActions } from '../../hooks/useFileActions'
import { useScanStore } from '../../store/scan-store'
import { formatBytes, formatNumber } from '../../lib/format'
import { getFileColor } from '../../lib/colors'
import { getFileCategory } from '../../lib/colors'
import { PreviewPanel } from './PreviewPanel'
import { classifyNode, SAFETY_META } from '../../lib/safety'
import type { FileNode } from '../../types/scan'

export function DetailsPanel() {
  const selectedNode = useUIStore(s => s.selectedNode)
  const showPreview = useUIStore(s => s.showPreview)
  const setSelectedNode = useUIStore(s => s.setSelectedNode)
  const setShowPreview = useUIStore(s => s.setShowPreview)
  const scanResult = useScanStore(s => s.scanResult)
  const { openInExplorer, deleteItem, copyPath } = useFileActions()
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (copied) {
      const t = setTimeout(() => setCopied(false), 1500)
      return () => clearTimeout(t)
    }
  }, [copied])

  if (!selectedNode) return null

  const color = selectedNode.type === 'directory'
    ? '#38bdf8'
    : getFileColor(selectedNode.extension)
  const category = selectedNode.type === 'directory' ? 'Directory' : getFileCategory(selectedNode.extension)
  const percentage = scanResult?.totalSize
    ? ((selectedNode.size / scanResult.totalSize) * 100).toFixed(1)
    : '0'

  const handleCopyPath = () => {
    copyPath(selectedNode)
    setCopied(true)
  }

  const handleDelete = async () => {
    await deleteItem(selectedNode)
    setSelectedNode(null)
  }

  return (
    <div className="w-[300px] bg-surface border-l border-gray-800 flex flex-col shrink-0">
      <div className="flex items-center justify-between p-3 border-b border-gray-800">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Details</h3>
        <button
          onClick={() => setSelectedNode(null)}
          className="p-1 rounded hover:bg-surface-elevated text-gray-500 hover:text-gray-300"
        >
          <X size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Header */}
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg" style={{ backgroundColor: color + '20' }}>
            {selectedNode.type === 'directory' ? (
              <Folder size={20} style={{ color }} />
            ) : (
              <File size={20} style={{ color }} />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-200 break-all">{selectedNode.name}</p>
            <p className="text-xs text-gray-500 capitalize">{category}</p>
            <div className="mt-1">
              <SafetyBadge node={selectedNode} />
            </div>
          </div>
        </div>

        {/* Info Grid */}
        <div className="space-y-2.5">
          <InfoRow label="Size" value={formatBytes(selectedNode.size)} />
          <InfoRow label="% of Total" value={percentage + '%'} />
          {selectedNode.type === 'directory' && selectedNode.itemCount !== undefined && (
            <InfoRow label="Items" value={formatNumber(selectedNode.itemCount)} />
          )}
          {selectedNode.extension && (
            <InfoRow label="Extension" value={'.' + selectedNode.extension} />
          )}
          {selectedNode.modified && (
            <InfoRow label="Modified" value={new Date(selectedNode.modified).toLocaleDateString()} />
          )}
          <div>
            <p className="text-xs text-gray-500 mb-0.5">Path</p>
            <p className="text-xs text-gray-300 break-all font-mono bg-surface-elevated rounded p-1.5">
              {selectedNode.path}
            </p>
          </div>
        </div>

        {/* Size Bar */}
        <div>
          <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${Math.max(1, parseFloat(percentage))}%`,
                backgroundColor: color
              }}
            />
          </div>
          <p className="text-[10px] text-gray-500 mt-1">{percentage}% of scanned total</p>
        </div>

        {/* Actions */}
        <div className="space-y-1.5">
          {selectedNode.type === 'file' && (
            <ActionButton
              icon={<Eye size={14} />}
              label="Preview"
              onClick={() => setShowPreview(!showPreview)}
            />
          )}
          <ActionButton
            icon={<FolderOpen size={14} />}
            label="Open in Explorer"
            onClick={() => openInExplorer(selectedNode)}
          />
          <ActionButton
            icon={<Copy size={14} />}
            label={copied ? 'Copied!' : 'Copy Path'}
            onClick={handleCopyPath}
          />
          <ActionButton
            icon={<Trash2 size={14} />}
            label="Delete"
            onClick={handleDelete}
            variant="danger"
          />
        </div>

        {/* Preview */}
        {showPreview && selectedNode.type === 'file' && (
          <PreviewPanel node={selectedNode} />
        )}
      </div>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-xs text-gray-500">{label}</span>
      <span className="text-xs text-gray-300 font-medium">{value}</span>
    </div>
  )
}

function ActionButton({ icon, label, onClick, variant = 'default' }: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  variant?: 'default' | 'danger'
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
        variant === 'danger'
          ? 'text-red-400 hover:bg-red-500/10'
          : 'text-gray-300 hover:bg-surface-elevated'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}

function SafetyBadge({ node }: { node: FileNode }) {
  const level = classifyNode(node)
  const { label, color, bg } = SAFETY_META[level]
  const Icon = level === 'safe' ? ShieldCheck : level === 'unsafe' ? ShieldAlert : ShieldQuestion
  return (
    <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-medium ${color} ${bg}`}>
      <Icon size={11} />
      {label}
    </div>
  )
}
