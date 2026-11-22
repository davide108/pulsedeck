import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { protocol } from 'electron'
import type { Repositories } from './db/repositories'
import type { ArtworkCache } from './scanner/artworkCache'

const AUDIO_MIME_TYPES: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.opus': 'audio/ogg; codecs=opus'
}

const IMAGE_MIME_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp'
}

interface ByteRange {
  start: number
  end: number
}

function parseByteRange(rangeHeader: string, fileSize: number): ByteRange | 'invalid' | null {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim())
  if (!match) return null

  const [, startRaw, endRaw] = match
  if (!startRaw && !endRaw) return 'invalid'

  if (!startRaw) {
    // Suffix range: bytes=-N
    const suffixLength = Number.parseInt(endRaw, 10)
    if (!Number.isFinite(suffixLength) || suffixLength <= 0 || fileSize <= 0) {
      return 'invalid'
    }
    const start = Math.max(0, fileSize - suffixLength)
    return { start, end: fileSize - 1 }
  }

  const start = Number.parseInt(startRaw, 10)
  const end = endRaw ? Math.min(Number.parseInt(endRaw, 10), fileSize - 1) : fileSize - 1

  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    start >= fileSize ||
    end < start
  ) {
    return 'invalid'
  }

  return { start, end }
}

function streamFileResponse(
  filePath: string,
  status: number,
  headers: Record<string, string>,
  signal: AbortSignal | undefined,
  range?: ByteRange
): Response {
  const nodeStream = range
    ? fs.createReadStream(filePath, { start: range.start, end: range.end })
    : fs.createReadStream(filePath)

  const cleanup = (): void => {
    if (!nodeStream.destroyed) {
      nodeStream.destroy()
    }
  }

  if (signal) {
    if (signal.aborted) {
      cleanup()
      return new Response(null, { status: 499 })
    }
    signal.addEventListener('abort', cleanup, { once: true })
  }

  nodeStream.once('close', () => {
    signal?.removeEventListener('abort', cleanup)
  })
  nodeStream.on('error', () => {
    cleanup()
  })

  const webStream = Readable.toWeb(nodeStream) as unknown as NonNullable<
    ConstructorParameters<typeof Response>[0]
  >
  return new Response(webStream, { status, headers })
}

/**
 * Registers the privileged `media://` scheme. Must be called BEFORE `app.whenReady()`.
 */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'media',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        corsEnabled: true
      }
    }
  ])
}

/**
 * Handles `media://track/<id>` (SQLite-backed range streaming) and
 * `media://artwork/<filename>` (strictly confined to artworkDir).
 */
export function registerMediaProtocol(repos: Repositories, artworkCache: ArtworkCache): void {
  protocol.handle('media', async (request) => {
    let url: URL
    try {
      url = new URL(request.url)
    } catch {
      return new Response('Bad Request', { status: 400 })
    }

    const host = url.hostname.toLowerCase()
    let segment: string
    try {
      segment = decodeURIComponent(url.pathname).replace(/^\/+/, '')
    } catch {
      return new Response('Bad Request', { status: 400 })
    }

    if (host === 'track') {
      if (!/^\d+$/.test(segment)) {
        return new Response('Invalid track ID', { status: 400 })
      }
      const trackId = Number.parseInt(segment, 10)
      const track = repos.tracks.getById(trackId)
      if (!track) {
        return new Response('Track not found', { status: 404 })
      }

      let stat: fs.Stats
      try {
        stat = await fs.promises.stat(track.filePath)
        if (!stat.isFile()) {
          return new Response('Track file not found', { status: 404 })
        }
      } catch {
        return new Response('Track file not found', { status: 404 })
      }

      const fileSize = stat.size
      const ext = path.extname(track.filePath).toLowerCase()
      const contentType = AUDIO_MIME_TYPES[ext] ?? 'application/octet-stream'
      const rangeHeader = request.headers.get('range')

      if (rangeHeader) {
        const parsed = parseByteRange(rangeHeader, fileSize)
        if (parsed === 'invalid') {
          return new Response('Range Not Satisfiable', {
            status: 416,
            headers: {
              'Content-Range': `bytes */${fileSize}`
            }
          })
        }
        if (parsed) {
          const contentLength = parsed.end - parsed.start + 1
          const headers: Record<string, string> = {
            'Content-Type': contentType,
            'Content-Range': `bytes ${parsed.start}-${parsed.end}/${fileSize}`,
            'Content-Length': String(contentLength),
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'no-cache'
          }
          if (request.method === 'HEAD') {
            return new Response(null, { status: 206, headers })
          }
          return streamFileResponse(track.filePath, 206, headers, request.signal, parsed)
        }
      }

      const headers: Record<string, string> = {
        'Content-Type': contentType,
        'Content-Length': String(fileSize),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-cache'
      }
      if (request.method === 'HEAD' || fileSize === 0) {
        return new Response(null, { status: 200, headers })
      }
      return streamFileResponse(track.filePath, 200, headers, request.signal)
    }

    if (host === 'artwork') {
      const safePath = artworkCache.resolveSafePath(segment)
      if (!safePath) {
        return new Response('Forbidden', { status: 403 })
      }

      let stat: fs.Stats
      try {
        stat = await fs.promises.stat(safePath)
        if (!stat.isFile()) {
          return new Response('Artwork not found', { status: 404 })
        }
      } catch {
        return new Response('Artwork not found', { status: 404 })
      }

      const ext = path.extname(safePath).toLowerCase()
      const contentType = IMAGE_MIME_TYPES[ext] ?? 'application/octet-stream'
      const headers: Record<string, string> = {
        'Content-Type': contentType,
        'Content-Length': String(stat.size),
        'Cache-Control': 'public, max-age=31536000, immutable'
      }
      if (request.method === 'HEAD' || stat.size === 0) {
        return new Response(null, { status: 200, headers })
      }
      return streamFileResponse(safePath, 200, headers, request.signal)
    }

    return new Response('Not Found', { status: 404 })
  })
}
