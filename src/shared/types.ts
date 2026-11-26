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
  includeWaveformPeaks?: boolean
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

export interface DeckEqKillState {
  low: boolean
  mid: boolean
  high: boolean
}

export type LoopBeats = 4 | 8 | 16

export interface DeckTelemetry {
  deckId: DeckId
  track: TrackRecord | null
  status: 'idle' | 'loading' | 'playing' | 'paused' | 'fading-in' | 'fading-out'
  currentTime: number
  duration: number
  playbackRate: number
  crossfadeGain: number
  normalizationGain: number
  channelGain: number
  eq: DeckEqState
  eqKill: DeckEqKillState
  filterValue: number
  cuePointSec: number
  loopEnabled: boolean
  loopBeats: LoopBeats
  loopStartSec: number | null
  loopEndSec: number | null
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
  reducedEffects: boolean
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
  showWaveformCues: true,
  reducedEffects: false
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

function clampNumeric(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function computeSyncRate(
  sourceBpm: number | null,
  targetBpm: number | null,
  maxShiftPct = 12
): number {
  if (
    sourceBpm === null ||
    targetBpm === null ||
    !Number.isFinite(sourceBpm) ||
    !Number.isFinite(targetBpm) ||
    sourceBpm <= 0 ||
    targetBpm <= 0
  ) {
    return 1
  }

  const multiples = [1, 0.5, 2]
  let bestRate = 1
  let bestWeightedDiff = Infinity

  for (const mult of multiples) {
    const candidateRate = (targetBpm * mult) / sourceBpm
    // Slight tie-breaker preference for direct 1x match
    const weightedDiff = Math.abs(candidateRate - 1) + (mult === 1 ? 0 : 1e-6)
    if (weightedDiff < bestWeightedDiff) {
      bestWeightedDiff = weightedDiff
      bestRate = candidateRate
    }
  }

  const safeMaxShift = Number.isFinite(maxShiftPct) ? Math.max(0, maxShiftPct) / 100 : 0.12
  const minRate = Math.max(0.05, 1 - safeMaxShift)
  const maxRate = 1 + safeMaxShift
  return Number(clampNumeric(bestRate, minRate, maxRate).toFixed(4))
}

export function computeLoopWindow(
  anchorSec: number,
  bpm: number | null,
  beats: number,
  duration: number
): { startSec: number; endSec: number } {
  if (!Number.isFinite(duration) || duration <= 0) {
    return { startSec: 0, endSec: 0 }
  }

  const safeBeats = Number.isFinite(beats) && beats > 0 ? beats : 8
  const beatSec =
    bpm !== null && Number.isFinite(bpm) && bpm > 0 ? 60 / bpm : 0.5
  const rawLoopLen = beatSec * safeBeats
  const loopLen = Math.min(rawLoopLen, duration)

  const rawAnchor = Number.isFinite(anchorSec) ? anchorSec : 0
  const maxStart = Math.max(0, duration - loopLen)
  const startSec = clampNumeric(rawAnchor, 0, maxStart)
  const endSec = clampNumeric(startSec + loopLen, startSec, duration)

  return {
    startSec: Number(startSec.toFixed(4)),
    endSec: Number(endSec.toFixed(4))
  }
}

export function mapFilterValueToBiquad(value: number): {
  type: 'lowpass' | 'highpass' | 'allpass'
  frequency: number
  q: number
} {
  const v = clampNumeric(Number.isFinite(value) ? value : 0, -1, 1)
  if (Math.abs(v) < 0.02) {
    return { type: 'allpass', frequency: 1000, q: 0.707 }
  }

  const q = Number((0.707 + Math.abs(v) * 2.3).toFixed(3))
  if (v < 0) {
    // -1 -> 120 Hz, 0 -> 18000 Hz (smooth log-scale sweep)
    const t = 1 + v
    const frequency = 120 * Math.pow(18000 / 120, t)
    return {
      type: 'lowpass',
      frequency: Number(frequency.toFixed(1)),
      q
    }
  }

  // 0 -> 60 Hz, +1 -> 8000 Hz (smooth log-scale sweep)
  const frequency = 60 * Math.pow(8000 / 60, v)
  return {
    type: 'highpass',
    frequency: Number(frequency.toFixed(1)),
    q
  }
}

export function computeEqualPowerCrossfadeGains(position: number): {
  gainA: number
  gainB: number
} {
  const pos = clampNumeric(Number.isFinite(position) ? position : 0.5, 0, 1)
  const rawA = Math.cos(pos * Math.PI * 0.5)
  const rawB = Math.sin(pos * Math.PI * 0.5)
  const gainA = rawA < 1e-6 ? 0 : Number(rawA.toFixed(6))
  const gainB = rawB < 1e-6 ? 0 : Number(rawB.toFixed(6))
  return { gainA, gainB }
}
