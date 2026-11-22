import fs from 'node:fs'
import path from 'node:path'
import { type FSWatcher, watch as watchFs } from 'chokidar'
import type { FolderRecord } from '../../shared/types'
import type { Repositories, TrackUpsertInput } from '../db/repositories'
import type { ArtworkCache } from './artworkCache'
import { extractTrackMetadata, SUPPORTED_AUDIO_EXTENSIONS } from './metadata'

const WATCH_DEBOUNCE_MS = 350

interface PendingFileOp {
  folderId: number
  op: 'upsert' | 'unlink'
}

export interface FolderWatcherDeps {
  repos: Repositories
  artworkCache: ArtworkCache
  onTracksChanged: () => void
}

export class FolderWatcher {
  private readonly repos: Repositories
  private readonly artworkCache: ArtworkCache
  private readonly onTracksChanged: () => void
  private readonly watchers = new Map<number, FSWatcher>()
  private readonly pendingOps = new Map<string, PendingFileOp>()
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private flushQueue: Promise<void> = Promise.resolve()
  private disposed = false

  constructor(deps: FolderWatcherDeps) {
    this.repos = deps.repos
    this.artworkCache = deps.artworkCache
    this.onTracksChanged = deps.onTracksChanged
  }

  async syncFolders(folders: FolderRecord[]): Promise<void> {
    if (this.disposed) return

    const activeById = new Map<number, FolderRecord>()
    for (const folder of folders) {
      if (folder.isActive) {
        activeById.set(folder.id, folder)
      }
    }

    for (const folderId of Array.from(this.watchers.keys())) {
      if (!activeById.has(folderId)) {
        await this.unwatchFolder(folderId)
      }
    }

    for (const folder of activeById.values()) {
      if (!this.watchers.has(folder.id)) {
        this.watchFolder(folder)
      }
    }
  }

  watchFolder(folder: FolderRecord): void {
    if (this.disposed || !folder.isActive || this.watchers.has(folder.id)) return
    if (!fs.existsSync(folder.path)) return

    const watcher = watchFs(folder.path, {
      ignoreInitial: true,
      persistent: true,
      awaitWriteFinish: {
        stabilityThreshold: 450,
        pollInterval: 100
      },
      ignored: (targetPath: string) => {
        if (targetPath === folder.path) return false
        return path.basename(targetPath).startsWith('.')
      }
    })

    const enqueue = (filePath: string, op: 'upsert' | 'unlink'): void => {
      if (this.disposed) return
      const ext = path.extname(filePath).toLowerCase()
      if (!SUPPORTED_AUDIO_EXTENSIONS.has(ext)) return
      this.pendingOps.set(filePath, { folderId: folder.id, op })
      this.scheduleFlush()
    }

    watcher.on('add', (filePath) => enqueue(filePath, 'upsert'))
    watcher.on('change', (filePath) => enqueue(filePath, 'upsert'))
    watcher.on('unlink', (filePath) => enqueue(filePath, 'unlink'))
    watcher.on('error', (err) => {
      console.warn(`[watcher] Error watching folder "${folder.path}":`, err)
    })

    this.watchers.set(folder.id, watcher)
  }

  async unwatchFolder(folderId: number): Promise<void> {
    const watcher = this.watchers.get(folderId)
    if (!watcher) return
    this.watchers.delete(folderId)

    for (const [filePath, op] of this.pendingOps.entries()) {
      if (op.folderId === folderId) {
        this.pendingOps.delete(filePath)
      }
    }

    try {
      await watcher.close()
    } catch (err) {
      console.warn(`[watcher] Failed to close watcher ${folderId}:`, err)
    }
  }

  async closeAll(): Promise<void> {
    this.disposed = true
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    this.pendingOps.clear()

    const entries = Array.from(this.watchers.values())
    this.watchers.clear()
    await Promise.all(
      entries.map((watcher) =>
        watcher.close().catch((err) => {
          console.warn('[watcher] Error closing watcher:', err)
        })
      )
    )
    await this.flushQueue
  }

  private scheduleFlush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
    }
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      this.flushQueue = this.flushQueue
        .then(() => this.flushPending())
        .catch((err) => {
          console.error('[watcher] Failed to process file system updates:', err)
        })
    }, WATCH_DEBOUNCE_MS)
  }

  private async flushPending(): Promise<void> {
    if (this.disposed || this.pendingOps.size === 0) return

    const batch = Array.from(this.pendingOps.entries())
    this.pendingOps.clear()

    const upserts: TrackUpsertInput[] = []
    let changed = false

    for (const [filePath, item] of batch) {
      if (this.disposed) return

      if (item.op === 'unlink') {
        if (this.repos.tracks.markMissingByFilePath(filePath, true)) {
          changed = true
        }
        continue
      }

      const folder = this.repos.folders.getById(item.folderId)
      if (!folder || !folder.isActive) continue

      let stat: fs.Stats
      try {
        stat = await fs.promises.stat(filePath)
        if (!stat.isFile()) continue
      } catch {
        continue
      }

      const fileMtime = Math.floor(stat.mtimeMs)
      const fileSize = stat.size
      const existing = this.repos.tracks.getByFilePath(filePath)
      if (existing && existing.fileMtime === fileMtime && existing.fileSize === fileSize) {
        if (existing.isMissing) {
          this.repos.tracks.markMissing(existing.id, false)
          changed = true
        }
        continue
      }

      const meta = await extractTrackMetadata(filePath, this.artworkCache)
      upserts.push({
        folderId: item.folderId,
        filePath,
        fileSize,
        fileMtime,
        format: meta.format,
        title: meta.title,
        artist: meta.artist,
        album: meta.album,
        albumArtist: meta.albumArtist,
        genre: meta.genre,
        year: meta.year,
        trackNumber: meta.trackNumber,
        duration: meta.duration,
        artworkPath: meta.artworkPath,
        bpm: meta.bpm,
        bpmSource: meta.bpmSource,
        musicalKey: meta.musicalKey,
        camelotKey: meta.camelotKey,
        keySource: meta.keySource
      })
    }

    if (upserts.length > 0) {
      const res = this.repos.tracks.upsertBatch(upserts)
      if (res.added > 0 || res.updated > 0) {
        changed = true
      }
    }

    if (changed && !this.disposed) {
      this.onTracksChanged()
    }
  }
}

export function createFolderWatcher(deps: FolderWatcherDeps): FolderWatcher {
  return new FolderWatcher(deps)
}
