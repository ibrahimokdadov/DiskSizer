import { useEffect } from 'react'
import { AlertCircle, ArrowRight, FolderOpen, HardDrive, Layers3, X } from 'lucide-react'
import { Sidebar } from './components/layout/Sidebar'
import { Header } from './components/layout/Header'
import { StatusBar } from './components/layout/StatusBar'
import { ChartContainer } from './components/visualization/ChartContainer'
import { FileTable } from './components/panels/FileTable'
import { DetailsPanel } from './components/panels/DetailsPanel'
import { ScanProgress } from './components/panels/ScanProgress'
import { ContextMenu } from './components/common/ContextMenu'
import { useContextMenu } from './hooks/useContextMenu'
import { useScanner } from './hooks/useScanner'
import { useScanStore } from './store/scan-store'
import { useUIStore } from './store/ui-store'
import { canNavigate } from './lib/scan-tree'

export default function App() {
  // One controller owns discovery and scan subscriptions for the entire app.
  const scanner = useScanner()
  const currentNode = useScanStore(s => s.currentNode)
  const navigateUp = useScanStore(s => s.navigateUp)
  const navigateIn = useScanStore(s => s.navigateIn)
  const selectedNode = useUIStore(s => s.selectedNode)
  const setSelectedNode = useUIStore(s => s.setSelectedNode)
  const viewMode = useUIStore(s => s.viewMode)
  const { contextMenu, hideContextMenu } = useContextMenu()
  const { isScanning, scanResult, scanError, partialRoot } = scanner
  const displayNode = isScanning && partialRoot ? partialRoot : currentNode
  const livePreview = isScanning && !!partialRoot

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && contextMenu) {
        event.preventDefault()
        hideContextMenu()
        return
      }
      const target = event.target as HTMLElement
      if (target.closest('input, textarea, select, [contenteditable="true"], [role="menu"]')) return
      if (event.altKey && event.key === 'ArrowUp' && !livePreview) {
        event.preventDefault()
        navigateUp()
      } else if (event.key === 'Escape') {
        setSelectedNode(null)
      } else if (target.closest('button, a, [data-file-row], [role="button"]')) {
        return
      } else if (event.key === 'Enter' && !livePreview && selectedNode && canNavigate(selectedNode) && selectedNode.path !== currentNode?.path) {
        event.preventDefault()
        navigateIn(selectedNode)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [contextMenu, hideContextMenu, navigateIn, navigateUp, selectedNode, setSelectedNode, currentNode?.path, livePreview])

  return (
    <div className="app-shell">
      <div className="titlebar-drag app-titlebar">
        <Layers3 size={15} className="text-[#60a5fa]" aria-hidden="true" />
        <span>DiskSizer</span>
        <span className="titlebar-caption">A clearer view of your storage</span>
      </div>
      <div className="app-body">
        <Sidebar scanner={scanner} />
        <main className="workspace">
          <Header onOpenScan={() => void scanner.openScan()} node={displayNode} live={livePreview} isScanning={isScanning} onRefresh={() => { if (currentNode) void scanner.startScan(currentNode.path) }} />
          {isScanning && <ScanProgress progress={scanner.scanProgress} isCancelling={scanner.isCancelling} activePath={scanner.activePath} onCancel={scanner.cancelScan} />}
          {scanError && (
            <div className="notice notice-error" role="alert">
              <AlertCircle size={18} className="shrink-0" />
              <div className="min-w-0 flex-1"><strong>We couldn’t finish this scan</strong><p className="break-words">{scanError}</p></div>
              {scanner.activePath && <button className="button button-quiet" disabled={isScanning} onClick={() => void scanner.startScan(scanner.activePath!)}>Try again</button>}
            </div>
          )}
          {scanner.actionError && <div className="notice notice-error" role="alert"><AlertCircle size={17} /><p className="flex-1 break-words">{scanner.actionError}</p><button className="icon-button" aria-label="Dismiss action error" onClick={() => scanner.setActionError(null)}><X size={15} /></button></div>}
          {!isScanning && scanResult && (scanResult.status !== 'complete' || scanResult.errorCount > 0 || scanResult.skippedCount > 0) && (
            <details className="scan-issues">
              <summary>{scanResult.stopReason === 'memory-limit' ? 'Scan stopped at its memory limit' : scanResult.status === 'cancelled' ? 'Stopped · partial results' : 'Some locations weren’t included'}<span>{scanResult.stopReason === 'memory-limit' ? 'Partial results · scan a smaller folder to continue' : 'Sizes may be incomplete. View details'}</span></summary>
              <div className="scan-issues-content">
                <p>{scanResult.errorCount} scan issues · {scanResult.skippedCount} skipped items</p>
                {scanResult.errors.map((error, index) => <p key={index} className="selectable break-words">{error}</p>)}
                {scanResult.errors.length === 0 && <p>Links and unavailable locations can be excluded to avoid duplicate counting. Refresh to try again.</p>}
              </div>
            </details>
          )}
          {scanResult && ((isScanning && !livePreview) || scanError) && <div className="previous-scan-note">{scanError ? 'Showing previous results' : 'Previous scan · updating'}</div>}
          <div className="workspace-content">
            {displayNode ? (
              viewMode === 'list' || livePreview
                ? <FileTable node={displayNode} live={livePreview} />
                : <ChartContainer node={displayNode} />
            ) : (
              <div className="empty-state">
                <div className="empty-icon"><HardDrive size={32} strokeWidth={1.5} /></div>
                <h2>{isScanning ? 'Finding what takes up space' : 'See what is taking up space'}</h2>
                <p>{isScanning ? 'Your largest folders will appear here as the scan progresses.' : 'Choose a drive on the left, or take a closer look at a folder.'}</p>
                {!isScanning && <button className="button button-primary" onClick={() => void scanner.selectFolder()}><FolderOpen size={16} />Choose folder<ArrowRight size={15} /></button>}
                {!isScanning && <span className="empty-footnote">File sizes only. Your files stay untouched during scanning.</span>}
              </div>
            )}
          </div>
          <StatusBar />
        </main>
        {selectedNode && <DetailsPanel />}
      </div>
      {contextMenu && <ContextMenu x={contextMenu.x} y={contextMenu.y} node={contextMenu.node} onClose={hideContextMenu} />}
    </div>
  )
}
