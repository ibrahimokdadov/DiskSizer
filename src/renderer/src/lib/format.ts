export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

export function formatNumber(num: number): string {
  return num.toLocaleString()
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export function formatPercentage(value: number, total: number): string {
  if (total === 0) return '0%'
  return ((value / total) * 100).toFixed(1) + '%'
}

export function truncatePath(p: string, maxLen: number = 60): string {
  if (p.length <= maxLen) return p
  const parts = p.split(/[\\/]/)
  if (parts.length <= 3) return '...' + p.slice(-(maxLen - 3))
  return parts[0] + '\\...\\' + parts.slice(-2).join('\\')
}
