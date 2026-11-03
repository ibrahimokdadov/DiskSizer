import type { FileNode } from '../types/scan'

export type SafetyLevel = 'safe' | 'unsafe' | 'unknown'

const SYSTEM_FOLDERS = ['windows', 'program files', 'program files (x86)', 'programdata', 'system volume information', 'recovery', '$recycle.bin']
const SYSTEM_FILES = new Set(['pagefile.sys', 'hiberfil.sys', 'swapfile.sys', 'bootmgr', 'bootnxt'])
const GENERATED_FOLDERS = new Set(['node_modules', '__pycache__', '.cache', 'cache', 'temp', 'tmp', '.npm', '.yarn', '.pnpm-store', '.next', '.nuxt', 'coverage', '.pytest_cache'])
const TEMP_EXTENSIONS = new Set(['tmp', 'cache', 'crdownload', 'part'])

export function classifyNode(node: FileNode): SafetyLevel {
  const segments = node.path.replace(/\//g, '\\').toLowerCase().split('\\')
  if (SYSTEM_FILES.has(node.name.toLowerCase()) || SYSTEM_FOLDERS.includes(segments[1] || '')) return 'unsafe'
  if (node.type === 'directory' && GENERATED_FOLDERS.has(node.name.toLowerCase())) return 'safe'
  if (node.type === 'file' && TEMP_EXTENSIONS.has(node.extension?.toLowerCase() || '')) return 'safe'
  return 'unknown'
}

export function getSafetyNote(node: FileNode): string {
  const level = classifyNode(node)
  if (level === 'unsafe') return 'This location may be required by Windows or an installed application. Review it carefully before removing anything.'
  if (level === 'safe') return 'The name suggests cached or generated content. Check the contents and the application that uses it before removing it.'
  return 'Only remove files you recognize and no longer need. Moving files to the Recycle Bin does not immediately free their space.'
}

export const SAFETY_META: Record<SafetyLevel, { label: string; color: string; bg: string }> = {
  safe: { label: 'Possible generated content', color: 'text-blue-300', bg: 'bg-blue-400/10' },
  unsafe: { label: 'System or application files', color: 'text-amber-300', bg: 'bg-amber-400/10' },
  unknown: { label: 'Review before removing', color: 'text-slate-300', bg: 'bg-slate-400/10' }
}
