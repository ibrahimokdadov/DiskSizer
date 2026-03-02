import { shell, dialog, BrowserWindow } from 'electron'
import { promises as fs } from 'fs'
import * as path from 'path'

export async function deleteItem(filePath: string, window: BrowserWindow): Promise<boolean> {
  const name = path.basename(filePath)
  const { response } = await dialog.showMessageBox(window, {
    type: 'warning',
    buttons: ['Move to Recycle Bin', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    title: 'Delete Item',
    message: `Are you sure you want to delete "${name}"?`,
    detail: `This will move the item to the Recycle Bin.\n\nPath: ${filePath}`
  })

  if (response === 0) {
    await shell.trashItem(filePath)
    return true
  }
  return false
}

export function openInExplorer(filePath: string): void {
  shell.showItemInFolder(filePath)
}

export interface FilePreview {
  type: 'image' | 'text' | 'video' | 'audio' | 'unsupported'
  content?: string
  filePath?: string
  mimeType?: string
  size: number
  name: string
}

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'ico'])
const TEXT_EXTS = new Set(['txt', 'md', 'json', 'xml', 'html', 'css', 'js', 'ts', 'tsx', 'jsx', 'py', 'java', 'c', 'cpp', 'h', 'hpp', 'rs', 'go', 'rb', 'php', 'yml', 'yaml', 'toml', 'ini', 'cfg', 'conf', 'log', 'csv', 'sql', 'sh', 'bat', 'ps1', 'env', 'gitignore', 'dockerfile'])
const VIDEO_EXTS = new Set(['mp4', 'webm', 'mkv', 'avi', 'mov'])
const AUDIO_EXTS = new Set(['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'wma'])

export async function getFilePreview(filePath: string): Promise<FilePreview> {
  const ext = path.extname(filePath).toLowerCase().slice(1)
  const name = path.basename(filePath)
  const stat = await fs.stat(filePath)

  if (IMAGE_EXTS.has(ext)) {
    return { type: 'image', filePath, size: stat.size, name }
  }

  if (VIDEO_EXTS.has(ext)) {
    return { type: 'video', filePath, size: stat.size, name }
  }

  if (AUDIO_EXTS.has(ext)) {
    return { type: 'audio', filePath, size: stat.size, name }
  }

  if (TEXT_EXTS.has(ext) || stat.size < 100_000) {
    try {
      const buffer = Buffer.alloc(10240)
      const fd = await fs.open(filePath, 'r')
      const { bytesRead } = await fd.read(buffer, 0, 10240, 0)
      await fd.close()
      const content = buffer.slice(0, bytesRead).toString('utf-8')
      // Check if content is valid text (no null bytes in first 512 bytes)
      const sample = content.slice(0, 512)
      if (sample.includes('\0')) {
        return { type: 'unsupported', size: stat.size, name }
      }
      return { type: 'text', content, size: stat.size, name }
    } catch {
      return { type: 'unsupported', size: stat.size, name }
    }
  }

  return { type: 'unsupported', size: stat.size, name }
}
