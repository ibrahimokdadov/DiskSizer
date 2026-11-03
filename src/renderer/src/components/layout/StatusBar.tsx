import { Check, Info } from 'lucide-react'
import { useScanStore } from '../../store/scan-store'
import { formatNumber, formatDuration } from '../../lib/format'

export function StatusBar() {
  const result = useScanStore(s => s.scanResult)
  const isScanning = useScanStore(s => s.isScanning)
  const scanError = useScanStore(s => s.scanError)
  return <footer className="status-bar"><div>{isScanning ? <><span className="status-dot" />Scanning · you can keep browsing</> : scanError ? <><Info size={13} /><span>Scan couldn’t finish{result ? ' · previous results shown' : ''}</span></> : result ? <>{result.status === 'complete' ? <Check size={13} /> : <Info size={13} />}<span>{result.stopReason === 'memory-limit' ? 'Partial scan · memory limit' : result.status === 'complete' ? 'Scan complete' : result.status === 'cancelled' ? 'Scan stopped' : 'Partial scan'}</span><span className="status-divider">·</span><span>{formatNumber(result.totalFiles)} files</span><span className="status-divider">·</span><span>{formatDuration(result.scanDurationMs)}</span></> : <><span className="status-dot muted" />Ready to scan</>}</div><span className="size-note"><Info size={12} />File size can differ from space on disk</span></footer>
}
