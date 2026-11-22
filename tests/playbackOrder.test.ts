import { describe, expect, it } from 'vitest'
import {
  buildShuffleOrder,
  resolveNormalNextTrack,
  resolveNormalPreviousTrack
} from '@shared/playbackOrder'
import type { TrackRecord } from '@shared/types'

function makeTrack(id: number): TrackRecord {
  return {
    id,
    folderId: 1,
    filePath: `C:\\Music\\track-${id}.mp3`,
    fileSize: 4_000_000,
    fileMtime: 1_700_000_000_000,
    format: 'mp3',
    title: `Track ${id}`,
    artist: `Artist ${id}`,
    album: `Album ${id}`,
    albumArtist: null,
    genre: 'Electronic',
    year: 2024,
    trackNumber: id,
    duration: 210,
    artworkPath: null,
    bpm: 124,
    bpmSource: 'analyzed',
    musicalKey: 'Am',
    camelotKey: '8A',
    keySource: 'analyzed',
    replaygainDb: -1,
    energy: 0.7,
    waveformPeaks: null,
    introCueSec: 2,
    outroCueSec: 200,
    analysisStatus: 'done',
    isMissing: false,
    playCount: 0,
    lastPlayedAt: null,
    addedAt: 1_700_000_000_000 + id
  }
}

describe('playbackOrder (normal playback, shuffle & repeat modes)', () => {
  const tracks = [makeTrack(1), makeTrack(2), makeTrack(3), makeTrack(4)]

  it('plays tracks sequentially and stops at the end when repeatMode is off', () => {
    const r1 = resolveNormalNextTrack({
      orderedTracks: tracks,
      shuffleOrderIds: [],
      currentTrackId: 1,
      shuffle: false,
      repeatMode: 'off',
      reason: 'natural-end'
    })
    expect(r1.nextTrack?.id).toBe(2)

    const r2 = resolveNormalNextTrack({
      orderedTracks: tracks,
      shuffleOrderIds: [],
      currentTrackId: 2,
      shuffle: false,
      repeatMode: 'off',
      reason: 'manual-next'
    })
    expect(r2.nextTrack?.id).toBe(3)

    const endNatural = resolveNormalNextTrack({
      orderedTracks: tracks,
      shuffleOrderIds: [],
      currentTrackId: 4,
      shuffle: false,
      repeatMode: 'off',
      reason: 'natural-end'
    })
    expect(endNatural.nextTrack).toBeNull()

    const endManual = resolveNormalNextTrack({
      orderedTracks: tracks,
      shuffleOrderIds: [],
      currentTrackId: 4,
      shuffle: false,
      repeatMode: 'off',
      reason: 'manual-next'
    })
    expect(endManual.nextTrack).toBeNull()
  })

  it('wraps around on repeatMode all for both next and previous', () => {
    const atEndNatural = resolveNormalNextTrack({
      orderedTracks: tracks,
      shuffleOrderIds: [],
      currentTrackId: 4,
      shuffle: false,
      repeatMode: 'all',
      reason: 'natural-end'
    })
    expect(atEndNatural.nextTrack?.id).toBe(1)

    const atEndManual = resolveNormalNextTrack({
      orderedTracks: tracks,
      shuffleOrderIds: [],
      currentTrackId: 4,
      shuffle: false,
      repeatMode: 'all',
      reason: 'manual-next'
    })
    expect(atEndManual.nextTrack?.id).toBe(1)

    const prevFromFirst = resolveNormalPreviousTrack({
      orderedTracks: tracks,
      shuffleOrderIds: [],
      currentTrackId: 1,
      shuffle: false,
      repeatMode: 'all',
      historyStack: []
    })
    expect(prevFromFirst.prevTrack?.id).toBe(4)
    expect(prevFromFirst.consumedHistory).toBe(false)
  })

  it('replays the same song on natural end when repeatMode is one, but advances on manual next', () => {
    const replaySame = resolveNormalNextTrack({
      orderedTracks: tracks,
      shuffleOrderIds: [],
      currentTrackId: 2,
      shuffle: false,
      repeatMode: 'one',
      reason: 'natural-end'
    })
    expect(replaySame.nextTrack?.id).toBe(2)

    const manualAdvance = resolveNormalNextTrack({
      orderedTracks: tracks,
      shuffleOrderIds: [],
      currentTrackId: 2,
      shuffle: false,
      repeatMode: 'one',
      reason: 'manual-next'
    })
    expect(manualAdvance.nextTrack?.id).toBe(3)

    const manualWrap = resolveNormalNextTrack({
      orderedTracks: tracks,
      shuffleOrderIds: [],
      currentTrackId: 4,
      shuffle: false,
      repeatMode: 'one',
      reason: 'manual-next'
    })
    expect(manualWrap.nextTrack?.id).toBe(1)
  })

  it('builds a valid shuffle order keeping currentTrackId first and visits every track without duplicates', () => {
    const order = buildShuffleOrder(tracks, 3, () => 0.42)
    expect(order[0]).toBe(3)
    expect(order).toHaveLength(4)
    expect(new Set(order).size).toBe(4)

    const step1 = resolveNormalNextTrack({
      orderedTracks: tracks,
      shuffleOrderIds: order,
      currentTrackId: order[0],
      shuffle: true,
      repeatMode: 'off',
      reason: 'natural-end'
    })
    expect(step1.nextTrack?.id).toBe(order[1])

    const atLastStop = resolveNormalNextTrack({
      orderedTracks: tracks,
      shuffleOrderIds: order,
      currentTrackId: order[3],
      shuffle: true,
      repeatMode: 'off',
      reason: 'natural-end'
    })
    expect(atLastStop.nextTrack).toBeNull()
  })

  it('reshuffles on repeatMode all wrap without immediately repeating the last track', () => {
    const order = [3, 1, 4, 2]
    const wrap = resolveNormalNextTrack({
      orderedTracks: tracks,
      shuffleOrderIds: order,
      currentTrackId: 2,
      shuffle: true,
      repeatMode: 'all',
      reason: 'natural-end',
      rng: () => 0.99
    })
    expect(wrap.nextTrack).not.toBeNull()
    expect(wrap.nextTrack?.id).not.toBe(2)
    expect(wrap.nextShuffleOrderIds).toHaveLength(4)
    expect(new Set(wrap.nextShuffleOrderIds).size).toBe(4)
  })

  it('uses historyStack first when navigating to previous track', () => {
    const prev = resolveNormalPreviousTrack({
      orderedTracks: tracks,
      shuffleOrderIds: [1, 3, 2, 4],
      currentTrackId: 3,
      shuffle: true,
      repeatMode: 'off',
      historyStack: [tracks[3]]
    })
    expect(prev.prevTrack?.id).toBe(4)
    expect(prev.consumedHistory).toBe(true)

    const prevOffStart = resolveNormalPreviousTrack({
      orderedTracks: tracks,
      shuffleOrderIds: [],
      currentTrackId: 1,
      shuffle: false,
      repeatMode: 'off',
      historyStack: []
    })
    expect(prevOffStart.prevTrack).toBeNull()
  })
})
