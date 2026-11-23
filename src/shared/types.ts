export type AudioFormat = 'mp3' | 'flac' | 'wav' | 'ogg' | 'm4a' | 'aac' | 'opus'

export type AnalysisStatus = 'pending' | 'done' | 'failed'

export type SmartViewId = 'all' | 'recently_added' | 'most_played' | 'high_energy'

export type LibraryView =
  | 'tracks'
  | 'albums'
  | 'artists'
  | 'folders'
  | 'playlist'
  | 'smart'
  | 'autodj'
  | 'settings'

export type RepeatMode = 'off' | 'all' | 'one'

export type MixStyle = 'equal-power' | 'bass-swap' | 'quick-cut'

export type TransitionDurationMode = 'fixed' | 'bars'

export type AutoDjScope =
  | { type: 'library' }
  | { type: 'folder'; folderId: number }
  | { type: 'playlist'; playlistId: number }

export interface FolderRecord {
  id: number
  path: string
  name: string
  isActive: boolean
  lastScannedAt: number | null
  createdAt: number
  trackCount?: number
}

export interface TrackRecord {
  id: number
  folderId: number
  filePath: string
  fileSize: number
  fileMtime: number
  format: AudioFormat
  title: string
  artist: string
  album: string
  albumArtist: string | null
  genre: string | null
  year: number | null
  trackNumber: number | null
  duration: number
  artworkPath: string | null
  bpm: number | null
  bpmSource: 'tag' | 'analyzed' | 'manual' | null
  musicalKey: string | null
  camelotKey: string | null
  keySource: 'tag' | 'analyzed' | 'manual' | null
  replaygainDb: number | null
  energy: number | null
  waveformPeaks: number[] | null
  introCueSec: number | null
  outroCueSec: number | null
  analysisStatus: AnalysisStatus
  isMissing: boolean
  playCount: number
  lastPlayedAt: number | null
  addedAt: number
  metadataEditedAt?: number | null
}

export interface TrackMetadataUpdateInput {
  title?: string
  artist?: string
  album?: string
  albumArtist?: string | null
  genre?: string | null
  year?: number | null
  trackNumber?: number | null
  bpm?: number | null
  musicalKey?: string | null
  camelotKey?: string | null
  artworkPath?: string | null
}

export interface TrackTechnicalInfo {
  trackId: number
  filePath: string
  fileExists: boolean
  fileSize: number
  container: string | null
  codec: string | null
  codecProfile: string | null
  bitrate: number | null
  sampleRate: number | null
  bitsPerSample: number | null
  numberOfChannels: number | null
  lossless: boolean | null
  duration: number
  hasEmbeddedLyrics: boolean
}

export type LyricsSource = 'lrclib' | 'embedded' | 'sidecar' | 'user'

export interface LyricsLine {
  timeSec: number
  text: string
}

export interface TrackLyricsRecord {
  trackId: number
  syncedLyrics: string | null
  plainLyrics: string | null
  source: LyricsSource
  providerTrackName: string | null
  providerArtistName: string | null
  isInstrumental: boolean
  offsetMs: number
  updatedAt: number
}

export interface LyricsFetchOptions {
  forceRefresh?: boolean
  allowOnline?: boolean
  customTitle?: string
  customArtist?: string
}

export interface SaveLyricsInput {
  trackId: number
  syncedLyrics: string | null
  plainLyrics: string | null
  source?: LyricsSource
  isInstrumental?: boolean
  offsetMs?: number
}

export interface TrackQueryFilter {
  search?: string
  genre?: string | null
  camelotKey?: string | null
  bpmMin?: number | null
  bpmMax?: number | null
  folderId?: number | null
  playlistId?: number | null
  smartView?: SmartViewId | null
  includeMissing?: boolean
  sortBy?:
    | 'title'
    | 'artist'
    | 'album'
    | 'bpm'
    | 'camelot_key'
    | 'energy'
    | 'duration'
    | 'added_at'
    | 'play_count'
  sortDir?: 'asc' | 'desc'
}

export interface LibraryFacets {
  genres: string[]
  keys: string[]
  minBpm: number | null
  maxBpm: number | null
  totalTracks: number
  analyzedTracks: number
}

export interface PlaylistRecord {
  id: number
  name: string
  description: string | null
  trackCount: number
  createdAt: number
  updatedAt: number
}

export interface PlayHistoryInput {
  trackId: number
  durationPlayedSec: number
  wasSkippedEarly: boolean
  source: 'manual' | 'autodj'
}

export type PlayHistoryRecord = PlayHistoryInput & {
  id: number
  playedAt: number
}

export interface TrackAnalysisPayload {
  trackId: number
  bpm: number | null
  bpmSource: 'tag' | 'analyzed' | 'manual' | null
  musicalKey: string | null
  camelotKey: string | null
  keySource: 'tag' | 'analyzed' | 'manual' | null
  replaygainDb: number
  energy: number
  waveformPeaks: number[]
  introCueSec: number
  outroCueSec: number
  status: 'done' | 'failed'
}

export interface ScanProgressEvent {
  folderId: number
  folderName: string
  scanned: number
  total: number
  added: number
  updated: number
  missing: number
  phase: 'discovering' | 'indexing' | 'done' | 'error'
  message?: string
}

export type MediaCommand = 'play-pause' | 'next' | 'previous' | 'stop'

export type DeckId = 'A' | 'B'

export interface DeckEqState {
  low: number
  mid: number
  high: number
}

export interface DeckTelemetry {
  deckId: DeckId
  track: TrackRecord | null
  status: 'idle' | 'loading' | 'playing' | 'paused' | 'fading-in' | 'fading-out'
  currentTime: number
  duration: number
  playbackRate: number
  crossfadeGain: number
  normalizationGain: number
  eq: DeckEqState
}

export interface TransitionTelemetry {
  active: boolean
  style: MixStyle
  progress: number
  durationSec: number
  fromDeck: DeckId
  toDeck: DeckId
  bpmDeltaPct: number | null
  tempoMatched: boolean
  keyCompatibilityLabel: string | null
}

export interface AutoDjConfig {
  enabled: boolean
  mixStyle: MixStyle
  durationMode: TransitionDurationMode
  durationSec: number
  durationBars: 4 | 8 | 16
  tempoMatchEnabled: boolean
  tempoMatchMaxPct: number
  scope: AutoDjScope
}

export interface AutoDjQueueItem {
  track: TrackRecord
  locked: boolean
  score: number
  bpmScore: number
  harmonicScore: number
  flowScore: number
  matchReason: string
  tempoRelation: 'exact' | 'half' | 'double' | 'close' | 'free'
  harmonicRelation: string
}

export interface ThemePalette {
  accentRgb: string
  accentGlowRgb: string
  isDefault: boolean
}

export interface AudioSettings {
  replayGainEnabled: boolean
  limiterEnabled: boolean
  seekStepSec: number
  manualCrossfadeSec: number
}

export interface AppearanceSettings {
  dynamicThemeEnabled: boolean
  customAccentRgb: string
  customAccentGlowRgb: string
  showWaveformCues: boolean
}

export interface LibrarySettings {
  autoAnalyzeEnabled: boolean
  earlySkipThresholdSec: number
  autoFetchLyrics: boolean
}

export interface AccentPreset {
  id: string
  name: string
  accentRgb: string
  accentGlowRgb: string
}

export const ACCENT_PRESETS: AccentPreset[] = [
  {
    id: 'indigo',
    name: 'Electric Indigo',
    accentRgb: '99 102 241',
    accentGlowRgb: '56 189 248'
  },
  {
    id: 'cyan',
    name: 'Neon Cyan',
    accentRgb: '6 182 212',
    accentGlowRgb: '129 140 248'
  },
  {
    id: 'emerald',
    name: 'Emerald Pulse',
    accentRgb: '16 185 129',
    accentGlowRgb: '52 211 153'
  },
  {
    id: 'amber',
    name: 'Sunset Amber',
    accentRgb: '245 158 11',
    accentGlowRgb: '251 113 133'
  },
  {
    id: 'rose',
    name: 'Crimson Rose',
    accentRgb: '244 63 94',
    accentGlowRgb: '251 146 60'
  },
  {
    id: 'violet',
    name: 'Violet Glow',
    accentRgb: '168 85 247',
    accentGlowRgb: '236 72 153'
  }
]

export interface AppSettings {
  volume: number
  muted: boolean
  shuffle: boolean
  repeatMode: RepeatMode
  autoDj: AutoDjConfig
  audio: AudioSettings
  appearance: AppearanceSettings
  library: LibrarySettings
  sidebarCollapsed: boolean
  autoCheckUpdates: boolean
}

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export interface UpdateState {
  status: UpdateStatus
  currentVersion: string
  latestVersion: string | null
  releaseName: string | null
  releaseDate: string | null
  releaseNotes: string | null
  releaseUrl: string | null
  downloadPercent: number
  bytesPerSecond: number
  transferredBytes: number
  totalBytes: number
  canAutoInstall: boolean
  checkedAt: number | null
  error: string | null
}

export interface WindowStateEvent {
  isMaximized: boolean
  isMiniPlayer: boolean
}

export const DEFAULT_AUTO_DJ_CONFIG: AutoDjConfig = {
  enabled: false,
  mixStyle: 'equal-power',
  durationMode: 'fixed',
  durationSec: 8,
  durationBars: 8,
  tempoMatchEnabled: true,
  tempoMatchMaxPct: 6,
  scope: { type: 'library' }
}

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  replayGainEnabled: true,
  limiterEnabled: true,
  seekStepSec: 5,
  manualCrossfadeSec: 1.75
}

export const DEFAULT_APPEARANCE_SETTINGS: AppearanceSettings = {
  dynamicThemeEnabled: true,
  customAccentRgb: '99 102 241',
  customAccentGlowRgb: '56 189 248',
  showWaveformCues: true
}

export const DEFAULT_LIBRARY_SETTINGS: LibrarySettings = {
  autoAnalyzeEnabled: true,
  earlySkipThresholdSec: 20,
  autoFetchLyrics: true
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  volume: 0.85,
  muted: false,
  shuffle: false,
  repeatMode: 'off',
  autoDj: DEFAULT_AUTO_DJ_CONFIG,
  audio: DEFAULT_AUDIO_SETTINGS,
  appearance: DEFAULT_APPEARANCE_SETTINGS,
  library: DEFAULT_LIBRARY_SETTINGS,
  sidebarCollapsed: false,
  autoCheckUpdates: true
}

export const DEFAULT_THEME_PALETTE: ThemePalette = {
  accentRgb: '99 102 241',
  accentGlowRgb: '56 189 248',
  isDefault: true
}
