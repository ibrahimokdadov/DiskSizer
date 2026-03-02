import { formatBytes } from '../../lib/format'
import { useUIStore } from '../../store/ui-store'

export function Tooltip() {
  const tooltip = useUIStore(s => s.tooltip)
  if (!tooltip) return null

  return (
    <div
      className="fixed z-50 pointer-events-none bg-surface-elevated border border-gray-700 rounded-lg shadow-xl px-3 py-2 text-xs max-w-xs"
      style={{
        left: Math.min(tooltip.x + 12, window.innerWidth - 260),
        top: Math.min(tooltip.y + 12, window.innerHeight - 100)
      }}
    >
      <div className="font-medium text-gray-200 truncate mb-1">{tooltip.name}</div>
      <div className="text-gray-400 truncate text-[10px] mb-1.5">{tooltip.path}</div>
      <div className="flex items-center gap-3 text-gray-300">
        <span>{formatBytes(tooltip.size)}</span>
        <span className="text-gray-500">{tooltip.percentage.toFixed(1)}%</span>
        {tooltip.type === 'directory' && tooltip.itemCount !== undefined && (
          <span className="text-gray-500">{tooltip.itemCount} items</span>
        )}
      </div>
    </div>
  )
}
