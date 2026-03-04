import type { FileNode } from '../types/scan'

export type SafetyLevel = 'safe' | 'unsafe' | 'unknown'

const UNSAFE_PATH_PREFIXES = [
  'C:\\Windows',
  'C:\\Program Files',
  'C:\\Program Files (x86)',
  'C:\\ProgramData',
  'C:\\System Volume Information',
  'C:\\Recovery',
  'C:\\$Recycle.Bin',
]

const UNSAFE_FILENAMES = new Set([
  'pagefile.sys',
  'hiberfil.sys',
  'swapfile.sys',
  'bootmgr',
  'BOOTNXT',
])

const SAFE_FOLDER_NAMES = new Set([
  'node_modules',
  '__pycache__',
  '.cache',
  'cache',
  'Cache',
  'Temp',
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
  '__MACOSX',
  '.gradle',
  '.m2',
  'target',
  'build',
  '.DS_Store',
])

const SAFE_EXTENSIONS = new Set([
  'tmp',
  'log',
  'bak',
  'cache',
  'dmp',
  'old',
  'temp',
  'crdownload',
  'part',
])

export function classifyNode(node: FileNode): SafetyLevel {
  const pathNorm = node.path.replace(/\//g, '\\')

  // Unsafe: known system paths
  for (const prefix of UNSAFE_PATH_PREFIXES) {
    if (pathNorm.toLowerCase().startsWith(prefix.toLowerCase())) {
      return 'unsafe'
    }
  }

  // Unsafe: critical system filenames
  if (UNSAFE_FILENAMES.has(node.name)) return 'unsafe'

  // Safe: known cache/temp folder names
  if (node.type === 'directory' && SAFE_FOLDER_NAMES.has(node.name)) return 'safe'

  // Safe: known throwaway extensions
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
