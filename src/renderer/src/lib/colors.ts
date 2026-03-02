const FILE_TYPE_COLORS: Record<string, string> = {
  // Images
  jpg: '#3b82f6', jpeg: '#3b82f6', png: '#3b82f6', gif: '#3b82f6',
  bmp: '#3b82f6', webp: '#3b82f6', svg: '#3b82f6', ico: '#3b82f6', tiff: '#3b82f6',
  // Videos
  mp4: '#8b5cf6', webm: '#8b5cf6', mkv: '#8b5cf6', avi: '#8b5cf6',
  mov: '#8b5cf6', wmv: '#8b5cf6', flv: '#8b5cf6',
  // Audio
  mp3: '#ec4899', wav: '#ec4899', ogg: '#ec4899', flac: '#ec4899',
  aac: '#ec4899', m4a: '#ec4899', wma: '#ec4899',
  // Documents
  pdf: '#10b981', doc: '#10b981', docx: '#10b981', xls: '#10b981',
  xlsx: '#10b981', ppt: '#10b981', pptx: '#10b981', txt: '#10b981',
  md: '#10b981', csv: '#10b981', rtf: '#10b981',
  // Code
  js: '#f59e0b', ts: '#f59e0b', tsx: '#f59e0b', jsx: '#f59e0b',
  py: '#f59e0b', java: '#f59e0b', c: '#f59e0b', cpp: '#f59e0b',
  h: '#f59e0b', rs: '#f59e0b', go: '#f59e0b', rb: '#f59e0b',
  php: '#f59e0b', css: '#f59e0b', html: '#f59e0b', json: '#f59e0b',
  xml: '#f59e0b', yml: '#f59e0b', yaml: '#f59e0b', sql: '#f59e0b',
  sh: '#f59e0b', bat: '#f59e0b', ps1: '#f59e0b',
  // Archives
  zip: '#f97316', rar: '#f97316', '7z': '#f97316', tar: '#f97316',
  gz: '#f97316', bz2: '#f97316', xz: '#f97316',
  // Executables
  exe: '#ef4444', msi: '#ef4444', dll: '#ef4444', sys: '#ef4444',
  // System
  ini: '#64748b', cfg: '#64748b', log: '#64748b', tmp: '#64748b', dat: '#64748b',
}

const CATEGORY_COLORS: Record<string, string> = {
  images: '#3b82f6',
  videos: '#8b5cf6',
  audio: '#ec4899',
  documents: '#10b981',
  code: '#f59e0b',
  archives: '#f97316',
  executables: '#ef4444',
  system: '#64748b',
  other: '#6b7280',
  directory: '#38bdf8',
}

export function getFileColor(extension?: string): string {
  if (!extension) return CATEGORY_COLORS.other
  return FILE_TYPE_COLORS[extension.toLowerCase()] || CATEGORY_COLORS.other
}

export function getDirectoryColor(depth: number): string {
  const hues = [210, 220, 230, 200, 190, 240]
  const hue = hues[depth % hues.length]
  const lightness = Math.max(25, 45 - depth * 5)
  return `hsl(${hue}, 60%, ${lightness}%)`
}

export function getCategoryColor(category: string): string {
  return CATEGORY_COLORS[category] || CATEGORY_COLORS.other
}

export function getFileCategory(extension?: string): string {
  if (!extension) return 'other'
  const ext = extension.toLowerCase()
  if (['jpg','jpeg','png','gif','bmp','webp','svg','ico','tiff'].includes(ext)) return 'images'
  if (['mp4','webm','mkv','avi','mov','wmv','flv'].includes(ext)) return 'videos'
  if (['mp3','wav','ogg','flac','aac','m4a','wma'].includes(ext)) return 'audio'
  if (['pdf','doc','docx','xls','xlsx','ppt','pptx','txt','md','csv','rtf'].includes(ext)) return 'documents'
  if (['js','ts','tsx','jsx','py','java','c','cpp','h','rs','go','rb','php','css','html','json','xml','yml','yaml','sql','sh','bat','ps1'].includes(ext)) return 'code'
  if (['zip','rar','7z','tar','gz','bz2','xz'].includes(ext)) return 'archives'
  if (['exe','msi','dll','sys'].includes(ext)) return 'executables'
  if (['ini','cfg','log','tmp','dat'].includes(ext)) return 'system'
  return 'other'
}

export { CATEGORY_COLORS }
