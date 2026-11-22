import fs from 'node:fs'
import path from 'node:path'
import type { FolderRecord, ScanProgressEvent } from '../../shared/types'
import type { Repositories, TrackUpsertInput } from '../db/repositories'
import type { ArtworkCache } from './artworkCache'
import { extractTrackMetadata, SUPPORTED_AUDIO_EXTENSIONS } from './metadata'

const SCAN_BATCH_SIZE = 25

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve)
  })
}

async function discoverAudioFiles(rootDir: string): Promise<string[]> {
  const discovered: string[] = []
  const visitedDirs = new Set<string>()
  const queue: string[] = [rootDir]

  while (queue.length > 0) {
    const currentDir = queue.shift()!
    let realDir: string
    try {
      realDir = await fs.promises.realpath(currentDir)
    } catch {
      continue
    }
    if (visitedDirs.has(realDir)) continue
    visitedDirs.add(realDir)

    let entries: fs.Dirent[]
    try {
      entries = await fs.promises.readdir(currentDir, { withFileTypes: true })
    } catch (err) {
      console.warn(`[scanner] Failed to read directory "${currentDir}":`, err)
      continue
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name)
      if (entry.isDirectory()) {
        queue.push(fullPath)
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase()
        if (SUPPORTED_AUDIO_EXTENSIONS.has(ext)) {
          discovered.push(fullPath)
        }
      } else if (entry.isSymbolicLink()) {
        try {
          const stat = await fs.promises.stat(fullPath)
          if (stat.isDirectory()) {
            queue.push(fullPath)
          } else if (stat.isFile()) {
            const ext = path.extname(entry.name).toLowerCase()
            if (SUPPORTED_AUDIO_EXTENSIONS.has(ext)) {
              discovered.push(fullPath)
            }
          }
        } catch {
          // Ignore broken symlinks.
        }
      }
    }
  }

  return discovered
}

export interface FolderScannerDeps {
  repos: Repositories
  artworkCache: ArtworkCache
  onProgress: (event: ScanProgressEvent) => void
  onTracksChanged: () => void
}

export class FolderScanner {
  private readonly repos: Repositories
  private readonly artworkCache: ArtworkCache
  private readonly onProgress: (event: ScanProgressEvent) => void
  private readonly onTracksChanged: () => void
  private readonly activeScans = new Map<number, Promise<ScanProgressEvent>>()

  constructor(deps: FolderScannerDeps) {
    this.repos = deps.repos
    this.artworkCache = deps.artworkCache
    this.onProgress = deps.onProgress
    this.onTracksChanged = deps.onTracksChanged
  }

  scanFolder(folder: FolderRecord): Promise<ScanProgressEvent> {
    const existing = this.activeScans.get(folder.id)
    if (existing) return existing

    const promise = this.runScan(folder).finally(() => {
      this.activeScans.delete(folder.id)
    })
    this.activeScans.set(folder.id, promise)
    return promise
  }

  async scanAllActive(): Promise<void> {
    const activeFolders = this.repos.folders.listActive()
    for (const folder of activeFolders) {
      await this.scanFolder(folder)
    }
  }

  private async runScan(folder: FolderRecord): Promise<ScanProgressEvent> {
    this.onProgress({
      folderId: folder.id,
      folderName: folder.name,
      scanned: 0,
      total: 0,
      added: 0,
      updated: 0,
      missing: 0,
      phase: 'discovering'
    })

    try {
      const rootStat = await fs.promises.stat(folder.path)
      if (!rootStat.isDirectory()) {
        const event: ScanProgressEvent = {
          folderId: folder.id,
          folderName: folder.name,
          scanned: 0,
          total: 0,
          added: 0,
          updated: 0,
          missing: 0,
          phase: 'error',
          message: 'Configured path is not a directory.'
        }
        this.onProgress(event)
        return event
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code
      let missing = 0
      if (code === 'ENOENT' && this.repos.folders.getById(folder.id)) {
        missing = this.repos.tracks.markMissingExcept(folder.id, [])
        this.onTracksChanged()
      }
      const event: ScanProgressEvent = {
        folderId: folder.id,
        folderName: folder.name,
        scanned: 0,
        total: 0,
        added: 0,
        updated: 0,
        missing,
        phase: 'error',
        message: err instanceof Error ? err.message : 'Folder unavailable'
      }
      this.onProgress(event)
      return event
    }

    const discoveredFiles = await discoverAudioFiles(folder.path)
    const total = discoveredFiles.length
    const knownMap = this.repos.tracks.getKnownSignaturesForFolder(folder.id)

    let scanned = 0
    let added = 0
    let updated = 0
    let revivedCount = 0

    for (let i = 0; i < discoveredFiles.length; i += SCAN_BATCH_SIZE) {
      if (!this.repos.folders.getById(folder.id)) {
        // Folder was removed during scan.
        break
      }

      const slice = discoveredFiles.slice(i, i + SCAN_BATCH_SIZE)
      const batchToUpsert: TrackUpsertInput[] = []

      for (const filePath of slice) {
        scanned++
        let stat: fs.Stats
        try {
          stat = await fs.promises.stat(filePath)
          if (!stat.isFile()) continue
        } catch {
          continue
        }

        const fileMtime = Math.floor(stat.mtimeMs)
        const fileSize = stat.size
        const known = knownMap.get(filePath)

        if (known && known.fileMtime === fileMtime && known.fileSize === fileSize) {
          if (known.isMissing) {
            this.repos.tracks.markMissing(known.id, false)
            revivedCount++
          }
          continue
        }

        const meta = await extractTrackMetadata(filePath, this.artworkCache)
        batchToUpsert.push({
          folderId: folder.id,
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

      if (batchToUpsert.length > 0 && this.repos.folders.getById(folder.id)) {
        const result = this.repos.tracks.upsertBatch(batchToUpsert)
        added += result.added
        updated += result.updated
      }

      this.onProgress({
        folderId: folder.id,
        folderName: folder.name,
        scanned,
        total,
        added,
        updated,
        missing: 0,
        phase: 'indexing'
      })

      await yieldToEventLoop()
    }

    if (!this.repos.folders.getById(folder.id)) {
      const abortedEvent: ScanProgressEvent = {
        folderId: folder.id,
        folderName: folder.name,
        scanned,
        total,
        added,
        updated,
        missing: 0,
        phase: 'done'
      }
      this.onProgress(abortedEvent)
      return abortedEvent
    }

    const missing = this.repos.tracks.markMissingExcept(folder.id, discoveredFiles)
    this.repos.folders.updateLastScanned(folder.id, Date.now())

    const doneEvent: ScanProgressEvent = {
      folderId: folder.id,
      folderName: folder.name,
      scanned: total,
      total,
      added,
      updated,
      missing,
      phase: 'done'
    }
    this.onProgress(doneEvent)

    if (added > 0 || updated > 0 || missing > 0 || revivedCount > 0) {
      this.onTracksChanged()
    } else {
      // Still notify when scan finishes so folder lastScannedAt / trackCount refreshes in UI.
      this.onTracksChanged()
    }

    return doneEvent
  }
}

export function createFolderScanner(deps: FolderScannerDeps): FolderScanner {
  return new FolderScanner(deps)
}
