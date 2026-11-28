import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDatabase } from '../src/main/db/database'
import { createRepositories, type TrackUpsertInput } from '../src/main/db/repositories'

function musicPath(...segments: string[]): string {
  return path.join(path.sep, 'Music', ...segments)
}

function makeTrackInput(
  folderId: number,
  suffix: string,
  overrides: Partial<TrackUpsertInput> = {}
): TrackUpsertInput {
  return {
    folderId,
    filePath: musicPath(`${suffix}.mp3`),
    fileSize: 4_096_000,
    fileMtime: 1_700_000_000_000,
    format: 'mp3',
    title: `Title ${suffix}`,
    artist: `Artist ${suffix}`,
    album: `Album ${suffix}`,
    albumArtist: `Album Artist ${suffix}`,
    genre: 'Electronic',
    year: 2024,
    trackNumber: 1,
    duration: 240,
    artworkPath: null,
    bpm: 126,
    bpmSource: 'tag',
    musicalKey: 'Am',
    camelotKey: '8A',
    keySource: 'tag',
    ...overrides
  }
}

describe('liked songs backend', () => {
  const openDbs: Database.Database[] = []
  const tempDirs: string[] = []

  function createTempDbPath(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulsedeck-liked-test-'))
    tempDirs.push(dir)
    return path.join(dir, 'library.db')
  }

  function openTestDb() {
    const db = createDatabase(':memory:')
    openDbs.push(db)
    const repos = createRepositories(db)
    return { db, repos }
  }

  afterEach(() => {
    vi.restoreAllMocks()
    while (openDbs.length > 0) {
      const db = openDbs.pop()
      try {
        db?.close()
      } catch {
        // ignore close errors during cleanup
      }
    }
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop()
      if (dir) {
        fs.rmSync(dir, { recursive: true, force: true })
      }
    }
  })

  it('migrates an existing database missing liked_at and creates idx_tracks_liked_at', () => {
    const dbPath = createTempDbPath()
    const legacyDb = new Database(dbPath)
    legacyDb.exec(`
      CREATE TABLE folders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        last_scanned_at INTEGER,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE tracks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
        file_path TEXT NOT NULL UNIQUE,
        file_size INTEGER NOT NULL,
        file_mtime INTEGER NOT NULL,
        format TEXT NOT NULL,
        title TEXT NOT NULL,
        artist TEXT NOT NULL,
        album TEXT NOT NULL,
        album_artist TEXT,
        genre TEXT,
        year INTEGER,
        track_number INTEGER,
        duration REAL NOT NULL DEFAULT 0,
        artwork_path TEXT,
        bpm REAL,
        bpm_source TEXT,
        musical_key TEXT,
        camelot_key TEXT,
        key_source TEXT,
        replaygain_db REAL,
        energy REAL,
        waveform_peaks TEXT,
        intro_cue_sec REAL,
        outro_cue_sec REAL,
        analysis_status TEXT NOT NULL DEFAULT 'pending',
        is_missing INTEGER NOT NULL DEFAULT 0,
        play_count INTEGER NOT NULL DEFAULT 0,
        last_played_at INTEGER,
        added_at INTEGER NOT NULL
      );

      INSERT INTO folders (path, name, is_active, last_scanned_at, created_at)
      VALUES ('/Music/Legacy', 'Legacy', 1, NULL, 1000);

      INSERT INTO tracks (
        folder_id, file_path, file_size, file_mtime, format,
        title, artist, album, added_at
      ) VALUES (
        1, '/Music/Legacy/track1.mp3', 1024, 2000, 'mp3',
        'Legacy Track', 'Legacy Artist', 'Legacy Album', 3000
      );
    `)
    legacyDb.close()

    const migratedDb = createDatabase(dbPath)
    openDbs.push(migratedDb)
    const repos = createRepositories(migratedDb)

    const columns = migratedDb.prepare('PRAGMA table_info(tracks)').all() as Array<{ name: string }>
    expect(columns.some((col) => col.name === 'liked_at')).toBe(true)

    const indexes = migratedDb.prepare("PRAGMA index_list('tracks')").all() as Array<{ name: string }>
    expect(indexes.some((idx) => idx.name === 'idx_tracks_liked_at')).toBe(true)

    const existingTrack = repos.tracks.getById(1)
    expect(existingTrack).not.toBeNull()
    expect(existingTrack?.isLiked).toBe(false)
    expect(existingTrack?.likedAt).toBeNull()

    const liked = repos.tracks.toggleLike(1, true)
    expect(liked?.isLiked).toBe(true)
    expect(typeof liked?.likedAt).toBe('number')
  })

  it('toggles and explicitly sets liked state via tracks.toggleLike', () => {
    const { repos } = openTestDb()
    const folder = repos.folders.add(musicPath('Likes'))
    repos.tracks.upsertBatch([makeTrackInput(folder.id, 'like1')])
    const track = repos.tracks.getByFilePath(musicPath('like1.mp3'))!

    expect(track.isLiked).toBe(false)
    expect(track.likedAt).toBeNull()
    expect(repos.tracks.toggleLike(999_999)).toBeNull()

    const nowSpy = vi.spyOn(Date, 'now')
    nowSpy.mockReturnValue(1_700_000_001_000)
    const liked = repos.tracks.toggleLike(track.id)
    expect(liked?.isLiked).toBe(true)
    expect(liked?.likedAt).toBe(1_700_000_001_000)

    const unliked = repos.tracks.toggleLike(track.id)
    expect(unliked?.isLiked).toBe(false)
    expect(unliked?.likedAt).toBeNull()

    nowSpy.mockReturnValue(1_700_000_002_000)
    const forcedLike = repos.tracks.toggleLike(track.id, true)
    expect(forcedLike?.isLiked).toBe(true)
    expect(forcedLike?.likedAt).toBe(1_700_000_002_000)

    const forcedUnlike = repos.tracks.toggleLike(track.id, false)
    expect(forcedUnlike?.isLiked).toBe(false)
    expect(forcedUnlike?.likedAt).toBeNull()
  })

  it('queries smartView: liked ordered by liked_at DESC, id DESC and reports getFacets().likedTracks', () => {
    const { repos } = openTestDb()
    const folderA = repos.folders.add(musicPath('LikedA'))
    const folderB = repos.folders.add(musicPath('LikedB'))

    repos.tracks.upsertBatch([
      makeTrackInput(folderA.id, 'l1', { title: 'First Liked' }),
      makeTrackInput(folderA.id, 'l2', { title: 'Second Liked' }),
      makeTrackInput(folderA.id, 'l3', { title: 'Unliked Track' }),
      makeTrackInput(folderB.id, 'l4', { title: 'Inactive Folder Liked' })
    ])

    const t1 = repos.tracks.getByFilePath(musicPath('l1.mp3'))!
    const t2 = repos.tracks.getByFilePath(musicPath('l2.mp3'))!
    const t4 = repos.tracks.getByFilePath(musicPath('l4.mp3'))!

    const nowSpy = vi.spyOn(Date, 'now')
    nowSpy.mockReturnValue(10_000)
    repos.tracks.toggleLike(t1.id, true)
    nowSpy.mockReturnValue(20_000)
    repos.tracks.toggleLike(t2.id, true)
    nowSpy.mockReturnValue(30_000)
    repos.tracks.toggleLike(t4.id, true)

    expect(repos.tracks.getFacets().likedTracks).toBe(3)
    expect(repos.tracks.query({ smartView: 'liked' }).map((t) => t.id)).toEqual([t4.id, t2.id, t1.id])

    // Explicit sortBy overrides default liked_at DESC order
    expect(
      repos.tracks.query({ smartView: 'liked', sortBy: 'title', sortDir: 'asc' }).map((t) => t.id)
    ).toEqual([t1.id, t4.id, t2.id])

    // Deactivating folderB excludes its liked tracks from active smartView & facets
    repos.folders.toggleActive(folderB.id, false)
    expect(repos.tracks.getFacets().likedTracks).toBe(2)
    expect(repos.tracks.query({ smartView: 'liked' }).map((t) => t.id)).toEqual([t2.id, t1.id])

    // Marking missing excludes from active smartView & facets
    repos.tracks.markMissing(t2.id, true)
    expect(repos.tracks.getFacets().likedTracks).toBe(1)
    expect(repos.tracks.query({ smartView: 'liked' }).map((t) => t.id)).toEqual([t1.id])
  })

  it('preserves liked_at across upsertBatch rescans (both unedited and manually edited tracks)', () => {
    const { repos } = openTestDb()
    const folder = repos.folders.add(musicPath('RescanLikes'))

    repos.tracks.upsertBatch([
      makeTrackInput(folder.id, 'r1', {
        fileSize: 5_000_000,
        fileMtime: 1_700_000_000_000,
        title: 'Rescan Track 1'
      }),
      makeTrackInput(folder.id, 'r2', {
        fileSize: 6_000_000,
        fileMtime: 1_700_000_000_000,
        title: 'Rescan Track 2'
      })
    ])

    const r1 = repos.tracks.getByFilePath(musicPath('r1.mp3'))!
    const r2 = repos.tracks.getByFilePath(musicPath('r2.mp3'))!

    const nowSpy = vi.spyOn(Date, 'now')
    nowSpy.mockReturnValue(50_000)
    repos.tracks.toggleLike(r1.id, true)
    nowSpy.mockReturnValue(60_000)
    repos.tracks.toggleLike(r2.id, true)

    repos.tracks.updateMetadata(r2.id, { title: 'Manually Edited Title' })

    // Rescan with changed mtime & size
    const rescan = repos.tracks.upsertBatch([
      makeTrackInput(folder.id, 'r1', {
        fileSize: 5_100_000,
        fileMtime: 1_700_000_500_000,
        title: 'Rescan Updated Title 1'
      }),
      makeTrackInput(folder.id, 'r2', {
        fileSize: 6_100_000,
        fileMtime: 1_700_000_500_000,
        title: 'Should Keep Manual Title'
      })
    ])
    expect(rescan).toEqual({ added: 0, updated: 2, skipped: 0 })

    const afterR1 = repos.tracks.getById(r1.id)!
    expect(afterR1.title).toBe('Rescan Updated Title 1')
    expect(afterR1.isLiked).toBe(true)
    expect(afterR1.likedAt).toBe(50_000)

    const afterR2 = repos.tracks.getById(r2.id)!
    expect(afterR2.title).toBe('Manually Edited Title')
    expect(afterR2.isLiked).toBe(true)
    expect(afterR2.likedAt).toBe(60_000)
  })

  it('persists autoDj.scope = { type: "liked" } cleanly via settings repository', () => {
    const { repos } = openTestDb()
    const defaults = repos.settings.getAll()
    expect(defaults.autoDj.scope).toEqual({ type: 'library' })

    const updated = repos.settings.set('autoDj', {
      ...defaults.autoDj,
      enabled: true,
      scope: { type: 'liked' }
    })

    expect(updated.autoDj.enabled).toBe(true)
    expect(updated.autoDj.scope).toEqual({ type: 'liked' })
    expect(repos.settings.getAll().autoDj.scope).toEqual({ type: 'liked' })
  })
})
