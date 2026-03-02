import { useEffect, useCallback } from 'react'
import { useScanStore } from '../store/scan-store'
import { ipc } from '../lib/ipc'

export function useScanner() {
  const {
    isScanning, scanProgress, scanError, scanResult, drives,
    setIsScanning, setScanProgress, setScanError, setScanResult,
    setDrives, reset
  } = useScanStore()

  useEffect(() => {
    ipc.getDrives().then(setDrives).catch(console.error)
  }, [setDrives])

  useEffect(() => {
    const unsubProgress = ipc.onScanProgress((progress) => {
      setScanProgress(progress)
    })
    const unsubComplete = ipc.onScanComplete((result) => {
      setScanResult(result)
      setIsScanning(false)
      setScanProgress(null)
    })
    const unsubError = ipc.onScanError((error) => {
      setScanError(error)
      setIsScanning(false)
      setScanProgress(null)
    })

    return () => {
      unsubProgress()
      unsubComplete()
      unsubError()
    }
  }, [setIsScanning, setScanProgress, setScanError, setScanResult])

  const startScan = useCallback(async (dirPath: string) => {
    reset()
    setIsScanning(true)
    setScanError(null)
    try {
      await ipc.startScan(dirPath)
    } catch (err: any) {
      if (!err.message?.includes('cancelled')) {
        setScanError(err.message)
      }
      setIsScanning(false)
    }
  }, [reset, setIsScanning, setScanError])

  const cancelScan = useCallback(async () => {
    await ipc.cancelScan()
    setIsScanning(false)
    setScanProgress(null)
  }, [setIsScanning, setScanProgress])

  const selectFolder = useCallback(async () => {
    const folder = await ipc.selectFolder()
    if (folder) {
      await startScan(folder)
    }
  }, [startScan])

  const refreshDrives = useCallback(async () => {
    const d = await ipc.getDrives()
    setDrives(d)
  }, [setDrives])

  return {
    isScanning, scanProgress, scanError, scanResult, drives,
    startScan, cancelScan, selectFolder, refreshDrives
  }
}
