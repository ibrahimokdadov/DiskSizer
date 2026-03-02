import { useScanStore } from '../../store/scan-store'
import { useUIStore } from '../../store/ui-store'
import { Breadcrumb } from '../visualization/Breadcrumb'
import { LayoutGrid, Sun } from 'lucide-react'
import type { ViewMode } from '../../types/visualization'

export function Header() {
  const scanResult = useScanStore(s => s.scanResult)
  const viewMode = useUIStore(s => s.viewMode)
  const setViewMode = useUIStore(s => s.setViewMode)

  if (!scanResult) return null

  return (
    <div className="h-11 bg-surface border-b border-gray-800 flex items-center justify-between px-4 shrink-0">
      <Breadcrumb />
      <div className="flex items-center gap-1 titlebar-no-drag">
        <ViewToggle mode="treemap" current={viewMode} onChange={setViewMode} icon={<LayoutGrid size={15} />} label="Treemap" />
        <ViewToggle mode="sunburst" current={viewMode} onChange={setViewMode} icon={<Sun size={15} />} label="Sunburst" />
      </div>
    </div>
  )
}

function ViewToggle({ mode, current, onChange, icon, label }: {
  mode: ViewMode
  current: ViewMode
  onChange: (m: ViewMode) => void
  icon: React.ReactNode
  label: string
}) {
  const active = mode === current
  return (
    <button
      onClick={() => onChange(mode)}
      className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium transition-colors ${
        active ? 'bg-accent-blue/20 text-accent-blue' : 'text-gray-400 hover:text-gray-200 hover:bg-surface-elevated'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}
