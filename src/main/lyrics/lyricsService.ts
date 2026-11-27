import fs from 'node:fs'
import path from 'node:path'
import { getPrimaryArtist, parseArtistList } from '../../shared/artists'
import { cleanQueryText, isSyncedLrc, stripLrcTimestamps } from '../../shared/lrcParser'
import type { LyricsFetchOptions, TrackLyricsRecord } from '../../shared/types'
import type { Repositories } from '../db/repositories'
import { extractEmbeddedLyrics } from '../scanner/metadata'

const LRCLIB_BASE_URL = 'https://lrclib.net/api'
const LRCLIB_TIMEOUT_MS = 8000
const MAX_SIDECAR_BYTES = 1024 * 1024

const LRCLIB_HEADERS: Record<string, string> = {
  'User-Agent': 'PulseDeck/1.0.0 (https://github.com/pulsedeck/pulsedeck)',
  Accept: 'application/json'
}

export interface LrclibApiItem {
  id?: number
  name?: string | null
  trackName?: string | null
  artistName?: string | null
  albumName?: string | null
  duration?: number | null
  instrumental?: boolean | null
  plainLyrics?: string | null
  syncedLyrics?: string | null
}

function hasPlainLyrics(item: LrclibApiItem): boolean {
  return typeof item.plainLyrics === 'string' && item.plainLyrics.trim().length > 0
}

function normalizeMatchText(value: string | null | undefined): string {
  if (!value) return ''
  const cleaned = cleanQueryText(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned || value.toLowerCase().trim()
}

function scoreTextMatch(candidateRaw: string | null | undefined, targetRaw: string): number {
  const normTarget = normalizeMatchText(targetRaw)
  if (!normTarget) return 0

  const normCand = normalizeMatchText(candidateRaw)
  if (!normCand) return -5
  if (normCand === normTarget) return 30
  if (normCand.includes(normTarget) || normTarget.includes(normCand)) return 18

  const targetTokens = new Set(normTarget.split(' ').filter(Boolean))
  const candTokens = new Set(normCand.split(' ').filter(Boolean))
  if (targetTokens.size === 0 || candTokens.size === 0) return 0

  let overlap = 0
  for (const token of targetTokens) {
    if (candTokens.has(token)) overlap++
  }

  return overlap > 0 ? Math.round((overlap / targetTokens.size) * 12) : -5
}

/**
 * Ranks LRCLIB candidates, strictly prioritizing valid synced LRC lyrics over
 * plain/static lyrics and instrumental entries, then preferring duration proximity
 * (within +-10s) and title/artist similarity.
 */
export function selectBestLrclibCandidate(
  candidates: LrclibApiItem[],
  trackDurationSec: number,
  targetTitle: string,
  targetArtist: string
): LrclibApiItem | null {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return null
  }

  const hasTrackDuration =
    typeof trackDurationSec === 'number' &&
    Number.isFinite(trackDurationSec) &&
    trackDurationSec > 0
  const useArtistScore =
    targetArtist.trim().length > 0 && targetArtist.trim().toLowerCase() !== 'unknown artist'

  interface RankedCandidate {
    item: LrclibApiItem
    tier: number
    score: number
    durationDiff: number
  }

  let best: RankedCandidate | null = null

  for (const item of candidates) {
    if (!item || typeof item !== 'object') continue

    const synced = isSyncedLrc(item.syncedLyrics)
    const plain = hasPlainLyrics(item)
    const instrumental = item.instrumental === true

    if (!synced && !plain && !instrumental) {
      continue
    }

    const tier = synced ? 3 : plain ? 2 : 1

    let durationDiff = Number.POSITIVE_INFINITY
    let durationScore = 0
    if (
      hasTrackDuration &&
      typeof item.duration === 'number' &&
      Number.isFinite(item.duration) &&
      item.duration > 0
    ) {
      durationDiff = Math.abs(item.duration - trackDurationSec)
      if (durationDiff <= 10) {
        durationScore = 40 - durationDiff * 2
      } else {
        durationScore = Math.max(-40, 15 - durationDiff)
      }
    }

    const candTitle = item.trackName ?? item.name ?? ''
    const titleScore = scoreTextMatch(candTitle, targetTitle)
    const artistScore = useArtistScore ? scoreTextMatch(item.artistName, targetArtist) : 0
    const score = durationScore + titleScore + artistScore

    if (!best) {
      best = { item, tier, score, durationDiff }
      continue
    }

    if (tier !== best.tier) {
      if (tier > best.tier) {
        best = { item, tier, score, durationDiff }
      }
      continue
    }

    if (score !== best.score) {
      if (score > best.score) {
        best = { item, tier, score, durationDiff }
      }
      continue
    }

    if (durationDiff < best.durationDiff) {
      best = { item, tier, score, durationDiff }
    }
  }

  return best ? best.item : null
}

async function readSidecarLyrics(
  audioFilePath: string
): Promise<{ syncedLyrics: string | null; plainLyrics: string | null } | null> {
  const ext = path.extname(audioFilePath)
  const basePath = ext ? audioFilePath.slice(0, -ext.length) : audioFilePath

  for (const sidecarExt of ['.lrc', '.txt']) {
    const candidatePath = `${basePath}${sidecarExt}`
    try {
      const stat = await fs.promises.stat(candidatePath)
      if (!stat.isFile() || stat.size === 0 || stat.size > MAX_SIDECAR_BYTES) {
        continue
      }
      const raw = await fs.promises.readFile(candidatePath, 'utf8')
      const trimmed = raw.replace(/^\uFEFF/, '').trim()
      if (!trimmed) {
        continue
      }
      if (isSyncedLrc(trimmed)) {
        return {
          syncedLyrics: trimmed,
          plainLyrics: stripLrcTimestamps(trimmed) || null
        }
      }
      return {
        syncedLyrics: null,
        plainLyrics: trimmed
      }
    } catch {
      // Sidecar file does not exist or cannot be read; check next candidate.
    }
  }

  return null
}

export interface LyricsServiceDeps {
  repos: Repositories
  fetchFn?: typeof fetch
}

/**
 * Resolves, caches, imports, and fetches track lyrics from SQLite, local sidecars,
 * embedded audio tags, and LRCLIB.
 */
export function createLyricsService({ repos, fetchFn }: LyricsServiceDeps) {
  const fetchImpl: typeof fetch = fetchFn ?? globalThis.fetch

  function saveLrclibCandidate(trackId: number, item: LrclibApiItem): TrackLyricsRecord {
    const synced = isSyncedLrc(item.syncedLyrics) ? item.syncedLyrics!.trim() : null
    const plainRaw = hasPlainLyrics(item) ? item.plainLyrics!.trim() : null
    const plain = plainRaw ?? (synced ? stripLrcTimestamps(synced) || null : null)

    return repos.lyrics.save({
      trackId,
      syncedLyrics: synced,
      plainLyrics: plain,
      source: 'lrclib',
      providerTrackName: item.trackName?.trim() || item.name?.trim() || null,
      providerArtistName: item.artistName?.trim() || null,
      isInstrumental: item.instrumental === true
    })
  }

  return {
    async getForTrack(
      trackId: number,
      options?: LyricsFetchOptions
    ): Promise<TrackLyricsRecord | null> {
      const track = repos.tracks.getById(trackId)
      if (!track) return null

      const forceRefresh = Boolean(options?.forceRefresh)
      const customTitle = options?.customTitle?.trim() || ''
      const customArtist = options?.customArtist?.trim() || ''
      const hasCustomQuery = Boolean(customTitle || customArtist)
      const allowOnline = options?.allowOnline !== false

      const cached = repos.lyrics.get(trackId)
      if (cached && !forceRefresh && !hasCustomQuery) {
        return cached
      }

      if (!hasCustomQuery && !forceRefresh) {
        const sidecar = await readSidecarLyrics(track.filePath)
        if (sidecar) {
          return repos.lyrics.save({
            trackId,
            syncedLyrics: sidecar.syncedLyrics,
            plainLyrics: sidecar.plainLyrics,
            source: 'sidecar'
          })
        }

        const embedded = await extractEmbeddedLyrics(track.filePath)
        if (embedded.syncedLyrics || embedded.plainLyrics) {
          return repos.lyrics.save({
            trackId,
            syncedLyrics: embedded.syncedLyrics,
            plainLyrics: embedded.plainLyrics,
            source: 'embedded'
          })
        }
      }

      const autoFetchLyrics = repos.settings.getAll().library.autoFetchLyrics
      if (!allowOnline || (!autoFetchLyrics && !forceRefresh && !hasCustomQuery)) {
        return cached ?? null
      }

      const rawTitle = customTitle || track.title
      const rawArtist = hasCustomQuery ? customArtist : track.artist
      const cleanedTitle = cleanQueryText(rawTitle) || rawTitle.trim()
      const cleanedArtist = cleanQueryText(rawArtist) || rawArtist.trim()
      const isKnownArtist =
        cleanedArtist.length > 0 && cleanedArtist.toLowerCase() !== 'unknown artist'

      let fallbackStatic: LrclibApiItem | null = null

      if (isKnownArtist && cleanedTitle) {
        try {
          const params = new URLSearchParams({
            track_name: cleanedTitle,
            artist_name: cleanedArtist
          })
          const albumName = track.album?.trim()
          if (!hasCustomQuery && albumName && albumName.toLowerCase() !== 'unknown album') {
            params.set('album_name', albumName)
          }
          if (
            typeof track.duration === 'number' &&
            Number.isFinite(track.duration) &&
            track.duration > 0
          ) {
            params.set('duration', String(Math.round(track.duration)))
          }

          const res = await fetchImpl(`${LRCLIB_BASE_URL}/get?${params.toString()}`, {
            headers: LRCLIB_HEADERS,
            signal: AbortSignal.timeout(LRCLIB_TIMEOUT_MS)
          })

          if (res.ok) {
            const item = (await res.json()) as LrclibApiItem | null
            if (item && typeof item === 'object') {
              if (isSyncedLrc(item.syncedLyrics)) {
                return saveLrclibCandidate(trackId, item)
              }
              if (hasPlainLyrics(item) || item.instrumental === true) {
                fallbackStatic = item
              }
            }
          }
        } catch {
          // Ignore transient network, timeout, or JSON parse failures and try /api/search.
        }
      }

      if (cleanedTitle || cleanedArtist) {
        const searchLrclib = async (searchArtist: string): Promise<LrclibApiItem | null> => {
          const searchParams = new URLSearchParams()
          const knownSearchArtist =
            searchArtist.length > 0 && searchArtist.toLowerCase() !== 'unknown artist'
          if (knownSearchArtist && cleanedTitle) {
            searchParams.set('track_name', cleanedTitle)
            searchParams.set('artist_name', searchArtist)
          } else {
            searchParams.set('q', cleanedTitle || searchArtist)
          }

          const res = await fetchImpl(`${LRCLIB_BASE_URL}/search?${searchParams.toString()}`, {
            headers: LRCLIB_HEADERS,
            signal: AbortSignal.timeout(LRCLIB_TIMEOUT_MS)
          })

          if (!res.ok) return null
          const payload = (await res.json()) as unknown
          const items = Array.isArray(payload) ? (payload as LrclibApiItem[]) : []
          return selectBestLrclibCandidate(
            items,
            track.duration,
            cleanedTitle,
            knownSearchArtist ? searchArtist : ''
          )
        }

        let best: LrclibApiItem | null = null
        try {
          best = await searchLrclib(cleanedArtist)
        } catch {
          // Ignore network, timeout, or JSON parse failures gracefully.
        }

        if (!best && !hasCustomQuery && parseArtistList(rawArtist).length > 1) {
          const primaryRaw = getPrimaryArtist(rawArtist)
          const primaryArtist = cleanQueryText(primaryRaw) || primaryRaw.trim()
          if (
            primaryArtist &&
            primaryArtist.toLowerCase() !== 'unknown artist' &&
            primaryArtist !== cleanedArtist
          ) {
            try {
              best = await searchLrclib(primaryArtist)
            } catch {
              // Ignore network, timeout, or JSON parse failures gracefully.
            }
          }
        }

        if (best && isSyncedLrc(best.syncedLyrics)) {
          return saveLrclibCandidate(trackId, best)
        }
        if (fallbackStatic && hasPlainLyrics(fallbackStatic)) {
          return saveLrclibCandidate(trackId, fallbackStatic)
        }
        if (best && (hasPlainLyrics(best) || best.instrumental === true)) {
          return saveLrclibCandidate(trackId, best)
        }
        if (fallbackStatic && fallbackStatic.instrumental === true) {
          return saveLrclibCandidate(trackId, fallbackStatic)
        }
      }

      if (fallbackStatic) {
        return saveLrclibCandidate(trackId, fallbackStatic)
      }

      return hasCustomQuery ? null : (cached ?? null)
    },

    importFromRawText(trackId: number, rawText: string): TrackLyricsRecord | null {
      const track = repos.tracks.getById(trackId)
      if (!track) return null

      const trimmed = typeof rawText === 'string' ? rawText.replace(/^\uFEFF/, '').trim() : ''
      if (!trimmed) return null

      if (isSyncedLrc(trimmed)) {
        return repos.lyrics.save({
          trackId,
          syncedLyrics: trimmed,
          plainLyrics: stripLrcTimestamps(trimmed) || null,
          source: 'user'
        })
      }

      return repos.lyrics.save({
        trackId,
        syncedLyrics: null,
        plainLyrics: trimmed,
        source: 'user'
      })
    }
  }
}

export type LyricsService = ReturnType<typeof createLyricsService>
