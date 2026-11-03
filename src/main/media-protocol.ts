import { net, protocol } from 'electron'
import { randomUUID } from 'crypto'
import { pathToFileURL } from 'url'

const previews = new Map<string, string>()

protocol.registerSchemesAsPrivileged([{
  scheme: 'diskvision-media',
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
}])

export function createMediaUrl(filePath: string): string {
  const token = randomUUID()
  previews.set(token, filePath)
  if (previews.size > 64) previews.delete(previews.keys().next().value!)
  return `diskvision-media://preview/${token}`
}

export function registerMediaProtocol(): void {
  protocol.handle('diskvision-media', async request => {
    const url = new URL(request.url)
    const filePath = url.hostname === 'preview' ? previews.get(url.pathname.slice(1)) : undefined
    if (!filePath || request.method !== 'GET') return new Response('Preview unavailable', { status: 404 })
    try {
      return await net.fetch(pathToFileURL(filePath).href, { headers: request.headers })
    } catch {
      return new Response('The file could not be read.', { status: 404 })
    }
  })
}
