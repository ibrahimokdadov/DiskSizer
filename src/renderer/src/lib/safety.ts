import type { FileNode } from '../types/scan'

export type SafetyLevel = 'safe' | 'unsafe' | 'unknown'

const SYSTEM_PATH_PATTERNS = [
  ':\\windows',
  ':\\program files',
  ':\\program files (x86)',
  ':\\programdata',
  ':\\system volume information',
  ':\\recovery',
  ':\\$recycle.bin',
]

const UNSAFE_FILENAMES = new Set([
  'pagefile.sys',
  'hiberfil.sys',
  'swapfile.sys',
  'bootmgr',
  'bootnxt',
])

const SAFE_FOLDER_NAMES = new Set([
  'node_modules',
  '__pycache__',
  '.cache',
  'cache',
  'temp',
  'tmp',
  'logs',
  '.npm',
  '.yarn',
  '.pnpm-store',
  'dist',
  '.next',
  '.nuxt',
  'coverage',
  '.pytest_cache',
  '.gradle',
  '.m2',
  'target',
  'build',
])

const SAFE_EXTENSIONS = new Set([
  // Throwaway
  'tmp', 'log', 'bak', 'cache', 'dmp', 'old', 'temp', 'crdownload', 'part',
  // Images
  'jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'tiff', 'tif', 'raw', 'cr2',
  'nef', 'arw', 'heic', 'heif', 'ico', 'svg',
  // Video
  'mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4v', 'mpg', 'mpeg',
  '3gp', 'ts', 'vob',
  // Audio
  'mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'wma', 'opus', 'aiff',
  // Documents
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'md',
  'csv', 'rtf', 'odt', 'ods', 'odp', 'epub', 'mobi',
  // Archives
  'zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'zst', 'iso',
])

// User directory safe path segments — OS doesn't depend on any of this
const SAFE_PATH_SEGMENTS = [
  '\\documents\\',
  '\\pictures\\',
  '\\videos\\',
  '\\music\\',
  '\\downloads\\',
  '\\desktop\\',
]

export function classifyNode(node: FileNode): SafetyLevel {
  const pathLower = node.path.replace(/\//g, '\\').toLowerCase()

  // Unsafe: known system paths (any drive letter)
  for (const pattern of SYSTEM_PATH_PATTERNS) {
    if (pathLower.slice(1).startsWith(pattern)) {
      return 'unsafe'
    }
  }

  // Unsafe: critical system filenames
  if (UNSAFE_FILENAMES.has(node.name.toLowerCase())) return 'unsafe'

  // Safe: known cache/temp folder names
  if (node.type === 'directory' && SAFE_FOLDER_NAMES.has(node.name.toLowerCase())) return 'safe'

  // Safe: inside user's personal directories
  if (SAFE_PATH_SEGMENTS.some(seg => pathLower.includes(seg))) return 'safe'

  // Safe: known user file extensions (OS doesn't need these)
  if (node.type === 'file' && node.extension && SAFE_EXTENSIONS.has(node.extension.toLowerCase())) {
    return 'safe'
  }

  return 'unknown'
}

export const SAFETY_META: Record<SafetyLevel, { label: string; color: string; bg: string }> = {
  safe:    { label: 'Safe to delete', color: 'text-green-400', bg: 'bg-green-400/10' },
  unsafe:  { label: 'Do not delete',  color: 'text-red-400',   bg: 'bg-red-400/10'   },
  unknown: { label: 'Unknown',         color: 'text-gray-400',  bg: 'bg-gray-400/10'  },
}
