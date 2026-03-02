import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

export interface DriveInfo {
  letter: string
  label: string
  totalSize: number
  freeSpace: number
}

export async function getDrives(): Promise<DriveInfo[]> {
  // Use PowerShell to get drive info as JSON
  const script = `Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Used -ne $null } | Select-Object @{N='letter';E={$_.Root}}, @{N='label';E={$_.Description}}, @{N='totalSize';E={$_.Used + $_.Free}}, @{N='freeSpace';E={$_.Free}} | ConvertTo-Json`

  const { stdout } = await execFileAsync('powershell', ['-NoProfile', '-Command', script])

  const parsed = JSON.parse(stdout)
  const drives = Array.isArray(parsed) ? parsed : [parsed]

  return drives.map(d => ({
    letter: String(d.letter || '').replace(/\\$/, ''),
    label: String(d.label || ''),
    totalSize: Number(d.totalSize) || 0,
    freeSpace: Number(d.freeSpace) || 0
  }))
}
