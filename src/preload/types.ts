export interface FileNode {
  name: string
  path: string
  size: number
  /** Per-file allocation; directory totals count shared identities once per scan. */
  allocatedSize?: number
  allocationUnknownFiles?: number
  hardlinkCount?: number
  allocationOwner?: string
  type: 'file' | 'directory'
  extension?: string
  modified?: number
  children?: FileNode[]
  itemCount?: number
  kind?: 'aggregate'
  childrenLoaded?: boolean
  /** Directory details can be fetched from the retained scan index. */
  detailsAvailable?: boolean
  fileCount?: number
  directoryCount?: number
  status?: 'pending' | 'scanning' | 'complete' | 'partial' | 'skipped' | 'error'
  skipReason?: string
}

export interface ScanResult {
  scanId: string
  status: 'complete' | 'partial' | 'cancelled'
  engine: 'native' | 'standard'
  sizeKind: 'logical'
  root: FileNode
  totalSize: number
  totalFiles: number
  totalDirectories: number
  scanDurationMs: number
  errors: string[]
  errorCount: number
  skippedCount: number
  /** Only shallow summaries cross IPC; directory entries are requested in pages. */
  indexed?: boolean
  stopReason?: 'memory-limit'
  createdAt?: string
  snapshotPath?: string
  source?: 'live' | 'snapshot'
  storage?: 'sqlite'
}

export interface DirectoryPageRequest {
  scanId: string
  path: string
  offset?: number
  limit?: number
  query?: string
  descending?: boolean
  scope?: 'folder' | 'scan'
  category?: 'all' | 'image' | 'video' | 'audio' | 'document' | 'code' | 'archive' | 'other'
  modifiedBefore?: number
  sizeMetric?: 'logical' | 'allocated'
}

export interface DirectoryPage {
  scanId: string
  node: FileNode
  ancestors: FileNode[]
  root: FileNode
  totalMatches: number
  totalChildren: number
  offset: number
  limit: number
}

export interface ScanProgress {
  scanId: string
  engine: 'native' | 'standard'
  phase: 'counting' | 'scanning' | 'building'
  currentPath: string
  filesScanned: number
  directoriesScanned: number
  totalSizeBytes: number
  elapsedMs: number
  errorCount: number
  skippedCount: number
  partialRoot?: FileNode
}

export interface ScanError {
  scanId: string
  message: string
}

export interface DriveInfo {
  letter: string
  label: string
  totalSize: number
  freeSpace: number
  fileSystem?: string
  driveType?: 'fixed' | 'removable' | 'network' | 'optical' | 'unknown'
  volumeId?: string
  available?: boolean
}

export interface FilePreview {
  type: 'image' | 'text' | 'video' | 'audio' | 'unsupported'
  content?: string
  filePath?: string
  url?: string
  mimeType?: string
  size: number
  name: string
}

export interface ElectronAPI {
  getDrives(): Promise<DriveInfo[]>
  selectFolder(): Promise<string | null>
  startScan(dirPath: string, scanId: string): Promise<ScanResult>
  cancelScan(scanId?: string): Promise<void>
  openScan(): Promise<ScanResult | null>
  saveScan(): Promise<string | null>
  getScanDirectory(request: DirectoryPageRequest): Promise<DirectoryPage>
  deleteItem(filePath: string): Promise<boolean>
  openInExplorer(filePath: string): Promise<void>
  getFilePreview(filePath: string): Promise<FilePreview>
  onScanProgress(callback: (progress: ScanProgress) => void): () => void
  onScanComplete(callback: (result: ScanResult) => void): () => void
  onScanCancelled(callback: (result: ScanResult) => void): () => void
  onScanError(callback: (error: ScanError) => void): () => void
}
