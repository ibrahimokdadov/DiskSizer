import { File, FileText, Image, Music, Video, Archive, Code, Settings, HardDrive, Folder } from 'lucide-react'

export const FILE_TYPE_ICONS = {
  images: Image,
  videos: Video,
  audio: Music,
  documents: FileText,
  code: Code,
  archives: Archive,
  executables: Settings,
  system: HardDrive,
  other: File,
  directory: Folder,
} as const

export type FileCategory = keyof typeof FILE_TYPE_ICONS
