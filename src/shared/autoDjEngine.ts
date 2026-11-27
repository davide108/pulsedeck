import { normalizeArtistKey, parseArtistList } from './artists'
import { getCamelotCompatibility, parseKeyToCamelot } from './camelot'
import type { AutoDjQueueItem, TrackRecord } from './types'

export interface AutoDjAnchor {
  id?: number
  trackId?: number | null
  bpm: number | null
  camelotKey: string | null
  genre: string | null
  energy: number | null
  artist: string | null
}

export interface SkipPenalties {
  trackIds: Record<number, number>
  artists: Record<string, number>
  genres: Record<string, number>
}

export interface AutoDjSessionState {
  anchor: AutoDjAnchor
  recentTrackIds: number[]
  recentArtists: string[]
  skipPenalties: SkipPenalties
  seed: number
  playedCount: number
}

export interface BpmCompatibility {
  score: number
  relation: 'exact' | 'half' | 'double' | 'close' | 'free'
  effectiveRatio: number
}

export interface ScoreBreakdown {
  total: number
  baseScore: number
  bpmScore: number
  harmonicScore: number
  flowScore: number
  freshnessScore: number
  penalty: number
  tempoRelation: 'exact' | 'half' | 'double' | 'close' | 'free'
  harmonicRelation: string
  matchReason: string
}

export interface GenerateAutoDjQueueOptions {
  anchor: AutoDjAnchor | TrackRecord | null
  candidates: TrackRecord[]
  session: AutoDjSessionState
  lockedItems?: (AutoDjQueueItem | null)[]
  count?: number
  deterministic?: boolean
  excludeTrackIds?: number[]
}

const RECENT_HISTORY_WINDOW = 30
const RECENT_ARTISTS_CAP = 12
const EARLY_SKIP_THRESHOLD_SEC = 20
const BACK_TO_BACK_ARTIST_PENALTY = 0.45

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0
  return Math.max(0, Math.min(1, value))
}

function normalizeLabel(value: string | null | undefined): string {
  return value ? value.trim().toLowerCase() : ''
}

function extractArtistKeys(raw: string | null | undefined): string[] {
  if (!raw || !raw.trim()) return []
  const keys: string[] = []
  const seen = new Set<string>()
  for (const name of parseArtistList(raw)) {
    const key = normalizeArtistKey(name)
    if (!key || key === 'unknown artist' || seen.has(key)) continue
    seen.add(key)
    keys.push(key)
  }
  return keys
}

function pushRecentArtists(recentArtists: string[], artistRaw: string | null | undefined): string[] {
  const keys = extractArtistKeys(artistRaw)
  if (keys.length === 0) return recentArtists
  const keySet = new Set(keys)
  return [...keys, ...recentArtists.filter((a) => !keySet.has(a))].slice(0, RECENT_ARTISTS_CAP)
}

function getAnchorTrackId(anchor: AutoDjAnchor | null | undefined): number | null {
  if (!anchor) return null
  if (typeof anchor.id === 'number') return anchor.id
  if (typeof anchor.trackId === 'number') return anchor.trackId
  return null
}

export function trackToAnchor(track?: TrackRecord | AutoDjAnchor | null): AutoDjAnchor {
  if (!track) {
    return {
      trackId: null,
      bpm: null,
      camelotKey: null,
      genre: null,
      energy: null,
      artist: null
    }
  }
  const id = getAnchorTrackId(track)
  return {
    trackId: id,
    bpm: track.bpm ?? null,
    camelotKey: parseKeyToCamelot(track.camelotKey) ?? track.camelotKey ?? null,
    genre: track.genre ?? null,
    energy: track.energy ?? null,
    artist: track.artist ?? null
  }
}

export function createAutoDjSession(anchorTrack?: TrackRecord | null): AutoDjSessionState {
  const anchor = trackToAnchor(anchorTrack)
  return {
    anchor,
    recentTrackIds: anchorTrack ? [anchorTrack.id] : [],
    recentArtists: extractArtistKeys(anchor.artist).slice(0, RECENT_ARTISTS_CAP),
    skipPenalties: {
      trackIds: {},
      artists: {},
      genres: {}
    },
    seed: 1,
    playedCount: anchorTrack ? 1 : 0
  }
}

export function computeBpmCompatibility(
  anchorBpm: number | null,
  candBpm: number | null
): BpmCompatibility {
  if (
    anchorBpm === null ||
    candBpm === null ||
    !Number.isFinite(anchorBpm) ||
    !Number.isFinite(candBpm) ||
    anchorBpm <= 0 ||
    candBpm <= 0
  ) {
    return { score: 0.5, relation: 'free', effectiveRatio: 1 }
  }

  // Evaluate 1x, 0.5x (candidate is double-time of anchor), and 2x (candidate is half-time of anchor)
  const candidates: Array<{
    mult: number
    relation: 'direct' | 'half' | 'double'
    effectiveCand: number
    pctDiff: number
  }> = [
    {
      mult: 1,
      relation: 'direct',
      effectiveCand: candBpm,
      pctDiff: Math.abs(candBpm - anchorBpm) / anchorBpm
    },
    {
      mult: 0.5,
      relation: 'double',
      effectiveCand: candBpm * 0.5,
      pctDiff: Math.abs(candBpm * 0.5 - anchorBpm) / anchorBpm
    },
    {
      mult: 2,
      relation: 'half',
      effectiveCand: candBpm * 2,
      pctDiff: Math.abs(candBpm * 2 - anchorBpm) / anchorBpm
    }
  ]

  // Slight preference for direct 1x when equally close
  candidates.sort((a, b) => {
    const aWeighted = a.pctDiff + (a.relation === 'direct' ? 0 : 0.004)
    const bWeighted = b.pctDiff + (b.relation === 'direct' ? 0 : 0.004)
    return aWeighted - bWeighted
  })

  const best = candidates[0]
  const effectiveRatio = Number((best.effectiveCand / anchorBpm).toFixed(4))

  if (best.relation !== 'direct' && best.pctDiff <= 0.04) {
    const score = Number((0.94 - (best.pctDiff / 0.04) * 0.08).toFixed(4))
    return {
      score: clamp01(score),
      relation: best.relation,
      effectiveRatio
    }
  }

  if (best.pctDiff <= 0.015) {
    const score = Number((1.0 - (best.pctDiff / 0.015) * 0.04).toFixed(4))
    return {
      score: clamp01(score),
      relation: 'exact',
      effectiveRatio
    }
  }

  if (best.pctDiff <= 0.08) {
    const t = (best.pctDiff - 0.015) / (0.08 - 0.015)
    const score = Number((0.94 - t * 0.32).toFixed(4))
    return {
      score: clamp01(score),
      relation: 'close',
      effectiveRatio
    }
  }

  if (best.pctDiff <= 0.2) {
    const t = (best.pctDiff - 0.08) / (0.2 - 0.08)
    const score = Number((0.55 - t * 0.4).toFixed(4))
    return {
      score: clamp01(score),
      relation: 'free',
      effectiveRatio
    }
  }

  return {
    score: 0.1,
    relation: 'free',
    effectiveRatio
  }
}

function computeGenreScore(anchorGenre: string | null, candGenre: string | null): number {
  const a = normalizeLabel(anchorGenre)
  const b = normalizeLabel(candGenre)
  if (!a || !b) return 0.55
  if (a === b) return 1.0

  const tokensA = new Set(a.split(/[\s/,&-]+/).filter((t) => t.length >= 3))
  const tokensB = b.split(/[\s/,&-]+/).filter((t) => t.length >= 3)
  for (const tok of tokensB) {
    if (tokensA.has(tok)) return 0.78
  }
  if (a.includes(b) || b.includes(a)) return 0.78
  return 0.3
}

function computeEnergyScore(anchorEnergy: number | null, candEnergy: number | null): number {
  if (
    anchorEnergy === null ||
    candEnergy === null ||
    !Number.isFinite(anchorEnergy) ||
    !Number.isFinite(candEnergy)
  ) {
    return 0.55
  }
  const diff = Math.abs(candEnergy - anchorEnergy)
  return clamp01(1.0 - diff * 1.4)
}

function computeFreshnessScore(candidate: TrackRecord): number {
  const playPenalty = 1 / (1 + Math.max(0, candidate.playCount) * 0.15)
  let recencyFactor = 1.0
  if (candidate.lastPlayedAt !== null && candidate.lastPlayedAt > 0) {
    const ageHours = Math.max(0, (Date.now() - candidate.lastPlayedAt) / 3_600_000)
    if (ageHours < 4) {
      recencyFactor = 0.7 + 0.3 * (ageHours / 4)
    }
  }
  return clamp01(playPenalty * recencyFactor)
}

function formatMatchReason(
  candidate: TrackRecord,
  tempoRelation: BpmCompatibility['relation'],
  harmonicRelation: string
): string {
  const parts: string[] = []
  if (candidate.bpm !== null && candidate.bpm > 0) {
    parts.push(`${Math.round(candidate.bpm)} BPM`)
  }
  if (candidate.camelotKey) {
    parts.push(candidate.camelotKey)
  }
  if (harmonicRelation !== 'Unknown Key' && harmonicRelation !== 'Harmonic Clash') {
    parts.push(harmonicRelation)
  } else if (tempoRelation === 'half') {
    parts.push('Half-Time')
  } else if (tempoRelation === 'double') {
    parts.push('Double-Time')
  } else if (candidate.genre) {
    parts.push(candidate.genre)
  } else if (harmonicRelation) {
    parts.push(harmonicRelation)
  }
  return parts.length > 0 ? parts.join(' · ') : 'Flow Mix'
}

export function scoreCandidate(
  anchor: AutoDjAnchor,
  candidate: TrackRecord,
  session: AutoDjSessionState
): ScoreBreakdown {
  const bpmCompat = computeBpmCompatibility(anchor.bpm, candidate.bpm)
  const harmCompat = getCamelotCompatibility(anchor.camelotKey, candidate.camelotKey)

  const genreScore = computeGenreScore(anchor.genre, candidate.genre)
  const energyScore = computeEnergyScore(anchor.energy, candidate.energy)
  const flowScore = Number((0.5 * genreScore + 0.5 * energyScore).toFixed(4))
  const freshnessScore = Number(computeFreshnessScore(candidate).toFixed(4))

  const baseScore = Number(
    (
      0.35 * bpmCompat.score +
      0.3 * harmCompat.score +
      0.25 * flowScore +
      0.1 * freshnessScore
    ).toFixed(4)
  )

  let penalty = 0

  // 1. Recency decay across last 30 played tracks
  const recentIdx = session.recentTrackIds.indexOf(candidate.id)
  if (recentIdx >= 0 && recentIdx < RECENT_HISTORY_WINDOW) {
    penalty += 0.85 * (1 - recentIdx / RECENT_HISTORY_WINDOW)
  }

  // 2. Back-to-back same-artist penalty (-0.45) + softer recent-artist penalty
  const anchorArtists = new Set(extractArtistKeys(anchor.artist))
  const candArtists = extractArtistKeys(candidate.artist)
  if (candArtists.length > 0) {
    if (candArtists.some((artistKey) => anchorArtists.has(artistKey))) {
      penalty += BACK_TO_BACK_ARTIST_PENALTY
    } else {
      let strongestRecentPenalty = 0
      for (const artistKey of candArtists) {
        const artistIdx = session.recentArtists.indexOf(artistKey)
        if (artistIdx >= 0 && artistIdx < 3) {
          const recentPenalty = 0.15 * (1 - artistIdx / 3)
          if (recentPenalty > strongestRecentPenalty) {
            strongestRecentPenalty = recentPenalty
          }
        }
      }
      penalty += strongestRecentPenalty
    }
  }

  // 3. Early-skip (<20s) session feedback penalties
  const trackSkip = session.skipPenalties.trackIds[candidate.id] ?? 0
  let artistSkip = 0
  for (const artistKey of candArtists) {
    const skipVal = session.skipPenalties.artists[artistKey] ?? 0
    if (skipVal > artistSkip) {
      artistSkip = skipVal
    }
  }
  const candGenre = normalizeLabel(candidate.genre)
  const genreSkip = candGenre ? (session.skipPenalties.genres[candGenre] ?? 0) : 0
  penalty += trackSkip + artistSkip + genreSkip

  const roundedPenalty = Number(penalty.toFixed(4))
  const total = Number((baseScore - roundedPenalty).toFixed(4))

  return {
    total,
    baseScore,
    bpmScore: bpmCompat.score,
    harmonicScore: harmCompat.score,
    flowScore,
    freshnessScore,
    penalty: roundedPenalty,
    tempoRelation: bpmCompat.relation,
    harmonicRelation: harmCompat.relation,
    matchReason: formatMatchReason(candidate, bpmCompat.relation, harmCompat.relation)
  }
}

export function reanchorSession(
  session: AutoDjSessionState,
  selectedTrack: TrackRecord
): AutoDjSessionState {
  const newAnchor = trackToAnchor(selectedTrack)
  const nextRecentIds = [
    selectedTrack.id,
    ...session.recentTrackIds.filter((id) => id !== selectedTrack.id)
  ].slice(0, RECENT_HISTORY_WINDOW)

  const nextRecentArtists = pushRecentArtists(session.recentArtists, selectedTrack.artist)

  return {
    ...session,
    anchor: newAnchor,
    recentTrackIds: nextRecentIds,
    recentArtists: nextRecentArtists,
    seed: session.seed + 1,
    playedCount: session.playedCount + 1
  }
}

export function recordEarlySkip(
  session: AutoDjSessionState,
  skippedTrack: TrackRecord,
  durationPlayedSec: number,
  thresholdSec: number = EARLY_SKIP_THRESHOLD_SEC
): AutoDjSessionState {
  if (durationPlayedSec >= thresholdSec) {
    return session
  }

  const nextTrackIds = { ...session.skipPenalties.trackIds }
  nextTrackIds[skippedTrack.id] = Math.min(1.0, (nextTrackIds[skippedTrack.id] ?? 0) + 0.65)

  const nextArtists = { ...session.skipPenalties.artists }
  for (const artistKey of extractArtistKeys(skippedTrack.artist)) {
    nextArtists[artistKey] = Math.min(0.75, (nextArtists[artistKey] ?? 0) + 0.3)
  }

  const nextGenres = { ...session.skipPenalties.genres }
  const normGenre = normalizeLabel(skippedTrack.genre)
  if (normGenre) {
    nextGenres[normGenre] = Math.min(0.6, (nextGenres[normGenre] ?? 0) + 0.25)
  }

  const nextRecentIds = [
    skippedTrack.id,
    ...session.recentTrackIds.filter((id) => id !== skippedTrack.id)
  ].slice(0, RECENT_HISTORY_WINDOW)

  return {
    ...session,
    recentTrackIds: nextRecentIds,
    skipPenalties: {
      trackIds: nextTrackIds,
      artists: nextArtists,
      genres: nextGenres
    }
  }
}

function advanceWorkingSession(
  session: AutoDjSessionState,
  pickedTrack: TrackRecord
): AutoDjSessionState {
  return {
    ...session,
    recentTrackIds: [
      pickedTrack.id,
      ...session.recentTrackIds.filter((id) => id !== pickedTrack.id)
    ].slice(0, RECENT_HISTORY_WINDOW),
    recentArtists: pushRecentArtists(session.recentArtists, pickedTrack.artist)
  }
}

export function generateAutoDjQueue(options: GenerateAutoDjQueueOptions): AutoDjQueueItem[] {
  const {
    anchor,
    candidates,
    session,
    lockedItems = [],
    count = 8,
    deterministic = true,
    excludeTrackIds = []
  } = options

  if (count <= 0) return []

  let currentAnchor = trackToAnchor(anchor)
  const anchorTrackId = getAnchorTrackId(anchor)

  const usedIds = new Set<number>(excludeTrackIds)
  if (anchorTrackId !== null) {
    usedIds.add(anchorTrackId)
  }

  // Reserve locked items in their slot positions
  const fixedSlots = new Map<number, AutoDjQueueItem>()
  for (let i = 0; i < Math.min(count, lockedItems.length); i++) {
    const item = lockedItems[i]
    if (item && item.locked && !item.track.isMissing && !usedIds.has(item.track.id)) {
      fixedSlots.set(i, item)
      usedIds.add(item.track.id)
    }
  }

  // Deduplicate and filter playable candidates
  const uniqueCandidates: TrackRecord[] = []
  const seenCandidateIds = new Set<number>()
  for (const cand of candidates) {
    if (!cand || cand.isMissing) continue
    if (seenCandidateIds.has(cand.id)) continue
    seenCandidateIds.add(cand.id)
    uniqueCandidates.push(cand)
  }

  let workingSession = session
  const queue: AutoDjQueueItem[] = []

  for (let slot = 0; slot < count; slot++) {
    const lockedSlot = fixedSlots.get(slot)
    if (lockedSlot) {
      const breakdown = scoreCandidate(currentAnchor, lockedSlot.track, workingSession)
      queue.push({
        track: lockedSlot.track,
        locked: true,
        score: clamp01(breakdown.total),
        bpmScore: breakdown.bpmScore,
        harmonicScore: breakdown.harmonicScore,
        flowScore: breakdown.flowScore,
        matchReason: breakdown.matchReason,
        tempoRelation: breakdown.tempoRelation,
        harmonicRelation: breakdown.harmonicRelation
      })
      currentAnchor = trackToAnchor(lockedSlot.track)
      workingSession = advanceWorkingSession(workingSession, lockedSlot.track)
      continue
    }

    const available = uniqueCandidates.filter((c) => !usedIds.has(c.id))
    if (available.length === 0) {
      continue
    }

    const scored = available.map((track) => ({
      track,
      breakdown: scoreCandidate(currentAnchor, track, workingSession)
    }))

    scored.sort((a, b) => {
      if (b.breakdown.total !== a.breakdown.total) {
        return b.breakdown.total - a.breakdown.total
      }
      return a.track.id - b.track.id
    })

    let picked = scored[0]
    if (!deterministic && scored.length > 1) {
      const topScore = scored[0].breakdown.total
      const pool = scored.slice(0, Math.min(4, scored.length)).filter((entry) => topScore - entry.breakdown.total <= 0.14)
      if (pool.length > 1) {
        const weights = pool.map((_, idx) => Math.pow(0.55, idx))
        const weightSum = weights.reduce((acc, w) => acc + w, 0)
        let r = Math.random() * weightSum
        for (let idx = 0; idx < pool.length; idx++) {
          r -= weights[idx]
          if (r <= 0) {
            picked = pool[idx]
            break
          }
        }
      }
    }

    usedIds.add(picked.track.id)
    queue.push({
      track: picked.track,
      locked: false,
      score: clamp01(picked.breakdown.total),
      bpmScore: picked.breakdown.bpmScore,
      harmonicScore: picked.breakdown.harmonicScore,
      flowScore: picked.breakdown.flowScore,
      matchReason: picked.breakdown.matchReason,
      tempoRelation: picked.breakdown.tempoRelation,
      harmonicRelation: picked.breakdown.harmonicRelation
    })

    currentAnchor = trackToAnchor(picked.track)
    workingSession = advanceWorkingSession(workingSession, picked.track)
  }

  return queue
}
