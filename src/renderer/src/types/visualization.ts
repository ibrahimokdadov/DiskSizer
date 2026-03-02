import type { FileNode } from './scan'

export type ViewMode = 'treemap' | 'sunburst'

export interface VisualizationNode {
  data: FileNode
  x0: number
  y0: number
  x1: number
  y1: number
  depth: number
  value: number
  parent?: VisualizationNode
  children?: VisualizationNode[]
}

export interface TooltipData {
  name: string
  path: string
  size: number
  percentage: number
  type: 'file' | 'directory'
  extension?: string
  itemCount?: number
  x: number
  y: number
}
