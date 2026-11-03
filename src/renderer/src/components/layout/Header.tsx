import { ArrowUp, LayoutGrid, List, RefreshCw } from 'lucide-react'
import { useScanStore } from '../../store/scan-store'
import { useUIStore } from '../../store/ui-store'
import { Breadcrumb } from '../visualization/Breadcrumb'
import { formatBytes, formatNumber } from '../../lib/format'
import type { FileNode } from '../../types/scan'
import { useState } from 'react'
import { ipc } from '../../lib/ipc'

export function Header({ node, live, isScanning, onRefresh, onOpenScan }: { node: FileNode | null; live: boolean; isScanning: boolean; onRefresh: () => void; onOpenScan: () => void }) {
  const result = useScanStore(s => s.scanResult)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const save = async () => {
    setSaving(true); setNotice('')
    try { if (await ipc.saveScan()) setNotice('Scan copy saved.') }
    catch (error) { useScanStore.getState().setActionError(String(error)) }
    finally { setSaving(false) }
  }
  const navigationStack = useScanStore(s => s.navigationStack)
  const navigateUp = useScanStore(s => s.navigateUp)
  const viewMode = useUIStore(s => s.viewMode)
  const setViewMode = useUIStore(s => s.setViewMode)

  return (
    <header className="workspace-header">
      <div className="workspace-heading"><div className="min-w-0"><p className="eyebrow">STORAGE EXPLORER</p><h1 title={node?.path}>{node?.name || 'Storage overview'}</h1></div><div className="scan-file-actions"><button className="button button-quiet" onClick={onOpenScan} disabled={isScanning || saving}>Open scan</button>{result?.storage === 'sqlite' && <button className="button button-quiet" onClick={() => void save()} disabled={isScanning || saving}>{saving ? 'Saving…' : 'Save copy'}</button>}{node && <button className="button button-secondary" onClick={onRefresh} disabled={isScanning || saving}><RefreshCw size={14} />Rescan</button>}</div></div>
      {result?.createdAt && !isScanning && <p className="scan-freshness">{result.source === 'snapshot' ? 'Saved scan · read-only' : 'Scan saved automatically'} · {new Date(result.createdAt).toLocaleString()}. Rescan to update.{notice && ` ${notice}`}</p>}
      {node ? (
        <>
          <div className="path-navigation"><button className="icon-button" aria-label="Go to parent folder" title="Go up (Alt + ↑)" disabled={live || navigationStack.length < 2} onClick={navigateUp}><ArrowUp size={16} /></button>{live ? <span className="path-text selectable" title={node.path}>{node.path}</span> : <Breadcrumb />}</div>
          <div className="workspace-summary">
            <div className="summary-number"><strong>{formatBytes(node.size)}</strong><span title="Total file lengths. Actual disk allocation can differ.">{live ? 'File size found' : 'File size'}<span className="summary-info" aria-label="Logical file size">ⓘ</span></span></div>
            <div className="summary-count"><strong>{formatNumber(node.itemCount ?? node.children?.length ?? 0)}</strong><span>items{live ? ' found' : ''}</span></div>
            {!live && node.allocatedSize !== undefined && <div className="summary-count"><strong>{node.allocationUnknownFiles ? '≥ ' : ''}{formatBytes(node.allocatedSize)}</strong><span title="Known allocation, shared files counted once in this scan. This is not an estimate of space freed by deleting.">on disk{node.allocationUnknownFiles ? ' · incomplete' : ''}</span></div>}
            <div className="view-switch" aria-label="Results view"><button aria-pressed={viewMode === 'list' || live} onClick={() => setViewMode('list')} className={viewMode === 'list' || live ? 'active' : ''}><List size={15} />List</button><button aria-pressed={viewMode !== 'list' && !live} onClick={() => setViewMode('treemap')} className={viewMode !== 'list' && !live ? 'active' : ''} disabled={live}><LayoutGrid size={15} />Map</button></div>
          </div>
        </>
      ) : <p className="workspace-description">Find the files and folders using your storage.</p>}
    </header>
  )
}
