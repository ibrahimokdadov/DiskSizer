import type { ElectronAPI, ScanResult } from '../../../preload/types'
import { useScanStore } from '../store/scan-store'
import { useUIStore } from '../store/ui-store'
import { findNodeByPath } from './scan-tree'

const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error)

/** One controller owns IPC subscriptions. Every asynchronous result belongs to a scan ID. */
export function createScanController(api: ElectronAPI, makeId = () => crypto.randomUUID()) {
  let subscriptions: Array<() => void> | null = null
  let driveRequest: Promise<void> | null = null

  function finish(result: ScanResult) {
    if (useScanStore.getState().activeScanId !== result.scanId) return
    const selectedPath = useUIStore.getState().selectedNode?.path
    useScanStore.getState().setScanResult(result)
    useUIStore.getState().resetSelection()
    if (selectedPath) useUIStore.getState().setSelectedNode(findNodeByPath(result.root, selectedPath))
    useScanStore.setState({ activeScanId: null, isScanning: false, isCancelling: false, scanProgress: null })
  }

  function fail(scanId: string, message: string) {
    const state = useScanStore.getState()
    if (state.activeScanId !== scanId) {
      // A retained index can fail after its scan completed. Keep the last page
      // visible, but explain immediately why further browsing needs a rescan.
      if (!state.activeScanId && state.scanResult?.indexed && state.scanResult.scanId === scanId) {
        state.setActionError(message)
      }
      return
    }
    useUIStore.getState().resetSelection()
    useScanStore.setState({ activeScanId: null, isScanning: false, isCancelling: false, scanProgress: null, scanError: message })
  }

  function refreshDrives(): Promise<void> {
    if (driveRequest) return driveRequest
    useScanStore.setState({ drivesLoading: true, drivesError: null })
    driveRequest = api.getDrives().then(drives => {
      useScanStore.setState({ drives, drivesError: null })
    }).catch(error => {
      useScanStore.setState({ drivesError: messageOf(error) })
    }).finally(() => {
      driveRequest = null
      useScanStore.setState({ drivesLoading: false })
    })
    return driveRequest
  }

  async function startScan(dirPath: string): Promise<void> {
    if (!dirPath.trim()) return
    const scanId = makeId()
    useUIStore.getState().resetSelection()
    useScanStore.setState({ activeScanId: scanId, activePath: dirPath, isScanning: true, isCancelling: false,
      scanProgress: null, scanError: null, actionError: null })
    try {
      // The invocation is the authoritative terminal transport; progress arrives separately.
      finish(await api.startScan(dirPath, scanId))
    } catch (error) {
      fail(scanId, messageOf(error))
    }
  }

  async function cancelScan(): Promise<void> {
    const { activeScanId, isCancelling } = useScanStore.getState()
    if (!activeScanId || isCancelling) return
    useScanStore.setState({ isCancelling: true })
    try {
      await api.cancelScan(activeScanId)
      // Keep Stopping visible until the worker acknowledges with a terminal result.
    } catch (error) {
      if (useScanStore.getState().activeScanId === activeScanId) {
        useScanStore.setState({ isCancelling: false, scanError: `Could not stop the scan: ${messageOf(error)}` })
      }
    }
  }

  async function selectFolder(): Promise<void> {
    try {
      const path = await api.selectFolder()
      if (path) await startScan(path)
    } catch (error) {
      useScanStore.setState({ scanError: messageOf(error) })
    }
  }

  function connect(): () => void {
    if (subscriptions) return () => {}
    subscriptions = [
      api.onScanProgress(progress => {
        if (progress.scanId === useScanStore.getState().activeScanId) {
          useScanStore.getState().setScanProgress(progress)
          if (progress.partialRoot) {
            const selectedPath = useUIStore.getState().selectedNode?.path
            if (selectedPath) useUIStore.getState().setSelectedNode(findNodeByPath(progress.partialRoot, selectedPath))
          }
        }
      }),
      api.onScanComplete(finish),
      api.onScanCancelled(finish),
      api.onScanError(error => fail(error.scanId, error.message))
    ]
    void refreshDrives()
    return () => {
      subscriptions?.forEach(unsubscribe => unsubscribe())
      subscriptions = null
    }
  }

  async function openScan(): Promise<void> {
    if (useScanStore.getState().isScanning) return
    const token = makeId()
    useUIStore.getState().resetSelection()
    useScanStore.setState({ activeScanId: token, isScanning: true, scanError: null, actionError: null, scanProgress: null })
    try {
      const result = await api.openScan()
      if (useScanStore.getState().activeScanId !== token) return
      if (result) {
        useScanStore.setState({ activeScanId: result.scanId, activePath: result.root.path })
        finish(result)
      } else useScanStore.setState({ activeScanId: null, isScanning: false })
    } catch (error) { fail(token, messageOf(error)) }
  }

  return { connect, startScan, cancelScan, selectFolder, refreshDrives, openScan }
}
