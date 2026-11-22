import { describe, expect, it } from 'vitest'
import {
  computeBpmCompatibility,
  createAutoDjSession,
  generateAutoDjQueue,
  reanchorSession,
  recordEarlySkip,
  scoreCandidate,
  trackToAnchor
} from '@shared/autoDjEngine'
import type { AutoDjQueueItem, TrackRecord } from '@shared/types'

function makeTrack(overrides: Partial<TrackRecord> & { id: number }): TrackRecord {
  const { id, ...rest } = overrides
  return {
    id,
    folderId: 1,
    filePath: `/music/track-${id}.mp3`,
    fileSize: 5_000_000,
    fileMtime: 1_700_000_000_000,
    format: 'mp3',
    title: `Track ${id}`,
    artist: `Artist ${id}`,
    album: `Album ${id}`,
    albumArtist: null,
    genre: 'Techno',
    year: 2024,
    trackNumber: id,
    duration: 300,
    artworkPath: null,
    bpm: 126,
    bpmSource: 'analyzed',
    musicalKey: 'Am',
    camelotKey: '8A',
    keySource: 'analyzed',
    replaygainDb: -1.5,
    energy: 0.75,
    waveformPeaks: [0.5, 0.7, 0.8],
    introCueSec: 8,
    outroCueSec: 280,
    analysisStatus: 'done',
    isMissing: false,
    playCount: 0,
    lastPlayedAt: null,
    addedAt: 1_700_000_000_000 + id,
    ...rest
  }
}

describe('autoDjEngine', () => {
  describe('computeBpmCompatibility', () => {
    it('recognizes exact, close, and mismatched tempos', () => {
      const exact = computeBpmCompatibility(126, 126)
      expect(exact.relation).toBe('exact')
      expect(exact.score).toBe(1)
      expect(exact.effectiveRatio).toBe(1)

      const nearExact = computeBpmCompatibility(126, 127)
      expect(nearExact.relation).toBe('exact')
      expect(nearExact.score).toBeGreaterThan(0.95)

      const close = computeBpmCompatibility(126, 132)
      expect(close.relation).toBe('close')
      expect(close.score).toBeGreaterThan(0.6)
      expect(close.score).toBeLessThan(0.95)

      const mismatch = computeBpmCompatibility(90, 140)
      expect(mismatch.relation).toBe('free')
      expect(mismatch.score).toBeLessThan(0.3)
    })

    it('supports half-time and double-time matching (70 <-> 140 BPM)', () => {
      const candDouble = computeBpmCompatibility(70, 140)
      expect(candDouble.relation).toBe('double')
      expect(candDouble.score).toBeGreaterThanOrEqual(0.9)
      expect(candDouble.effectiveRatio).toBeCloseTo(1, 3)

      const candHalf = computeBpmCompatibility(140, 70)
      expect(candHalf.relation).toBe('half')
      expect(candHalf.score).toBeGreaterThanOrEqual(0.9)
      expect(candHalf.effectiveRatio).toBeCloseTo(1, 3)

      const nearDouble = computeBpmCompatibility(71, 140)
      expect(nearDouble.relation).toBe('double')
      expect(nearDouble.score).toBeGreaterThan(0.85)
    })

    it('handles missing or non-positive BPM gracefully', () => {
      expect(computeBpmCompatibility(null, 126)).toEqual({
        score: 0.5,
        relation: 'free',
        effectiveRatio: 1
      })
      expect(computeBpmCompatibility(126, null)).toEqual({
        score: 0.5,
        relation: 'free',
        effectiveRatio: 1
      })
      expect(computeBpmCompatibility(0, 120)).toEqual({
        score: 0.5,
        relation: 'free',
        effectiveRatio: 1
      })
    })
  })

  describe('scoreCandidate & weighted criteria', () => {
    it('prefers harmonic matches, genre/energy continuity, and penalizes recent tracks & same artists', () => {
      const anchor = makeTrack({
        id: 1,
        artist: 'Charlotte de Witte',
        genre: 'Techno',
        bpm: 130,
        camelotKey: '8A',
        energy: 0.8
      })
      const session = createAutoDjSession(anchor)

      const harmonicMatch = makeTrack({
        id: 2,
        artist: 'Amelie Lens',
        genre: 'Techno',
        bpm: 130,
        camelotKey: '9A',
        energy: 0.82
      })
      const harmonicClash = makeTrack({
        id: 3,
        artist: 'Enrico Sangiuliano',
        genre: 'Techno',
        bpm: 130,
        camelotKey: '2A',
        energy: 0.82
      })
      const genreEnergyJump = makeTrack({
        id: 4,
        artist: 'Nora En Pure',
        genre: 'Ambient',
        bpm: 130,
        camelotKey: '9A',
        energy: 0.2
      })
      const sameArtistBackToBack = makeTrack({
        id: 5,
        artist: 'Charlotte de Witte',
        genre: 'Techno',
        bpm: 130,
        camelotKey: '8A',
        energy: 0.8
      })

      const sHarmonic = scoreCandidate(trackToAnchor(anchor), harmonicMatch, session)
      const sClash = scoreCandidate(trackToAnchor(anchor), harmonicClash, session)
      const sJump = scoreCandidate(trackToAnchor(anchor), genreEnergyJump, session)
      const sSameArtist = scoreCandidate(trackToAnchor(anchor), sameArtistBackToBack, session)

      expect(sHarmonic.harmonicScore).toBeGreaterThan(sClash.harmonicScore)
      expect(sHarmonic.total).toBeGreaterThan(sClash.total)

      expect(sHarmonic.flowScore).toBeGreaterThan(sJump.flowScore)
      expect(sHarmonic.total).toBeGreaterThan(sJump.total)

      expect(sSameArtist.penalty).toBeGreaterThanOrEqual(0.45)
      expect(sHarmonic.total).toBeGreaterThan(sSameArtist.total)

      // Recent track anti-repeat penalty
      const sessionWithRecent = {
        ...session,
        recentTrackIds: [1, 2]
      }
      const sRecent = scoreCandidate(trackToAnchor(anchor), harmonicMatch, sessionWithRecent)
      expect(sRecent.penalty).toBeGreaterThan(sHarmonic.penalty)
      expect(sRecent.total).toBeLessThan(sHarmonic.total)
    })
  })

  describe('recordEarlySkip', () => {
    it('lowers affinity for skipped track, artist, and genre when skipped before 20s', () => {
      const anchor = makeTrack({ id: 1, artist: 'Anchor Artist', genre: 'House' })
      const session = createAutoDjSession(anchor)

      const skipped = makeTrack({
        id: 10,
        artist: 'Skipped DJ',
        genre: 'Hardstyle',
        bpm: 126,
        camelotKey: '8A'
      })
      const sameArtistDiffTrack = makeTrack({
        id: 11,
        artist: 'Skipped DJ',
        genre: 'House',
        bpm: 126,
        camelotKey: '8A'
      })
      const sameGenreDiffArtist = makeTrack({
        id: 12,
        artist: 'Other DJ',
        genre: 'Hardstyle',
        bpm: 126,
        camelotKey: '8A'
      })

      const beforeTrack = scoreCandidate(trackToAnchor(anchor), skipped, session)
      const beforeArtist = scoreCandidate(trackToAnchor(anchor), sameArtistDiffTrack, session)
      const beforeGenre = scoreCandidate(trackToAnchor(anchor), sameGenreDiffArtist, session)

      const updated = recordEarlySkip(session, skipped, 12.5)
      expect(updated).not.toBe(session)
      expect(updated.skipPenalties.trackIds[10]).toBeGreaterThan(0)
      expect(updated.skipPenalties.artists['skipped dj']).toBeGreaterThan(0)
      expect(updated.skipPenalties.genres['hardstyle']).toBeGreaterThan(0)

      const afterTrack = scoreCandidate(trackToAnchor(anchor), skipped, updated)
      const afterArtist = scoreCandidate(trackToAnchor(anchor), sameArtistDiffTrack, updated)
      const afterGenre = scoreCandidate(trackToAnchor(anchor), sameGenreDiffArtist, updated)

      expect(afterTrack.total).toBeLessThan(beforeTrack.total)
      expect(afterArtist.total).toBeLessThan(beforeArtist.total)
      expect(afterGenre.total).toBeLessThan(beforeGenre.total)
    })

    it('does not apply skip penalties when played for 20s or longer', () => {
      const anchor = makeTrack({ id: 1, artist: 'Anchor Artist', genre: 'House' })
      const session = createAutoDjSession(anchor)
      const track = makeTrack({ id: 10, artist: 'Played DJ', genre: 'Techno' })

      const atExact20 = recordEarlySkip(session, track, 20)
      expect(atExact20).toBe(session)
      expect(atExact20.skipPenalties.trackIds[10]).toBeUndefined()

      const at45 = recordEarlySkip(session, track, 45)
      expect(at45).toBe(session)
    })
  })

  describe('generateAutoDjQueue & reanchorSession', () => {
    it('respects locked slots, excludes missing/anchor/excluded tracks, and avoids duplicates', () => {
      const anchor = makeTrack({ id: 1, artist: 'Anchor', bpm: 124, camelotKey: '8A', genre: 'House' })
      const lockedTrackA = makeTrack({
        id: 20,
        artist: 'Locked A',
        bpm: 124,
        camelotKey: '8A',
        genre: 'House'
      })
      const lockedTrackB = makeTrack({
        id: 21,
        artist: 'Locked B',
        bpm: 126,
        camelotKey: '9A',
        genre: 'House'
      })
      const missingTrack = makeTrack({ id: 99, isMissing: true, bpm: 124, camelotKey: '8A' })

      const pool: TrackRecord[] = [
        anchor,
        lockedTrackA,
        lockedTrackB,
        missingTrack,
        ...Array.from({ length: 12 }, (_, idx) =>
          makeTrack({
            id: 30 + idx,
            artist: `Pool Artist ${idx}`,
            bpm: 123 + (idx % 4),
            camelotKey: idx % 2 === 0 ? '8A' : '9A',
            genre: 'House'
          })
        ),
        // Duplicate entry in candidate list should be deduplicated
        makeTrack({ id: 30, artist: 'Pool Artist 0', bpm: 123, camelotKey: '8A', genre: 'House' })
      ]

      const lockedItems: (AutoDjQueueItem | null)[] = [
        null,
        {
          track: lockedTrackA,
          locked: true,
          score: 0.9,
          bpmScore: 1,
          harmonicScore: 1,
          flowScore: 1,
          matchReason: 'Locked',
          tempoRelation: 'exact',
          harmonicRelation: 'Exact Match'
        },
        null,
        null,
        {
          track: lockedTrackB,
          locked: true,
          score: 0.9,
          bpmScore: 1,
          harmonicScore: 1,
          flowScore: 1,
          matchReason: 'Locked',
          tempoRelation: 'exact',
          harmonicRelation: 'Exact Match'
        }
      ]

      const session = createAutoDjSession(anchor)
      const queue = generateAutoDjQueue({
        anchor,
        candidates: pool,
        session,
        lockedItems,
        count: 8,
        deterministic: true,
        excludeTrackIds: [31]
      })

      expect(queue).toHaveLength(8)
      expect(queue[1].track.id).toBe(lockedTrackA.id)
      expect(queue[1].locked).toBe(true)
      expect(queue[4].track.id).toBe(lockedTrackB.id)
      expect(queue[4].locked).toBe(true)

      const ids = queue.map((item) => item.track.id)
      expect(new Set(ids).size).toBe(ids.length)
      expect(ids).not.toContain(anchor.id)
      expect(ids).not.toContain(missingTrack.id)
      expect(ids).not.toContain(31)
    })

    it('immediately shifts the upcoming queue after reanchorSession to a totally different BPM/key/genre', () => {
      const technoAnchor = makeTrack({
        id: 1,
        artist: 'Techno Opener',
        bpm: 132,
        camelotKey: '8A',
        genre: 'Techno',
        energy: 0.88
      })

      const technoTracks = Array.from({ length: 6 }, (_, i) =>
        makeTrack({
          id: 100 + i,
          artist: `Techno DJ ${i}`,
          bpm: 131 + (i % 3),
          camelotKey: i % 2 === 0 ? '8A' : '9A',
          genre: 'Techno',
          energy: 0.85
        })
      )

      const ambientOverride = makeTrack({
        id: 200,
        artist: 'Ambient Pioneer',
        bpm: 86,
        camelotKey: '2B',
        genre: 'Ambient',
        energy: 0.25
      })

      const ambientTracks = Array.from({ length: 6 }, (_, i) =>
        makeTrack({
          id: 201 + i,
          artist: `Ambient Composer ${i}`,
          bpm: 85 + (i % 3),
          camelotKey: i % 2 === 0 ? '2B' : '3B',
          genre: 'Ambient',
          energy: 0.28
        })
      )

      const allCandidates = [...technoTracks, ambientOverride, ...ambientTracks]
      const initialSession = createAutoDjSession(technoAnchor)
      const initialQueue = generateAutoDjQueue({
        anchor: technoAnchor,
        candidates: allCandidates,
        session: initialSession,
        count: 5,
        deterministic: true
      })

      expect(initialQueue.every((item) => item.track.genre === 'Techno')).toBe(true)

      // User manually jumps to Ambient 86 BPM / 2B track
      const reanchored = reanchorSession(initialSession, ambientOverride)
      expect(reanchored.anchor.bpm).toBe(86)
      expect(reanchored.anchor.camelotKey).toBe('2B')
      expect(reanchored.anchor.genre).toBe('Ambient')

      const shiftedQueue = generateAutoDjQueue({
        anchor: ambientOverride,
        candidates: allCandidates,
        session: reanchored,
        count: 5,
        deterministic: true
      })

      expect(shiftedQueue).toHaveLength(5)
      expect(shiftedQueue.every((item) => item.track.genre === 'Ambient')).toBe(true)
      expect(shiftedQueue[0].track.bpm).toBeGreaterThanOrEqual(85)
      expect(shiftedQueue[0].track.bpm).toBeLessThanOrEqual(88)
    })
  })
})
