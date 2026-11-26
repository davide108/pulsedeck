import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type Database from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDatabase } from '../src/main/db/database'
import { createRepositories } from '../src/main/db/repositories'
import { ArtworkCache } from '../src/main/scanner/artworkCache'

describe('performance optimizations (Pack 3)', () => {
  const openDbs: Database.Database[] = []
  const tempDirs: string[] = []

  function createTempDir(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
    tempDirs.push(dir)
    return dir
  }

  function openMemoryDb() {
    const db = createDatabase(':memory:')
    openDbs.push(db)
    const repos = createRepositories(db)
    return { db, repos }
  }

  afterEach(() => {
    while (openDbs.length > 0) {
      const db = openDbs.pop()
      try {
        db?.close()
      } catch {
        // ignore cleanup errors
      }
    }
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop()
      if (dir) {
        fs.rmSync(dir, { recursive: true, force: true })
      }
    }
  })

  it('omits waveformPeaks in tracks.query() by default, includes them with includeWaveformPeaks: true, and returns them in getById() and getByFilePath()', () => {
    const { repos } = openMemoryDb()
    const folder = repos.folders.add(path.join(path.sep, 'Music', 'PerfTest'))
    const filePath = path.join(path.sep, 'Music', 'PerfTest', 'wave.mp3')

    repos.tracks.upsertBatch([
      {
        folderId: folder.id,
        filePath,
        fileSize: 2_000_000,
        fileMtime: 1_700_000_000_000,
        format: 'mp3',
        title: 'Waveform Track',
        artist: 'Test Artist',
        album: 'Test Album',
        duration: 180
      }
    ])

    const inserted = repos.tracks.getByFilePath(filePath)!
    const peaks = [0.12, 0.45, 0.88, 0.31]

    repos.tracks.saveAnalysis({
      trackId: inserted.id,
      bpm: 126,
      bpmSource: 'analyzed',
      musicalKey: 'Am',
      camelotKey: '8A',
      keySource: 'analyzed',
      replaygainDb: -1.2,
      energy: 0.78,
      waveformPeaks: peaks,
      introCueSec: 8,
      outroCueSec: 165,
      status: 'done'
    })

    const defaultQuery = repos.tracks.query()
    expect(defaultQuery).toHaveLength(1)
    expect(defaultQuery[0].waveformPeaks).toBeNull()
    expect(defaultQuery[0].bpm).toBe(126)
    expect(defaultQuery[0].camelotKey).toBe('8A')

    const withPeaksQuery = repos.tracks.query({ includeWaveformPeaks: true })
    expect(withPeaksQuery).toHaveLength(1)
    expect(withPeaksQuery[0].waveformPeaks).toEqual(peaks)

    const byId = repos.tracks.getById(inserted.id)
    expect(byId?.waveformPeaks).toEqual(peaks)

    const byPath = repos.tracks.getByFilePath(filePath)
    expect(byPath?.waveformPeaks).toEqual(peaks)
  })

  it('defaults appearance.reducedEffects to false, persists true, and falls back on invalid values', () => {
    const { repos } = openMemoryDb()

    const initial = repos.settings.getAll()
    expect(initial.appearance.reducedEffects).toBe(false)

    const updated = repos.settings.set('appearance', {
      ...initial.appearance,
      reducedEffects: true
    })
    expect(updated.appearance.reducedEffects).toBe(true)
    expect(repos.settings.getAll().appearance.reducedEffects).toBe(true)

    repos.settings.setRaw('appearance', { reducedEffects: 'invalid' })
    expect(repos.settings.getAll().appearance.reducedEffects).toBe(false)
  })

  it('ArtworkCache deduplicates repeated saves across extensions and falls back gracefully without nativeImage', async () => {
    const userDataDir = createTempDir('pulsedeck-artwork-test-')
    const cache = new ArtworkCache(userDataDir)

    expect(await cache.save(Buffer.alloc(0))).toBeNull()

    // Minimal PNG magic-byte payload (running under ELECTRON_RUN_AS_NODE=1 where nativeImage is absent)
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
    const firstFilename = await cache.save(pngBytes)
    expect(firstFilename).toMatch(/^[0-9a-f]{24}\.png$/)

    const secondFilename = await cache.save(pngBytes, 'image/png')
    expect(secondFilename).toBe(firstFilename)

    const cachedFiles = fs.readdirSync(cache.artworkDir)
    expect(cachedFiles).toEqual([firstFilename])

    // If a hash is already cached as .jpg (e.g., previously resized), saving the same raw bytes with png mime returns the existing .jpg
    const jpegSourceBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 5, 6, 7, 8])
    const jpgFilename = await cache.save(jpegSourceBytes, 'image/jpeg')
    expect(jpgFilename).toMatch(/^[0-9a-f]{24}\.jpg$/)
    expect(await cache.save(jpegSourceBytes, 'image/png')).toBe(jpgFilename)
  })

  it('ArtworkCache resizes oversized images to 640px JPEG(85) when nativeImage is available and skips decoding on cache hits', async () => {
    const userDataDir = createTempDir('pulsedeck-artwork-resize-')
    const resizedJpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9])
    const resizeMock = vi.fn(() => ({
      toJPEG: vi.fn(() => resizedJpegBytes)
    }))
    const createFromBufferMock = vi.fn(() => ({
      isEmpty: () => false,
      getSize: () => ({ width: 1400, height: 1000 }),
      resize: resizeMock
    }))

    vi.resetModules()
    vi.doMock('electron', () => ({
      nativeImage: {
        createFromBuffer: createFromBufferMock
      }
    }))

    try {
      const { ArtworkCache: MockedArtworkCache } = await import(
        '../src/main/scanner/artworkCache'
      )
      const cache = new MockedArtworkCache(userDataDir)
      const largePngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 10, 20, 30, 40])

      const firstSaved = await cache.save(largePngBytes, 'image/png')
      expect(firstSaved).toMatch(/^[0-9a-f]{24}\.jpg$/)
      expect(createFromBufferMock).toHaveBeenCalledTimes(1)
      expect(resizeMock).toHaveBeenCalledWith({ width: 640, quality: 'good' })
      expect(fs.readFileSync(path.join(cache.artworkDir, firstSaved!))).toEqual(resizedJpegBytes)

      // Subsequent save with the same raw PNG bytes returns the existing .jpg without calling createFromBuffer again
      const secondSaved = await cache.save(largePngBytes, 'image/png')
      expect(secondSaved).toBe(firstSaved)
      expect(createFromBufferMock).toHaveBeenCalledTimes(1)
    } finally {
      vi.doUnmock('electron')
      vi.resetModules()
    }
  })
})
