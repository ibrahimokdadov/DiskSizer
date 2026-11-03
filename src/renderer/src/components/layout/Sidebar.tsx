import { HardDrive, FolderOpen, RefreshCw, ChevronRight, Loader2, AlertCircle } from 'lucide-react'
import type { useScanner } from '../../hooks/useScanner'
import { formatBytes } from '../../lib/format'

export function Sidebar({ scanner }: { scanner: ReturnType<typeof useScanner> }) {
  const { drives, startScan, selectFolder, refreshDrives, isScanning, drivesLoading, drivesError, activePath, scanResult } = scanner
  const selectedPath = activePath || scanResult?.root.path || ''
  const targetFor = (root: string) => /[\\/]$/.test(root) ? root : root + '\\'
  const activeDrive = drives.filter(drive => selectedPath.replace(/\//g, '\\').toLowerCase().startsWith(targetFor(drive.letter).replace(/\//g, '\\').toLowerCase()))
    .sort((a, b) => b.letter.length - a.letter.length)[0]?.letter

  return (
    <aside className="locations-sidebar" aria-label="Scan locations">
      <div className="sidebar-heading"><span>LOCATIONS</span><button className="icon-button" title="Refresh drives" aria-label="Refresh drives" disabled={drivesLoading} onClick={() => void refreshDrives()}><RefreshCw size={14} className={drivesLoading ? 'animate-spin' : ''} /></button></div>
      <div className="drive-list">
        {drivesLoading && drives.length === 0 && <div className="sidebar-state"><Loader2 size={17} className="animate-spin" /><span>Loading drives…</span></div>}
        {drivesError && <div className="sidebar-error"><AlertCircle size={17} /><p>Couldn’t load drives.</p><button className="text-button" onClick={() => void refreshDrives()}>Try again</button></div>}
        {!drivesLoading && !drivesError && drives.length === 0 && <p className="sidebar-empty">No drives found. Choose a folder to get started.</p>}
        {drives.map(drive => {
          const target = drive.letter.endsWith('\\') || drive.letter.endsWith('/') ? drive.letter : drive.letter + '\\'
          const used = Math.max(0, drive.totalSize - drive.freeSpace)
          const percent = drive.totalSize > 0 ? Math.min(100, used / drive.totalSize * 100) : 0
          const active = activeDrive === drive.letter
          return (
            <button key={drive.letter} className={`drive-card ${active ? 'active' : ''}`} onClick={() => void startScan(target)} disabled={isScanning || drive.available === false} title={drive.available === false ? 'This drive is unavailable' : `Scan ${drive.label || drive.letter}`} aria-label={`Scan ${drive.label || 'drive'} ${drive.letter}`}>
              <div className="drive-card-title"><HardDrive size={19} /><div><strong>{drive.label || (drive.driveType === 'network' ? 'Network drive' : drive.driveType === 'removable' ? 'Removable drive' : 'Local disk')}</strong><span>{drive.letter}{drive.fileSystem ? ' · ' + drive.fileSystem : ''}</span></div><ChevronRight size={14} className="drive-arrow" /></div>
              <div className="capacity-track"><div style={{ width: `${percent}%`, backgroundColor: percent > 90 ? '#fbbf24' : '#60a5fa' }} /></div>
              <div className="drive-capacity">{drive.available === false ? <span>Unavailable</span> : <><span>{formatBytes(drive.freeSpace)} free</span><span>of {formatBytes(drive.totalSize)}</span></>}</div>
            </button>
          )
        })}
      </div>
      <div className="sidebar-folder"><button className="button button-secondary w-full" onClick={() => void selectFolder()} disabled={isScanning}><FolderOpen size={16} />Choose folder</button></div>
      <div className="sidebar-footer"><span className="status-dot" />Scans don’t change your files<p>Choose a location. We’ll find the largest files and folders.</p></div>
    </aside>
  )
}
