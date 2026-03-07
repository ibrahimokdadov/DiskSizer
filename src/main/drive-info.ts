import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

export interface DriveInfo {
  letter: string
  label: string
  totalSize: number
  freeSpace: number
}

export async function getDriveMediaType(driveLetter: string): Promise<'SSD' | 'HDD' | 'Unknown'> {
  const letter = driveLetter.replace(/[:\\/]/g, '').toUpperCase().charAt(0)
  const script = `try { $d = Get-Partition -DriveLetter '${letter}' -ErrorAction Stop | Get-Disk; (Get-PhysicalDisk | Where-Object DeviceId -eq $d.Number).MediaType } catch { 'Unknown' }`
  try {
    const { stdout } = await execFileAsync('powershell', ['-NoProfile', '-Command', script])
    const t = stdout.trim()
    if (t === 'SSD') return 'SSD'
    if (t === 'HDD') return 'HDD'
    return 'Unknown'
  } catch {
    return 'Unknown'
  }
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
