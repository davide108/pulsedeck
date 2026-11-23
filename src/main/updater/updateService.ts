import type { AppUpdater, ProgressInfo, UpdateInfo } from 'electron-updater'
import type { UpdateState } from '../../shared/types'

export const GITHUB_REPO_OWNER = 'davide108'
export const GITHUB_REPO_NAME = 'pulsedeck'
export const GITHUB_RELEASES_URL = `https://github.com/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/releases/latest`
const GITHUB_LATEST_API_URL = `https://api.github.com/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/releases/latest`
const FETCH_TIMEOUT_MS = 10_000

interface GitHubReleaseAsset {
  name?: string
  browser_download_url?: string
}

interface GitHubLatestReleasePayload {
  tag_name?: string
  name?: string
  published_at?: string
  body?: string
  html_url?: string
  assets?: GitHubReleaseAsset[]
}

/**
 * Strips leading "v" and parses a semver string into numeric parts + optional prerelease tag.
 */
function parseSemver(version: string): { major: number; minor: number; patch: number; pre: string } {
  const cleaned = version.trim().replace(/^v/i, '')
  const [core, ...preParts] = cleaned.split('-')
  const [maj = '0', min = '0', pat = '0'] = core.split('.')
  return {
    major: Number.parseInt(maj, 10) || 0,
    minor: Number.parseInt(min, 10) || 0,
    patch: Number.parseInt(pat, 10) || 0,
    pre: preParts.join('-').trim()
  }
}

/**
 * Compares two semver strings. Returns >0 if a > b, <0 if a < b, 0 if equal.
 */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a)
  const pb = parseSemver(b)

  if (pa.major !== pb.major) return pa.major - pb.major
  if (pa.minor !== pb.minor) return pa.minor - pb.minor
  if (pa.patch !== pb.patch) return pa.patch - pb.patch

  if (!pa.pre && !pb.pre) return 0
  if (!pa.pre && pb.pre) return 1
  if (pa.pre && !pb.pre) return -1
  return pa.pre.localeCompare(pb.pre)
}

/**
 * Normalizes electron-updater release notes (string, ReleaseNoteInfo[], or null) into plain text.
 */
export function formatReleaseNotes(raw: unknown): string | null {
  if (!raw) return null
  if (typeof raw === 'string') {
    const stripped = raw
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<[^>]+>/g, '')
      .trim()
    return stripped.length > 0 ? stripped : null
  }
  if (Array.isArray(raw)) {
    const joined = raw
      .map((entry) => {
        if (typeof entry === 'string') return entry
        if (entry && typeof entry === 'object' && 'note' in entry && typeof entry.note === 'string') {
          const ver = 'version' in entry && typeof entry.version === 'string' ? `v${entry.version}\n` : ''
          return `${ver}${entry.note}`
        }
        return ''
      })
      .filter(Boolean)
      .join('\n\n')
      .trim()
    return joined.length > 0 ? formatReleaseNotes(joined) : null
  }
  return null
}

/**
 * Picks the best GitHub Release URL or matching platform asset URL for manual downloads.
 */
export function pickReleaseDownloadUrl(
  assets: GitHubReleaseAsset[] | undefined,
  platform: NodeJS.Platform,
  arch: string,
  fallbackUrl: string
): string {
  if (!Array.isArray(assets) || assets.length === 0) return fallbackUrl

  if (platform === 'darwin') {
    const archTag = arch === 'arm64' ? 'arm64' : 'x64'
    const dmg = assets.find(
      (a) => typeof a.name === 'string' && a.name.endsWith('.dmg') && a.name.includes(archTag)
    )
    if (dmg?.browser_download_url) return dmg.browser_download_url
  } else if (platform === 'win32') {
    const setup = assets.find(
      (a) =>
        typeof a.name === 'string' &&
        a.name.endsWith('.exe') &&
        a.name.toLowerCase().includes('setup')
    )
    if (setup?.browser_download_url) return setup.browser_download_url
  }

  return fallbackUrl
}

/**
 * Extracts `autoUpdater` from either direct ESM named exports or CJS-interop `default` exports.
 */
export function resolveAutoUpdaterFromModule(mod: unknown): AppUpdater {
  if (mod && typeof mod === 'object') {
    const record = mod as {
      autoUpdater?: AppUpdater
      default?: { autoUpdater?: AppUpdater }
    }
    const candidate = record.autoUpdater ?? record.default?.autoUpdater
    if (candidate) {
      return candidate
    }
  }
  throw new Error('Failed to load electron-updater autoUpdater instance.')
}

export interface UpdateServiceOptions {
  currentVersion: string
  isPackaged: boolean
  platform?: NodeJS.Platform
  arch?: string
  isPortable?: boolean
  onStateChange?: (state: UpdateState) => void
  openExternal?: (url: string) => Promise<void> | void
  fetchFn?: typeof fetch
  loadAutoUpdater?: () => Promise<AppUpdater>
}

export interface UpdateService {
  getState: () => UpdateState
  checkForUpdates: () => Promise<UpdateState>
  downloadUpdate: () => Promise<UpdateState>
  quitAndInstall: () => Promise<void>
  openReleasePage: () => Promise<void>
}

export function createUpdateService(options: UpdateServiceOptions): UpdateService {
  const platform = options.platform ?? process.platform
  const arch = options.arch ?? process.arch
  const isPortable = options.isPortable ?? Boolean(process.env.PORTABLE_EXECUTABLE_FILE)
  const fetchFn = options.fetchFn ?? globalThis.fetch
  const openExternal = options.openExternal ?? (() => undefined)

  // Full silent in-app install is supported on packaged Windows NSIS installs.
  // Unsigned macOS apps cannot pass Squirrel.Mac signature verification, and portable/dev builds
  // don't have an NSIS installer target, so those check GitHub Releases and open the installer URL.
  const canAutoInstall = options.isPackaged && platform === 'win32' && !isPortable

  let state: UpdateState = {
    status: 'idle',
    currentVersion: options.currentVersion,
    latestVersion: null,
    releaseName: null,
    releaseDate: null,
    releaseNotes: null,
    releaseUrl: GITHUB_RELEASES_URL,
    downloadPercent: 0,
    bytesPerSecond: 0,
    transferredBytes: 0,
    totalBytes: 0,
    canAutoInstall,
    checkedAt: null,
    error: null
  }

  let updaterInstance: AppUpdater | null = null
  let updaterInitialized = false

  function updateState(patch: Partial<UpdateState>): UpdateState {
    state = { ...state, ...patch }
    options.onStateChange?.(state)
    return state
  }

  async function ensureAutoUpdater(): Promise<AppUpdater> {
    if (updaterInstance && updaterInitialized) {
      return updaterInstance
    }

    const loader =
      options.loadAutoUpdater ??
      (async () => {
        const mod = await import('electron-updater')
        return resolveAutoUpdaterFromModule(mod)
      })

    const updater = await loader()
    updater.autoDownload = false
    updater.autoInstallOnAppQuit = true
    updater.allowPrerelease = false

    if (!updaterInitialized) {
      updaterInitialized = true

      updater.on('checking-for-update', () => {
        updateState({
          status: 'checking',
          error: null
        })
      })

      updater.on('update-available', (info: UpdateInfo) => {
        const version = info.version.replace(/^v/i, '')
        updateState({
          status: 'available',
          latestVersion: version,
          releaseName: info.releaseName || `PulseDeck v${version}`,
          releaseDate: info.releaseDate || null,
          releaseNotes: formatReleaseNotes(info.releaseNotes),
          releaseUrl: `https://github.com/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/releases/tag/v${version}`,
          downloadPercent: 0,
          bytesPerSecond: 0,
          transferredBytes: 0,
          totalBytes: 0,
          checkedAt: Date.now(),
          error: null
        })
      })

      updater.on('update-not-available', (info: UpdateInfo) => {
        const version = info?.version ? info.version.replace(/^v/i, '') : options.currentVersion
        updateState({
          status: 'not-available',
          latestVersion: version,
          releaseName: info?.releaseName || null,
          releaseDate: info?.releaseDate || null,
          releaseNotes: null,
          downloadPercent: 0,
          bytesPerSecond: 0,
          transferredBytes: 0,
          totalBytes: 0,
          checkedAt: Date.now(),
          error: null
        })
      })

      updater.on('download-progress', (progress: ProgressInfo) => {
        updateState({
          status: 'downloading',
          downloadPercent: Math.max(0, Math.min(100, progress.percent)),
          bytesPerSecond: progress.bytesPerSecond || 0,
          transferredBytes: progress.transferred || 0,
          totalBytes: progress.total || 0,
          error: null
        })
      })

      updater.on('update-downloaded', (info: UpdateInfo) => {
        const version = info.version.replace(/^v/i, '')
        updateState({
          status: 'downloaded',
          latestVersion: version,
          releaseName: info.releaseName || state.releaseName || `PulseDeck v${version}`,
          releaseDate: info.releaseDate || state.releaseDate,
          releaseNotes: formatReleaseNotes(info.releaseNotes) ?? state.releaseNotes,
          downloadPercent: 100,
          bytesPerSecond: 0,
          error: null
        })
      })

      updater.on('error', (err: Error) => {
        updateState({
          status: 'error',
          bytesPerSecond: 0,
          checkedAt: Date.now(),
          error: err?.message || 'Failed to check for updates.'
        })
      })
    }

    updaterInstance = updater
    return updater
  }

  async function checkViaGitHubApi(): Promise<UpdateState> {
    updateState({
      status: 'checking',
      error: null
    })

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

    try {
      const response = await fetchFn(GITHUB_LATEST_API_URL, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': `PulseDeck/${options.currentVersion}`
        },
        signal: controller.signal
      })

      if (!response.ok) {
        throw new Error(`GitHub API responded with HTTP ${response.status}`)
      }

      const payload = (await response.json()) as GitHubLatestReleasePayload
      const rawTag = payload.tag_name?.trim()
      if (!rawTag) {
        throw new Error('Latest GitHub release is missing a version tag.')
      }

      const latestVersion = rawTag.replace(/^v/i, '')
      const releasePageUrl = payload.html_url || GITHUB_RELEASES_URL
      const downloadUrl = pickReleaseDownloadUrl(payload.assets, platform, arch, releasePageUrl)
      const isNewer = compareSemver(latestVersion, options.currentVersion) > 0

      if (isNewer) {
        return updateState({
          status: 'available',
          latestVersion,
          releaseName: payload.name?.trim() || `PulseDeck v${latestVersion}`,
          releaseDate: payload.published_at || null,
          releaseNotes: formatReleaseNotes(payload.body),
          releaseUrl: downloadUrl,
          downloadPercent: 0,
          bytesPerSecond: 0,
          transferredBytes: 0,
          totalBytes: 0,
          checkedAt: Date.now(),
          error: null
        })
      }

      return updateState({
        status: 'not-available',
        latestVersion,
        releaseName: payload.name?.trim() || null,
        releaseDate: payload.published_at || null,
        releaseNotes: null,
        releaseUrl: releasePageUrl,
        downloadPercent: 0,
        bytesPerSecond: 0,
        transferredBytes: 0,
        totalBytes: 0,
        checkedAt: Date.now(),
        error: null
      })
    } catch (err) {
      const message =
        err instanceof Error && err.name === 'AbortError'
          ? 'Update check timed out. Please check your internet connection.'
          : err instanceof Error
            ? err.message
            : 'Unable to reach GitHub Releases.'

      return updateState({
        status: 'error',
        checkedAt: Date.now(),
        error: message
      })
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    getState(): UpdateState {
      return state
    },

    async checkForUpdates(): Promise<UpdateState> {
      if (state.status === 'checking' || state.status === 'downloading') {
        return state
      }

      if (!canAutoInstall) {
        return checkViaGitHubApi()
      }

      updateState({
        status: 'checking',
        error: null
      })

      try {
        const updater = await ensureAutoUpdater()
        await updater.checkForUpdates()
        return state
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to check for updates.'
        return updateState({
          status: 'error',
          checkedAt: Date.now(),
          error: message
        })
      }
    },

    async downloadUpdate(): Promise<UpdateState> {
      if (state.status === 'downloading' || state.status === 'downloaded') {
        return state
      }

      if (!canAutoInstall) {
        await openExternal(state.releaseUrl || GITHUB_RELEASES_URL)
        return state
      }

      updateState({
        status: 'downloading',
        downloadPercent: 0,
        bytesPerSecond: 0,
        transferredBytes: 0,
        totalBytes: 0,
        error: null
      })

      try {
        const updater = await ensureAutoUpdater()
        await updater.downloadUpdate()
        return state
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to download update.'
        return updateState({
          status: 'error',
          bytesPerSecond: 0,
          error: message
        })
      }
    },

    async quitAndInstall(): Promise<void> {
      if (!canAutoInstall) {
        await openExternal(state.releaseUrl || GITHUB_RELEASES_URL)
        return
      }
      const updater = await ensureAutoUpdater()
      updater.quitAndInstall(false, true)
    },

    async openReleasePage(): Promise<void> {
      await openExternal(state.releaseUrl || GITHUB_RELEASES_URL)
    }
  }
}
