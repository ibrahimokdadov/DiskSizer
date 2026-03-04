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
