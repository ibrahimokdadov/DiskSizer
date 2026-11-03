import { useMemo, useCallback } from 'react'
import * as d3 from 'd3'
import type { FileNode } from '../../types/scan'
import { getFileColor, getDirectoryColor } from '../../lib/colors'
import { formatBytes } from '../../lib/format'
import { useScanStore } from '../../store/scan-store'
import { useUIStore } from '../../store/ui-store'
import { useContextMenu } from '../../hooks/useContextMenu'

interface Props {
  node: FileNode
  width: number
  height: number
}

interface ArcData {
  data: FileNode
  x0: number; x1: number; y0: number; y1: number
  depth: number
  value: number
  current: { x0: number; x1: number; y0: number; y1: number }
}

export function SunburstChart({ node, width, height }: Props) {
  const navigateIn = useScanStore(s => s.navigateIn)
  const navigateUp = useScanStore(s => s.navigateUp)
  const setSelectedNode = useUIStore(s => s.setSelectedNode)
  const setViewMode = useUIStore(s => s.setViewMode)
  const setTooltip = useUIStore(s => s.setTooltip)
  const { showContextMenu } = useContextMenu()

  const radius = Math.min(width, height) / 2 - 10

  // Bound only the rendered records; preserve the size of every omitted item.
  const shallowNode = useMemo(() => {
    const sorted = [...(node.children || [])].sort((a, b) => b.size - a.size)
    const children: FileNode[] = sorted.slice(0, 80).map(child => ({ ...child, children: undefined }))
    const rest = sorted.slice(80)
    if (rest.length) children.push({ name: `Other (${rest.length} items)`, path: '', size: rest.reduce((sum, child) => sum + child.size, 0), type: 'directory', kind: 'aggregate', itemCount: rest.length })
    return { ...node, children }
  }, [node])

  const { arcs, rootNode } = useMemo(() => {
    if (radius <= 0) return { arcs: [], rootNode: null }

    const root = d3.hierarchy<FileNode>(shallowNode)
      .sum(d => d.children?.length ? 0 : d.size)
      .sort((a, b) => (b.value || 0) - (a.value || 0))

    const partition = d3.partition<FileNode>()
      .size([2 * Math.PI, radius])

    const partitioned = partition(root)
    const focus = partitioned

    const arcData: ArcData[] = []

    partitioned.descendants().forEach(d => {
      if (d.depth === 0) return // skip root center

      // Calculate visible arcs relative to focus
      const relDepth = d.depth - (focus.depth || 0)
      if (relDepth < 1 || relDepth > 3) return

      const angle = d.x1 - d.x0
      if (angle < 0.005) return // skip tiny arcs

      arcData.push({
        data: d.data,
        x0: d.x0, x1: d.x1,
        y0: d.y0, y1: d.y1,
        depth: d.depth,
        value: d.value || 0,
        current: { x0: d.x0, x1: d.x1, y0: d.y0, y1: d.y1 }
      })
    })

    return { arcs: arcData, rootNode: partitioned }
  }, [shallowNode, radius])

  const arcGenerator = useMemo(() => {
    return d3.arc<ArcData>()
      .startAngle(d => d.x0)
      .endAngle(d => d.x1)
      .innerRadius(d => d.y0)
      .outerRadius(d => d.y1)
      .padAngle(0.002)
      .padRadius(radius / 2)
  }, [radius])

  // Find the real node (with full children) from the original tree by path
  const findRealNode = useCallback((targetPath: string): FileNode | null => {
    return node.path === targetPath ? node : node.children?.find(child => child.path === targetPath) || null
  }, [node])

  const handleClick = useCallback((arc: ArcData, e: React.MouseEvent) => {
    e.stopPropagation()
    if (arc.data.kind === 'aggregate') { setTooltip(null); setViewMode('list'); return }
    const realNode = findRealNode(arc.data.path) || arc.data
    if (realNode.type === 'directory' && realNode.childrenLoaded !== false && realNode.status !== 'error' && realNode.status !== 'skipped') {
      navigateIn(realNode)
    }
    setSelectedNode(realNode)
  }, [navigateIn, setSelectedNode, findRealNode, setTooltip, setViewMode])

  const handleCenterClick = useCallback(() => {
    navigateUp()
  }, [navigateUp])

  const handleMouseMove = useCallback((arc: ArcData, e: React.MouseEvent) => {
    const totalSize = node.size || 1
    setTooltip({
      name: arc.data.name,
      path: arc.data.path,
      size: arc.data.size,
      percentage: (arc.data.size / totalSize) * 100,
      type: arc.data.type,
      extension: arc.data.extension,
      itemCount: arc.data.itemCount,
      x: e.clientX,
      y: e.clientY
    })
  }, [setTooltip, node.size])

  const handleMouseLeave = useCallback(() => {
    setTooltip(null)
  }, [setTooltip])

  const cx = width / 2
  const cy = height / 2

  return (
    <svg width={width} height={height} className="select-none">
      <rect width={width} height={height} fill="#0f1117" />
      <g transform={`translate(${cx},${cy})`}>
        {/* Center circle - click to go up */}
        <circle
          r={arcs.length > 0 ? arcs[0].y0 - 2 : radius * 0.3}
          fill="#1a1d27"
          stroke="#2a2e3d"
          strokeWidth={2}
          className="cursor-pointer hover:fill-[#242836] transition-colors"
          onClick={handleCenterClick}
        />
        <text
          textAnchor="middle"
          dy="-0.3em"
          fontSize={13}
          fontWeight={600}
          fill="#e5e7eb"
          className="pointer-events-none"
        >
          {node.name.length > 15 ? node.name.slice(0, 14) + '...' : node.name}
        </text>
        <text
          textAnchor="middle"
          dy="1.2em"
          fontSize={11}
          fill="#9ca3af"
          className="pointer-events-none"
        >
          {formatBytes(node.size)}
        </text>

        {/* Arcs */}
        {arcs.map((arc) => {
          const color = arc.data.type === 'directory'
            ? getDirectoryColor(arc.depth)
            : getFileColor(arc.data.extension)
          const path = arcGenerator(arc)
          if (!path) return null

          return (
            <path
              key={arc.data.path}
              d={path}
              fill={color}
              fillOpacity={0.8}
              stroke="#0f1117"
              strokeWidth={0.5}
              className="cursor-pointer hover:brightness-125 transition-all duration-150"
              onClick={(e) => handleClick(arc, e)}
              onContextMenu={(e) => { if (arc.data.kind !== 'aggregate') showContextMenu(e, findRealNode(arc.data.path) || arc.data) }}
              onMouseMove={(e) => handleMouseMove(arc, e)}
              onMouseLeave={handleMouseLeave}
            />
          )
        })}
      </g>
    </svg>
  )
}
