import { useMemo, useCallback, useState } from 'react'
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
  const setTooltip = useUIStore(s => s.setTooltip)
  const { showContextMenu } = useContextMenu()
  const [focusNode, setFocusNode] = useState<d3.HierarchyRectangularNode<FileNode> | null>(null)

  const radius = Math.min(width, height) / 2 - 10

  // Create a shallow copy limited to 3 levels for D3 performance
  const shallowNode = useMemo(() => {
    function shallow(n: FileNode, depth: number): FileNode {
      if (depth >= 3 || n.type === 'file' || !n.children) return { ...n, children: undefined }
      return {
        ...n,
        children: n.children.slice(0, 60).map(c => shallow(c, depth + 1))
      }
    }
    return shallow(node, 0)
  }, [node])

  const { arcs, rootNode } = useMemo(() => {
    if (radius <= 0) return { arcs: [], rootNode: null }

    const root = d3.hierarchy(shallowNode)
      .sum(d => d.type === 'file' ? d.size : (d.children ? 0 : d.size))
      .sort((a, b) => (b.value || 0) - (a.value || 0))

    const partition = d3.partition<FileNode>()
      .size([2 * Math.PI, radius])

    const partitioned = partition(root)
    const focus = focusNode || partitioned

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
  }, [node, radius, focusNode])

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
    function find(n: FileNode): FileNode | null {
      if (n.path === targetPath) return n
      if (n.children) {
        for (const c of n.children) {
          const found = find(c)
          if (found) return found
        }
      }
      return null
    }
    return find(node)
  }, [node])

  const handleClick = useCallback((arc: ArcData, e: React.MouseEvent) => {
    e.stopPropagation()
    const realNode = findRealNode(arc.data.path) || arc.data
    if (realNode.type === 'directory') {
      navigateIn(realNode)
    }
    setSelectedNode(realNode)
  }, [navigateIn, setSelectedNode, findRealNode])

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
              onContextMenu={(e) => showContextMenu(e, findRealNode(arc.data.path) || arc.data)}
              onMouseMove={(e) => handleMouseMove(arc, e)}
              onMouseLeave={handleMouseLeave}
            />
          )
        })}
      </g>
    </svg>
  )
}
