import { useRef, useState, useEffect, useMemo } from 'react'
import { Loader2 } from 'lucide-react'
import { TreemapChart } from './TreemapChart'
import { Tooltip } from './Tooltip'
import { useUIStore } from '../../store/ui-store'
import type { FileNode } from '../../types/scan'
import { useScanStore } from '../../store/scan-store'
import { useDirectoryPage } from '../../hooks/useDirectoryPage'

export function ChartContainer({ node }: { node: FileNode }) {
  const setViewMode = useUIStore(s => s.setViewMode)
  const setTooltip = useUIStore(s => s.setTooltip)
  const containerRef = useRef<HTMLDivElement>(null)
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 })
  const indexed = useScanStore(state => !!state.scanResult?.indexed)
  const directory = useDirectoryPage(node, { enabled: indexed, offset: 0, limit: 80, descending: true })
  const mapNode = useMemo(() => {
    if (!indexed || !directory.page) return node
    const page = directory.page
    const children = page.node.children || []
    const omittedCount = Math.max(0, page.totalChildren - children.length)
    const omittedSize = Math.max(0, page.node.size - children.reduce((sum, child) => sum + child.size, 0))
    return { ...page.node, children: omittedCount > 0 ? [...children, {
      name: `Other (${omittedCount} items)`, path: `aggregate:${page.node.path}`,
      type: 'directory' as const, kind: 'aggregate' as const, size: omittedSize, itemCount: omittedCount
    }] : children }
  }, [indexed, directory.page, node])
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver(entries => {
      const entry = entries[0]
      if (entry) setDimensions({ width: Math.floor(entry.contentRect.width), height: Math.floor(entry.contentRect.height) })
    })
    observer.observe(el)
    return () => { observer.disconnect(); setTooltip(null) }
  }, [setTooltip])
  return <section className="map-container" aria-label="Storage map"><div className="map-caption"><span>Each block is sized by file size. Double-click a folder to open it.</span><button className="text-button" onClick={() => setViewMode('list')}>View all items</button></div><div ref={containerRef} className="map-area">{indexed && directory.loading ? <div className="table-empty" role="status"><Loader2 className="animate-spin" size={24} /><strong>Loading map…</strong></div> : indexed && directory.error ? <div className="table-empty" role="alert"><strong>Map details are unavailable</strong><span className="max-w-lg break-words">{directory.error}</span><span>Rescan this location to rebuild its results.</span><button className="text-button" onClick={directory.retry}>Retry loading</button></div> : dimensions.width > 0 && dimensions.height > 0 && <TreemapChart node={mapNode} width={dimensions.width} height={dimensions.height} />}<Tooltip /></div></section>
}
