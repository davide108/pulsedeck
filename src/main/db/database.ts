import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  last_scanned_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tracks (
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
  added_at INTEGER NOT NULL,
  metadata_edited_at INTEGER,
  liked_at INTEGER
);

CREATE TABLE IF NOT EXISTS track_lyrics (
  track_id INTEGER PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
  synced_lyrics TEXT,
  plain_lyrics TEXT,
  source TEXT NOT NULL,
  provider_track_name TEXT,
  provider_artist_name TEXT,
  is_instrumental INTEGER NOT NULL DEFAULT 0,
  offset_ms INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS playlists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS playlist_tracks (
  playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (playlist_id, track_id)
);

CREATE TABLE IF NOT EXISTS play_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  played_at INTEGER NOT NULL,
  duration_played_sec REAL NOT NULL,
  was_skipped_early INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tracks_folder_id ON tracks(folder_id);
CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist);
CREATE INDEX IF NOT EXISTS idx_tracks_album ON tracks(album);
CREATE INDEX IF NOT EXISTS idx_tracks_genre ON tracks(genre);
CREATE INDEX IF NOT EXISTS idx_tracks_bpm ON tracks(bpm);
CREATE INDEX IF NOT EXISTS idx_tracks_camelot_key ON tracks(camelot_key);
CREATE INDEX IF NOT EXISTS idx_tracks_energy ON tracks(energy);
CREATE INDEX IF NOT EXISTS idx_tracks_added_at ON tracks(added_at);
CREATE INDEX IF NOT EXISTS idx_tracks_play_count ON tracks(play_count);
CREATE INDEX IF NOT EXISTS idx_tracks_analysis_status ON tracks(analysis_status);
CREATE INDEX IF NOT EXISTS idx_playlist_tracks_order ON playlist_tracks(playlist_id, position);
CREATE INDEX IF NOT EXISTS idx_play_history_played_at ON play_history(played_at);
`

/**
 * Opens or creates the PulseDeck SQLite database, configures WAL and integrity PRAGMAs,
 * and ensures all required tables and indexes exist.
 */
export function createDatabase(dbPath: string): Database.Database {
  if (dbPath !== ':memory:' && !dbPath.startsWith('file:')) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  }

  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('synchronous = NORMAL')
  db.pragma('busy_timeout = 5000')
  db.exec(SCHEMA_SQL)

  const trackColumns = db.prepare('PRAGMA table_info(tracks)').all() as Array<{ name: string }>
  if (!trackColumns.some((column) => column.name === 'metadata_edited_at')) {
    db.exec('ALTER TABLE tracks ADD COLUMN metadata_edited_at INTEGER')
  }
  if (!trackColumns.some((column) => column.name === 'liked_at')) {
    db.exec('ALTER TABLE tracks ADD COLUMN liked_at INTEGER')
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_tracks_liked_at ON tracks(liked_at)')

  return db
}
