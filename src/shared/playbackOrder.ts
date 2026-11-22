import type { RepeatMode, TrackRecord } from './types'

/**
 * Builds a Fisher-Yates shuffled list of track IDs.
 * If `currentTrackId` exists in `tracks`, it is placed at index 0 and the
 * remaining tracks are shuffled after it.
 */
export function buildShuffleOrder(
  tracks: TrackRecord[],
  currentTrackId?: number | null,
  rng: () => number = Math.random
): number[] {
  if (tracks.length === 0) return []

  const remaining =
    currentTrackId != null
      ? tracks.filter((t) => t.id !== currentTrackId).map((t) => t.id)
      : tracks.map((t) => t.id)

  for (let i = remaining.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = remaining[i]
    remaining[i] = remaining[j]
    remaining[j] = tmp
  }

  const hasCurrent =
    currentTrackId != null && tracks.some((t) => t.id === currentTrackId)
  return hasCurrent ? [currentTrackId!, ...remaining] : remaining
}

function buildActiveList(
  orderedTracks: TrackRecord[],
  shuffleOrderIds: number[],
  currentTrackId: number | null,
  shuffle: boolean,
  rng: () => number
): { activeList: TrackRecord[]; orderIds: number[] } {
  if (!shuffle) {
    return {
      activeList: orderedTracks,
      orderIds: shuffleOrderIds
    }
  }

  const trackById = new Map<number, TrackRecord>()
  for (const t of orderedTracks) {
    trackById.set(t.id, t)
  }

  // Validate existing shuffle order against current track set
  const seen = new Set<number>()
  const validTracks: TrackRecord[] = []
  for (const id of shuffleOrderIds) {
    if (seen.has(id)) continue
    const track = trackById.get(id)
    if (track) {
      seen.add(id)
      validTracks.push(track)
    }
  }

  if (validTracks.length === orderedTracks.length) {
    return {
      activeList: validTracks,
      orderIds: validTracks.map((t) => t.id)
    }
  }

  const freshIds = buildShuffleOrder(orderedTracks, currentTrackId, rng)
  return {
    activeList: freshIds
      .map((id) => trackById.get(id))
      .filter((t): t is TrackRecord => t !== undefined),
    orderIds: freshIds
  }
}

export interface ResolveNextTrackParams {
  orderedTracks: TrackRecord[]
  shuffleOrderIds: number[]
  currentTrackId: number | null
  shuffle: boolean
  repeatMode: RepeatMode
  reason: 'natural-end' | 'manual-next'
  rng?: () => number
}

export interface ResolveNextTrackResult {
  nextTrack: TrackRecord | null
  nextShuffleOrderIds?: number[]
}

export function resolveNormalNextTrack(
  params: ResolveNextTrackParams
): ResolveNextTrackResult {
  const {
    orderedTracks,
    shuffleOrderIds,
    currentTrackId,
    shuffle,
    repeatMode,
    reason,
    rng = Math.random
  } = params

  if (orderedTracks.length === 0) {
    return { nextTrack: null }
  }

  if (reason === 'natural-end' && repeatMode === 'one' && currentTrackId !== null) {
    const sameTrack = orderedTracks.find((t) => t.id === currentTrackId) ?? null
    return {
      nextTrack: sameTrack,
      nextShuffleOrderIds: shuffle ? shuffleOrderIds : undefined
    }
  }

  const { activeList, orderIds } = buildActiveList(
    orderedTracks,
    shuffleOrderIds,
    currentTrackId,
    shuffle,
    rng
  )

  if (activeList.length === 0) {
    return { nextTrack: null }
  }

  const idx = currentTrackId !== null ? activeList.findIndex((t) => t.id === currentTrackId) : -1
  if (idx === -1) {
    return {
      nextTrack: activeList[0],
      nextShuffleOrderIds: shuffle ? orderIds : undefined
    }
  }

  if (idx + 1 < activeList.length) {
    return {
      nextTrack: activeList[idx + 1],
      nextShuffleOrderIds: shuffle ? orderIds : undefined
    }
  }

  // At end of activeList
  if (repeatMode === 'all' || (reason === 'manual-next' && repeatMode === 'one')) {
    if (shuffle && orderedTracks.length > 1) {
      const trackById = new Map(orderedTracks.map((t) => [t.id, t]))
      const freshIds = buildShuffleOrder(orderedTracks, null, rng)
      if (freshIds.length > 1 && freshIds[0] === currentTrackId) {
        const tmp = freshIds[0]
        freshIds[0] = freshIds[1]
        freshIds[1] = tmp
      }
      return {
        nextTrack: trackById.get(freshIds[0]) ?? activeList[0],
        nextShuffleOrderIds: freshIds
      }
    }

    return {
      nextTrack: activeList[0],
      nextShuffleOrderIds: shuffle ? orderIds : undefined
    }
  }

  return {
    nextTrack: null,
    nextShuffleOrderIds: shuffle ? orderIds : undefined
  }
}

export interface ResolvePreviousTrackParams {
  orderedTracks: TrackRecord[]
  shuffleOrderIds: number[]
  currentTrackId: number | null
  shuffle: boolean
  repeatMode: RepeatMode
  historyStack: TrackRecord[]
}

export interface ResolvePreviousTrackResult {
  prevTrack: TrackRecord | null
  consumedHistory: boolean
}

export function resolveNormalPreviousTrack(
  params: ResolvePreviousTrackParams
): ResolvePreviousTrackResult {
  const {
    orderedTracks,
    shuffleOrderIds,
    currentTrackId,
    shuffle,
    repeatMode,
    historyStack
  } = params

  if (historyStack.length > 0) {
    return {
      prevTrack: historyStack[0],
      consumedHistory: true
    }
  }

  if (orderedTracks.length === 0) {
    return { prevTrack: null, consumedHistory: false }
  }

  const { activeList } = buildActiveList(
    orderedTracks,
    shuffleOrderIds,
    currentTrackId,
    shuffle,
    Math.random
  )

  if (activeList.length === 0) {
    return { prevTrack: null, consumedHistory: false }
  }

  const idx = currentTrackId !== null ? activeList.findIndex((t) => t.id === currentTrackId) : -1
  if (idx > 0) {
    return { prevTrack: activeList[idx - 1], consumedHistory: false }
  }

  if (idx === 0 && repeatMode === 'all' && activeList.length > 1) {
    return { prevTrack: activeList[activeList.length - 1], consumedHistory: false }
  }

  return { prevTrack: null, consumedHistory: false }
}
