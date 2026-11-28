import path from 'node:path'
import type Database from 'better-sqlite3'
import { camelotToMusicalName, parseKeyToCamelot } from '../../shared/camelot'
import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_APPEARANCE_SETTINGS,
  DEFAULT_AUDIO_SETTINGS,
  DEFAULT_AUTO_DJ_CONFIG,
  DEFAULT_LIBRARY_SETTINGS,
  type AnalysisStatus,
  type AppSettings,
  type AppearanceSettings,
  type AudioFormat,
  type AudioSettings,
  type AutoDjConfig,
  type FolderRecord,
  type LibraryFacets,
  type LibrarySettings,
  type LyricsSource,
  type PlayHistoryInput,
  type PlayHistoryRecord,
  type PlaylistRecord,
  type RepeatMode,
  type SaveLyricsInput,
  type TrackAnalysisPayload,
  type TrackLyricsRecord,
  type TrackMetadataUpdateInput,
  type TrackQueryFilter,
  type TrackRecord
} from '../../shared/types'
import type { ExtractedTrackMetadata } from '../scanner/metadata'

export interface TrackUpsertInput {
  folderId: number
  filePath: string
  fileSize: number
  fileMtime: number
  format: AudioFormat
  title: string
  artist: string
  album: string
  albumArtist?: string | null
  genre?: string | null
  year?: number | null
  trackNumber?: number | null
  duration?: number
  artworkPath?: string | null
  bpm?: number | null
  bpmSource?: 'tag' | 'analyzed' | 'manual' | null
  musicalKey?: string | null
  camelotKey?: string | null
  keySource?: 'tag' | 'analyzed' | 'manual' | null
}

interface FolderRow {
  id: number
  path: string
  name: string
  is_active: number
  last_scanned_at: number | null
  created_at: number
  track_count?: number
}

interface TrackRow {
  id: number
  folder_id: number
  file_path: string
  file_size: number
  file_mtime: number
  format: string
  title: string
  artist: string
  album: string
  album_artist: string | null
  genre: string | null
  year: number | null
  track_number: number | null
  duration: number
  artwork_path: string | null
  bpm: number | null
  bpm_source: string | null
  musical_key: string | null
  camelot_key: string | null
  key_source: string | null
  replaygain_db: number | null
  energy: number | null
  waveform_peaks: string | null
  intro_cue_sec: number | null
  outro_cue_sec: number | null
  analysis_status: string
  is_missing: number
  play_count: number
  last_played_at: number | null
  added_at: number
  metadata_edited_at: number | null
  liked_at: number | null
}

interface TrackLyricsRow {
  track_id: number
  synced_lyrics: string | null
  plain_lyrics: string | null
  source: string
  provider_track_name: string | null
  provider_artist_name: string | null
  is_instrumental: number
  offset_ms: number
  updated_at: number
}

interface PlaylistRow {
  id: number
  name: string
  description: string | null
  created_at: number
  updated_at: number
  track_count: number
}

interface HistoryRow {
  id: number
  track_id: number
  played_at: number
  duration_played_sec: number
  was_skipped_early: number
  source: string
}

const SORT_COLUMN_MAP: Record<NonNullable<TrackQueryFilter['sortBy']>, string> = {
  title: 't.title COLLATE NOCASE',
  artist: 't.artist COLLATE NOCASE',
  album: 't.album COLLATE NOCASE',
  bpm: 't.bpm',
  camelot_key: 't.camelot_key',
  energy: 't.energy',
  duration: 't.duration',
  added_at: 't.added_at',
  play_count: 't.play_count'
}

const NULLABLE_SORT_KEYS = new Set<NonNullable<TrackQueryFilter['sortBy']>>([
  'bpm',
  'camelot_key',
  'energy'
])

function parseWaveformPeaks(raw: string | null): number[] | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((v): v is number => typeof v === 'number') : null
  } catch {
    return null
  }
}

function mapFolderRow(row: FolderRow): FolderRecord {
  const record: FolderRecord = {
    id: row.id,
    path: row.path,
    name: row.name,
    isActive: row.is_active === 1,
    lastScannedAt: row.last_scanned_at,
    createdAt: row.created_at
  }
  if (row.track_count !== undefined) {
    record.trackCount = Number(row.track_count)
  }
  return record
}

function mapTrackRow(row: TrackRow): TrackRecord {
  return {
    id: row.id,
    folderId: row.folder_id,
    filePath: row.file_path,
    fileSize: row.file_size,
    fileMtime: row.file_mtime,
    format: row.format as AudioFormat,
    title: row.title,
    artist: row.artist,
    album: row.album,
    albumArtist: row.album_artist,
    genre: row.genre,
    year: row.year,
    trackNumber: row.track_number,
    duration: row.duration,
    artworkPath: row.artwork_path,
    bpm: row.bpm,
    bpmSource: (row.bpm_source as TrackRecord['bpmSource']) ?? null,
    musicalKey: row.musical_key,
    camelotKey: row.camelot_key,
    keySource: (row.key_source as TrackRecord['keySource']) ?? null,
    replaygainDb: row.replaygain_db,
    energy: row.energy,
    waveformPeaks: parseWaveformPeaks(row.waveform_peaks),
    introCueSec: row.intro_cue_sec,
    outroCueSec: row.outro_cue_sec,
    analysisStatus: row.analysis_status as AnalysisStatus,
    isMissing: row.is_missing === 1,
    playCount: row.play_count,
    lastPlayedAt: row.last_played_at,
    addedAt: row.added_at,
    metadataEditedAt: row.metadata_edited_at ?? null,
    isLiked: row.liked_at != null,
    likedAt: row.liked_at ?? null
  }
}

function clampLyricsOffsetMs(offsetMs: number): number {
  if (!Number.isFinite(offsetMs)) return 0
  return Math.max(-15000, Math.min(15000, Math.round(offsetMs)))
}

function normalizeLyricsSource(source?: string | null): LyricsSource {
  if (source === 'lrclib' || source === 'embedded' || source === 'sidecar' || source === 'user') {
    return source
  }
  return 'user'
}

function mapLyricsRow(row: TrackLyricsRow): TrackLyricsRecord {
  return {
    trackId: row.track_id,
    syncedLyrics: row.synced_lyrics,
    plainLyrics: row.plain_lyrics,
    source: normalizeLyricsSource(row.source),
    providerTrackName: row.provider_track_name,
    providerArtistName: row.provider_artist_name,
    isInstrumental: row.is_instrumental === 1,
    offsetMs: row.offset_ms,
    updatedAt: row.updated_at
  }
}

function mapPlaylistRow(row: PlaylistRow): PlaylistRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    trackCount: Number(row.track_count ?? 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function mapHistoryRow(row: HistoryRow): PlayHistoryRecord {
  return {
    id: row.id,
    trackId: row.track_id,
    playedAt: row.played_at,
    durationPlayedSec: row.duration_played_sec,
    wasSkippedEarly: row.was_skipped_early === 1,
    source: row.source === 'autodj' ? 'autodj' : 'manual'
  }
}

function compareCamelotKeys(a: string, b: string): number {
  const matchA = /^(\d{1,2})([AB])$/i.exec(a.trim())
  const matchB = /^(\d{1,2})([AB])$/i.exec(b.trim())
  if (!matchA && !matchB) return a.localeCompare(b)
  if (!matchA) return 1
  if (!matchB) return -1
  const numDiff = Number(matchA[1]) - Number(matchB[1])
  if (numDiff !== 0) return numDiff
  return matchA[2].toUpperCase().localeCompare(matchB[2].toUpperCase())
}

/**
 * Creates typed SQLite repositories for folders, tracks, playlists, play history, and settings.
 */
export function createRepositories(db: Database.Database) {
  const folderSelectSql = `
    SELECT f.id, f.path, f.name, f.is_active, f.last_scanned_at, f.created_at,
           COUNT(CASE WHEN t.id IS NOT NULL AND t.is_missing = 0 THEN 1 END) AS track_count
    FROM folders f
    LEFT JOIN tracks t ON t.folder_id = f.id
  `

  const folders = {
    list(): FolderRecord[] {
      const rows = db
        .prepare(`${folderSelectSql} GROUP BY f.id ORDER BY f.created_at ASC, f.id ASC`)
        .all() as FolderRow[]
      return rows.map(mapFolderRow)
    },

    listActive(): FolderRecord[] {
      const rows = db
        .prepare(
          `${folderSelectSql} WHERE f.is_active = 1 GROUP BY f.id ORDER BY f.created_at ASC, f.id ASC`
        )
        .all() as FolderRow[]
      return rows.map(mapFolderRow)
    },

    getById(id: number): FolderRecord | null {
      const row = db
        .prepare(`${folderSelectSql} WHERE f.id = ? GROUP BY f.id`)
        .get(id) as FolderRow | undefined
      return row ? mapFolderRow(row) : null
    },

    getByPath(folderPath: string): FolderRecord | null {
      const row = db
        .prepare(`${folderSelectSql} WHERE f.path = ? GROUP BY f.id`)
        .get(folderPath) as FolderRow | undefined
      return row ? mapFolderRow(row) : null
    },

    add(folderPath: string, name?: string): FolderRecord {
      const existing = folders.getByPath(folderPath)
      if (existing) {
        if (!existing.isActive) {
          return folders.toggleActive(existing.id, true) ?? existing
        }
        return existing
      }

      const displayName = name?.trim() || path.basename(folderPath) || folderPath
      const now = Date.now()
      const info = db
        .prepare(
          `INSERT INTO folders (path, name, is_active, last_scanned_at, created_at)
           VALUES (?, ?, 1, NULL, ?)`
        )
        .run(folderPath, displayName, now)

      return folders.getById(Number(info.lastInsertRowid))!
    },

    remove(folderId: number): void {
      db.prepare('DELETE FROM folders WHERE id = ?').run(folderId)
    },

    toggleActive(folderId: number, isActive: boolean): FolderRecord | null {
      db.prepare('UPDATE folders SET is_active = ? WHERE id = ?').run(isActive ? 1 : 0, folderId)
      return folders.getById(folderId)
    },

    updateLastScanned(folderId: number, scannedAt = Date.now()): void {
      db.prepare('UPDATE folders SET last_scanned_at = ? WHERE id = ?').run(scannedAt, folderId)
    }
  }

  const selectExistingForUpsert = db.prepare(
    `SELECT id, folder_id, file_size, file_mtime, is_missing, metadata_edited_at
     FROM tracks
     WHERE file_path = ?`
  )

  const insertTrackStmt = db.prepare(`
    INSERT INTO tracks (
      folder_id, file_path, file_size, file_mtime, format,
      title, artist, album, album_artist, genre, year, track_number, duration, artwork_path,
      bpm, bpm_source, musical_key, camelot_key, key_source,
      analysis_status, is_missing, play_count, last_played_at, added_at
    ) VALUES (
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      'pending', 0, 0, NULL, ?
    )
  `)

  const updateTrackMetadataStmt = db.prepare(`
    UPDATE tracks
    SET folder_id = ?,
        file_size = ?,
        file_mtime = ?,
        format = ?,
        title = ?,
        artist = ?,
        album = ?,
        album_artist = ?,
        genre = ?,
        year = ?,
        track_number = ?,
        duration = ?,
        artwork_path = ?,
        bpm = ?,
        bpm_source = ?,
        musical_key = ?,
        camelot_key = ?,
        key_source = ?,
        replaygain_db = NULL,
        energy = NULL,
        waveform_peaks = NULL,
        intro_cue_sec = NULL,
        outro_cue_sec = NULL,
        analysis_status = 'pending',
        is_missing = 0
    WHERE id = ?
  `)

  const updateEditedTrackFileInfoStmt = db.prepare(`
    UPDATE tracks
    SET folder_id = ?,
        file_size = ?,
        file_mtime = ?,
        format = ?,
        duration = ?,
        replaygain_db = NULL,
        energy = NULL,
        waveform_peaks = NULL,
        intro_cue_sec = NULL,
        outro_cue_sec = NULL,
        analysis_status = 'pending',
        is_missing = 0
    WHERE id = ?
  `)

  const reviveUnchangedTrackStmt = db.prepare(`
    UPDATE tracks
    SET folder_id = ?,
        is_missing = 0
    WHERE id = ?
  `)

  const upsertBatchTx = db.transaction((items: TrackUpsertInput[]) => {
    let added = 0
    let updated = 0
    let skipped = 0
    const now = Date.now()

    for (const item of items) {
      const existing = selectExistingForUpsert.get(item.filePath) as
        | {
            id: number
            folder_id: number
            file_size: number
            file_mtime: number
            is_missing: number
            metadata_edited_at: number | null
          }
        | undefined

      const validBpm =
        item.bpm != null && Number.isFinite(item.bpm) && item.bpm > 0 ? item.bpm : null
      const bpmSource = validBpm !== null ? (item.bpmSource ?? 'tag') : null

      const validCamelot = item.camelotKey?.trim() ? item.camelotKey.trim() : null
      const validMusicalKey = item.musicalKey?.trim() ? item.musicalKey.trim() : null
      const keySource = validCamelot !== null ? (item.keySource ?? 'tag') : null

      if (!existing) {
        insertTrackStmt.run(
          item.folderId,
          item.filePath,
          item.fileSize,
          item.fileMtime,
          item.format,
          item.title,
          item.artist,
          item.album,
          item.albumArtist ?? null,
          item.genre ?? null,
          item.year ?? null,
          item.trackNumber ?? null,
          typeof item.duration === 'number' && Number.isFinite(item.duration) ? item.duration : 0,
          item.artworkPath ?? null,
          validBpm,
          bpmSource,
          validCamelot !== null ? validMusicalKey : null,
          validCamelot,
          keySource,
          now
        )
        added++
        continue
      }

      if (existing.file_mtime === item.fileMtime && existing.file_size === item.fileSize) {
        if (existing.is_missing !== 0 || existing.folder_id !== item.folderId) {
          reviveUnchangedTrackStmt.run(item.folderId, existing.id)
        }
        skipped++
        continue
      }

      const safeDuration =
        typeof item.duration === 'number' && Number.isFinite(item.duration) ? item.duration : 0

      if (existing.metadata_edited_at != null) {
        updateEditedTrackFileInfoStmt.run(
          item.folderId,
          item.fileSize,
          item.fileMtime,
          item.format,
          safeDuration,
          existing.id
        )
        updated++
        continue
      }

      updateTrackMetadataStmt.run(
        item.folderId,
        item.fileSize,
        item.fileMtime,
        item.format,
        item.title,
        item.artist,
        item.album,
        item.albumArtist ?? null,
        item.genre ?? null,
        item.year ?? null,
        item.trackNumber ?? null,
        safeDuration,
        item.artworkPath ?? null,
        validBpm,
        bpmSource,
        validCamelot !== null ? validMusicalKey : null,
        validCamelot,
        keySource,
        existing.id
      )
      updated++
    }

    return { added, updated, skipped }
  })

  const markMissingExceptTx = db.transaction((folderId: number, existingFilePaths: string[]) => {
    const existingSet = new Set(existingFilePaths)
    const rows = db
      .prepare('SELECT id, file_path, is_missing FROM tracks WHERE folder_id = ?')
      .all(folderId) as Array<{ id: number; file_path: string; is_missing: number }>

    const setMissingStmt = db.prepare('UPDATE tracks SET is_missing = ? WHERE id = ?')
    let missingCount = 0

    for (const row of rows) {
      const existsOnDisk = existingSet.has(row.file_path)
      if (!existsOnDisk) {
        if (row.is_missing === 0) {
          setMissingStmt.run(1, row.id)
        }
        missingCount++
      } else if (row.is_missing === 1) {
        setMissingStmt.run(0, row.id)
      }
    }

    return missingCount
  })

  const tracks = {
    upsertBatch(items: TrackUpsertInput[]): { added: number; updated: number; skipped: number } {
      if (items.length === 0) return { added: 0, updated: 0, skipped: 0 }
      return upsertBatchTx(items)
    },

    getKnownSignaturesForFolder(
      folderId: number
    ): Map<string, { id: number; fileSize: number; fileMtime: number; isMissing: boolean }> {
      const rows = db
        .prepare('SELECT id, file_path, file_size, file_mtime, is_missing FROM tracks WHERE folder_id = ?')
        .all(folderId) as Array<{
        id: number
        file_path: string
        file_size: number
        file_mtime: number
        is_missing: number
      }>
      const map = new Map<
        string,
        { id: number; fileSize: number; fileMtime: number; isMissing: boolean }
      >()
      for (const row of rows) {
        map.set(row.file_path, {
          id: row.id,
          fileSize: row.file_size,
          fileMtime: row.file_mtime,
          isMissing: row.is_missing === 1
        })
      }
      return map
    },

    query(filter: TrackQueryFilter = {}): TrackRecord[] {
      const joins = ['INNER JOIN folders f ON f.id = t.folder_id']
      const conditions: string[] = []
      const params: Array<string | number> = []

      if (filter.playlistId != null) {
        joins.push('INNER JOIN playlist_tracks pt ON pt.track_id = t.id')
        conditions.push('pt.playlist_id = ?')
        params.push(filter.playlistId)
      } else {
        conditions.push('f.is_active = 1')
      }

      if (filter.folderId != null) {
        conditions.push('t.folder_id = ?')
        params.push(filter.folderId)
      }

      if (!filter.includeMissing) {
        conditions.push('t.is_missing = 0')
      }

      const searchTerm = filter.search?.trim()
      if (searchTerm) {
        const escaped = searchTerm.replace(/[\\%_]/g, (ch) => `\\${ch}`)
        const pattern = `%${escaped}%`
        conditions.push(
          "(t.title LIKE ? ESCAPE '\\' OR t.artist LIKE ? ESCAPE '\\' OR t.album LIKE ? ESCAPE '\\' OR COALESCE(t.album_artist, '') LIKE ? ESCAPE '\\' OR COALESCE(t.genre, '') LIKE ? ESCAPE '\\')"
        )
        params.push(pattern, pattern, pattern, pattern, pattern)
      }

      if (filter.genre != null && filter.genre.trim() !== '') {
        conditions.push('t.genre = ?')
        params.push(filter.genre.trim())
      }

      if (filter.camelotKey != null && filter.camelotKey.trim() !== '') {
        conditions.push('t.camelot_key = ?')
        params.push(filter.camelotKey.trim())
      }

      if (filter.bpmMin != null && Number.isFinite(filter.bpmMin)) {
        conditions.push('t.bpm >= ?')
        params.push(filter.bpmMin)
      }

      if (filter.bpmMax != null && Number.isFinite(filter.bpmMax)) {
        conditions.push('t.bpm <= ?')
        params.push(filter.bpmMax)
      }

      if (filter.smartView === 'liked') {
        conditions.push('t.liked_at IS NOT NULL')
      } else if (filter.smartView === 'most_played') {
        conditions.push('t.play_count > 0')
      } else if (filter.smartView === 'high_energy') {
        conditions.push('t.energy IS NOT NULL AND t.energy >= 0.65')
      }

      let orderByClause: string
      if (filter.sortBy && SORT_COLUMN_MAP[filter.sortBy]) {
        const col = SORT_COLUMN_MAP[filter.sortBy]
        const dir = filter.sortDir === 'desc' ? 'DESC' : 'ASC'
        if (NULLABLE_SORT_KEYS.has(filter.sortBy)) {
          orderByClause = `CASE WHEN ${col} IS NULL THEN 1 ELSE 0 END ASC, ${col} ${dir}, t.title COLLATE NOCASE ASC`
        } else {
          orderByClause = `${col} ${dir}, t.id ASC`
        }
      } else if (filter.playlistId != null) {
        orderByClause = 'pt.position ASC, t.id ASC'
      } else if (filter.smartView === 'liked') {
        orderByClause = 't.liked_at DESC, t.id DESC'
      } else if (filter.smartView === 'recently_added') {
        orderByClause = 't.added_at DESC, t.id DESC'
      } else if (filter.smartView === 'most_played') {
        orderByClause = 't.play_count DESC, COALESCE(t.last_played_at, 0) DESC, t.id ASC'
      } else if (filter.smartView === 'high_energy') {
        orderByClause = 't.energy DESC, COALESCE(t.bpm, 0) DESC, t.id ASC'
      } else {
        orderByClause =
          't.artist COLLATE NOCASE ASC, t.album COLLATE NOCASE ASC, COALESCE(t.track_number, 9999) ASC, t.title COLLATE NOCASE ASC'
      }

      const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
      const waveformColumn =
        filter.includeWaveformPeaks === true ? 't.waveform_peaks' : 'NULL AS waveform_peaks'
      const sql = `
        SELECT t.id, t.folder_id, t.file_path, t.file_size, t.file_mtime, t.format,
               t.title, t.artist, t.album, t.album_artist, t.genre, t.year, t.track_number,
               t.duration, t.artwork_path, t.bpm, t.bpm_source, t.musical_key, t.camelot_key,
               t.key_source, t.replaygain_db, t.energy, ${waveformColumn},
               t.intro_cue_sec, t.outro_cue_sec, t.analysis_status, t.is_missing,
               t.play_count, t.last_played_at, t.added_at, t.metadata_edited_at, t.liked_at
        FROM tracks t
        ${joins.join('\n')}
        ${whereSql}
        ORDER BY ${orderByClause}
      `
      const rows = db.prepare(sql).all(...params) as TrackRow[]
      return rows.map(mapTrackRow)
    },

    getById(id: number): TrackRecord | null {
      const row = db.prepare('SELECT * FROM tracks WHERE id = ?').get(id) as TrackRow | undefined
      return row ? mapTrackRow(row) : null
    },

    getByFilePath(filePath: string): TrackRecord | null {
      const row = db
        .prepare('SELECT * FROM tracks WHERE file_path = ?')
        .get(filePath) as TrackRow | undefined
      return row ? mapTrackRow(row) : null
    },

    getFacets(): LibraryFacets {
      const genreRows = db
        .prepare(
          `SELECT DISTINCT t.genre
           FROM tracks t
           INNER JOIN folders f ON f.id = t.folder_id
           WHERE f.is_active = 1 AND t.is_missing = 0
             AND t.genre IS NOT NULL AND TRIM(t.genre) != ''
           ORDER BY t.genre COLLATE NOCASE ASC`
        )
        .all() as Array<{ genre: string }>

      const keyRows = db
        .prepare(
          `SELECT DISTINCT t.camelot_key
           FROM tracks t
           INNER JOIN folders f ON f.id = t.folder_id
           WHERE f.is_active = 1 AND t.is_missing = 0
             AND t.camelot_key IS NOT NULL AND TRIM(t.camelot_key) != ''`
        )
        .all() as Array<{ camelot_key: string }>

      const statsRow = db
        .prepare(
          `SELECT MIN(t.bpm) AS min_bpm,
                  MAX(t.bpm) AS max_bpm,
                  COUNT(*) AS total_tracks,
                  SUM(CASE WHEN t.analysis_status = 'done' THEN 1 ELSE 0 END) AS analyzed_tracks,
                  SUM(CASE WHEN t.liked_at IS NOT NULL THEN 1 ELSE 0 END) AS liked_tracks
           FROM tracks t
           INNER JOIN folders f ON f.id = t.folder_id
           WHERE f.is_active = 1 AND t.is_missing = 0`
        )
        .get() as {
        min_bpm: number | null
        max_bpm: number | null
        total_tracks: number
        analyzed_tracks: number | null
        liked_tracks: number | null
      }

      return {
        genres: genreRows.map((r) => r.genre),
        keys: keyRows.map((r) => r.camelot_key).sort(compareCamelotKeys),
        minBpm: statsRow.min_bpm ?? null,
        maxBpm: statsRow.max_bpm ?? null,
        totalTracks: Number(statsRow.total_tracks ?? 0),
        analyzedTracks: Number(statsRow.analyzed_tracks ?? 0),
        likedTracks: Number(statsRow.liked_tracks ?? 0)
      }
    },

    getPendingAnalysis(limit = 50): TrackRecord[] {
      const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)))
      const rows = db
        .prepare(
          `SELECT t.*
           FROM tracks t
           INNER JOIN folders f ON f.id = t.folder_id
           WHERE t.analysis_status = 'pending'
             AND t.is_missing = 0
             AND f.is_active = 1
           ORDER BY t.added_at DESC, t.id ASC
           LIMIT ?`
        )
        .all(safeLimit) as TrackRow[]
      return rows.map(mapTrackRow)
    },

    saveAnalysis(payload: TrackAnalysisPayload): void {
      const existing = db
        .prepare(
          'SELECT bpm, bpm_source, musical_key, camelot_key, key_source FROM tracks WHERE id = ?'
        )
        .get(payload.trackId) as
        | {
            bpm: number | null
            bpm_source: string | null
            musical_key: string | null
            camelot_key: string | null
            key_source: string | null
          }
        | undefined

      if (!existing) return

      if (payload.status === 'failed') {
        db.prepare("UPDATE tracks SET analysis_status = 'failed' WHERE id = ?").run(
          payload.trackId
        )
        return
      }

      const keepExistingBpm =
        (existing.bpm_source === 'tag' || existing.bpm_source === 'manual') &&
        existing.bpm !== null &&
        existing.bpm > 0
      const validPayloadBpm =
        payload.bpm !== null && Number.isFinite(payload.bpm) && payload.bpm > 0
          ? payload.bpm
          : null
      const nextBpm = keepExistingBpm ? existing.bpm : validPayloadBpm
      const nextBpmSource = keepExistingBpm
        ? existing.bpm_source
        : validPayloadBpm !== null
          ? (payload.bpmSource ?? 'analyzed')
          : null

      const keepExistingKey =
        (existing.key_source === 'tag' || existing.key_source === 'manual') &&
        existing.camelot_key !== null &&
        existing.camelot_key.trim() !== ''
      const validPayloadCamelot =
        payload.camelotKey && payload.camelotKey.trim() !== ''
          ? payload.camelotKey.trim()
          : null
      const nextMusicalKey = keepExistingKey ? existing.musical_key : payload.musicalKey
      const nextCamelotKey = keepExistingKey ? existing.camelot_key : validPayloadCamelot
      const nextKeySource = keepExistingKey
        ? existing.key_source
        : validPayloadCamelot !== null
          ? (payload.keySource ?? 'analyzed')
          : null

      const safeReplaygain = Number.isFinite(payload.replaygainDb) ? payload.replaygainDb : 0
      const safeEnergy = Number.isFinite(payload.energy) ? payload.energy : 0
      const safeIntro = Number.isFinite(payload.introCueSec) ? payload.introCueSec : 0
      const safeOutro = Number.isFinite(payload.outroCueSec) ? payload.outroCueSec : 0

      db.prepare(
        `UPDATE tracks
         SET bpm = ?,
             bpm_source = ?,
             musical_key = ?,
             camelot_key = ?,
             key_source = ?,
             replaygain_db = ?,
             energy = ?,
             waveform_peaks = ?,
             intro_cue_sec = ?,
             outro_cue_sec = ?,
             analysis_status = 'done'
         WHERE id = ?`
      ).run(
        nextBpm,
        nextBpmSource,
        nextMusicalKey,
        nextCamelotKey,
        nextKeySource,
        safeReplaygain,
        safeEnergy,
        JSON.stringify(Array.isArray(payload.waveformPeaks) ? payload.waveformPeaks : []),
        safeIntro,
        safeOutro,
        payload.trackId
      )
    },

    markMissing(trackId: number, isMissing: boolean): void {
      db.prepare('UPDATE tracks SET is_missing = ? WHERE id = ?').run(
        isMissing ? 1 : 0,
        trackId
      )
    },

    markMissingByFilePath(filePath: string, isMissing: boolean): boolean {
      const info = db
        .prepare('UPDATE tracks SET is_missing = ? WHERE file_path = ?')
        .run(isMissing ? 1 : 0, filePath)
      return info.changes > 0
    },

    markMissingExcept(folderId: number, existingFilePaths: string[]): number {
      return markMissingExceptTx(folderId, existingFilePaths)
    },

    updateMetadata(trackId: number, patch: TrackMetadataUpdateInput): TrackRecord | null {
      const existing = tracks.getById(trackId)
      if (!existing) return null

      let nextTitle = existing.title
      if (patch.title !== undefined) {
        const trimmedTitle = patch.title.trim()
        if (!trimmedTitle) {
          throw new Error('Track title cannot be empty')
        }
        nextTitle = trimmedTitle
      }

      let nextArtist = existing.artist
      if (patch.artist !== undefined) {
        nextArtist = patch.artist.trim() || 'Unknown Artist'
      }

      let nextAlbum = existing.album
      if (patch.album !== undefined) {
        nextAlbum = patch.album.trim() || 'Unknown Album'
      }

      const nextAlbumArtist =
        patch.albumArtist !== undefined
          ? patch.albumArtist?.trim()
            ? patch.albumArtist.trim()
            : null
          : existing.albumArtist

      const nextGenre =
        patch.genre !== undefined
          ? patch.genre?.trim()
            ? patch.genre.trim()
            : null
          : existing.genre

      let nextYear = existing.year
      if (patch.year !== undefined) {
        if (patch.year === null) {
          nextYear = null
        } else if (typeof patch.year === 'number' && Number.isFinite(patch.year)) {
          const floored = Math.floor(patch.year)
          nextYear = floored >= 1 && floored <= 9999 ? floored : null
        }
      }

      let nextTrackNumber = existing.trackNumber
      if (patch.trackNumber !== undefined) {
        if (patch.trackNumber === null) {
          nextTrackNumber = null
        } else if (typeof patch.trackNumber === 'number' && Number.isFinite(patch.trackNumber)) {
          const floored = Math.floor(patch.trackNumber)
          nextTrackNumber = floored >= 1 && floored <= 9999 ? floored : null
        }
      }

      const nextArtworkPath =
        patch.artworkPath !== undefined
          ? patch.artworkPath?.trim()
            ? patch.artworkPath.trim()
            : null
          : existing.artworkPath

      let nextBpm = existing.bpm
      let nextBpmSource = existing.bpmSource
      if (patch.bpm !== undefined) {
        if (patch.bpm === null || !Number.isFinite(patch.bpm)) {
          nextBpm = null
          nextBpmSource = null
        } else {
          const clampedBpm = Math.max(30, Math.min(300, patch.bpm))
          nextBpm = Math.round(clampedBpm * 10) / 10
          nextBpmSource = 'manual'
        }
      }

      let nextMusicalKey = existing.musicalKey
      let nextCamelotKey = existing.camelotKey
      let nextKeySource = existing.keySource
      if (patch.musicalKey !== undefined || patch.camelotKey !== undefined) {
        const rawCamelot = patch.camelotKey?.trim() ?? ''
        const rawMusical = patch.musicalKey?.trim() ?? ''
        if (!rawCamelot && !rawMusical) {
          nextMusicalKey = null
          nextCamelotKey = null
          nextKeySource = null
        } else {
          const normalizedCamelot =
            parseKeyToCamelot(rawCamelot) ?? parseKeyToCamelot(rawMusical)
          if (normalizedCamelot) {
            nextCamelotKey = normalizedCamelot
            nextMusicalKey =
              rawMusical || camelotToMusicalName(normalizedCamelot) || normalizedCamelot
            nextKeySource = 'manual'
          } else {
            nextMusicalKey = null
            nextCamelotKey = null
            nextKeySource = null
          }
        }
      }

      const editedAt = Date.now()
      db.prepare(
        `UPDATE tracks
         SET title = ?,
             artist = ?,
             album = ?,
             album_artist = ?,
             genre = ?,
             year = ?,
             track_number = ?,
             artwork_path = ?,
             bpm = ?,
             bpm_source = ?,
             musical_key = ?,
             camelot_key = ?,
             key_source = ?,
             metadata_edited_at = ?
         WHERE id = ?`
      ).run(
        nextTitle,
        nextArtist,
        nextAlbum,
        nextAlbumArtist,
        nextGenre,
        nextYear,
        nextTrackNumber,
        nextArtworkPath,
        nextBpm,
        nextBpmSource,
        nextMusicalKey,
        nextCamelotKey,
        nextKeySource,
        editedAt,
        trackId
      )

      return tracks.getById(trackId)
    },

    applyFileMetadata(trackId: number, meta: ExtractedTrackMetadata): TrackRecord | null {
      const existing = tracks.getById(trackId)
      if (!existing) return null

      const validBpm =
        meta.bpm != null && Number.isFinite(meta.bpm) && meta.bpm > 0 ? meta.bpm : null
      const bpmSource = validBpm !== null ? (meta.bpmSource ?? 'tag') : null
      const validCamelot = meta.camelotKey?.trim() ? meta.camelotKey.trim() : null
      const validMusicalKey =
        validCamelot !== null && meta.musicalKey?.trim() ? meta.musicalKey.trim() : null
      const keySource = validCamelot !== null ? (meta.keySource ?? 'tag') : null
      const safeDuration =
        typeof meta.duration === 'number' && Number.isFinite(meta.duration) ? meta.duration : 0

      db.prepare(
        `UPDATE tracks
         SET format = ?,
             title = ?,
             artist = ?,
             album = ?,
             album_artist = ?,
             genre = ?,
             year = ?,
             track_number = ?,
             duration = ?,
             artwork_path = ?,
             bpm = ?,
             bpm_source = ?,
             musical_key = ?,
             camelot_key = ?,
             key_source = ?,
             metadata_edited_at = NULL
         WHERE id = ?`
      ).run(
        meta.format,
        meta.title,
        meta.artist,
        meta.album,
        meta.albumArtist ?? null,
        meta.genre ?? null,
        meta.year ?? null,
        meta.trackNumber ?? null,
        safeDuration,
        meta.artworkPath ?? null,
        validBpm,
        bpmSource,
        validMusicalKey,
        validCamelot,
        keySource,
        trackId
      )

      return tracks.getById(trackId)
    },

    toggleLike(trackId: number, liked?: boolean): TrackRecord | null {
      const existing = db
        .prepare('SELECT id, liked_at FROM tracks WHERE id = ?')
        .get(trackId) as { id: number; liked_at: number | null } | undefined
      if (!existing) return null

      const shouldLike = typeof liked === 'boolean' ? liked : existing.liked_at == null
      const nextLikedAt = shouldLike ? Date.now() : null
      db.prepare('UPDATE tracks SET liked_at = ? WHERE id = ?').run(nextLikedAt, trackId)
      return tracks.getById(trackId)
    }
  }

  const playlistSelectSql = `
    SELECT p.id, p.name, p.description, p.created_at, p.updated_at,
           COUNT(CASE WHEN t.id IS NOT NULL AND t.is_missing = 0 THEN 1 END) AS track_count
    FROM playlists p
    LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
    LEFT JOIN tracks t ON t.id = pt.track_id
  `

  const addPlaylistTrackTx = db.transaction((playlistId: number, trackId: number) => {
    const exists = db
      .prepare('SELECT 1 FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?')
      .get(playlistId, trackId)
    if (exists) return

    const row = db
      .prepare(
        'SELECT COALESCE(MAX(position), -1) + 1 AS next_pos FROM playlist_tracks WHERE playlist_id = ?'
      )
      .get(playlistId) as { next_pos: number }

    const now = Date.now()
    db.prepare(
      'INSERT INTO playlist_tracks (playlist_id, track_id, position, added_at) VALUES (?, ?, ?, ?)'
    ).run(playlistId, trackId, row.next_pos, now)
    db.prepare('UPDATE playlists SET updated_at = ? WHERE id = ?').run(now, playlistId)
  })

  const removePlaylistTrackTx = db.transaction((playlistId: number, trackId: number) => {
    const info = db
      .prepare('DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?')
      .run(playlistId, trackId)
    if (info.changes === 0) return

    const remaining = db
      .prepare(
        'SELECT track_id FROM playlist_tracks WHERE playlist_id = ? ORDER BY position ASC'
      )
      .all(playlistId) as Array<{ track_id: number }>

    const updatePos = db.prepare(
      'UPDATE playlist_tracks SET position = ? WHERE playlist_id = ? AND track_id = ?'
    )
    remaining.forEach((row, index) => {
      updatePos.run(index, playlistId, row.track_id)
    })
    db.prepare('UPDATE playlists SET updated_at = ? WHERE id = ?').run(Date.now(), playlistId)
  })

  const reorderPlaylistTracksTx = db.transaction(
    (playlistId: number, orderedTrackIds: number[]) => {
      const existingRows = db
        .prepare(
          'SELECT track_id FROM playlist_tracks WHERE playlist_id = ? ORDER BY position ASC'
        )
        .all(playlistId) as Array<{ track_id: number }>
      const existingSet = new Set(existingRows.map((r) => r.track_id))

      const finalOrder: number[] = []
      const seen = new Set<number>()

      for (const trackId of orderedTrackIds) {
        if (existingSet.has(trackId) && !seen.has(trackId)) {
          finalOrder.push(trackId)
          seen.add(trackId)
        }
      }
      for (const row of existingRows) {
        if (!seen.has(row.track_id)) {
          finalOrder.push(row.track_id)
          seen.add(row.track_id)
        }
      }

      const updatePos = db.prepare(
        'UPDATE playlist_tracks SET position = ? WHERE playlist_id = ? AND track_id = ?'
      )
      finalOrder.forEach((trackId, index) => {
        updatePos.run(index, playlistId, trackId)
      })
      db.prepare('UPDATE playlists SET updated_at = ? WHERE id = ?').run(Date.now(), playlistId)
    }
  )

  const playlists = {
    list(): PlaylistRecord[] {
      const rows = db
        .prepare(`${playlistSelectSql} GROUP BY p.id ORDER BY p.updated_at DESC, p.id DESC`)
        .all() as PlaylistRow[]
      return rows.map(mapPlaylistRow)
    },

    getById(playlistId: number): PlaylistRecord | null {
      const row = db
        .prepare(`${playlistSelectSql} WHERE p.id = ? GROUP BY p.id`)
        .get(playlistId) as PlaylistRow | undefined
      return row ? mapPlaylistRow(row) : null
    },

    create(name: string, description?: string | null): PlaylistRecord {
      const cleanName = name.trim() || 'Untitled Playlist'
      const cleanDesc = description?.trim() ? description.trim() : null
      const now = Date.now()
      const info = db
        .prepare(
          'INSERT INTO playlists (name, description, created_at, updated_at) VALUES (?, ?, ?, ?)'
        )
        .run(cleanName, cleanDesc, now, now)
      return playlists.getById(Number(info.lastInsertRowid))!
    },

    rename(playlistId: number, name: string, description?: string | null): PlaylistRecord | null {
      const existing = playlists.getById(playlistId)
      if (!existing) return null

      const cleanName = name.trim() || existing.name
      const nextDesc =
        description === undefined
          ? existing.description
          : description?.trim()
            ? description.trim()
            : null

      db.prepare(
        'UPDATE playlists SET name = ?, description = ?, updated_at = ? WHERE id = ?'
      ).run(cleanName, nextDesc, Date.now(), playlistId)

      return playlists.getById(playlistId)
    },

    delete(playlistId: number): void {
      db.prepare('DELETE FROM playlists WHERE id = ?').run(playlistId)
    },

    addTrack(playlistId: number, trackId: number): void {
      addPlaylistTrackTx(playlistId, trackId)
    },

    removeTrack(playlistId: number, trackId: number): void {
      removePlaylistTrackTx(playlistId, trackId)
    },

    reorderTracks(playlistId: number, orderedTrackIds: number[]): void {
      reorderPlaylistTracksTx(playlistId, orderedTrackIds)
    }
  }

  const recordPlayTx = db.transaction((entry: PlayHistoryInput): PlayHistoryRecord => {
    const playedAt = Date.now()
    const info = db
      .prepare(
        `INSERT INTO play_history (track_id, played_at, duration_played_sec, was_skipped_early, source)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        entry.trackId,
        playedAt,
        entry.durationPlayedSec,
        entry.wasSkippedEarly ? 1 : 0,
        entry.source
      )

    db.prepare(
      'UPDATE tracks SET play_count = play_count + 1, last_played_at = ? WHERE id = ?'
    ).run(playedAt, entry.trackId)

    return {
      id: Number(info.lastInsertRowid),
      trackId: entry.trackId,
      playedAt,
      durationPlayedSec: entry.durationPlayedSec,
      wasSkippedEarly: entry.wasSkippedEarly,
      source: entry.source
    }
  })

  const history = {
    recordPlay(entry: PlayHistoryInput): PlayHistoryRecord {
      return recordPlayTx(entry)
    },

    getRecent(limit = 50): PlayHistoryRecord[] {
      const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)))
      const rows = db
        .prepare(
          `SELECT id, track_id, played_at, duration_played_sec, was_skipped_early, source
           FROM play_history
           ORDER BY played_at DESC, id DESC
           LIMIT ?`
        )
        .all(safeLimit) as HistoryRow[]
      return rows.map(mapHistoryRow)
    }
  }

  const settings = {
    getRaw<T>(key: string): T | null {
      const row = db
        .prepare('SELECT value FROM app_settings WHERE key = ?')
        .get(key) as { value: string } | undefined
      if (!row) return null
      try {
        return JSON.parse(row.value) as T
      } catch {
        return null
      }
    },

    setRaw(key: string, value: unknown): void {
      db.prepare(
        `INSERT INTO app_settings (key, value)
         VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      ).run(key, JSON.stringify(value))
    },

    getAll(): AppSettings {
      const rows = db
        .prepare('SELECT key, value FROM app_settings')
        .all() as Array<{ key: string; value: string }>

      const parsed: Record<string, unknown> = {}
      for (const row of rows) {
        try {
          parsed[row.key] = JSON.parse(row.value)
        } catch {
          // Ignore malformed JSON values and fall back to defaults.
        }
      }

      const rawAutoDj = parsed.autoDj
      const autoDj: AutoDjConfig =
        rawAutoDj && typeof rawAutoDj === 'object'
          ? { ...DEFAULT_AUTO_DJ_CONFIG, ...(rawAutoDj as Partial<AutoDjConfig>) }
          : { ...DEFAULT_AUTO_DJ_CONFIG }

      const rawRepeatMode = parsed.repeatMode
      const repeatMode: RepeatMode =
        rawRepeatMode === 'off' || rawRepeatMode === 'all' || rawRepeatMode === 'one'
          ? rawRepeatMode
          : DEFAULT_APP_SETTINGS.repeatMode

      const rawAudio = parsed.audio
      const mergedAudio =
        rawAudio && typeof rawAudio === 'object'
          ? { ...DEFAULT_AUDIO_SETTINGS, ...(rawAudio as Partial<AudioSettings>) }
          : { ...DEFAULT_AUDIO_SETTINGS }
      const audio: AudioSettings = {
        replayGainEnabled:
          typeof mergedAudio.replayGainEnabled === 'boolean'
            ? mergedAudio.replayGainEnabled
            : DEFAULT_AUDIO_SETTINGS.replayGainEnabled,
        limiterEnabled:
          typeof mergedAudio.limiterEnabled === 'boolean'
            ? mergedAudio.limiterEnabled
            : DEFAULT_AUDIO_SETTINGS.limiterEnabled,
        seekStepSec:
          typeof mergedAudio.seekStepSec === 'number' && Number.isFinite(mergedAudio.seekStepSec)
            ? Math.max(1, Math.min(30, Math.round(mergedAudio.seekStepSec)))
            : DEFAULT_AUDIO_SETTINGS.seekStepSec,
        manualCrossfadeSec:
          typeof mergedAudio.manualCrossfadeSec === 'number' &&
          Number.isFinite(mergedAudio.manualCrossfadeSec)
            ? Math.max(0.25, Math.min(8, Number(mergedAudio.manualCrossfadeSec.toFixed(2))))
            : DEFAULT_AUDIO_SETTINGS.manualCrossfadeSec
      }

      const rawAppearance = parsed.appearance
      const mergedAppearance =
        rawAppearance && typeof rawAppearance === 'object'
          ? { ...DEFAULT_APPEARANCE_SETTINGS, ...(rawAppearance as Partial<AppearanceSettings>) }
          : { ...DEFAULT_APPEARANCE_SETTINGS }
      const appearance: AppearanceSettings = {
        dynamicThemeEnabled:
          typeof mergedAppearance.dynamicThemeEnabled === 'boolean'
            ? mergedAppearance.dynamicThemeEnabled
            : DEFAULT_APPEARANCE_SETTINGS.dynamicThemeEnabled,
        customAccentRgb:
          typeof mergedAppearance.customAccentRgb === 'string' &&
          mergedAppearance.customAccentRgb.trim() !== ''
            ? mergedAppearance.customAccentRgb.trim()
            : DEFAULT_APPEARANCE_SETTINGS.customAccentRgb,
        customAccentGlowRgb:
          typeof mergedAppearance.customAccentGlowRgb === 'string' &&
          mergedAppearance.customAccentGlowRgb.trim() !== ''
            ? mergedAppearance.customAccentGlowRgb.trim()
            : DEFAULT_APPEARANCE_SETTINGS.customAccentGlowRgb,
        showWaveformCues:
          typeof mergedAppearance.showWaveformCues === 'boolean'
            ? mergedAppearance.showWaveformCues
            : DEFAULT_APPEARANCE_SETTINGS.showWaveformCues,
        reducedEffects:
          typeof mergedAppearance.reducedEffects === 'boolean'
            ? mergedAppearance.reducedEffects
            : DEFAULT_APPEARANCE_SETTINGS.reducedEffects
      }

      const rawLibrary = parsed.library
      const mergedLibrary =
        rawLibrary && typeof rawLibrary === 'object'
          ? { ...DEFAULT_LIBRARY_SETTINGS, ...(rawLibrary as Partial<LibrarySettings>) }
          : { ...DEFAULT_LIBRARY_SETTINGS }
      const library: LibrarySettings = {
        autoAnalyzeEnabled:
          typeof mergedLibrary.autoAnalyzeEnabled === 'boolean'
            ? mergedLibrary.autoAnalyzeEnabled
            : DEFAULT_LIBRARY_SETTINGS.autoAnalyzeEnabled,
        earlySkipThresholdSec:
          typeof mergedLibrary.earlySkipThresholdSec === 'number' &&
          Number.isFinite(mergedLibrary.earlySkipThresholdSec)
            ? Math.max(5, Math.min(60, Math.round(mergedLibrary.earlySkipThresholdSec)))
            : DEFAULT_LIBRARY_SETTINGS.earlySkipThresholdSec,
        autoFetchLyrics:
          typeof mergedLibrary.autoFetchLyrics === 'boolean'
            ? mergedLibrary.autoFetchLyrics
            : DEFAULT_LIBRARY_SETTINGS.autoFetchLyrics
      }

      return {
        volume:
          typeof parsed.volume === 'number' && Number.isFinite(parsed.volume)
            ? Math.max(0, Math.min(1, parsed.volume))
            : DEFAULT_APP_SETTINGS.volume,
        muted:
          typeof parsed.muted === 'boolean' ? parsed.muted : DEFAULT_APP_SETTINGS.muted,
        shuffle:
          typeof parsed.shuffle === 'boolean' ? parsed.shuffle : DEFAULT_APP_SETTINGS.shuffle,
        repeatMode,
        autoDj,
        audio,
        appearance,
        library,
        sidebarCollapsed:
          typeof parsed.sidebarCollapsed === 'boolean'
            ? parsed.sidebarCollapsed
            : DEFAULT_APP_SETTINGS.sidebarCollapsed,
        autoCheckUpdates:
          typeof parsed.autoCheckUpdates === 'boolean'
            ? parsed.autoCheckUpdates
            : DEFAULT_APP_SETTINGS.autoCheckUpdates
      }
    },

    set<K extends keyof AppSettings>(key: K, value: AppSettings[K]): AppSettings {
      settings.setRaw(key, value)
      return settings.getAll()
    }
  }

  const lyrics = {
    get(trackId: number): TrackLyricsRecord | null {
      const row = db
        .prepare(
          `SELECT track_id, synced_lyrics, plain_lyrics, source,
                  provider_track_name, provider_artist_name, is_instrumental, offset_ms, updated_at
           FROM track_lyrics
           WHERE track_id = ?`
        )
        .get(trackId) as TrackLyricsRow | undefined
      return row ? mapLyricsRow(row) : null
    },

    save(
      input: SaveLyricsInput & {
        providerTrackName?: string | null
        providerArtistName?: string | null
      }
    ): TrackLyricsRecord {
      const syncedLyrics = input.syncedLyrics?.trim() ? input.syncedLyrics.trim() : null
      const plainLyrics = input.plainLyrics?.trim() ? input.plainLyrics.trim() : null
      const source = normalizeLyricsSource(input.source)
      const providerTrackName = input.providerTrackName?.trim()
        ? input.providerTrackName.trim()
        : null
      const providerArtistName = input.providerArtistName?.trim()
        ? input.providerArtistName.trim()
        : null
      const isInstrumental = input.isInstrumental ? 1 : 0
      const offsetMs = typeof input.offsetMs === 'number' ? clampLyricsOffsetMs(input.offsetMs) : 0
      const updatedAt = Date.now()

      db.prepare(
        `INSERT INTO track_lyrics (
           track_id, synced_lyrics, plain_lyrics, source,
           provider_track_name, provider_artist_name, is_instrumental, offset_ms, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(track_id) DO UPDATE SET
           synced_lyrics = excluded.synced_lyrics,
           plain_lyrics = excluded.plain_lyrics,
           source = excluded.source,
           provider_track_name = excluded.provider_track_name,
           provider_artist_name = excluded.provider_artist_name,
           is_instrumental = excluded.is_instrumental,
           offset_ms = excluded.offset_ms,
           updated_at = excluded.updated_at`
      ).run(
        input.trackId,
        syncedLyrics,
        plainLyrics,
        source,
        providerTrackName,
        providerArtistName,
        isInstrumental,
        offsetMs,
        updatedAt
      )

      return lyrics.get(input.trackId)!
    },

    updateOffset(trackId: number, offsetMs: number): TrackLyricsRecord | null {
      const existing = lyrics.get(trackId)
      if (!existing) return null

      const clamped = clampLyricsOffsetMs(offsetMs)
      db.prepare('UPDATE track_lyrics SET offset_ms = ?, updated_at = ? WHERE track_id = ?').run(
        clamped,
        Date.now(),
        trackId
      )
      return lyrics.get(trackId)
    },

    delete(trackId: number): void {
      db.prepare('DELETE FROM track_lyrics WHERE track_id = ?').run(trackId)
    }
  }

  return { folders, tracks, playlists, history, settings, lyrics }
}

export type Repositories = ReturnType<typeof createRepositories>
