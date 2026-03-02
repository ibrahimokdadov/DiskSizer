export interface FileNode {
  name: string
  path: string
  size: number
  type: 'file' | 'directory'
  extension?: string
  modified?: number
  children?: FileNode[]
  itemCount?: number
}

export interface ScanResult {
  root: FileNode
  totalSize: number
  totalFiles: number
  totalDirectories: number
  scanDurationMs: number
  errors: string[]
}

export interface ScanProgress {
  phase: 'counting' | 'scanning' | 'building'
  currentPath: string
  filesScanned: number
  directoriesScanned: number
  totalSizeBytes: number
  elapsedMs: number
}

export interface DriveInfo {
  letter: string
  label: string
  totalSize: number
  freeSpace: number
}

export interface FilePreview {
  type: 'image' | 'text' | 'video' | 'audio' | 'unsupported'
  content?: string
  filePath?: string
  mimeType?: string
  size: number
  name: string
}

export interface ElectronAPI {
  getDrives(): Promise<DriveInfo[]>
  selectFolder(): Promise<string | null>
  startScan(dirPath: string): Promise<ScanResult>
  cancelScan(): Promise<void>
  deleteItem(filePath: string): Promise<boolean>
  openInExplorer(filePath: string): Promise<void>
  getFilePreview(filePath: string): Promise<FilePreview>
  onScanProgress(callback: (progress: ScanProgress) => void): () => void
  onScanComplete(callback: (result: ScanResult) => void): () => void
  onScanError(callback: (error: string) => void): () => void
}
