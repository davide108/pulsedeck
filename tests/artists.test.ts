import { afterEach, describe, expect, it, vi } from 'vitest'
import type Database from 'better-sqlite3'
import {
  getPrimaryArtist,
  normalizeArtistKey,
  parseArtistList,
  pickPreferredArtistDisplayName
} from '@shared/artists'
import {
  createAutoDjSession,
  reanchorSession,
  recordEarlySkip,
  scoreCandidate,
  trackToAnchor
} from '@shared/autoDjEngine'
import type { TrackRecord } from '@shared/types'
import { createDatabase } from '../src/main/db/database'
import { createRepositories } from '../src/main/db/repositories'
import { createLyricsService, type LrclibApiItem } from '../src/main/lyrics/lyricsService'
import { resolveArtistFromTags } from '../src/main/scanner/metadata'

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

describe('artists parsing and integration', () => {
  const openDbs: Database.Database[] = []

  afterEach(() => {
    while (openDbs.length > 0) {
      try {
        openDbs.pop()?.close()
      } catch {
        // ignore close errors
      }
    }
  })

  describe('normalizeArtistKey & pickPreferredArtistDisplayName', () => {
    it('normalizes whitespace and casing for artist keys', () => {
      expect(normalizeArtistKey('  Daft   Punk  ')).toBe('daft punk')
      expect(normalizeArtistKey('TYLER, THE CREATOR')).toBe('tyler, the creator')
    })

    it('upgrades all-lowercase display names when a capitalized candidate exists', () => {
      expect(pickPreferredArtistDisplayName('daft punk', 'Daft Punk')).toBe('Daft Punk')
      expect(pickPreferredArtistDisplayName('Daft Punk', 'daft punk')).toBe('Daft Punk')
      expect(pickPreferredArtistDisplayName('10,000', '10,000')).toBe('10,000')
    })
  })

  describe('parseArtistList & getPrimaryArtist', () => {
    it('falls back to Unknown Artist for null, undefined, empty, or comma-only inputs', () => {
      expect(parseArtistList(null)).toEqual(['Unknown Artist'])
      expect(parseArtistList(undefined)).toEqual(['Unknown Artist'])
      expect(parseArtistList('   ')).toEqual(['Unknown Artist'])
      expect(parseArtistList(' , , ')).toEqual(['Unknown Artist'])
      expect(getPrimaryArtist('')).toBe('Unknown Artist')
    })

    it('splits comma-separated collaborations, trims whitespace, and deduplicates case-insensitively', () => {
      expect(parseArtistList('daft punk, Pharrell Williams,   Daft   Punk ')).toEqual([
        'Daft Punk',
        'Pharrell Williams'
      ])
      expect(getPrimaryArtist('Calvin Harris, Dua Lipa')).toBe('Calvin Harris')
    })

    it('protects well-known comma-containing artist names and numeric commas', () => {
      expect(parseArtistList('Tyler, The Creator, Frank Ocean')).toEqual([
        'Tyler, The Creator',
        'Frank Ocean'
      ])
      expect(parseArtistList('tyler, the creator, Kali Uchis')).toEqual([
        'tyler, the creator',
        'Kali Uchis'
      ])
      expect(parseArtistList('Earth, Wind & Fire, The Emotions')).toEqual([
        'Earth, Wind & Fire',
        'The Emotions'
      ])
      expect(parseArtistList('Earth, Wind and Fire')).toEqual(['Earth, Wind and Fire'])
      expect(parseArtistList('Blood, Sweat & Tears')).toEqual(['Blood, Sweat & Tears'])
      expect(parseArtistList('Crosby, Stills & Nash')).toEqual(['Crosby, Stills & Nash'])
      expect(parseArtistList('Crosby, Stills, Nash & Young, Neil Young')).toEqual([
        'Crosby, Stills, Nash & Young',
        'Neil Young'
      ])
      expect(parseArtistList('Emerson, Lake & Palmer')).toEqual(['Emerson, Lake & Palmer'])
      expect(parseArtistList('10,000 Maniacs, 2,000 Watts')).toEqual([
        '10,000 Maniacs',
        '2,000 Watts'
      ])
      expect(getPrimaryArtist('Tyler, The Creator, A$AP Rocky')).toBe('Tyler, The Creator')
    })

    it('splits artist names ending or starting with digits', () => {
      expect(parseArtistList('D12, 50 Cent')).toEqual(['D12', '50 Cent'])
      expect(parseArtistList('D12,50 Cent')).toEqual(['D12', '50 Cent'])
      expect(parseArtistList('Eminem,50 Cent')).toEqual(['Eminem', '50 Cent'])
      expect(parseArtistList('Maroon 5, Cardi B')).toEqual(['Maroon 5', 'Cardi B'])
      expect(parseArtistList('blink-182, Lil Wayne')).toEqual(['blink-182', 'Lil Wayne'])
      expect(parseArtistList('deadmau5, Kaskade')).toEqual(['deadmau5', 'Kaskade'])
      expect(parseArtistList('U2, Mary J. Blige')).toEqual(['U2', 'Mary J. Blige'])
      expect(parseArtistList('702, 112')).toEqual(['702', '112'])
      expect(parseArtistList('D12,112')).toEqual(['D12', '112'])
    })
  })

  describe('resolveArtistFromTags', () => {
    it('joins multi-value common.artists arrays while splitting embedded commas and deduplicating', () => {
      expect(
        resolveArtistFromTags(
          'Disclosure',
          ['disclosure', 'Eliza Doolittle, Disclosure', '  ', 'Unknown Artist'],
          'Fallback Artist'
        )
      ).toBe('Disclosure, Eliza Doolittle')
    })

    it('uses common.artist or fallback when common.artists has 0 or 1 entries', () => {
      expect(resolveArtistFromTags('  M83  ', ['M83'], 'Fallback Artist')).toBe('M83')
      expect(resolveArtistFromTags(undefined, ['Solo'], 'Fallback Artist')).toBe('Fallback Artist')
      expect(resolveArtistFromTags('   ', undefined, 'Fallback Artist')).toBe('Fallback Artist')
    })
  })

  describe('autoDjEngine multi-artist penalties', () => {
    it('applies back-to-back penalty when anchor and candidate share any individual artist', () => {
      const anchor = makeTrack({ id: 1, artist: 'Fred again.., Baby Keem' })
      const session = createAutoDjSession(anchor)

      const sharedCollab = makeTrack({ id: 2, artist: 'Skrillex, Fred again..' })
      const unrelated = makeTrack({ id: 3, artist: 'Four Tet' })

      const sShared = scoreCandidate(trackToAnchor(anchor), sharedCollab, session)
      const sUnrelated = scoreCandidate(trackToAnchor(anchor), unrelated, session)

      expect(sShared.penalty).toBeGreaterThanOrEqual(0.45)
      expect(sShared.total).toBeLessThan(sUnrelated.total)
    })

    it('tracks up to 12 recent individual artists and applies strongest recent-artist penalty for idx < 3', () => {
      const track1 = makeTrack({ id: 1, artist: 'Artist A, Artist B' })
      let session = createAutoDjSession(track1)
      expect(session.recentArtists).toEqual(['artist a', 'artist b'])

      // Reanchor with a solo artist C -> recentArtists = ['artist c', 'artist a', 'artist b']
      const track2 = makeTrack({ id: 2, artist: 'Artist C' })
      session = reanchorSession(session, track2)
      expect(session.recentArtists).toEqual(['artist c', 'artist a', 'artist b'])

      // Candidate collaborates with Artist A (index 1 -> 0.1) and Artist B (index 2 -> 0.05)
      // Strongest matching penalty should be 0.1
      const collabCand = makeTrack({ id: 3, artist: 'Artist B, Artist A' })
      const freshCand = makeTrack({ id: 4, artist: 'Artist Z' })

      const sCollab = scoreCandidate(trackToAnchor(track2), collabCand, session)
      const sFresh = scoreCandidate(trackToAnchor(track2), freshCand, session)
      expect(sCollab.penalty - sFresh.penalty).toBeCloseTo(0.1, 4)

      // Verify cap at 12 recent individual artists
      for (let i = 0; i < 15; i++) {
        session = reanchorSession(session, makeTrack({ id: 100 + i, artist: `Unique ${i}` }))
      }
      expect(session.recentArtists).toHaveLength(12)
    })

    it('applies early-skip penalties to each individual artist and takes max skip penalty across candidate artists', () => {
      const anchor = makeTrack({ id: 1, artist: 'Anchor Artist', genre: 'House' })
      let session = createAutoDjSession(anchor)

      const skippedCollab = makeTrack({
        id: 10,
        artist: 'Skipped One, Skipped Two',
        genre: 'Techno'
      })
      session = recordEarlySkip(session, skippedCollab, 5)
      session = recordEarlySkip(session, makeTrack({ id: 11, artist: 'Skipped Two', genre: 'Ambient' }), 5)

      expect(session.skipPenalties.artists['skipped one']).toBeCloseTo(0.3, 4)
      expect(session.skipPenalties.artists['skipped two']).toBeCloseTo(0.6, 4)

      const candWithBoth = makeTrack({
        id: 20,
        artist: 'Skipped One, Skipped Two',
        genre: 'House'
      })
      const candWithOne = makeTrack({
        id: 21,
        artist: 'Skipped One, Fresh Artist',
        genre: 'House'
      })

      const scoreBoth = scoreCandidate(trackToAnchor(anchor), candWithBoth, session)
      const scoreOne = scoreCandidate(trackToAnchor(anchor), candWithOne, session)

      expect(scoreBoth.penalty).toBeCloseTo(0.6, 4)
      expect(scoreOne.penalty).toBeCloseTo(0.3, 4)
      expect(scoreBoth.total).toBeLessThan(scoreOne.total)
    })

    it('ignores Unknown Artist when computing artist penalties', () => {
      const anchor = makeTrack({ id: 1, artist: 'Unknown Artist' })
      const session = createAutoDjSession(anchor)
      expect(session.recentArtists).toEqual([])

      const candidate = makeTrack({ id: 2, artist: 'Unknown Artist' })
      const score = scoreCandidate(trackToAnchor(anchor), candidate, session)
      expect(score.penalty).toBe(0)
    })
  })

  describe('lyricsService multi-artist primary fallback', () => {
    it('falls back to one /api/search with primary artist only when full-artist search returns no usable candidates', async () => {
      const db = createDatabase(':memory:')
      openDbs.push(db)
      const repos = createRepositories(db)
      const folder = repos.folders.add('C:\\Music\\LyricsMultiTest', 'LyricsMultiTest')

      repos.tracks.upsertBatch([
        {
          folderId: folder.id,
          filePath: 'C:\\Music\\LyricsMultiTest\\collab.mp3',
          fileSize: 4_000_000,
          fileMtime: 1_700_000_000_000,
          format: 'mp3',
          title: 'One Kiss',
          artist: 'Calvin Harris, Dua Lipa',
          album: 'One Kiss',
          duration: 214
        }
      ])
      const track = repos.tracks.getByFilePath('C:\\Music\\LyricsMultiTest\\collab.mp3')!

      const urls: string[] = []
      const fetchMock = vi.fn<typeof fetch>(async (input) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
        urls.push(url)

        if (url.includes('/api/get?')) {
          return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 })
        }

        if (url.includes('artist_name=Calvin+Harris%2C+Dua+Lipa')) {
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          })
        }

        if (url.includes('artist_name=Calvin+Harris')) {
          return new Response(
            JSON.stringify([
              {
                id: 77,
                trackName: 'One Kiss',
                artistName: 'Calvin Harris & Dua Lipa',
                duration: 214,
                syncedLyrics: '[00:08.00] One kiss is all it takes'
              } satisfies LrclibApiItem
            ]),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        }

        return new Response(JSON.stringify([]), { status: 200 })
      })

      const service = createLyricsService({ repos, fetchFn: fetchMock })
      const result = await service.getForTrack(track.id)

      expect(urls).toHaveLength(3)
      expect(urls[0]).toContain('/api/get?')
      expect(urls[1]).toContain('/api/search?')
      expect(urls[1]).toContain('artist_name=Calvin+Harris%2C+Dua+Lipa')
      expect(urls[2]).toContain('/api/search?')
      expect(urls[2]).toContain('artist_name=Calvin+Harris')
      expect(urls[2]).not.toContain('Dua+Lipa')
      expect(result?.syncedLyrics).toBe('[00:08.00] One kiss is all it takes')
    })
  })
})
