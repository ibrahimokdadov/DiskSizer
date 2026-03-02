import { Loader2, X } from 'lucide-react'
import { useScanStore } from '../../store/scan-store'
import { useScanner } from '../../hooks/useScanner'
import { formatBytes, formatNumber, formatDuration, truncatePath } from '../../lib/format'

export function ScanProgress() {
  const progress = useScanStore(s => s.scanProgress)
  const { cancelScan } = useScanner()

  return (
    <div className="absolute inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-10">
      <div className="bg-surface rounded-xl border border-gray-800 p-6 w-96 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Loader2 size={20} className="text-accent-blue animate-spin" />
            <h3 className="text-sm font-semibold text-gray-200">Scanning...</h3>
          </div>
          <button
            onClick={cancelScan}
            className="p-1 rounded hover:bg-surface-elevated text-gray-500 hover:text-gray-300 transition-colors"
            title="Cancel scan"
          >
            <X size={16} />
          </button>
        </div>

        {progress && (
          <div className="space-y-3">
            <div className="text-xs text-gray-400 truncate h-4">
              {truncatePath(progress.currentPath, 50)}
            </div>

            {/* Animated progress bar */}
            <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
              <div className="h-full bg-accent-blue rounded-full animate-pulse" style={{ width: '100%' }} />
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="flex justify-between">
                <span className="text-gray-500">Files:</span>
                <span className="text-gray-300">{formatNumber(progress.filesScanned)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Folders:</span>
                <span className="text-gray-300">{formatNumber(progress.directoriesScanned)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Size:</span>
                <span className="text-gray-300">{formatBytes(progress.totalSizeBytes)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Elapsed:</span>
                <span className="text-gray-300">{formatDuration(progress.elapsedMs)}</span>
              </div>
            </div>
          </div>
        )}

        {!progress && (
          <div className="text-xs text-gray-500 text-center py-4">
            Preparing scan...
          </div>
        )}
      </div>
    </div>
  )
}
