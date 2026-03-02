import { useMemo } from 'react'
import * as d3 from 'd3'
import type { FileNode } from '../types/scan'

export function useHierarchy(node: FileNode | null) {
  return useMemo(() => {
    if (!node) return null
    const root = d3.hierarchy(node)
      .sum(d => d.type === 'file' ? d.size : 0)
      .sort((a, b) => (b.value || 0) - (a.value || 0))
    return root
  }, [node])
}

export function useTreemapLayout(
  hierarchy: d3.HierarchyNode<FileNode> | null,
  width: number,
  height: number
) {
  return useMemo(() => {
    if (!hierarchy || width <= 0 || height <= 0) return null
    const treemap = d3.treemap<FileNode>()
      .size([width, height])
      .padding(2)
      .paddingTop(20)
      .round(true)
      .tile(d3.treemapSquarify.ratio(1.618))
    return treemap(hierarchy.copy())
  }, [hierarchy, width, height])
}

export function useSunburstLayout(
  hierarchy: d3.HierarchyNode<FileNode> | null,
  radius: number
) {
  return useMemo(() => {
    if (!hierarchy || radius <= 0) return null
    const partition = d3.partition<FileNode>()
      .size([2 * Math.PI, radius])
    return partition(hierarchy.copy())
  }, [hierarchy, radius])
}
