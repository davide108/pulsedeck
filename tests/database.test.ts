import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { createDatabase } from '../src/main/db/database'
import { createRepositories, type TrackUpsertInput } from '../src/main/db/repositories'

type StorageMode = 'memory' | 'disk'

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
    bpm: null,
    bpmSource: null,
    musicalKey: null,
    camelotKey: null,
    keySource: null,
    ...overrides
  }
}

describe('database & repositories', () => {
  const openDbs: Database.Database[] = []
  const tempDirs: string[] = []

  function openTestDb(mode: StorageMode) {
    let dbPath = ':memory:'
    if (mode === 'disk') {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulsedeck-db-test-'))
      tempDirs.push(dir)
      dbPath = path.join(dir, 'library.db')
    }
    const db = createDatabase(dbPath)
    openDbs.push(db)
    const repos = createRepositories(db)
    return { db, repos, dbPath }
  }

  afterEach(() => {
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

  it('enables WAL journal mode and foreign keys on a temporary disk database', () => {
    const { db, dbPath } = openTestDb('disk')
    expect(fs.existsSync(dbPath)).toBe(true)
    const journalMode = db.pragma('journal_mode', { simple: true })
    const foreignKeys = db.pragma('foreign_keys', { simple: true })
    expect(String(journalMode).toLowerCase()).toBe('wal')
    expect(foreignKeys).toBe(1)
  })

  describe.each<StorageMode>(['memory', 'disk'])('mode=%s', (mode) => {
    it('performs folder CRUD and filters tracks/facets/pending by folder active state', () => {
      const { repos } = openTestDb(mode)

      const folderA = repos.folders.add(musicPath('FolderA'), 'Folder A')
      const folderB = repos.folders.add(musicPath('FolderB'))
      expect(folderA.name).toBe('Folder A')
      expect(folderA.isActive).toBe(true)
      expect(folderB.name).toBe('FolderB')
      expect(repos.folders.list()).toHaveLength(2)
      expect(repos.folders.listActive()).toHaveLength(2)

      repos.tracks.upsertBatch([
        makeTrackInput(folderA.id, 'a1', { genre: 'Techno', bpm: 130, camelotKey: '8A' }),
        makeTrackInput(folderB.id, 'b1', { genre: 'House', bpm: 124, camelotKey: '9A' })
      ])

      expect(repos.tracks.query()).toHaveLength(2)
      expect(repos.tracks.getFacets().totalTracks).toBe(2)
      expect(repos.tracks.getPendingAnalysis(50)).toHaveLength(2)

      const toggled = repos.folders.toggleActive(folderB.id, false)
      expect(toggled?.isActive).toBe(false)
      expect(repos.folders.listActive().map((f) => f.id)).toEqual([folderA.id])

      const activeTracks = repos.tracks.query()
      expect(activeTracks).toHaveLength(1)
      expect(activeTracks[0].folderId).toBe(folderA.id)

      const facets = repos.tracks.getFacets()
      expect(facets.totalTracks).toBe(1)
      expect(facets.genres).toEqual(['Techno'])

      expect(repos.tracks.getPendingAnalysis(50)).toHaveLength(1)

      repos.folders.updateLastScanned(folderA.id, 123456789)
      expect(repos.folders.getById(folderA.id)?.lastScannedAt).toBe(123456789)

      // Removing a folder cascades to its tracks
      repos.folders.remove(folderA.id)
      expect(repos.folders.getById(folderA.id)).toBeNull()
      expect(repos.tracks.getByFilePath(musicPath('a1.mp3'))).toBeNull()
    })

    it('batch upserts tracks and preserves analyzed fields & playCount when mtime+size are unchanged', () => {
      const { repos } = openTestDb(mode)
      const folder = repos.folders.add(musicPath('Library'))

      const initialResult = repos.tracks.upsertBatch([
        makeTrackInput(folder.id, 'preserve', {
          fileSize: 8_000_000,
          fileMtime: 1_700_000_111_000,
          title: 'Original Title'
        })
      ])
      expect(initialResult).toEqual({ added: 1, updated: 0, skipped: 0 })

      const inserted = repos.tracks.getByFilePath(musicPath('preserve.mp3'))!
      expect(inserted.analysisStatus).toBe('pending')

      repos.tracks.saveAnalysis({
        trackId: inserted.id,
        bpm: 128.4,
        bpmSource: 'analyzed',
        musicalKey: 'Am',
        camelotKey: '8A',
        keySource: 'analyzed',
        replaygainDb: -2.1,
        energy: 0.84,
        waveformPeaks: [0.1, 0.5, 0.9, 0.4],
        introCueSec: 6.5,
        outroCueSec: 225,
        status: 'done'
      })
      repos.history.recordPlay({
        trackId: inserted.id,
        durationPlayedSec: 180,
        wasSkippedEarly: false,
        source: 'manual'
      })

      // Re-upsert with identical mtime & size -> skipped, analyzed fields & playCount preserved
      const unchangedResult = repos.tracks.upsertBatch([
        makeTrackInput(folder.id, 'preserve', {
          fileSize: 8_000_000,
          fileMtime: 1_700_000_111_000,
          title: 'Ignored Changed Title'
        })
      ])
      expect(unchangedResult).toEqual({ added: 0, updated: 0, skipped: 1 })

      const preserved = repos.tracks.getById(inserted.id)!
      expect(preserved.title).toBe('Original Title')
      expect(preserved.bpm).toBe(128.4)
      expect(preserved.camelotKey).toBe('8A')
      expect(preserved.waveformPeaks).toEqual([0.1, 0.5, 0.9, 0.4])
      expect(preserved.playCount).toBe(1)
      expect(preserved.analysisStatus).toBe('done')

      // Re-upsert with changed mtime -> updated, resets analysisStatus to pending while preserving playCount
      const changedResult = repos.tracks.upsertBatch([
        makeTrackInput(folder.id, 'preserve', {
          fileSize: 8_000_000,
          fileMtime: 1_700_000_222_000,
          title: 'Updated Title'
        })
      ])
      expect(changedResult).toEqual({ added: 0, updated: 1, skipped: 0 })

      const updated = repos.tracks.getById(inserted.id)!
      expect(updated.title).toBe('Updated Title')
      expect(updated.analysisStatus).toBe('pending')
      expect(updated.waveformPeaks).toBeNull()
      expect(updated.playCount).toBe(1)
    })

    it('supports multi-criteria filtering (search, genre, BPM range, Camelot key) and facets', () => {
      const { repos } = openTestDb(mode)
      const folder = repos.folders.add(musicPath('FilterSet'))

      repos.tracks.upsertBatch([
        makeTrackInput(folder.id, 't1', {
          title: 'Solaris 100%',
          artist: 'Bicep',
          album: 'Isles',
          genre: 'Breakbeat',
          bpm: 132,
          bpmSource: 'tag',
          musicalKey: 'Am',
          camelotKey: '8A',
          keySource: 'tag'
        }),
        makeTrackInput(folder.id, 't2', {
          title: 'Glue',
          artist: 'Bicep',
          album: 'Bicep',
          genre: 'Breakbeat',
          bpm: 130,
          bpmSource: 'tag',
          musicalKey: 'Em',
          camelotKey: '9A',
          keySource: 'tag'
        }),
        makeTrackInput(folder.id, 't3', {
          title: 'Midnight Mirage',
          artist: 'Bonobo',
          album: 'Migration',
          genre: 'Downtempo',
          bpm: 118,
          bpmSource: 'tag',
          musicalKey: 'Am',
          camelotKey: '8A',
          keySource: 'tag'
        }),
        makeTrackInput(folder.id, 't4', {
          title: 'Pulse',
          artist: 'Four Tet',
          album: 'Three',
          genre: 'House',
          bpm: 126,
          bpmSource: 'tag',
          musicalKey: 'C',
          camelotKey: '8B',
          keySource: 'tag'
        })
      ])

      expect(repos.tracks.query({ search: '100%' }).map((t) => t.title)).toEqual(['Solaris 100%'])
      expect(repos.tracks.query({ genre: 'Breakbeat' })).toHaveLength(2)
      expect(repos.tracks.query({ camelotKey: '8A' })).toHaveLength(2)
      expect(repos.tracks.query({ bpmMin: 125, bpmMax: 131 })).toHaveLength(2)

      const combined = repos.tracks.query({
        search: 'Bicep',
        genre: 'Breakbeat',
        bpmMin: 131,
        bpmMax: 135,
        camelotKey: '8A'
      })
      expect(combined).toHaveLength(1)
      expect(combined[0].title).toBe('Solaris 100%')

      const facets = repos.tracks.getFacets()
      expect(facets.genres).toEqual(['Breakbeat', 'Downtempo', 'House'])
      expect(facets.keys).toEqual(['8A', '8B', '9A'])
      expect(facets.minBpm).toBe(118)
      expect(facets.maxBpm).toBe(132)
    })

    it('implements smart views: recently_added, most_played, and high_energy', () => {
      const { db, repos } = openTestDb(mode)
      const folder = repos.folders.add(musicPath('Smart'))

      repos.tracks.upsertBatch([
        makeTrackInput(folder.id, 's1', { title: 'Chill Opener', bpm: 100 }),
        makeTrackInput(folder.id, 's2', { title: 'Peak Anthem', bpm: 134 }),
        makeTrackInput(folder.id, 's3', { title: 'Club Roller', bpm: 126 })
      ])

      const s1 = repos.tracks.getByFilePath(musicPath('s1.mp3'))!
      const s2 = repos.tracks.getByFilePath(musicPath('s2.mp3'))!
      const s3 = repos.tracks.getByFilePath(musicPath('s3.mp3'))!

      // Ensure explicit added_at ordering differences
      db.prepare('UPDATE tracks SET added_at = ? WHERE id = ?').run(1000, s1.id)
      db.prepare('UPDATE tracks SET added_at = ? WHERE id = ?').run(2000, s2.id)
      db.prepare('UPDATE tracks SET added_at = ? WHERE id = ?').run(3000, s3.id)

      repos.tracks.saveAnalysis({
        trackId: s1.id,
        bpm: 100,
        bpmSource: 'analyzed',
        musicalKey: 'C',
        camelotKey: '8B',
        keySource: 'analyzed',
        replaygainDb: 0,
        energy: 0.35,
        waveformPeaks: [],
        introCueSec: 0,
        outroCueSec: 200,
        status: 'done'
      })
      repos.tracks.saveAnalysis({
        trackId: s2.id,
        bpm: 134,
        bpmSource: 'analyzed',
        musicalKey: 'Am',
        camelotKey: '8A',
        keySource: 'analyzed',
        replaygainDb: -1,
        energy: 0.92,
        waveformPeaks: [],
        introCueSec: 0,
        outroCueSec: 200,
        status: 'done'
      })
      repos.tracks.saveAnalysis({
        trackId: s3.id,
        bpm: 126,
        bpmSource: 'analyzed',
        musicalKey: 'Em',
        camelotKey: '9A',
        keySource: 'analyzed',
        replaygainDb: -1,
        energy: 0.72,
        waveformPeaks: [],
        introCueSec: 0,
        outroCueSec: 200,
        status: 'done'
      })

      repos.history.recordPlay({
        trackId: s3.id,
        durationPlayedSec: 120,
        wasSkippedEarly: false,
        source: 'manual'
      })
      repos.history.recordPlay({
        trackId: s3.id,
        durationPlayedSec: 150,
        wasSkippedEarly: false,
        source: 'autodj'
      })
      repos.history.recordPlay({
        trackId: s1.id,
        durationPlayedSec: 90,
        wasSkippedEarly: false,
        source: 'manual'
      })

      const recent = repos.tracks.query({ smartView: 'recently_added' })
      expect(recent.map((t) => t.id)).toEqual([s3.id, s2.id, s1.id])

      const mostPlayed = repos.tracks.query({ smartView: 'most_played' })
      expect(mostPlayed.map((t) => t.id)).toEqual([s3.id, s1.id])
      expect(mostPlayed[0].playCount).toBe(2)

      const highEnergy = repos.tracks.query({ smartView: 'high_energy' })
      expect(highEnergy.map((t) => t.id)).toEqual([s2.id, s3.id])
    })

    it('handles playlist CRUD, reordering, and querying tracks in playlist position order', () => {
      const { repos } = openTestDb(mode)
      const folder = repos.folders.add(musicPath('Playlists'))

      repos.tracks.upsertBatch([
        makeTrackInput(folder.id, 'p1', { title: 'First' }),
        makeTrackInput(folder.id, 'p2', { title: 'Second' }),
        makeTrackInput(folder.id, 'p3', { title: 'Third' })
      ])

      const t1 = repos.tracks.getByFilePath(musicPath('p1.mp3'))!
      const t2 = repos.tracks.getByFilePath(musicPath('p2.mp3'))!
      const t3 = repos.tracks.getByFilePath(musicPath('p3.mp3'))!

      const created = repos.playlists.create('Late Night Set', 'Warmup to peak')
      expect(created.name).toBe('Late Night Set')
      expect(created.trackCount).toBe(0)

      repos.playlists.addTrack(created.id, t1.id)
      repos.playlists.addTrack(created.id, t2.id)
      repos.playlists.addTrack(created.id, t3.id)
      // Duplicate add should be idempotent
      repos.playlists.addTrack(created.id, t2.id)

      expect(repos.playlists.getById(created.id)?.trackCount).toBe(3)
      expect(repos.tracks.query({ playlistId: created.id }).map((t) => t.id)).toEqual([
        t1.id,
        t2.id,
        t3.id
      ])

      repos.playlists.reorderTracks(created.id, [t3.id, t1.id, t2.id])
      expect(repos.tracks.query({ playlistId: created.id }).map((t) => t.id)).toEqual([
        t3.id,
        t1.id,
        t2.id
      ])

      repos.playlists.removeTrack(created.id, t1.id)
      expect(repos.tracks.query({ playlistId: created.id }).map((t) => t.id)).toEqual([
        t3.id,
        t2.id
      ])

      const renamed = repos.playlists.rename(created.id, 'Afterhours', 'Deep cuts')
      expect(renamed?.name).toBe('Afterhours')
      expect(renamed?.description).toBe('Deep cuts')
      expect(repos.playlists.list()).toHaveLength(1)

      repos.playlists.delete(created.id)
      expect(repos.playlists.getById(created.id)).toBeNull()
      expect(repos.playlists.list()).toHaveLength(0)
    })

    it('increments play_count on history.recordPlay and handles is_missing tracks properly', () => {
      const { repos } = openTestDb(mode)
      const folder = repos.folders.add(musicPath('HistoryAndMissing'))

      repos.tracks.upsertBatch([
        makeTrackInput(folder.id, 'h1', { title: 'Present Track' }),
        makeTrackInput(folder.id, 'h2', { title: 'Vanishing Track' })
      ])

      const t1 = repos.tracks.getByFilePath(musicPath('h1.mp3'))!
      const t2 = repos.tracks.getByFilePath(musicPath('h2.mp3'))!

      const h1 = repos.history.recordPlay({
        trackId: t1.id,
        durationPlayedSec: 215,
        wasSkippedEarly: false,
        source: 'autodj'
      })
      const h2 = repos.history.recordPlay({
        trackId: t1.id,
        durationPlayedSec: 8,
        wasSkippedEarly: true,
        source: 'manual'
      })

      expect(h1.source).toBe('autodj')
      expect(h2.wasSkippedEarly).toBe(true)

      const updatedT1 = repos.tracks.getById(t1.id)!
      expect(updatedT1.playCount).toBe(2)
      expect(updatedT1.lastPlayedAt).toBe(h2.playedAt)

      const recentHistory = repos.history.getRecent(10)
      expect(recentHistory).toHaveLength(2)
      expect(recentHistory[0].id).toBe(h2.id)

      // Mark missing individually and via markMissingExcept
      repos.tracks.markMissing(t2.id, true)
      expect(repos.tracks.getById(t2.id)?.isMissing).toBe(true)
      expect(repos.tracks.query().map((t) => t.id)).toEqual([t1.id])
      expect(repos.tracks.query({ includeMissing: true })).toHaveLength(2)

      // Reviving via markMissingExcept when file reappears on disk
      const missingCount = repos.tracks.markMissingExcept(folder.id, [t1.filePath, t2.filePath])
      expect(missingCount).toBe(0)
      expect(repos.tracks.getById(t2.id)?.isMissing).toBe(false)
      expect(repos.tracks.query()).toHaveLength(2)

      // Removing t2 from disk marks it missing
      const missingAfterScan = repos.tracks.markMissingExcept(folder.id, [t1.filePath])
      expect(missingAfterScan).toBe(1)
      expect(repos.tracks.getById(t2.id)?.isMissing).toBe(true)
      expect(repos.tracks.query()).toHaveLength(1)
    })

    it('defaults to normal sequential playback (autoDj disabled) and persists all app settings', () => {
      const { repos } = openTestDb(mode)

      const defaults = repos.settings.getAll()
      expect(defaults.autoDj.enabled).toBe(false)
      expect(defaults.shuffle).toBe(false)
      expect(defaults.repeatMode).toBe('off')
      expect(defaults.audio.replayGainEnabled).toBe(true)
      expect(defaults.audio.limiterEnabled).toBe(true)
      expect(defaults.audio.seekStepSec).toBe(5)
      expect(defaults.appearance.dynamicThemeEnabled).toBe(true)
      expect(defaults.appearance.reducedEffects).toBe(false)
      expect(defaults.library.autoAnalyzeEnabled).toBe(true)
      expect(defaults.library.autoFetchLyrics).toBe(true)

      repos.settings.set('shuffle', true)
      repos.settings.set('repeatMode', 'one')
      repos.settings.set('autoDj', { ...defaults.autoDj, enabled: true, mixStyle: 'bass-swap' })
      repos.settings.set('audio', {
        replayGainEnabled: false,
        limiterEnabled: false,
        seekStepSec: 10,
        manualCrossfadeSec: 2.5
      })
      repos.settings.set('appearance', {
        dynamicThemeEnabled: false,
        customAccentRgb: '16 185 129',
        customAccentGlowRgb: '52 211 153',
        showWaveformCues: false,
        reducedEffects: false
      })
      repos.settings.set('library', {
        autoAnalyzeEnabled: false,
        earlySkipThresholdSec: 30,
        autoFetchLyrics: false
      })

      const reloaded = repos.settings.getAll()
      expect(reloaded.shuffle).toBe(true)
      expect(reloaded.repeatMode).toBe('one')
      expect(reloaded.autoDj.enabled).toBe(true)
      expect(reloaded.autoDj.mixStyle).toBe('bass-swap')
      expect(reloaded.audio).toEqual({
        replayGainEnabled: false,
        limiterEnabled: false,
        seekStepSec: 10,
        manualCrossfadeSec: 2.5
      })
      expect(reloaded.appearance).toEqual({
        dynamicThemeEnabled: false,
        customAccentRgb: '16 185 129',
        customAccentGlowRgb: '52 211 153',
        showWaveformCues: false,
        reducedEffects: false
      })
      expect(reloaded.library).toEqual({
        autoAnalyzeEnabled: false,
        earlySkipThresholdSec: 30,
        autoFetchLyrics: false
      })
    })

    it('updates track metadata, normalizes Camelot key, preserves custom edits across rescans, and restores file tags via applyFileMetadata', () => {
      const { repos } = openTestDb(mode)
      const folder = repos.folders.add(musicPath('MetadataEdit'))

      repos.tracks.upsertBatch([
        makeTrackInput(folder.id, 'edit1', {
          fileSize: 5_000_000,
          fileMtime: 1_700_000_000_000,
          title: 'Original Tag Title',
          artist: 'Original Tag Artist',
          album: 'Original Tag Album',
          genre: 'House',
          bpm: 120,
          bpmSource: 'tag',
          musicalKey: 'C',
          camelotKey: '8B',
          keySource: 'tag'
        })
      ])

      const track = repos.tracks.getByFilePath(musicPath('edit1.mp3'))!
      expect(track.metadataEditedAt).toBeNull()

      const edited = repos.tracks.updateMetadata(track.id, {
        title: '  Edited Track Title  ',
        artist: 'Edited Artist',
        album: 'Edited Album',
        albumArtist: 'Edited Album Artist',
        genre: 'Melodic Techno',
        year: 2025,
        trackNumber: 4,
        artworkPath: 'custom-cover.jpg',
        bpm: 128.44,
        musicalKey: 'F#m'
      })

      expect(edited).not.toBeNull()
      expect(edited?.title).toBe('Edited Track Title')
      expect(edited?.artist).toBe('Edited Artist')
      expect(edited?.album).toBe('Edited Album')
      expect(edited?.albumArtist).toBe('Edited Album Artist')
      expect(edited?.genre).toBe('Melodic Techno')
      expect(edited?.year).toBe(2025)
      expect(edited?.trackNumber).toBe(4)
      expect(edited?.artworkPath).toBe('custom-cover.jpg')
      expect(edited?.bpm).toBe(128.4)
      expect(edited?.bpmSource).toBe('manual')
      expect(edited?.musicalKey).toBe('F#m')
      expect(edited?.camelotKey).toBe('11A')
      expect(edited?.keySource).toBe('manual')
      expect(typeof edited?.metadataEditedAt).toBe('number')

      // Normalizing Camelot-only update derives musical name and sets keySource='manual'
      const camelotOnly = repos.tracks.updateMetadata(track.id, {
        camelotKey: '08a',
        musicalKey: undefined
      })
      expect(camelotOnly?.camelotKey).toBe('8A')
      expect(camelotOnly?.musicalKey).toBe('Am')
      expect(camelotOnly?.keySource).toBe('manual')

      // Rescan with changed fileMtime & fileSize preserves user metadata while refreshing file signature
      const rescanResult = repos.tracks.upsertBatch([
        makeTrackInput(folder.id, 'edit1', {
          fileSize: 5_555_555,
          fileMtime: 1_700_000_999_000,
          duration: 312,
          title: 'Disk Overwrite Title',
          artist: 'Disk Overwrite Artist',
          album: 'Disk Overwrite Album',
          genre: 'Trance',
          bpm: 138,
          bpmSource: 'tag',
          musicalKey: 'D',
          camelotKey: '10B',
          keySource: 'tag'
        })
      ])
      expect(rescanResult).toEqual({ added: 0, updated: 1, skipped: 0 })

      const afterRescan = repos.tracks.getById(track.id)!
      expect(afterRescan.fileSize).toBe(5_555_555)
      expect(afterRescan.fileMtime).toBe(1_700_000_999_000)
      expect(afterRescan.duration).toBe(312)
      expect(afterRescan.analysisStatus).toBe('pending')
      expect(afterRescan.title).toBe('Edited Track Title')
      expect(afterRescan.artist).toBe('Edited Artist')
      expect(afterRescan.album).toBe('Edited Album')
      expect(afterRescan.albumArtist).toBe('Edited Album Artist')
      expect(afterRescan.genre).toBe('Melodic Techno')
      expect(afterRescan.year).toBe(2025)
      expect(afterRescan.trackNumber).toBe(4)
      expect(afterRescan.artworkPath).toBe('custom-cover.jpg')
      expect(afterRescan.bpm).toBe(128.4)
      expect(afterRescan.bpmSource).toBe('manual')
      expect(afterRescan.camelotKey).toBe('8A')
      expect(afterRescan.keySource).toBe('manual')
      expect(afterRescan.metadataEditedAt).not.toBeNull()

      // DSP saveAnalysis preserves manual BPM and key overrides
      repos.tracks.saveAnalysis({
        trackId: track.id,
        bpm: 95,
        bpmSource: 'analyzed',
        musicalKey: 'C',
        camelotKey: '8B',
        keySource: 'analyzed',
        replaygainDb: -1.5,
        energy: 0.78,
        waveformPeaks: [0.2, 0.8],
        introCueSec: 5,
        outroCueSec: 295,
        status: 'done'
      })
      const afterAnalysis = repos.tracks.getById(track.id)!
      expect(afterAnalysis.bpm).toBe(128.4)
      expect(afterAnalysis.bpmSource).toBe('manual')
      expect(afterAnalysis.camelotKey).toBe('8A')
      expect(afterAnalysis.keySource).toBe('manual')
      expect(afterAnalysis.energy).toBe(0.78)

      // applyFileMetadata clears metadataEditedAt and restores embedded file tags
      const restored = repos.tracks.applyFileMetadata(track.id, {
        format: 'mp3',
        title: 'Restored File Title',
        artist: 'Restored File Artist',
        album: 'Restored File Album',
        albumArtist: null,
        genre: 'Deep House',
        year: 2021,
        trackNumber: 2,
        duration: 312,
        artworkPath: 'file-cover.png',
        bpm: 122,
        bpmSource: 'tag',
        musicalKey: 'Em',
        camelotKey: '9A',
        keySource: 'tag'
      })
      expect(restored).not.toBeNull()
      expect(restored?.metadataEditedAt).toBeNull()
      expect(restored?.title).toBe('Restored File Title')
      expect(restored?.artist).toBe('Restored File Artist')
      expect(restored?.album).toBe('Restored File Album')
      expect(restored?.genre).toBe('Deep House')
      expect(restored?.bpm).toBe(122)
      expect(restored?.bpmSource).toBe('tag')
      expect(restored?.camelotKey).toBe('9A')
      expect(restored?.keySource).toBe('tag')
      expect(restored?.artworkPath).toBe('file-cover.png')
    })

    it('performs lyrics CRUD, clamps offsetMs to -15000..15000, and cascades delete on track removal', () => {
      const { repos } = openTestDb(mode)
      const folder = repos.folders.add(musicPath('LyricsCrud'))

      repos.tracks.upsertBatch([makeTrackInput(folder.id, 'lyr1', { title: 'Lyric Track' })])
      const track = repos.tracks.getByFilePath(musicPath('lyr1.mp3'))!

      expect(repos.lyrics.get(track.id)).toBeNull()
      expect(repos.lyrics.updateOffset(track.id, 500)).toBeNull()

      const saved = repos.lyrics.save({
        trackId: track.id,
        syncedLyrics: '[00:05.00] First line',
        plainLyrics: 'First line',
        source: 'lrclib',
        providerTrackName: 'Lyric Track',
        providerArtistName: 'Artist lyr1',
        isInstrumental: false,
        offsetMs: 250
      })

      expect(saved.trackId).toBe(track.id)
      expect(saved.syncedLyrics).toBe('[00:05.00] First line')
      expect(saved.plainLyrics).toBe('First line')
      expect(saved.source).toBe('lrclib')
      expect(saved.providerTrackName).toBe('Lyric Track')
      expect(saved.providerArtistName).toBe('Artist lyr1')
      expect(saved.isInstrumental).toBe(false)
      expect(saved.offsetMs).toBe(250)

      expect(repos.lyrics.get(track.id)?.syncedLyrics).toBe('[00:05.00] First line')

      const clampedHigh = repos.lyrics.updateOffset(track.id, 99_999)
      expect(clampedHigh?.offsetMs).toBe(15_000)

      const clampedLow = repos.lyrics.updateOffset(track.id, -99_999)
      expect(clampedLow?.offsetMs).toBe(-15_000)

      const updatedOffset = repos.lyrics.updateOffset(track.id, -1500)
      expect(updatedOffset?.offsetMs).toBe(-1500)

      repos.lyrics.delete(track.id)
      expect(repos.lyrics.get(track.id)).toBeNull()

      // Re-save and confirm folder/track cascade deletes track_lyrics row
      repos.lyrics.save({
        trackId: track.id,
        syncedLyrics: null,
        plainLyrics: 'Cascade test',
        source: 'user'
      })
      expect(repos.lyrics.get(track.id)).not.toBeNull()

      repos.folders.remove(folder.id)
      expect(repos.tracks.getById(track.id)).toBeNull()
      expect(repos.lyrics.get(track.id)).toBeNull()
    })
  })
})
