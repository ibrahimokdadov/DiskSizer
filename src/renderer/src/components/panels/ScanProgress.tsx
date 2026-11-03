import { Loader2, Square } from 'lucide-react'
import type { ScanProgress as Progress } from '../../types/scan'
import { formatBytes, formatNumber, formatDuration } from '../../lib/format'

export function ScanProgress({ progress, isCancelling, activePath, onCancel }: { progress: Progress | null; isCancelling: boolean; activePath: string | null; onCancel: () => Promise<void> }) {
  return (
    <section className="scan-activity" aria-label="Scan progress">
      <Loader2 size={18} className="animate-spin shrink-0" />
      <div className="min-w-0 flex-1"><div className="activity-title"><strong>{isCancelling ? 'Stopping scan…' : 'Scanning'}</strong><span title={progress?.currentPath || activePath || ''}>{progress?.currentPath || activePath || 'Preparing your scan…'}</span></div><div className="activity-metrics">{progress ? <><span>{formatNumber(progress.filesScanned)} files</span><span>{formatBytes(progress.totalSizeBytes)} found</span><span>{formatDuration(progress.elapsedMs)}</span><span className="activity-partial">Results are still updating</span></> : <span>Preparing your scan…</span>}</div></div>
      <button className="button button-secondary" onClick={() => void onCancel()} disabled={isCancelling}><Square size={12} fill="currentColor" />{isCancelling ? 'Stopping…' : 'Stop'}</button>
    </section>
  )
}
