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

interface TreemapNode {
  data: FileNode
  x0: number; y0: number; x1: number; y1: number
  depth: number
  value: number
  children?: TreemapNode[]
}

export function TreemapChart({ node, width, height }: Props) {
  const navigateIn = useScanStore(s => s.navigateIn)
  const setSelectedNode = useUIStore(s => s.setSelectedNode)
  const setTooltip = useUIStore(s => s.setTooltip)
  const { showContextMenu } = useContextMenu()

  // Create a shallow copy of the node tree limited to 2 levels deep for D3
  const shallowNode = useMemo(() => {
    function shallow(n: FileNode, depth: number): FileNode {
      if (depth >= 2 || n.type === 'file' || !n.children) return { ...n, children: undefined }
      return {
        ...n,
        children: n.children.slice(0, 60).map(c => shallow(c, depth + 1))
      }
    }
    return shallow(node, 0)
  }, [node])

  const layout = useMemo(() => {
    if (width <= 0 || height <= 0) return []

    const root = d3.hierarchy(shallowNode)
      .sum(d => d.type === 'file' ? d.size : (d.children ? 0 : d.size))
      .sort((a, b) => (b.value || 0) - (a.value || 0))

    const treemap = d3.treemap<FileNode>()
      .size([width, height])
      .padding(2)
      .paddingTop(22)
      .round(true)
      .tile(d3.treemapSquarify.ratio(1.618))

    const tree = treemap(root)

    // Collect visible nodes (depth 1-2 relative to root)
    const nodes: TreemapNode[] = []

    function collect(n: d3.HierarchyRectangularNode<FileNode>, maxDepth: number) {
      if (n.depth > 0 && n.depth <= maxDepth) {
        const w = n.x1 - n.x0
        const h = n.y1 - n.y0
        if (w >= 2 && h >= 2) {
          nodes.push({
            data: n.data,
            x0: n.x0, y0: n.y0, x1: n.x1, y1: n.y1,
            depth: n.depth,
            value: n.value || 0
          })
        }
      }
      if (n.children && n.depth < maxDepth) {
        n.children.forEach(c => collect(c, maxDepth))
      }
    }

    collect(tree, 2)
    return nodes
  }, [node, width, height])

  const rootSize = useMemo(() => {
    return node.size || layout.reduce((sum, n) => n.depth === 1 ? sum + n.value : sum, 0)
  }, [node, layout])

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

  const handleClick = useCallback((n: TreemapNode, e: React.MouseEvent) => {
    e.stopPropagation()
    const realNode = findRealNode(n.data.path) || n.data
    if (realNode.type === 'directory') {
      navigateIn(realNode)
    }
    setSelectedNode(realNode)
  }, [navigateIn, setSelectedNode, findRealNode])

  const handleMouseMove = useCallback((n: TreemapNode, e: React.MouseEvent) => {
    setTooltip({
      name: n.data.name,
      path: n.data.path,
      size: n.data.size,
      percentage: rootSize > 0 ? (n.data.size / rootSize) * 100 : 0,
      type: n.data.type,
      extension: n.data.extension,
      itemCount: n.data.itemCount,
      x: e.clientX,
      y: e.clientY
    })
  }, [setTooltip, rootSize])

  const handleMouseLeave = useCallback(() => {
    setTooltip(null)
  }, [setTooltip])

  return (
    <svg width={width} height={height} className="select-none">
      {/* Background */}
      <rect width={width} height={height} fill="#0f1117" />

      {layout.map((n) => {
        const w = n.x1 - n.x0
        const h = n.y1 - n.y0
        const color = n.data.type === 'directory'
          ? getDirectoryColor(n.depth)
          : getFileColor(n.data.extension)
        const showLabel = w > 60 && h > 20

        return (
          <g
            key={n.data.path}
            onClick={(e) => handleClick(n, e)}
            onContextMenu={(e) => showContextMenu(e, findRealNode(n.data.path) || n.data)}
            onMouseMove={(e) => handleMouseMove(n, e)}
            onMouseLeave={handleMouseLeave}
            className="cursor-pointer"
          >
            <rect
              x={n.x0}
              y={n.y0}
              width={w}
              height={h}
              fill={color}
              fillOpacity={n.depth === 1 ? 0.85 : 0.65}
              stroke="#0f1117"
              strokeWidth={1}
              rx={2}
              className="hover:brightness-125 transition-all duration-150"
            />
            {showLabel && (
              <>
                {/* Name label */}
                <text
                  x={n.x0 + 4}
                  y={n.y0 + 14}
                  fontSize={11}
                  fontWeight={n.data.type === 'directory' ? 600 : 400}
                  fill="white"
                  fillOpacity={0.9}
                  className="pointer-events-none"
                >
                  <tspan>
                    {n.data.name.length > Math.floor(w / 7)
                      ? n.data.name.slice(0, Math.floor(w / 7) - 2) + '...'
                      : n.data.name}
                  </tspan>
                </text>
                {/* Size label */}
                {h > 36 && (
                  <text
                    x={n.x0 + 4}
                    y={n.y0 + 28}
                    fontSize={10}
                    fill="white"
                    fillOpacity={0.6}
                    className="pointer-events-none"
                  >
                    {formatBytes(n.data.size)}
                  </text>
                )}
              </>
            )}
          </g>
        )
      })}
    </svg>
  )
}
