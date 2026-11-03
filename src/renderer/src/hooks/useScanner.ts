import { useEffect } from 'react'
import { useScanStore } from '../store/scan-store'
import { ipc } from '../lib/ipc'
import { createScanController } from '../lib/scan-controller'

const controller = createScanController(ipc)

/** Mount once in App; pass its actions to presentation components. */
export function useScanner() {
  const state = useScanStore()
  useEffect(() => controller.connect(), [])
  return {
    ...state,
    partialRoot: state.scanProgress?.partialRoot ?? null,
    startScan: controller.startScan,
    cancelScan: controller.cancelScan,
    selectFolder: controller.selectFolder,
    openScan: controller.openScan,
    refreshDrives: controller.refreshDrives
  }
}

export type ScannerController = ReturnType<typeof useScanner>
