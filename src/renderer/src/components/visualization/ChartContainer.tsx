import { useRef, useState, useEffect } from 'react'
import { TreemapChart } from './TreemapChart'
import { SunburstChart } from './SunburstChart'
import { Tooltip } from './Tooltip'
import { useUIStore } from '../../store/ui-store'
import { useScanStore } from '../../store/scan-store'

export function ChartContainer() {
  const viewMode = useUIStore(s => s.viewMode)
  const currentNode = useScanStore(s => s.currentNode)
  const containerRef = useRef<HTMLDivElement>(null)
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) {
        setDimensions({
          width: Math.floor(entry.contentRect.width),
          height: Math.floor(entry.contentRect.height)
        })
      }
    })

    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  if (!currentNode) return null

  return (
    <div ref={containerRef} className="w-full h-full overflow-hidden relative">
      {dimensions.width > 0 && dimensions.height > 0 && (
        viewMode === 'treemap' ? (
          <TreemapChart
            node={currentNode}
            width={dimensions.width}
            height={dimensions.height}
          />
        ) : (
          <SunburstChart
            node={currentNode}
            width={dimensions.width}
            height={dimensions.height}
          />
        )
      )}
      <Tooltip />
    </div>
  )
}
