import { useMemo } from 'react'
import * as d3 from 'd3'
import type { FileNode } from '../../types/scan'
import { formatBytes } from '../../lib/format'
import { useScanStore } from '../../store/scan-store'
import { useUIStore } from '../../store/ui-store'
import { useContextMenu } from '../../hooks/useContextMenu'
import { canNavigate } from '../../lib/scan-tree'

interface Props { node: FileNode; width: number; height: number }
const MAX_TILES = 80
const TILE_COLORS = ['#325f8a', '#356e87', '#4a608f', '#386f71', '#58658c', '#457b8c', '#4a6c9c', '#3f6079']

export function TreemapChart({ node, width, height }: Props) {
  const navigateIn = useScanStore(s => s.navigateIn)
  const select = useUIStore(s => s.setSelectedNode)
  const setViewMode = useUIStore(s => s.setViewMode)
  const setTooltip = useUIStore(s => s.setTooltip)
  const { showContextMenu } = useContextMenu()
  const selected = useUIStore(s => s.selectedNode)
  const { tiles, originals } = useMemo(() => {
    const summaries = (node.children || []).filter(child => child.kind === 'aggregate')
    const children = (node.children || []).filter(child => child.kind !== 'aggregate').slice().sort((a, b) => b.size - a.size)
    const originals = new Map(children.map(child => [child.path, child]))
    const kept: FileNode[] = children.slice(0, MAX_TILES).map(child => ({ ...child, children: undefined }))
    const rest = children.slice(MAX_TILES)
    const omittedCount = rest.length + summaries.reduce((sum, child) => sum + (child.itemCount || 0), 0)
    if (rest.length || summaries.length) kept.push({ name: `Other (${omittedCount} items)`, path: '', size: [...rest, ...summaries].reduce((sum, child) => sum + child.size, 0), type: 'directory', kind: 'aggregate', itemCount: omittedCount })
    const root = d3.hierarchy<FileNode>({ ...node, children: kept }).sum(item => item.children?.length ? 0 : item.size)
    const layout = d3.treemap<FileNode>().size([width, height]).padding(4).round(true)(root)
    return { tiles: layout.children || [], originals }
  }, [node, width, height])

  const activate = (item: FileNode, open: boolean) => {
    if (item.kind === 'aggregate') { setTooltip(null); setViewMode('list'); return }
    const original = originals.get(item.path) || item
    if (open && canNavigate(original)) { navigateIn(original); select(null); setTooltip(null) }
    else select(original)
  }

  if (!tiles.some(tile => (tile.value || 0) > 0)) return <div className="table-empty"><strong>No file size to map</strong><span>Use the list to inspect empty or unavailable items.</span><button className="text-button" onClick={() => setViewMode('list')}>Show list</button></div>
  return (
    <svg width={width} height={height} role="group" aria-label="Map of this folder's file sizes">
      {tiles.map((tile, index) => {
        const w = tile.x1 - tile.x0
        const h = tile.y1 - tile.y0
        if (w < 3 || h < 3 || !tile.value) return null
        const item = tile.data
        const aggregate = item.kind === 'aggregate'
        const chars = Math.max(1, Math.floor((w - 20) / 7))
        return <g key={item.path || 'remaining'} role="button" tabIndex={0} aria-label={`${item.name}, ${formatBytes(item.size)}${aggregate ? ', show all items' : ''}`} onClick={() => activate(item, false)} onDoubleClick={() => activate(item, true)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); activate(item, event.key === 'Enter') } }} onContextMenu={event => { if (!aggregate) showContextMenu(event, originals.get(item.path) || item) }} onMouseMove={event => setTooltip({ name: item.name, path: aggregate ? 'Show all items in the list' : item.path, size: item.size, percentage: node.size ? item.size / node.size * 100 : 0, type: item.type, itemCount: item.itemCount, x: event.clientX, y: event.clientY })} onMouseLeave={() => setTooltip(null)} className="cursor-pointer">
          <rect x={tile.x0} y={tile.y0} width={w} height={h} rx={5} fill={aggregate ? '#354457' : TILE_COLORS[index % TILE_COLORS.length]} stroke={selected?.path === item.path ? '#c2ddff' : '#18283a'} strokeWidth={selected?.path === item.path ? 2 : 1} className="hover:brightness-125 transition-[filter]" />
          {w > 70 && h > 29 && <text x={tile.x0 + 10} y={tile.y0 + 20} fill="#e8f2ff" fontSize={11} fontWeight={500} className="map-label">{item.name.length > chars ? item.name.slice(0, Math.max(1, chars - 1)) + '…' : item.name}</text>}
          {w > 70 && h > 52 && <text x={tile.x0 + 10} y={tile.y0 + 39} fill="#c0d6ed" fontSize={10} className="map-label">{formatBytes(item.size)}</text>}
          {aggregate && w > 120 && h > 74 && <text x={tile.x0 + 10} y={tile.y0 + 60} fill="#9fb5cd" fontSize={10} className="map-label">Show all items →</text>}
        </g>
      })}
    </svg>
  )
}
