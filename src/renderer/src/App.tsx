import { useEffect } from 'react'
import { Sidebar } from './components/layout/Sidebar'
import { Header } from './components/layout/Header'
import { StatusBar } from './components/layout/StatusBar'
import { ChartContainer } from './components/visualization/ChartContainer'
import { DetailsPanel } from './components/panels/DetailsPanel'
import { ScanProgress } from './components/panels/ScanProgress'
import { ContextMenu } from './components/common/ContextMenu'
import { useContextMenu } from './hooks/useContextMenu'
import { useScanStore } from './store/scan-store'
import { useUIStore } from './store/ui-store'

export default function App() {
  const isScanning = useScanStore(s => s.isScanning)
  const scanResult = useScanStore(s => s.scanResult)
  const selectedNode = useUIStore(s => s.selectedNode)
  const navigateUp = useScanStore(s => s.navigateUp)
  const navigateIn = useScanStore(s => s.navigateIn)
  const { contextMenu, hideContextMenu } = useContextMenu()

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        navigateUp()
      } else if (e.key === 'Enter' && selectedNode?.type === 'directory') {
        navigateIn(selectedNode)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [navigateUp, navigateIn, selectedNode])

  return (
    <div className="flex flex-col h-screen bg-background text-gray-200">
      {/* Titlebar drag area */}
      <div className="titlebar-drag h-9 bg-background flex items-center px-4 shrink-0">
        <span className="text-sm font-semibold text-gray-400 titlebar-no-drag">DiskVision</span>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <Sidebar />

        {/* Main content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <Header />
          <div className="flex-1 overflow-hidden relative">
            {isScanning && <ScanProgress />}
            {!isScanning && scanResult && <ChartContainer />}
            {!isScanning && !scanResult && (
              <div className="flex items-center justify-center h-full text-gray-500">
                <div className="text-center">
                  <p className="text-lg mb-2">Select a drive or folder to analyze</p>
                  <p className="text-sm">Choose from the sidebar or use the Browse button</p>
                </div>
              </div>
            )}
          </div>
          <StatusBar />
        </div>

        {/* Details Panel */}
        {selectedNode && <DetailsPanel />}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          node={contextMenu.node}
          onClose={hideContextMenu}
        />
      )}
    </div>
  )
}
