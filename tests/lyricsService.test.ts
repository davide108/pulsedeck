import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type Database from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDatabase } from '../src/main/db/database'
import { createRepositories } from '../src/main/db/repositories'
import {
  createLyricsService,
  selectBestLrclibCandidate,
  type LrclibApiItem
} from '../src/main/lyrics/lyricsService'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

describe('lyricsService & LRCLIB selection', () => {
  const openDbs: Database.Database[] = []
  const tempDirs: string[] = []

  function setupTestEnv() {
    const db = createDatabase(':memory:')
    openDbs.push(db)
    const repos = createRepositories(db)
    const folder = repos.folders.add('C:\\Music\\LyricsTest', 'LyricsTest')
    return { db, repos, folder }
  }

  function createTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulsedeck-lyrics-test-'))
    tempDirs.push(dir)
    return dir
  }

  afterEach(() => {
    while (openDbs.length > 0) {
      try {
        openDbs.pop()?.close()
      } catch {
        // ignore close errors during cleanup
      }
    }
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop()
      if (dir) {
        fs.rmSync(dir, { recursive: true, force: true })
      }
    }
  })

  it('selectBestLrclibCandidate strictly prioritizes valid synced lyrics over static and picks closest duration', () => {
    const candidates: LrclibApiItem[] = [
      {
        id: 1,
        trackName: 'Midnight City',
        artistName: 'M83',
        duration: 243,
        plainLyrics: 'Waiting in a car\nWaiting for a ride in the dark',
        syncedLyrics: null
      },
      {
        id: 2,
        trackName: 'Midnight City',
        artistName: 'M83',
        duration: 285,
        plainLyrics: 'Far duration',
        syncedLyrics: '[00:10.00] Extended version'
      },
      {
        id: 3,
        trackName: 'Midnight City',
        artistName: 'M83',
        duration: 244,
        plainLyrics: 'Closest duration',
        syncedLyrics: '[00:12.50] Waiting in a car\n[00:16.00] Waiting for a ride'
      }
    ]

    const best = selectBestLrclibCandidate(candidates, 243, 'Midnight City', 'M83')
    expect(best?.id).toBe(3)
  })

  it('upgrades /api/get static-only response by finding a synced match on /api/search', async () => {
    const { repos, folder } = setupTestEnv()
    repos.tracks.upsertBatch([
      {
        folderId: folder.id,
        filePath: 'C:\\Music\\LyricsTest\\midnight-city.mp3',
        fileSize: 5_000_000,
        fileMtime: 1_700_000_000_000,
        format: 'mp3',
        title: 'Midnight City (Official Video)',
        artist: 'M83',
        album: 'Hurry Up, We Are Dreaming',
        duration: 243
      }
    ])
    const track = repos.tracks.getByFilePath('C:\\Music\\LyricsTest\\midnight-city.mp3')!

    const calls: Array<{ url: string; userAgent: string | null; hasSignal: boolean }> = []
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      const headers = new Headers(init?.headers)
      calls.push({
        url,
        userAgent: headers.get('User-Agent'),
        hasSignal: init?.signal instanceof AbortSignal
      })

      if (url.startsWith('https://lrclib.net/api/get?')) {
        return jsonResponse({
          id: 10,
          trackName: 'Midnight City',
          artistName: 'M83',
          duration: 243,
          plainLyrics: 'Static only from /get',
          syncedLyrics: null
        } satisfies LrclibApiItem)
      }

      if (url.startsWith('https://lrclib.net/api/search?')) {
        return jsonResponse([
          {
            id: 20,
            trackName: 'Midnight City',
            artistName: 'M83',
            duration: 310,
            syncedLyrics: '[00:05.00] Live remix line'
          },
          {
            id: 21,
            trackName: 'Midnight City',
            artistName: 'M83',
            duration: 242,
            syncedLyrics: '[00:12.00] Waiting in a car\n[00:17.50] Waiting for a ride in the dark'
          }
        ] satisfies LrclibApiItem[])
      }

      return jsonResponse({ message: 'Not Found' }, 404)
    })

    const service = createLyricsService({ repos, fetchFn: fetchMock })
    const result = await service.getForTrack(track.id)

    expect(calls).toHaveLength(2)
    expect(calls[0].url).toContain('/api/get?')
    expect(calls[0].url).toContain('track_name=Midnight+City')
    expect(calls[0].userAgent).toMatch(/^PulseDeck\//)
    expect(calls[0].hasSignal).toBe(true)
    expect(calls[1].url).toContain('/api/search?')

    expect(result).not.toBeNull()
    expect(result?.source).toBe('lrclib')
    expect(result?.syncedLyrics).toBe(
      '[00:12.00] Waiting in a car\n[00:17.50] Waiting for a ride in the dark'
    )
    expect(result?.plainLyrics).toBe('Waiting in a car\nWaiting for a ride in the dark')
  })

  it('falls back to static plainLyrics when no synced lyrics exist on LRCLIB', async () => {
    const { repos, folder } = setupTestEnv()
    repos.tracks.upsertBatch([
      {
        folderId: folder.id,
        filePath: 'C:\\Music\\LyricsTest\\static-song.mp3',
        fileSize: 4_000_000,
        fileMtime: 1_700_000_000_000,
        format: 'mp3',
        title: 'Static Song',
        artist: 'Static Artist',
        album: 'Static Album',
        duration: 200
      }
    ])
    const track = repos.tracks.getByFilePath('C:\\Music\\LyricsTest\\static-song.mp3')!

    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url.startsWith('https://lrclib.net/api/get?')) {
        return jsonResponse({
          id: 30,
          trackName: 'Static Song',
          artistName: 'Static Artist',
          duration: 200,
          plainLyrics: 'Verse one\nChorus line',
          syncedLyrics: null
        } satisfies LrclibApiItem)
      }
      return jsonResponse([] satisfies LrclibApiItem[])
    })

    const service = createLyricsService({ repos, fetchFn: fetchMock })
    const result = await service.getForTrack(track.id)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result).not.toBeNull()
    expect(result?.source).toBe('lrclib')
    expect(result?.syncedLyrics).toBeNull()
    expect(result?.plainLyrics).toBe('Verse one\nChorus line')
  })

  it('caches LRCLIB results in SQLite and preserves user-imported lyrics unless forced', async () => {
    const { repos, folder } = setupTestEnv()
    repos.tracks.upsertBatch([
      {
        folderId: folder.id,
        filePath: 'C:\\Music\\LyricsTest\\cached-song.mp3',
        fileSize: 4_500_000,
        fileMtime: 1_700_000_000_000,
        format: 'mp3',
        title: 'Cached Track',
        artist: 'Cached Artist',
        album: 'Cached Album',
        duration: 180
      }
    ])
    const track = repos.tracks.getByFilePath('C:\\Music\\LyricsTest\\cached-song.mp3')!

    let networkRound = 1
    const fetchMock = vi.fn<typeof fetch>(async () => {
      return jsonResponse({
        id: 50 + networkRound,
        trackName: 'Cached Track',
        artistName: 'Cached Artist',
        duration: 180,
        syncedLyrics: `[00:05.00] Online round ${networkRound}`
      } satisfies LrclibApiItem)
    })

    const service = createLyricsService({ repos, fetchFn: fetchMock })

    // First call hits network and caches into SQLite
    const first = await service.getForTrack(track.id)
    expect(first?.syncedLyrics).toBe('[00:05.00] Online round 1')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // Second call uses SQLite cache with 0 HTTP requests
    const second = await service.getForTrack(track.id)
    expect(second?.syncedLyrics).toBe('[00:05.00] Online round 1')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // User imports plain static lyrics -> detected as static, source='user'
    const userPlain = service.importFromRawText(track.id, 'My custom static lyrics')
    expect(userPlain?.source).toBe('user')
    expect(userPlain?.syncedLyrics).toBeNull()
    expect(userPlain?.plainLyrics).toBe('My custom static lyrics')

    // User imports synced LRC -> detected as synced, strips plainLyrics, source='user'
    const userSynced = service.importFromRawText(track.id, '[00:10.00] My custom synced line')
    expect(userSynced?.source).toBe('user')
    expect(userSynced?.syncedLyrics).toBe('[00:10.00] My custom synced line')
    expect(userSynced?.plainLyrics).toBe('My custom synced line')

    // Normal getForTrack preserves user edits with 0 HTTP calls
    networkRound = 2
    const preserved = await service.getForTrack(track.id)
    expect(preserved?.source).toBe('user')
    expect(preserved?.syncedLyrics).toBe('[00:10.00] My custom synced line')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // Force refresh overwrites with fresh LRCLIB result
    const forced = await service.getForTrack(track.id, { forceRefresh: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(forced?.source).toBe('lrclib')
    expect(forced?.syncedLyrics).toBe('[00:05.00] Online round 2')
  })

  it('prioritizes local .lrc sidecar over .txt sidecar in the track folder without network requests', async () => {
    const dir = createTempDir()
    const audioPath = path.join(dir, 'sidecar-track.mp3')
    const lrcPath = path.join(dir, 'sidecar-track.lrc')
    const txtPath = path.join(dir, 'sidecar-track.txt')

    fs.writeFileSync(audioPath, 'dummy')
    fs.writeFileSync(txtPath, 'Plain text sidecar')
    fs.writeFileSync(lrcPath, '[00:03.50] Synced LRC sidecar', 'utf8')

    const db = createDatabase(':memory:')
    openDbs.push(db)
    const repos = createRepositories(db)
    const folder = repos.folders.add(dir)

    repos.tracks.upsertBatch([
      {
        folderId: folder.id,
        filePath: audioPath,
        fileSize: 5,
        fileMtime: Date.now(),
        format: 'mp3',
        title: 'Sidecar Track',
        artist: 'Local Artist',
        album: 'Local Album',
        duration: 180
      }
    ])
    const track = repos.tracks.getByFilePath(audioPath)!

    const fetchMock = vi.fn<typeof fetch>()
    const service = createLyricsService({ repos, fetchFn: fetchMock })

    const res = await service.getForTrack(track.id)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(res?.source).toBe('sidecar')
    expect(res?.syncedLyrics).toBe('[00:03.50] Synced LRC sidecar')
    expect(res?.plainLyrics).toBe('Synced LRC sidecar')

    // Remove .lrc sidecar and clear DB cache -> falls back to .txt sidecar
    fs.unlinkSync(lrcPath)
    repos.lyrics.delete(track.id)

    const txtRes = await service.getForTrack(track.id)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(txtRes?.source).toBe('sidecar')
    expect(txtRes?.syncedLyrics).toBeNull()
    expect(txtRes?.plainLyrics).toBe('Plain text sidecar')
  })

  it('resolves gracefully to null on HTTP 404 or network errors without throwing', async () => {
    const { repos, folder } = setupTestEnv()
    repos.tracks.upsertBatch([
      {
        folderId: folder.id,
        filePath: 'C:\\Music\\LyricsTest\\not-found.mp3',
        fileSize: 3_000_000,
        fileMtime: 1_700_000_000_000,
        format: 'mp3',
        title: 'Obscure Track',
        artist: 'Unknown Indie',
        album: 'Demo',
        duration: 150
      }
    ])
    const track = repos.tracks.getByFilePath('C:\\Music\\LyricsTest\\not-found.mp3')!

    const notFoundFetch = vi.fn<typeof fetch>(async () => jsonResponse({ error: 'Not Found' }, 404))
    const notFoundService = createLyricsService({ repos, fetchFn: notFoundFetch })
    await expect(notFoundService.getForTrack(track.id)).resolves.toBeNull()

    const networkErrorFetch = vi.fn<typeof fetch>(async () => {
      throw new Error('ECONNREFUSED')
    })
    const errorService = createLyricsService({ repos, fetchFn: networkErrorFetch })
    await expect(errorService.getForTrack(track.id)).resolves.toBeNull()
  })
})
