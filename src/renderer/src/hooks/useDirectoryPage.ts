import { useEffect, useState } from 'react'
import type { DirectoryPage, DirectoryPageRequest, FileNode } from '../types/scan'
import { ipc } from '../lib/ipc'
import { useScanStore } from '../store/scan-store'

/** Only the visible folder page crosses IPC; previous requests cannot replace a new view. */
export function useDirectoryPage(node: FileNode, options: Omit<DirectoryPageRequest, 'scanId' | 'path'> & { enabled: boolean; offset: number; limit: number }) {
  const scanId = useScanStore(state => state.scanResult?.scanId)
  const revision = useScanStore(state => state.directoryRevision)
  const isScanning = useScanStore(state => state.isScanning)
  const [attempt, setAttempt] = useState(0)
  const [response, setResponse] = useState<{ key: string; page?: DirectoryPage; error?: string } | null>(null)
  const { enabled, offset, limit, query = '', descending = true, scope, category, modifiedBefore, sizeMetric } = options
  const key = JSON.stringify([scanId, node.path, revision, offset, limit, query, descending, scope, category, modifiedBefore, sizeMetric, attempt])

  useEffect(() => {
    if (!enabled || !scanId || isScanning) return
    let current = true
    const timer = setTimeout(() => { void ipc.getScanDirectory({ scanId, path: node.path, offset, limit, query, descending, scope, category, modifiedBefore, sizeMetric }).then(page => {
      const state = useScanStore.getState()
      if (!current || state.isScanning || state.scanResult?.scanId !== scanId || state.currentNode?.path !== node.path || state.directoryRevision !== revision) return
      state.applyDirectoryPage(page)
      setResponse({ key, page })
    }).catch(error => {
      const state = useScanStore.getState()
      if (current && !state.isScanning && state.scanResult?.scanId === scanId && state.currentNode?.path === node.path && state.directoryRevision === revision) {
        setResponse({ key, error: error instanceof Error ? error.message : String(error) })
      }
    }) }, query ? 200 : 0)
    return () => { current = false; clearTimeout(timer) }
  }, [enabled, scanId, node.path, revision, offset, limit, query, descending, scope, category, modifiedBefore, sizeMetric, attempt, key, isScanning])

  const visible = response?.key === key ? response : null
  return { page: visible?.page, error: visible?.error, loading: enabled && !visible, retry: () => setAttempt(value => value + 1) }
}
