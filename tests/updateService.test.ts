import { describe, expect, it, vi } from 'vitest'
import {
  compareSemver,
  createUpdateService,
  formatReleaseNotes,
  pickReleaseDownloadUrl
} from '../src/main/updater/updateService'

describe('updateService helpers', () => {
  it('compares semver versions accurately including v-prefix and prereleases', () => {
    expect(compareSemver('1.1.0', '1.0.0')).toBeGreaterThan(0)
    expect(compareSemver('v1.2.0', '1.1.9')).toBeGreaterThan(0)
    expect(compareSemver('1.0.0', '1.0.0')).toBe(0)
    expect(compareSemver('v1.0.0', '1.0.0')).toBe(0)
    expect(compareSemver('1.0.0', '1.0.1')).toBeLessThan(0)
    expect(compareSemver('1.1.0', '1.1.0-beta.1')).toBeGreaterThan(0)
    expect(compareSemver('1.1.0-alpha.1', '1.1.0-beta.1')).toBeLessThan(0)
  })

  it('formats string and ReleaseNoteInfo[] release notes cleanly', () => {
    expect(formatReleaseNotes(null)).toBeNull()
    expect(formatReleaseNotes('   ')).toBeNull()
    expect(formatReleaseNotes('<p>Added <b>Auto-Update</b></p>')).toBe('Added Auto-Update')
    expect(
      formatReleaseNotes([
        { version: '1.1.0', note: 'In-app updater' },
        { version: '1.0.0', note: 'Initial release' }
      ])
    ).toBe('v1.1.0\nIn-app updater\n\nv1.0.0\nInitial release')
  })

  it('picks matching platform/arch download asset when present', () => {
    const assets = [
      { name: 'PulseDeck.Setup.1.1.0.exe', browser_download_url: 'https://example.com/setup.exe' },
      { name: 'PulseDeck-1.1.0-mac-arm64.dmg', browser_download_url: 'https://example.com/arm64.dmg' },
      { name: 'PulseDeck-1.1.0-mac-x64.dmg', browser_download_url: 'https://example.com/x64.dmg' }
    ]
    expect(pickReleaseDownloadUrl(assets, 'darwin', 'arm64', 'https://fallback')).toBe(
      'https://example.com/arm64.dmg'
    )
    expect(pickReleaseDownloadUrl(assets, 'darwin', 'x64', 'https://fallback')).toBe(
      'https://example.com/x64.dmg'
    )
    expect(pickReleaseDownloadUrl(assets, 'win32', 'x64', 'https://fallback')).toBe(
      'https://example.com/setup.exe'
    )
    expect(pickReleaseDownloadUrl([], 'linux', 'x64', 'https://fallback')).toBe('https://fallback')
  })
})

describe('createUpdateService (GitHub Releases API mode)', () => {
  it('detects a newer GitHub release and opens the matching download URL', async () => {
    const openExternal = vi.fn()
    const states: string[] = []
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        tag_name: 'v1.2.0',
        name: 'PulseDeck v1.2.0',
        published_at: '2026-12-01T12:00:00Z',
        body: 'New features & fixes',
        html_url: 'https://github.com/davide108/pulsedeck/releases/tag/v1.2.0',
        assets: [
          {
            name: 'PulseDeck-1.2.0-mac-arm64.dmg',
            browser_download_url: 'https://github.com/davide108/pulsedeck/releases/download/v1.2.0/PulseDeck-1.2.0-mac-arm64.dmg'
          }
        ]
      })
    })

    const service = createUpdateService({
      currentVersion: '1.1.0',
      isPackaged: true,
      platform: 'darwin',
      arch: 'arm64',
      onStateChange: (s) => states.push(s.status),
      openExternal,
      fetchFn: mockFetch as unknown as typeof fetch
    })

    expect(service.getState().canAutoInstall).toBe(false)
    const result = await service.checkForUpdates()
    expect(result.status).toBe('available')
    expect(result.latestVersion).toBe('1.2.0')
    expect(result.releaseNotes).toBe('New features & fixes')
    expect(result.releaseUrl).toContain('PulseDeck-1.2.0-mac-arm64.dmg')
    expect(states).toEqual(['checking', 'available'])

    await service.downloadUpdate()
    expect(openExternal).toHaveBeenCalledWith(result.releaseUrl)
  })

  it('reports not-available when current version matches latest release', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        tag_name: 'v1.1.0',
        name: 'PulseDeck v1.1.0',
        html_url: 'https://github.com/davide108/pulsedeck/releases/tag/v1.1.0'
      })
    })

    const service = createUpdateService({
      currentVersion: '1.1.0',
      isPackaged: false,
      platform: 'win32',
      arch: 'x64',
      fetchFn: mockFetch as unknown as typeof fetch
    })

    const result = await service.checkForUpdates()
    expect(result.status).toBe('not-available')
    expect(result.latestVersion).toBe('1.1.0')
    expect(result.error).toBeNull()
  })

  it('handles GitHub API errors gracefully without throwing', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503
    })

    const service = createUpdateService({
      currentVersion: '1.1.0',
      isPackaged: false,
      platform: 'win32',
      arch: 'x64',
      fetchFn: mockFetch as unknown as typeof fetch
    })

    const result = await service.checkForUpdates()
    expect(result.status).toBe('error')
    expect(result.error).toContain('503')
  })
})
