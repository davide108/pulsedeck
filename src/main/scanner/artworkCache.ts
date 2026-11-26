import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const MAX_ARTWORK_DIMENSION = 640
const CACHE_EXTENSIONS = ['.jpg', '.png', '.webp'] as const

interface NativeImageModule {
  createFromBuffer: (buffer: Buffer) => {
    isEmpty: () => boolean
    getSize: () => { width: number; height: number }
    resize: (options: { width?: number; height?: number; quality?: 'good' | 'better' | 'best' }) => {
      toJPEG: (quality: number) => Buffer
    }
  }
}

async function loadElectronNativeImage(): Promise<NativeImageModule | null> {
  try {
    const mod: unknown = await import('electron')
    const candidate =
      typeof mod === 'object' && mod !== null && 'nativeImage' in mod
        ? mod
        : typeof mod === 'object' &&
            mod !== null &&
            'default' in mod &&
            typeof (mod as { default: unknown }).default === 'object' &&
            (mod as { default: unknown }).default !== null
          ? (mod as { default: unknown }).default
          : null

    if (
      typeof candidate === 'object' &&
      candidate !== null &&
      'nativeImage' in candidate &&
      typeof (candidate as { nativeImage?: NativeImageModule }).nativeImage?.createFromBuffer ===
        'function'
    ) {
      return (candidate as { nativeImage: NativeImageModule }).nativeImage
    }
  } catch {
    // Electron nativeImage is unavailable in pure Node / Vitest environments.
  }
  return null
}

function detectImageExtension(data: Uint8Array, mimeType?: string): '.jpg' | '.png' | '.webp' {
  const mime = mimeType?.toLowerCase().trim() ?? ''
  if (mime.includes('png')) return '.png'
  if (mime.includes('webp')) return '.webp'
  if (mime.includes('jpeg') || mime.includes('jpg')) return '.jpg'

  // Magic-byte fallback
  if (
    data.length >= 8 &&
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47
  ) {
    return '.png'
  }
  if (
    data.length >= 12 &&
    data[0] === 0x52 &&
    data[1] === 0x49 &&
    data[2] === 0x46 &&
    data[3] === 0x46 &&
    data[8] === 0x57 &&
    data[9] === 0x45 &&
    data[10] === 0x42 &&
    data[11] === 0x50
  ) {
    return '.webp'
  }
  return '.jpg'
}

export class ArtworkCache {
  readonly artworkDir: string
  private dirEnsured = false

  constructor(appUserDataDir: string) {
    this.artworkDir = path.join(appUserDataDir, 'artwork')
  }

  private async ensureDir(): Promise<void> {
    if (this.dirEnsured) return
    await fs.promises.mkdir(this.artworkDir, { recursive: true })
    this.dirEnsured = true
  }

  /**
   * Saves embedded cover artwork deduplicated by SHA-256 (first 24 hex chars) + extension.
   * Caps oversized images to max 640px on the longest edge via JPEG(85) when nativeImage is available.
   * Returns only the cached filename (e.g. "a1b2c3...jpg") or null if empty.
   */
  async save(data: Uint8Array | Buffer, mimeType?: string): Promise<string | null> {
    if (!data || data.byteLength === 0) return null

    await this.ensureDir()
    const hash = crypto.createHash('sha256').update(data).digest('hex').slice(0, 24)

    for (const candidateExt of CACHE_EXTENSIONS) {
      const existingFilename = `${hash}${candidateExt}`
      try {
        await fs.promises.access(path.join(this.artworkDir, existingFilename), fs.constants.F_OK)
        return existingFilename
      } catch {
        // Not cached under this extension yet.
      }
    }

    let ext = detectImageExtension(data, mimeType)
    let outputData: Uint8Array | Buffer = data

    const nativeImage = await loadElectronNativeImage()
    if (nativeImage) {
      try {
        const inputBuffer = Buffer.isBuffer(data)
          ? data
          : Buffer.from(data.buffer, data.byteOffset, data.byteLength)
        const image = nativeImage.createFromBuffer(inputBuffer)
        if (!image.isEmpty()) {
          const { width, height } = image.getSize()
          if (width > MAX_ARTWORK_DIMENSION || height > MAX_ARTWORK_DIMENSION) {
            const resized =
              width >= height
                ? image.resize({ width: MAX_ARTWORK_DIMENSION, quality: 'good' })
                : image.resize({ height: MAX_ARTWORK_DIMENSION, quality: 'good' })
            const jpegBuffer = resized.toJPEG(85)
            if (jpegBuffer && jpegBuffer.byteLength > 0) {
              outputData = jpegBuffer
              ext = '.jpg'
            }
          }
        }
      } catch {
        // Fall back to writing raw bytes if image decoding/resizing fails.
      }
    }

    const filename = `${hash}${ext}`
    const targetPath = path.join(this.artworkDir, filename)

    try {
      await fs.promises.writeFile(targetPath, outputData, { flag: 'wx' })
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code
      if (code !== 'EEXIST') {
        throw err
      }
    }

    return filename
  }

  /**
   * Resolves a cached artwork filename safely inside artworkDir, rejecting traversal attempts.
   */
  resolveSafePath(filename: string): string | null {
    if (!filename || filename.includes('/') || filename.includes('\\')) {
      return null
    }
    const base = path.basename(filename)
    if (base !== filename || base === '.' || base === '..') {
      return null
    }
    const resolvedDir = path.resolve(this.artworkDir)
    const resolvedTarget = path.resolve(resolvedDir, base)
    const rel = path.relative(resolvedDir, resolvedTarget)
    if (rel.startsWith('..') || path.isAbsolute(rel) || rel !== base) {
      return null
    }
    return resolvedTarget
  }
}

export function createArtworkCache(appUserDataDir: string): ArtworkCache {
  return new ArtworkCache(appUserDataDir)
}
