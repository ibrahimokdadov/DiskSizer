import * as path from 'path'
import { MetadataScanner, type DirectoryEntry } from './scanner-core'

interface NativeAddon {
  apiVersion: number
  DirectoryCursor?: new (dirPath: string) => { read(): Promise<{ entries: DirectoryEntry[]; done: boolean }>; close(): void }
  readdirWithStats(dirPath: string): Promise<DirectoryEntry[]>
  getVolumes?(): Promise<Array<{ letter: string; label: string; totalSize: number; freeSpace: number; fileSystem: string; volumeId: string; driveType: 'fixed' | 'removable' | 'network' | 'optical' | 'unknown' }>>
}

function loadAddon(): NativeAddon | null {
  const candidates = [
    path.join(__dirname, '..', '..', 'build', 'Release', 'fast_readdir.node'),
    path.join(__dirname, '..', '..', '..', 'build', 'Release', 'fast_readdir.node'),
    path.join(process.resourcesPath ?? '', 'build', 'Release', 'fast_readdir.node'),
    path.join(process.resourcesPath ?? '', 'app.asar.unpacked', 'build', 'Release', 'fast_readdir.node')
  ]
  for (const candidate of candidates) {
    try {
      const addon = require(candidate) as NativeAddon
      // Older binaries silently swallow Win32 errors and misclassify reparse points.
      if (addon.apiVersion >= 2) return addon
    } catch { /* Use the portable backend if this binary cannot be loaded. */ }
  }
  return null
}

export const nativeAddon = loadAddon()

/** Native memory and IPC remain bounded even for a directory with millions of files. */
export async function* readNativeDirectory(dirPath: string, signal: AbortSignal): AsyncGenerator<DirectoryEntry[]> {
  if (!nativeAddon?.DirectoryCursor) throw new Error('Rebuild the native addon to use allocation-aware scanning.')
  const cursor = new nativeAddon.DirectoryCursor(dirPath)
  try {
    while (!signal.aborted) {
      const batch = await cursor.read()
      if (batch.entries.length) yield batch.entries
      if (batch.done) break
    }
  } finally { cursor.close() }
}

export class NativeDiskScanner extends MetadataScanner {
  constructor() {
    super('native', async (dirPath) => {
      if (!nativeAddon) throw new Error('Native scanner is unavailable. Rebuild the native addon.')
      return nativeAddon.readdirWithStats(dirPath)
    }, 4)
  }
}

export const nativeScanner = new NativeDiskScanner()
