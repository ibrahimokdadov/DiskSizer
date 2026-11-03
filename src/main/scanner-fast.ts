import { promises as fs } from 'fs'
import * as path from 'path'
import { MetadataScanner, type DirectoryEntry } from './scanner-core'

/** Compatibility backend. Its metadata requests are bounded across the scan. */
async function readDirectory(dirPath: string, signal: AbortSignal): Promise<DirectoryEntry[]> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true })
  const result: DirectoryEntry[] = []
  for (let offset = 0; offset < entries.length && !signal.aborted; offset += 8) {
    const batch = await Promise.all(entries.slice(offset, offset + 8).map(async (entry): Promise<DirectoryEntry> => {
      const basic = { name: entry.name, isDir: entry.isDirectory(), isSymlink: entry.isSymbolicLink() }
      if (basic.isDir || basic.isSymlink) return { ...basic, size: 0, mtime: 0 }
      try {
        const stat = await fs.lstat(path.join(dirPath, entry.name))
        return { ...basic, size: stat.size, mtime: stat.mtimeMs, isSymlink: stat.isSymbolicLink() }
      } catch (error) {
        return { ...basic, size: 0, mtime: 0, error: error instanceof Error ? error.message : String(error) }
      }
    }))
    result.push(...batch)
  }
  return result
}

export class FastDiskScanner extends MetadataScanner {
  constructor() { super('standard', readDirectory, 4) }
}

export const fastScanner = new FastDiskScanner()

/** Streaming fallback. Windows allocation is unknown when native metadata is unavailable. */
export async function* readStandardDirectory(dirPath: string, signal: AbortSignal): AsyncGenerator<DirectoryEntry[]> {
  const directory = await fs.opendir(dirPath, { bufferSize: 128 })
  let batch: DirectoryEntry[] = []
  for await (const entry of directory) {
    if (signal.aborted) break
    const basic: DirectoryEntry = { name: entry.name, isDir: entry.isDirectory(), isSymlink: entry.isSymbolicLink(), size: 0, mtime: 0 }
    if (!basic.isDir && !basic.isSymlink) {
      try {
        const stat = await fs.lstat(path.join(dirPath, entry.name))
        basic.size = stat.size; basic.mtime = stat.mtimeMs; basic.isSymlink = stat.isSymbolicLink()
        if (process.platform !== 'win32' && stat.blocks !== undefined) { basic.allocatedSize = stat.blocks * 512; basic.fileIdentity = `${stat.dev}:${stat.ino}` }
      } catch (error) { basic.error = error instanceof Error ? error.message : String(error) }
    }
    batch.push(basic)
    if (batch.length === 128) { yield batch; batch = [] }
  }
  if (batch.length) yield batch
}
