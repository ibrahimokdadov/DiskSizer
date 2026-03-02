import { ChevronRight } from 'lucide-react'
import { useScanStore } from '../../store/scan-store'

export function Breadcrumb() {
  const navigationStack = useScanStore(s => s.navigationStack)
  const navigateTo = useScanStore(s => s.navigateTo)

  return (
    <div className="flex items-center gap-0.5 text-sm overflow-hidden titlebar-no-drag">
      {navigationStack.map((node, i) => {
        const isLast = i === navigationStack.length - 1
        return (
          <div key={node.path} className="flex items-center gap-0.5 shrink-0">
            {i > 0 && <ChevronRight size={14} className="text-gray-600 shrink-0" />}
            <button
              onClick={() => navigateTo(i)}
              className={`px-1.5 py-0.5 rounded truncate max-w-[150px] transition-colors ${
                isLast ? 'text-gray-200 font-medium' : 'text-gray-400 hover:text-gray-200 hover:bg-surface-elevated'
              }`}
            >
              {node.name || node.path}
            </button>
          </div>
        )
      })}
    </div>
  )
}
