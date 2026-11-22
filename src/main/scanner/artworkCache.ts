import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

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
   * Returns only the cached filename (e.g. "a1b2c3...jpg") or null if empty.
   */
  async save(data: Uint8Array | Buffer, mimeType?: string): Promise<string | null> {
    if (!data || data.byteLength === 0) return null

    await this.ensureDir()
    const ext = detectImageExtension(data, mimeType)
    const hash = crypto.createHash('sha256').update(data).digest('hex').slice(0, 24)
    const filename = `${hash}${ext}`
    const targetPath = path.join(this.artworkDir, filename)

    try {
      await fs.promises.access(targetPath, fs.constants.F_OK)
      return filename
    } catch {
      // File does not exist yet; proceed to write atomically.
    }

    try {
      await fs.promises.writeFile(targetPath, data, { flag: 'wx' })
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
