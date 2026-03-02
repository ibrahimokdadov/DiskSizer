import { useState, useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import { ipc } from '../../lib/ipc'
import type { FileNode, FilePreview } from '../../types/scan'

interface Props {
  node: FileNode
}

export function PreviewPanel({ node }: Props) {
  const [preview, setPreview] = useState<FilePreview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    ipc.getFilePreview(node.path)
      .then(setPreview)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [node.path])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 size={20} className="text-gray-500 animate-spin" />
      </div>
    )
  }

  if (error) {
    return <div className="text-xs text-red-400 py-4 text-center">{error}</div>
  }

  if (!preview) return null

  switch (preview.type) {
    case 'image':
      return (
        <div className="rounded-lg overflow-hidden border border-gray-700">
          <img
            src={`file:///${preview.filePath?.replace(/\\/g, '/')}`}
            alt={preview.name}
            className="w-full h-auto max-h-64 object-contain bg-black/50"
          />
        </div>
      )

    case 'text':
      return (
        <div className="rounded-lg border border-gray-700 overflow-hidden">
          <pre className="text-[10px] text-gray-300 p-2 overflow-auto max-h-64 bg-surface-elevated font-mono whitespace-pre-wrap break-all">
            {preview.content}
          </pre>
        </div>
      )

    case 'video':
      return (
        <div className="rounded-lg overflow-hidden border border-gray-700">
          <video
            src={`file:///${preview.filePath?.replace(/\\/g, '/')}`}
            controls
            className="w-full max-h-48"
          />
        </div>
      )

    case 'audio':
      return (
        <div className="rounded-lg border border-gray-700 p-3">
          <audio
            src={`file:///${preview.filePath?.replace(/\\/g, '/')}`}
            controls
            className="w-full"
          />
        </div>
      )

    default:
      return (
        <div className="text-xs text-gray-500 py-4 text-center">
          Preview not available for this file type
        </div>
      )
  }
}
