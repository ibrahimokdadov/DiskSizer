import { execFile } from 'child_process'
import { promisify } from 'util'
import { nativeAddon } from './scanner-native'
import type { DriveInfo } from '../preload/types'

const execFileAsync = promisify(execFile)
let pendingDiscovery: Promise<DriveInfo[]> | undefined

async function discoverDrives(): Promise<DriveInfo[]> {
  if (nativeAddon?.getVolumes) {
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        nativeAddon.getVolumes(),
        new Promise<DriveInfo[]>((_, reject) => { timeout = setTimeout(() => reject(new Error('Drive discovery timed out. Check disconnected network drives and try again.')), 8000) })
      ])
    } finally { if (timeout) clearTimeout(timeout) }
  }

  // Compatibility path when no current native binary is installed. One process
  // discovers all drives; scan startup itself never waits for a media-type query.
  const script = `[System.IO.DriveInfo]::GetDrives() | ForEach-Object { $d = $_; [pscustomobject]@{ letter=$d.Name; label=$(if($d.IsReady){$d.VolumeLabel}else{''}); totalSize=$(if($d.IsReady){$d.TotalSize}else{0}); freeSpace=$(if($d.IsReady){$d.AvailableFreeSpace}else{0}); fileSystem=$(if($d.IsReady){$d.DriveFormat}else{''}); driveType=$d.DriveType.ToString().ToLowerInvariant(); available=$d.IsReady } } | ConvertTo-Json -Compress`
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 8000 })
  const parsed = JSON.parse(stdout.trim() || '[]')
  const drives = Array.isArray(parsed) ? parsed : parsed ? [parsed] : []
  return drives.map(d => ({
    letter: String(d.letter || ''), label: String(d.label || ''),
    totalSize: Number(d.totalSize) || 0, freeSpace: Number(d.freeSpace) || 0,
    fileSystem: String(d.fileSystem || ''), available: Boolean(d.available),
    driveType: ['fixed', 'removable', 'network'].includes(d.driveType) ? d.driveType : d.driveType === 'cdrom' ? 'optical' : 'unknown'
  }))
}

export function getDrives(): Promise<DriveInfo[]> {
  // Deduplicate simultaneous consumers without making the Refresh action stale.
  if (!pendingDiscovery) pendingDiscovery = discoverDrives()
    .then(drives => drives.sort((a, b) => a.letter.localeCompare(b.letter)))
    .finally(() => { pendingDiscovery = undefined })
  return pendingDiscovery
}
