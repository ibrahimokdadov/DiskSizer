import { create } from 'zustand'
import type { ViewMode, TooltipData } from '../types/visualization'
import type { FileNode } from '../types/scan'

interface UIState {
  viewMode: ViewMode
  selectedNode: FileNode | null
  hoveredNode: FileNode | null
  tooltip: TooltipData | null
  showPreview: boolean
  sidebarWidth: number
  detailsPanelWidth: number
  contextMenu: { x: number; y: number; node: FileNode } | null

  setViewMode: (mode: ViewMode) => void
  setSelectedNode: (node: FileNode | null) => void
  setHoveredNode: (node: FileNode | null) => void
  setTooltip: (tooltip: TooltipData | null) => void
  setShowPreview: (show: boolean) => void
  setSidebarWidth: (width: number) => void
  setDetailsPanelWidth: (width: number) => void
  setContextMenu: (menu: { x: number; y: number; node: FileNode } | null) => void
}

export const useUIStore = create<UIState>((set) => ({
  viewMode: 'treemap',
  selectedNode: null,
  hoveredNode: null,
  tooltip: null,
  showPreview: false,
  sidebarWidth: 240,
  detailsPanelWidth: 300,
  contextMenu: null,

  setViewMode: (mode) => set({ viewMode: mode }),
  setSelectedNode: (node) => set({ selectedNode: node }),
  setHoveredNode: (node) => set({ hoveredNode: node }),
  setTooltip: (tooltip) => set({ tooltip }),
  setShowPreview: (show) => set({ showPreview: show }),
  setSidebarWidth: (width) => set({ sidebarWidth: width }),
  setDetailsPanelWidth: (width) => set({ detailsPanelWidth: width }),
  setContextMenu: (menu) => set({ contextMenu: menu }),
}))
