import type { LyricsLine } from './types'

const LEADING_TIMESTAMP_RE = /^\s*\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/
const TIMESTAMP_GLOBAL_RE = /\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/g
const OFFSET_TAG_RE = /^\s*\[\s*offset\s*:\s*([+-]?\d+)\s*\]\s*$/i
const METADATA_LINE_RE = /^\s*\[\s*[a-zA-Z][a-zA-Z0-9_-]*\s*:[^\]]*\]\s*$/

const BRACKETED_NOISE_PATTERNS: readonly RegExp[] = [
  /\(\s*(?:official(?:\s+(?:music|lyric(?:s)?))?(?:\s+(?:video|audio|visualizer))?(?:\s+(?:hd|hq|4k))?|music\s+video|lyric(?:s)?\s+video|lyrics?|audio|visualizer)\s*\)/gi,
  /\[\s*(?:official(?:\s+(?:music|lyric(?:s)?))?(?:\s+(?:video|audio|visualizer))?(?:\s+(?:hd|hq|4k))?|music\s+video|lyric(?:s)?\s+video|lyrics?|audio|visualizer)\s*\]/gi,
  /\([^)]*\bremaster(?:ed)?\b[^)]*\)/gi,
  /\[[^\]]*\bremaster(?:ed)?\b[^\]]*\]/gi,
  /\(\s*(?:hd|hq|4k)\s*\)/gi,
  /\[\s*(?:hd|hq|4k)\s*\]/gi,
  /\(\s*(?:feat\.|ft\.|(?:feat|ft|featuring)\s+)[^)]*\)/gi,
  /\[\s*(?:feat\.|ft\.|(?:feat|ft|featuring)\s+)[^\]]*\]/gi
]

function roundToMs(seconds: number): number {
  return Math.round(seconds * 1000) / 1000
}

/**
 * Parses an LRC string into ascending timestamped lyric lines.
 * Supports [mm:ss.xx], [mm:ss.xxx], [mm:ss:xx], [mm:ss], multiple timestamps
 * per line, and the [offset:±ms] header tag (shifting line timestamps by
 * offsetMs / 1000 and clamping >= 0). Non-time metadata tags and empty lines
 * are skipped.
 */
export function parseLrc(raw: string): LyricsLine[] {
  if (!raw || typeof raw !== 'string') {
    return []
  }

  const normalized = raw.replace(/^\uFEFF/, '')
  const rawLines = normalized.split(/\r?\n/)

  let headerOffsetMs = 0
  const parsed: LyricsLine[] = []

  for (const line of rawLines) {
    const offsetMatch = OFFSET_TAG_RE.exec(line)
    if (offsetMatch) {
      const value = Number.parseInt(offsetMatch[1], 10)
      if (Number.isFinite(value)) {
        headerOffsetMs = value
      }
      continue
    }

    const timestamps: number[] = []
    let remaining = line

    while (true) {
      const match = LEADING_TIMESTAMP_RE.exec(remaining)
      if (!match) {
        break
      }

      const minutes = Number.parseInt(match[1], 10)
      const seconds = Number.parseInt(match[2], 10)
      const fractionRaw = match[3] ?? ''
      const fractionSec =
        fractionRaw.length > 0 ? Number.parseInt(fractionRaw, 10) / 10 ** fractionRaw.length : 0

      timestamps.push(minutes * 60 + seconds + fractionSec)
      remaining = remaining.slice(match[0].length)
    }

    if (timestamps.length === 0) {
      continue
    }

    const text = remaining.trim()
    if (!text) {
      continue
    }

    for (const timeSec of timestamps) {
      parsed.push({ timeSec, text })
    }
  }

  if (parsed.length === 0) {
    return []
  }

  const offsetSec = headerOffsetMs / 1000
  const adjusted = parsed.map((line) => ({
    timeSec: Math.max(0, roundToMs(line.timeSec + offsetSec)),
    text: line.text
  }))

  adjusted.sort((a, b) => a.timeSec - b.timeSec)
  return adjusted
}

/**
 * Returns true iff the input parses to at least one timestamped lyric line.
 */
export function isSyncedLrc(raw: string | null | undefined): boolean {
  if (!raw || typeof raw !== 'string') {
    return false
  }
  return parseLrc(raw).length > 0
}

/**
 * Strips [mm:ss...] timestamps and LRC metadata tags, returning clean plain lyric lines.
 */
export function stripLrcTimestamps(raw: string): string {
  if (!raw || typeof raw !== 'string') {
    return ''
  }

  const normalized = raw.replace(/^\uFEFF/, '')
  const lines = normalized.split(/\r?\n/)
  const out: string[] = []

  for (const line of lines) {
    if (METADATA_LINE_RE.test(line)) {
      continue
    }
    const cleaned = line.replace(TIMESTAMP_GLOBAL_RE, '').trim()
    if (cleaned.length > 0) {
      out.push(cleaned)
    }
  }

  return out.join('\n')
}

/**
 * Formats seconds as an LRC timestamp `[mm:ss.xx]`.
 */
export function formatTimestampLrc(timeSec: number): string {
  const safeSec = Number.isFinite(timeSec) && timeSec > 0 ? timeSec : 0
  const totalCentis = Math.round(safeSec * 100)
  const minutes = Math.floor(totalCentis / 6000)
  const remainingCentis = totalCentis % 6000
  const seconds = Math.floor(remainingCentis / 100)
  const centis = remainingCentis % 100

  const mm = String(minutes).padStart(2, '0')
  const ss = String(seconds).padStart(2, '0')
  const xx = String(centis).padStart(2, '0')
  return `[${mm}:${ss}.${xx}]`
}

/**
 * Returns the index of the currently active lyric line for `currentTimeSec`
 * adjusted by `offsetMs` (effectiveTime = currentTimeSec + offsetMs / 1000),
 * or -1 if before the first line or when `lines` is empty.
 */
export function findActiveLyricIndex(
  lines: LyricsLine[],
  currentTimeSec: number,
  offsetMs?: number
): number {
  if (!Array.isArray(lines) || lines.length === 0 || !Number.isFinite(currentTimeSec)) {
    return -1
  }

  const safeOffsetMs = typeof offsetMs === 'number' && Number.isFinite(offsetMs) ? offsetMs : 0
  const effectiveTime = currentTimeSec + safeOffsetMs / 1000

  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].timeSec <= effectiveTime) {
      return i
    }
  }

  return -1
}

/**
 * Strips common noisy video/audio/remaster/feature suffixes and collapses whitespace
 * for cleaner online lyrics search queries.
 */
export function cleanQueryText(value: string): string {
  if (!value || typeof value !== 'string') {
    return ''
  }

  let cleaned = value
  for (const pattern of BRACKETED_NOISE_PATTERNS) {
    cleaned = cleaned.replace(pattern, ' ')
  }

  return cleaned.replace(/\s+/g, ' ').trim()
}
