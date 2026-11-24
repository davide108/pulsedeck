import { describe, expect, it, vi } from 'vitest'
import {
  compareSemver,
  createUpdateService,
  formatReleaseNotes,
  pickReleaseDownloadUrl,
  resolveAutoUpdaterFromModule
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

  it('picks Linux AppImage by arch and falls back cleanly to deb, rpm, or fallbackUrl', () => {
    const linuxAssets = [
      {
        name: 'PulseDeck-1.3.0-linux-x86_64.AppImage.blockmap',
        browser_download_url: 'https://example.com/x86_64.AppImage.blockmap'
      },
      {
        name: 'PulseDeck-1.3.0-linux-arm64.AppImage',
        browser_download_url: 'https://example.com/arm64.AppImage'
      },
      {
        name: 'PulseDeck-1.3.0-linux-x86_64.AppImage',
        browser_download_url: 'https://example.com/x86_64.AppImage'
      },
      {
        name: 'PulseDeck-1.3.0-linux-amd64.deb',
        browser_download_url: 'https://example.com/amd64.deb'
      },
      {
        name: 'PulseDeck-1.3.0-linux-x86_64.rpm',
        browser_download_url: 'https://example.com/x86_64.rpm'
      }
    ]

    expect(pickReleaseDownloadUrl(linuxAssets, 'linux', 'x64', 'https://fallback')).toBe(
      'https://example.com/x86_64.AppImage'
    )
    expect(pickReleaseDownloadUrl(linuxAssets, 'linux', 'arm64', 'https://fallback')).toBe(
      'https://example.com/arm64.AppImage'
    )

    // Matches aarch64 tag on arm64 and generic (un-arched) AppImage on x64
    expect(
      pickReleaseDownloadUrl(
        [
          {
            name: 'PulseDeck-1.3.0-linux-aarch64.AppImage',
            browser_download_url: 'https://example.com/aarch64.AppImage'
          },
          {
            name: 'PulseDeck-1.3.0.AppImage',
            browser_download_url: 'https://example.com/generic.AppImage'
          }
        ],
        'linux',
        'arm64',
        'https://fallback'
      )
    ).toBe('https://example.com/aarch64.AppImage')
    expect(
      pickReleaseDownloadUrl(
        [
          {
            name: 'PulseDeck-1.3.0.AppImage',
            browser_download_url: 'https://example.com/generic.AppImage'
          }
        ],
        'linux',
        'x64',
        'https://fallback'
      )
    ).toBe('https://example.com/generic.AppImage')

    // Falls back to .deb when no matching .AppImage exists
    const debAndRpm = linuxAssets.filter((a) => !a.name.toLowerCase().endsWith('.appimage'))
    expect(pickReleaseDownloadUrl(debAndRpm, 'linux', 'x64', 'https://fallback')).toBe(
      'https://example.com/amd64.deb'
    )

    // Falls back to .rpm when neither .AppImage nor .deb exists
    const rpmOnly = debAndRpm.filter((a) => !a.name.toLowerCase().endsWith('.deb'))
    expect(pickReleaseDownloadUrl(rpmOnly, 'linux', 'x64', 'https://fallback')).toBe(
      'https://example.com/x86_64.rpm'
    )

    // Falls back to fallbackUrl when no compatible Linux asset exists (e.g. x64-only release on arm64)
    expect(pickReleaseDownloadUrl(debAndRpm, 'linux', 'arm64', 'https://fallback')).toBe(
      'https://fallback'
    )
    expect(
      pickReleaseDownloadUrl(
        [{ name: 'PulseDeck.Setup.1.3.0.exe', browser_download_url: 'https://example.com/setup.exe' }],
        'linux',
        'x64',
        'https://fallback'
      )
    ).toBe('https://fallback')
  })

  it('resolves autoUpdater from both named and default-wrapped CJS module shapes', () => {
    const fakeUpdater = { autoDownload: false } as unknown as import('electron-updater').AppUpdater
    expect(resolveAutoUpdaterFromModule({ autoUpdater: fakeUpdater })).toBe(fakeUpdater)
    expect(resolveAutoUpdaterFromModule({ default: { autoUpdater: fakeUpdater } })).toBe(fakeUpdater)
    expect(() => resolveAutoUpdaterFromModule({})).toThrow()
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

  it('enables native auto-install for packaged Linux AppImage builds and uses electron-updater', async () => {
    const listeners = new Map<string, (...args: unknown[]) => void>()
    const checkForUpdates = vi.fn().mockImplementation(async () => {
      listeners.get('checking-for-update')?.()
      listeners.get('update-available')?.({
        version: '1.3.0',
        releaseName: 'PulseDeck v1.3.0',
        releaseDate: '2026-12-01T12:00:00Z',
        releaseNotes: 'Linux AppImage support'
      })
    })
    const fakeUpdater = {
      autoDownload: true,
      autoInstallOnAppQuit: false,
      allowPrerelease: true,
      on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
        listeners.set(event, cb)
      }),
      checkForUpdates
    } as unknown as import('electron-updater').AppUpdater

    const fetchFn = vi.fn()
    const service = createUpdateService({
      currentVersion: '1.2.0',
      isPackaged: true,
      platform: 'linux',
      arch: 'x64',
      isAppImage: true,
      fetchFn: fetchFn as unknown as typeof fetch,
      loadAutoUpdater: async () => fakeUpdater
    })

    expect(service.getState().canAutoInstall).toBe(true)

    const result = await service.checkForUpdates()
    expect(checkForUpdates).toHaveBeenCalledTimes(1)
    expect(fetchFn).not.toHaveBeenCalled()
    expect(result.status).toBe('available')
    expect(result.latestVersion).toBe('1.3.0')
    expect(result.releaseNotes).toBe('Linux AppImage support')
    expect(result.canAutoInstall).toBe(true)

    // Unpackaged dev runs must never auto-install even if APPIMAGE is set
    const devService = createUpdateService({
      currentVersion: '1.2.0',
      isPackaged: false,
      platform: 'linux',
      arch: 'x64',
      isAppImage: true
    })
    expect(devService.getState().canAutoInstall).toBe(false)
  })

  it('uses GitHub Releases API and returns Linux download URL for non-AppImage packaged Linux builds', async () => {
    const openExternal = vi.fn()
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        tag_name: 'v1.3.0',
        name: 'PulseDeck v1.3.0',
        published_at: '2026-12-01T12:00:00Z',
        body: 'Linux packages added',
        html_url: 'https://github.com/davide108/pulsedeck/releases/tag/v1.3.0',
        assets: [
          {
            name: 'PulseDeck-1.3.0-linux-x86_64.AppImage',
            browser_download_url:
              'https://github.com/davide108/pulsedeck/releases/download/v1.3.0/PulseDeck-1.3.0-linux-x86_64.AppImage'
          },
          {
            name: 'PulseDeck-1.3.0-linux-amd64.deb',
            browser_download_url:
              'https://github.com/davide108/pulsedeck/releases/download/v1.3.0/PulseDeck-1.3.0-linux-amd64.deb'
          }
        ]
      })
    })

    const service = createUpdateService({
      currentVersion: '1.2.0',
      isPackaged: true,
      platform: 'linux',
      arch: 'x64',
      isAppImage: false,
      openExternal,
      fetchFn: mockFetch as unknown as typeof fetch
    })

    expect(service.getState().canAutoInstall).toBe(false)

    const result = await service.checkForUpdates()
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(result.status).toBe('available')
    expect(result.latestVersion).toBe('1.3.0')
    expect(result.releaseUrl).toBe(
      'https://github.com/davide108/pulsedeck/releases/download/v1.3.0/PulseDeck-1.3.0-linux-x86_64.AppImage'
    )

    await service.downloadUpdate()
    expect(openExternal).toHaveBeenCalledWith(result.releaseUrl)
  })
})
