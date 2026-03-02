import { useScanStore } from '../../store/scan-store'
import { formatBytes, formatNumber, formatDuration } from '../../lib/format'

export function StatusBar() {
  const scanResult = useScanStore(s => s.scanResult)

  return (
    <div className="h-7 bg-surface border-t border-gray-800 flex items-center px-4 text-xs text-gray-500 shrink-0">
      {scanResult ? (
        <div className="flex items-center gap-4">
          <span>{formatNumber(scanResult.totalFiles)} files</span>
          <span>{formatNumber(scanResult.totalDirectories)} folders</span>
          <span>{formatBytes(scanResult.totalSize)}</span>
          <span>Scanned in {formatDuration(scanResult.scanDurationMs)}</span>
          {scanResult.errors.length > 0 && (
            <span className="text-amber-500">{scanResult.errors.length} errors</span>
          )}
        </div>
      ) : (
        <span>Ready</span>
      )}
    </div>
  )
}
