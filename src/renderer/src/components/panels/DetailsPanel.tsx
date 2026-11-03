import { X, Eye, FolderOpen, Trash2, Copy, File, Folder, Info } from 'lucide-react'
import { useUIStore } from '../../store/ui-store'
import { useFileActions } from '../../hooks/useFileActions'
import { useScanStore } from '../../store/scan-store'
import { formatBytes, formatNumber } from '../../lib/format'
import { getFileCategory } from '../../lib/colors'
import { PreviewPanel } from './PreviewPanel'
import { classifyNode, getSafetyNote, SAFETY_META } from '../../lib/safety'
import { canRecycleNode } from '../../lib/scan-tree'

export function DetailsPanel() {
  const node = useUIStore(s => s.selectedNode)
  const showPreview = useUIStore(s => s.showPreview)
  const setSelectedNode = useUIStore(s => s.setSelectedNode)
  const setShowPreview = useUIStore(s => s.setShowPreview)
  const isScanning = useScanStore(s => s.isScanning)
  const result = useScanStore(s => s.scanResult)
  const { openInExplorer, deleteItem, copyPath } = useFileActions()
  if (!node || node.kind === 'aggregate') return null
  const canDelete = canRecycleNode(node, result, isScanning)
  const category = node.type === 'directory' ? 'Folder' : getFileCategory(node.extension)
  const level = classifyNode(node)

  return (
    <aside className="inspector" aria-label="Selected item details">
      <div className="inspector-heading"><span>DETAILS</span><button className="icon-button" onClick={() => setSelectedNode(null)} aria-label="Close details" title="Close details (Esc)"><X size={16} /></button></div>
      <div className="inspector-content">
        <div className="inspector-icon">{node.type === 'directory' ? <Folder size={25} strokeWidth={1.5} /> : <File size={25} strokeWidth={1.5} />}</div>
        <h2 className="inspector-name selectable">{node.name}</h2>
        <p className="inspector-type">{category}{node.extension ? ' · ' + node.extension.toUpperCase() : ''}</p>
        <div className="inspector-size">{formatBytes(node.size)}</div>
        <p className="inspector-size-label">{node.childrenLoaded === false ? 'Partial file size' : 'File size · logical bytes'}</p>
        <div className="inspector-metadata">
          <div className="inspector-row"><span>On disk</span><strong>{node.allocatedSize === undefined ? 'Unknown' : `${node.type === 'directory' && node.allocationUnknownFiles ? '≥ ' : ''}${formatBytes(node.allocatedSize)}`}</strong></div>
          {!!node.allocationUnknownFiles && <p className="scan-freshness">Allocation or file identity unavailable for {formatNumber(node.allocationUnknownFiles)} file(s). Folder totals include only verified allocation.</p>}
          {!!node.hardlinkCount && <p className="scan-freshness">{node.hardlinkCount} names in this scan share this file. Folder allocation is counted at {node.allocationOwner}. Removing one name may free no data.</p>}
          {node.type === 'directory' && <div className="inspector-row"><span>Items</span><strong>{formatNumber(node.itemCount ?? node.children?.length ?? 0)}</strong></div>}
          {node.modified !== undefined && <div className="inspector-row"><span>Modified</span><strong>{new Date(node.modified).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</strong></div>}
          <div className="inspector-row"><span>Status</span><strong>{node.status === 'skipped' ? 'Not included' : node.status === 'error' ? 'Couldn’t read' : node.childrenLoaded === false ? isScanning ? 'Still scanning' : 'Incomplete' : node.status === 'partial' ? 'Partially scanned' : 'Analyzed'}</strong></div>
        </div>
        <p className="text-[10px] text-[#8196b2] mb-2">LOCATION</p>
        <p className="inspector-path">{node.path}</p>
        {result?.source === 'snapshot' && <p className="scan-freshness">Saved metadata is read-only. Previews and Explorer show the file currently at this path.</p>}
        {node.skipReason && <p className="text-[11px] text-amber-300/80 mt-3">{node.skipReason}</p>}
        <div className="inspector-actions">
          <button className="button button-secondary" onClick={() => void openInExplorer(node)}><FolderOpen size={15} />Open in Explorer</button>
          <button className="button button-quiet" onClick={() => copyPath(node)}><Copy size={14} />Copy path</button>
          {node.type === 'file' && <button className="button button-quiet" onClick={() => setShowPreview(!showPreview)} aria-expanded={showPreview}><Eye size={14} />{showPreview ? 'Hide preview' : 'Preview file'}</button>}
          <button className="button danger-action" disabled={!canDelete} title={!canDelete ? 'Available for fully scanned items after scanning finishes' : 'Move this item to the Recycle Bin'} onClick={async () => { if (await deleteItem(node)) setSelectedNode(null) }}><Trash2 size={14} />Move to Recycle Bin</button>
        </div>
        <div className="review-note"><strong><Info size={13} />{SAFETY_META[level].label}</strong><p>{getSafetyNote(node)}</p></div>
        {showPreview && node.type === 'file' && <div className="mt-5"><PreviewPanel node={node} /></div>}
      </div>
    </aside>
  )
}
