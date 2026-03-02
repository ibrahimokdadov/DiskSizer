import { HardDrive, FolderOpen, RefreshCw } from 'lucide-react'
import { useScanner } from '../../hooks/useScanner'
import { formatBytes } from '../../lib/format'

export function Sidebar() {
  const { drives, startScan, selectFolder, refreshDrives, isScanning } = useScanner()

  return (
    <div className="w-60 bg-surface border-r border-gray-800 flex flex-col shrink-0">
      <div className="p-4 border-b border-gray-800">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Drives</h2>
          <button
            onClick={refreshDrives}
            className="p-1 rounded hover:bg-surface-elevated text-gray-500 hover:text-gray-300 transition-colors"
            title="Refresh drives"
          >
            <RefreshCw size={14} />
          </button>
        </div>
        <div className="space-y-2">
          {drives.map(drive => {
            const usedPercent = drive.totalSize > 0
              ? ((drive.totalSize - drive.freeSpace) / drive.totalSize) * 100
              : 0
            return (
              <button
                key={drive.letter}
                onClick={() => !isScanning && startScan(drive.letter + '\\')}
                disabled={isScanning}
                className="w-full text-left p-2 rounded-lg hover:bg-surface-elevated transition-colors group disabled:opacity-50"
              >
                <div className="flex items-center gap-2 mb-1">
                  <HardDrive size={16} className="text-accent-blue shrink-0" />
                  <span className="text-sm font-medium truncate">
                    {drive.letter}
                    {drive.label ? ` (${drive.label})` : ''}
                  </span>
                </div>
                <div className="ml-6">
                  <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden mb-1">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${usedPercent}%`,
                        backgroundColor: usedPercent > 90 ? '#ef4444' : usedPercent > 75 ? '#f59e0b' : '#3b82f6'
                      }}
                    />
                  </div>
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>{formatBytes(drive.totalSize - drive.freeSpace)} used</span>
                    <span>{formatBytes(drive.freeSpace)} free</span>
                  </div>
                </div>
              </button>
            )
          })}
          {drives.length === 0 && (
            <p className="text-xs text-gray-500 text-center py-2">Loading drives...</p>
          )}
        </div>
      </div>

      <div className="p-4">
        <button
          onClick={selectFolder}
          disabled={isScanning}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-accent-blue/10 text-accent-blue rounded-lg hover:bg-accent-blue/20 transition-colors text-sm font-medium disabled:opacity-50"
        >
          <FolderOpen size={16} />
          Browse Folder
        </button>
      </div>
    </div>
  )
}
