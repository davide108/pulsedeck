import fs from 'node:fs'
import path from 'node:path'
import type { ILyricsTag } from 'music-metadata'
import { parseKeyToCamelot } from '../../shared/camelot'
import { formatTimestampLrc, isSyncedLrc, stripLrcTimestamps } from '../../shared/lrcParser'
import type { AudioFormat, TrackRecord, TrackTechnicalInfo } from '../../shared/types'
import type { ArtworkCache } from './artworkCache'

export const SUPPORTED_AUDIO_EXTENSIONS = new Set<string>([
  '.mp3',
  '.flac',
  '.wav',
  '.ogg',
  '.m4a',
  '.aac',
  '.opus'
])

export interface ParsedFilenameMetadata {
  artist: string
  title: string
  trackNumber: number | null
}

export interface ExtractedTrackMetadata {
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
  bpmSource: 'tag' | null
  musicalKey: string | null
  camelotKey: string | null
  keySource: 'tag' | null
}

function extensionToAudioFormat(filePath: string): AudioFormat {
  const ext = path.extname(filePath).toLowerCase().replace(/^\./, '')
  switch (ext) {
    case 'flac':
    case 'wav':
    case 'ogg':
    case 'm4a':
    case 'aac':
    case 'opus':
      return ext
    default:
      return 'mp3'
  }
}

/**
 * Pure filename parser used as a fallback when embedded tags are missing or unreadable.
 * Handles formats like:
 * - "01 - Artist - Title.mp3"
 * - "02. Artist - Title.flac"
 * - "Artist - Title (Extended Mix).opus"
 * - "Title_Name.wav"
 */
export function parseFilenameFallback(filePath: string): ParsedFilenameMetadata {
  const fileName = filePath.split(/[/\\]/).pop() ?? filePath
  const ext = path.extname(fileName)
  const rawBase = ext ? fileName.slice(0, -ext.length) : fileName
  const cleaned = rawBase.replace(/_/g, ' ').replace(/\s+/g, ' ').trim()

  if (!cleaned) {
    return {
      artist: 'Unknown Artist',
      title: 'Unknown Title',
      trackNumber: null
    }
  }

  let trackNumber: number | null = null
  let remainder = cleaned

  const numPrefix = /^(?:(\d{1,3})\s*[.)\-]+\s*|(\d{1,2})\s+)(.+)$/.exec(cleaned)
  if (numPrefix) {
    const rawNum = numPrefix[1] ?? numPrefix[2]
    const parsedNum = Number.parseInt(rawNum, 10)
    if (Number.isFinite(parsedNum) && parsedNum >= 1 && parsedNum <= 199) {
      trackNumber = parsedNum
      remainder = numPrefix[3].trim()
    }
  }

  const parts = remainder
    .split(/\s+-\s+/)
    .map((part) => part.trim())
    .filter(Boolean)

  if (parts.length >= 2) {
    return {
      artist: parts[0],
      title: parts.slice(1).join(' - '),
      trackNumber
    }
  }

  return {
    artist: 'Unknown Artist',
    title: remainder || cleaned,
    trackNumber
  }
}

function extractTagString(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  }
  if (value && typeof value === 'object') {
    const obj = value as { text?: unknown; value?: unknown }
    if (typeof obj.text === 'string' && obj.text.trim()) return obj.text.trim()
    if (typeof obj.value === 'string' && obj.value.trim()) return obj.value.trim()
  }
  return null
}

function extractNativeTag(
  native: Record<string, Array<{ id: string; value: unknown }>> | undefined,
  candidateIds: Set<string>
): string | null {
  if (!native) return null
  for (const tagList of Object.values(native)) {
    if (!Array.isArray(tagList)) continue
    for (const tag of tagList) {
      if (!tag?.id) continue
      const normalizedId = tag.id.toUpperCase()
      const tailId = normalizedId.includes(':')
        ? normalizedId.slice(normalizedId.lastIndexOf(':') + 1)
        : normalizedId
      if (candidateIds.has(normalizedId) || candidateIds.has(tailId)) {
        const str = extractTagString(tag.value)
        if (str) return str
      }
    }
  }
  return null
}

function normalizeBpm(rawBpm: unknown): number | null {
  let num: number | null = null
  if (typeof rawBpm === 'number') {
    num = rawBpm
  } else if (typeof rawBpm === 'string') {
    const parsed = Number.parseFloat(rawBpm.replace(',', '.'))
    if (Number.isFinite(parsed)) num = parsed
  }
  if (num === null || !Number.isFinite(num) || num < 30 || num > 300) {
    return null
  }
  return Math.round(num * 10) / 10
}

const KEY_TAG_IDS = new Set(['TKEY', 'INITIALKEY', 'INITIAL KEY', 'INITIAL_KEY', 'KEY'])
const BPM_TAG_IDS = new Set(['TBPM', 'BPM', 'TMPO'])

/**
 * Extracts audio tags and embedded artwork from a file with graceful fallback to filename parsing.
 */
export async function extractTrackMetadata(
  filePath: string,
  artworkCache: ArtworkCache
): Promise<ExtractedTrackMetadata> {
  const format = extensionToAudioFormat(filePath)
  const fallback = parseFilenameFallback(filePath)

  const defaultResult: ExtractedTrackMetadata = {
    format,
    title: fallback.title,
    artist: fallback.artist,
    album: 'Unknown Album',
    albumArtist: null,
    genre: null,
    year: null,
    trackNumber: fallback.trackNumber,
    duration: 0,
    artworkPath: null,
    bpm: null,
    bpmSource: null,
    musicalKey: null,
    camelotKey: null,
    keySource: null
  }

  try {
    const { parseFile, selectCover } = await import('music-metadata')
    const metadata = await parseFile(filePath, { duration: true, skipCovers: false })
    const { common, format: audioFormat, native } = metadata

    const title = common.title?.trim() || fallback.title
    const artist =
      common.artist?.trim() ||
      common.artists
        ?.map((a) => a.trim())
        .filter(Boolean)
        .join(', ') ||
      fallback.artist
    const album = common.album?.trim() || 'Unknown Album'
    const albumArtist = common.albumartist?.trim() || null
    const genre = common.genre?.find((g) => g.trim().length > 0)?.trim() || null
    const year =
      typeof common.year === 'number' && Number.isFinite(common.year) && common.year > 0
        ? Math.floor(common.year)
        : null
    const trackNumber =
      typeof common.track?.no === 'number' &&
      Number.isFinite(common.track.no) &&
      common.track.no > 0
        ? Math.floor(common.track.no)
        : fallback.trackNumber
    const duration =
      typeof audioFormat.duration === 'number' &&
      Number.isFinite(audioFormat.duration) &&
      audioFormat.duration >= 0
        ? audioFormat.duration
        : 0

    const rawBpm = common.bpm ?? extractNativeTag(native, BPM_TAG_IDS)
    const bpm = normalizeBpm(rawBpm)
    const bpmSource: 'tag' | null = bpm !== null ? 'tag' : null

    const rawKey = common.key?.trim() || extractNativeTag(native, KEY_TAG_IDS)
    const camelotKey = parseKeyToCamelot(rawKey)
    const musicalKey = camelotKey && rawKey ? rawKey.trim() : null
    const keySource: 'tag' | null = camelotKey !== null ? 'tag' : null

    let artworkPath: string | null = null
    try {
      const cover = selectCover(common.picture) ?? common.picture?.[0]
      if (cover?.data && cover.data.byteLength > 0) {
        artworkPath = await artworkCache.save(cover.data, cover.format)
      }
    } catch {
      artworkPath = null
    }

    return {
      format,
      title,
      artist,
      album,
      albumArtist,
      genre,
      year,
      trackNumber,
      duration,
      artworkPath,
      bpm,
      bpmSource,
      musicalKey,
      camelotKey,
      keySource
    }
  } catch (err) {
    console.warn(`[metadata] Fallback parsing for "${filePath}":`, err)
    return defaultResult
  }
}

function extractLyricsFromCommon(lyricsTags?: ILyricsTag[]): {
  syncedLyrics: string | null
  plainLyrics: string | null
} {
  if (!Array.isArray(lyricsTags) || lyricsTags.length === 0) {
    return { syncedLyrics: null, plainLyrics: null }
  }

  let syncedLyrics: string | null = null
  let plainLyrics: string | null = null

  for (const entry of lyricsTags) {
    if (Array.isArray(entry.syncText) && entry.syncText.length > 0 && !syncedLyrics) {
      const timedLines: Array<{ timestamp: number; text: string }> = []
      for (const item of entry.syncText) {
        if (
          typeof item.timestamp === 'number' &&
          Number.isFinite(item.timestamp) &&
          item.timestamp >= 0
        ) {
          const lineText = typeof item.text === 'string' ? item.text.trim() : ''
          if (lineText.length > 0) {
            timedLines.push({ timestamp: item.timestamp, text: lineText })
          }
        }
      }

      if (timedLines.length > 0) {
        timedLines.sort((a, b) => a.timestamp - b.timestamp)
        const formatted = timedLines
          .map((item) => `${formatTimestampLrc(item.timestamp / 1000)} ${item.text}`)
          .join('\n')
        if (isSyncedLrc(formatted)) {
          syncedLyrics = formatted
        }
      }
    }

    const rawText = typeof entry.text === 'string' ? entry.text.trim() : ''
    if (rawText.length > 0) {
      if (isSyncedLrc(rawText)) {
        if (!syncedLyrics) {
          syncedLyrics = rawText
        }
        if (!plainLyrics) {
          plainLyrics = stripLrcTimestamps(rawText) || null
        }
      } else if (!plainLyrics) {
        plainLyrics = rawText
      }
    }
  }

  if (syncedLyrics && !plainLyrics) {
    plainLyrics = stripLrcTimestamps(syncedLyrics) || null
  }

  return { syncedLyrics, plainLyrics }
}

/**
 * Extracts embedded synchronized and/or plain lyrics from an audio file's tags.
 */
export async function extractEmbeddedLyrics(
  filePath: string
): Promise<{ syncedLyrics: string | null; plainLyrics: string | null }> {
  try {
    const { parseFile } = await import('music-metadata')
    const metadata = await parseFile(filePath, { duration: false, skipCovers: true })
    return extractLyricsFromCommon(metadata.common.lyrics)
  } catch {
    return { syncedLyrics: null, plainLyrics: null }
  }
}

/**
 * Inspects technical audio stream properties and embedded lyrics presence for a track file.
 */
export async function inspectTrackFile(track: TrackRecord): Promise<TrackTechnicalInfo> {
  const missingResult: TrackTechnicalInfo = {
    trackId: track.id,
    filePath: track.filePath,
    fileExists: false,
    fileSize: 0,
    container: null,
    codec: null,
    codecProfile: null,
    bitrate: null,
    sampleRate: null,
    bitsPerSample: null,
    numberOfChannels: null,
    lossless: null,
    duration: track.duration,
    hasEmbeddedLyrics: false
  }

  let stat: fs.Stats
  try {
    stat = await fs.promises.stat(track.filePath)
    if (!stat.isFile()) {
      return missingResult
    }
  } catch {
    return missingResult
  }

  try {
    const { parseFile } = await import('music-metadata')
    const metadata = await parseFile(track.filePath, { duration: true, skipCovers: true })
    const { format: fmt, common } = metadata
    const embedded = extractLyricsFromCommon(common.lyrics)

    return {
      trackId: track.id,
      filePath: track.filePath,
      fileExists: true,
      fileSize: stat.size,
      container: fmt.container?.trim() || null,
      codec: fmt.codec?.trim() || null,
      codecProfile: fmt.codecProfile?.trim() || null,
      bitrate:
        typeof fmt.bitrate === 'number' && Number.isFinite(fmt.bitrate)
          ? Math.round(fmt.bitrate)
          : null,
      sampleRate:
        typeof fmt.sampleRate === 'number' && Number.isFinite(fmt.sampleRate)
          ? fmt.sampleRate
          : null,
      bitsPerSample:
        typeof fmt.bitsPerSample === 'number' && Number.isFinite(fmt.bitsPerSample)
          ? fmt.bitsPerSample
          : null,
      numberOfChannels:
        typeof fmt.numberOfChannels === 'number' && Number.isFinite(fmt.numberOfChannels)
          ? fmt.numberOfChannels
          : null,
      lossless: typeof fmt.lossless === 'boolean' ? fmt.lossless : null,
      duration:
        typeof fmt.duration === 'number' && Number.isFinite(fmt.duration) && fmt.duration >= 0
          ? fmt.duration
          : track.duration,
      hasEmbeddedLyrics: Boolean(embedded.syncedLyrics || embedded.plainLyrics)
    }
  } catch {
    return {
      ...missingResult,
      fileExists: true,
      fileSize: stat.size
    }
  }
}
