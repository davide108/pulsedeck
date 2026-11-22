import path from 'node:path'
import {
  app,
  BrowserWindow,
  globalShortcut,
  type Rectangle,
  screen
} from 'electron'
import { IPC_CHANNELS } from '../shared/ipc'
import type { MediaCommand, ScanProgressEvent, WindowStateEvent } from '../shared/types'
import { createDatabase } from './db/database'
import { createRepositories, type Repositories } from './db/repositories'
import { registerIpcHandlers, type WindowController } from './ipcHandlers'
import { createLyricsService } from './lyrics/lyricsService'
import { registerMediaProtocol, registerMediaScheme } from './protocol'
import { createArtworkCache } from './scanner/artworkCache'
import { createFolderScanner, type FolderScanner } from './scanner/folderScanner'
import { createFolderWatcher, type FolderWatcher } from './scanner/folderWatcher'

const DEFAULT_WIDTH = 1360
const DEFAULT_HEIGHT = 860
const MIN_WIDTH = 960
const MIN_HEIGHT = 620
const MINI_WIDTH = 392
const MINI_HEIGHT = 164
const WINDOW_BOUNDS_SETTINGS_KEY = 'windowBounds'

interface PersistedWindowBounds {
  x?: number
  y?: number
  width: number
  height: number
  isMaximized?: boolean
}

// Register media:// scheme privilege before app is ready.
registerMediaScheme()

if (process.platform === 'win32') {
  app.setAppUserModelId('com.pulsedeck.player')
}

const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
}

let mainWindow: BrowserWindow | null = null
let isMiniPlayer = false
let restoreBounds: Rectangle | null = null
let wasMaximizedBeforeMini = false
let boundsSaveTimer: ReturnType<typeof setTimeout> | null = null
let tracksChangedTimer: ReturnType<typeof setTimeout> | null = null

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function rectanglesIntersectEnough(a: Rectangle, b: Rectangle): boolean {
  const overlapX = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
  const overlapY = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
  return overlapX >= 80 && overlapY >= 40
}

function validateWindowBounds(saved: PersistedWindowBounds | null): {
  bounds: Rectangle
  isMaximized: boolean
} {
  const primaryWorkArea = screen.getPrimaryDisplay().workArea
  const displays = screen.getAllDisplays()

  const rawWidth =
    typeof saved?.width === 'number' && Number.isFinite(saved.width)
      ? saved.width
      : DEFAULT_WIDTH
  const rawHeight =
    typeof saved?.height === 'number' && Number.isFinite(saved.height)
      ? saved.height
      : DEFAULT_HEIGHT

  if (
    saved &&
    typeof saved.x === 'number' &&
    Number.isFinite(saved.x) &&
    typeof saved.y === 'number' &&
    Number.isFinite(saved.y)
  ) {
    const candidate: Rectangle = {
      x: Math.round(saved.x),
      y: Math.round(saved.y),
      width: Math.round(rawWidth),
      height: Math.round(rawHeight)
    }

    const matchingDisplay = displays.find((d) =>
      rectanglesIntersectEnough(candidate, d.workArea)
    )

    if (matchingDisplay) {
      const work = matchingDisplay.workArea
      const width = clamp(candidate.width, Math.min(MIN_WIDTH, work.width), work.width)
      const height = clamp(candidate.height, Math.min(MIN_HEIGHT, work.height), work.height)
      const x = clamp(candidate.x, work.x, Math.max(work.x, work.x + work.width - width))
      const y = clamp(candidate.y, work.y, Math.max(work.y, work.y + work.height - height))
      return {
        bounds: { x, y, width, height },
        isMaximized: Boolean(saved.isMaximized)
      }
    }
  }

  const width = clamp(Math.round(rawWidth), Math.min(MIN_WIDTH, primaryWorkArea.width), primaryWorkArea.width)
  const height = clamp(
    Math.round(rawHeight),
    Math.min(MIN_HEIGHT, primaryWorkArea.height),
    primaryWorkArea.height
  )
  const x = Math.round(primaryWorkArea.x + (primaryWorkArea.width - width) / 2)
  const y = Math.round(primaryWorkArea.y + (primaryWorkArea.height - height) / 2)

  return {
    bounds: { x, y, width, height },
    isMaximized: Boolean(saved?.isMaximized)
  }
}

function sendToRenderer<T>(channel: string, payload?: T): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.webContents.isDestroyed()) return
  if (payload === undefined) {
    mainWindow.webContents.send(channel)
  } else {
    mainWindow.webContents.send(channel, payload)
  }
}

function emitWindowState(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const payload: WindowStateEvent = {
    isMaximized: isMiniPlayer ? false : mainWindow.isMaximized(),
    isMiniPlayer
  }
  sendToRenderer(IPC_CHANNELS.EVENT_WINDOW_STATE_CHANGED, payload)
}

function persistCurrentBounds(repos: Repositories): void {
  if (!mainWindow || mainWindow.isDestroyed() || isMiniPlayer) return
  const maximized = mainWindow.isMaximized()
  const rect = maximized ? mainWindow.getNormalBounds() : mainWindow.getBounds()
  repos.settings.setRaw(WINDOW_BOUNDS_SETTINGS_KEY, {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    isMaximized: maximized
  } satisfies PersistedWindowBounds)
}

function registerMediaShortcuts(): void {
  const bindings: Array<[string, MediaCommand]> = [
    ['MediaPlayPause', 'play-pause'],
    ['MediaNextTrack', 'next'],
    ['MediaPreviousTrack', 'previous'],
    ['MediaStop', 'stop']
  ]

  for (const [accelerator, command] of bindings) {
    try {
      globalShortcut.register(accelerator, () => {
        sendToRenderer(IPC_CHANNELS.EVENT_MEDIA_COMMAND, command)
      })
    } catch (err) {
      console.warn(`[shortcuts] Failed to register ${accelerator}:`, err)
    }
  }
}

function createWindow(repos: Repositories): BrowserWindow {
  const saved = repos.settings.getRaw<PersistedWindowBounds>(WINDOW_BOUNDS_SETTINGS_KEY)
  const { bounds, isMaximized } = validateWindowBounds(saved)
  restoreBounds = { ...bounds }

  const win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    frame: false,
    backgroundColor: '#090A0F',
    show: false,
    title: 'PulseDeck',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      sandbox: true
    }
  })

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  win.webContents.on('will-navigate', (event, targetUrl) => {
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (devUrl && targetUrl.startsWith(devUrl)) {
      return
    }
    if (targetUrl.startsWith('file://')) {
      return
    }
    event.preventDefault()
  })

  win.once('ready-to-show', () => {
    if (isMaximized) {
      win.maximize()
    }
    win.show()
    emitWindowState()
  })

  const scheduleBoundsSave = (): void => {
    if (isMiniPlayer) return
    if (boundsSaveTimer) clearTimeout(boundsSaveTimer)
    boundsSaveTimer = setTimeout(() => {
      boundsSaveTimer = null
      persistCurrentBounds(repos)
    }, 300)
  }

  win.on('resize', scheduleBoundsSave)
  win.on('move', scheduleBoundsSave)
  win.on('maximize', emitWindowState)
  win.on('unmaximize', emitWindowState)

  win.on('close', () => {
    if (boundsSaveTimer) {
      clearTimeout(boundsSaveTimer)
      boundsSaveTimer = null
    }
    persistCurrentBounds(repos)
  })

  win.on('closed', () => {
    mainWindow = null
  })

  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  if (rendererUrl) {
    void win.loadURL(rendererUrl)
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  return win
}

app.on('second-instance', () => {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
})

if (gotSingleInstanceLock) {
  app.whenReady().then(async () => {
    const userDataDir = app.getPath('userData')
    const dbPath = path.join(userDataDir, 'library.db')
    const db = createDatabase(dbPath)
    const repos = createRepositories(db)
    const artworkCache = createArtworkCache(userDataDir)
    const lyricsService = createLyricsService({ repos })

    registerMediaProtocol(repos, artworkCache)

    const emitTracksChanged = (): void => {
      sendToRenderer(IPC_CHANNELS.EVENT_TRACKS_CHANGED)
    }

    const scheduleTracksChanged = (): void => {
      if (tracksChangedTimer) clearTimeout(tracksChangedTimer)
      tracksChangedTimer = setTimeout(() => {
        tracksChangedTimer = null
        emitTracksChanged()
      }, 450)
    }

    const scanner: FolderScanner = createFolderScanner({
      repos,
      artworkCache,
      onProgress: (event: ScanProgressEvent) => {
        sendToRenderer(IPC_CHANNELS.EVENT_SCAN_PROGRESS, event)
      },
      onTracksChanged: emitTracksChanged
    })

    const watcher: FolderWatcher = createFolderWatcher({
      repos,
      artworkCache,
      onTracksChanged: emitTracksChanged
    })

    const windowController: WindowController = {
      minimize: () => {
        mainWindow?.minimize()
      },
      maximizeToggle: () => {
        if (!mainWindow || mainWindow.isDestroyed() || isMiniPlayer) return false
        if (mainWindow.isMaximized()) {
          mainWindow.unmaximize()
          return false
        }
        mainWindow.maximize()
        return true
      },
      close: () => {
        mainWindow?.close()
      },
      isMaximized: () => {
        if (!mainWindow || mainWindow.isDestroyed() || isMiniPlayer) return false
        return mainWindow.isMaximized()
      },
      setMiniPlayer: (enabled: boolean) => {
        if (!mainWindow || mainWindow.isDestroyed() || enabled === isMiniPlayer) return

        if (enabled) {
          wasMaximizedBeforeMini = mainWindow.isMaximized()
          restoreBounds = wasMaximizedBeforeMini
            ? mainWindow.getNormalBounds()
            : mainWindow.getBounds()

          if (wasMaximizedBeforeMini) {
            mainWindow.unmaximize()
          }

          isMiniPlayer = true
          mainWindow.setMinimumSize(MINI_WIDTH, MINI_HEIGHT)
          mainWindow.setResizable(false)
          mainWindow.setMaximizable(false)
          mainWindow.setAlwaysOnTop(true)

          const displayWork = screen.getDisplayMatching(restoreBounds).workArea
          const x = clamp(
            restoreBounds.x,
            displayWork.x,
            Math.max(displayWork.x, displayWork.x + displayWork.width - MINI_WIDTH)
          )
          const y = clamp(
            restoreBounds.y,
            displayWork.y,
            Math.max(displayWork.y, displayWork.y + displayWork.height - MINI_HEIGHT)
          )
          mainWindow.setBounds({ x, y, width: MINI_WIDTH, height: MINI_HEIGHT })
          emitWindowState()
          return
        }

        isMiniPlayer = false
        mainWindow.setAlwaysOnTop(false)
        mainWindow.setMaximizable(true)
        mainWindow.setResizable(true)
        mainWindow.setMinimumSize(MIN_WIDTH, MIN_HEIGHT)

        const validated = validateWindowBounds(
          restoreBounds
            ? {
                x: restoreBounds.x,
                y: restoreBounds.y,
                width: restoreBounds.width,
                height: restoreBounds.height,
                isMaximized: wasMaximizedBeforeMini
              }
            : null
        )
        mainWindow.setBounds(validated.bounds)
        if (wasMaximizedBeforeMini) {
          mainWindow.maximize()
        }
        emitWindowState()
      }
    }

    registerIpcHandlers({
      repos,
      scanner,
      watcher,
      artworkCache,
      lyricsService,
      getMainWindow: () => mainWindow,
      windowController,
      emitTracksChanged,
      scheduleTracksChanged
    })

    mainWindow = createWindow(repos)
    registerMediaShortcuts()

    await watcher.syncFolders(repos.folders.list())
    void scanner.scanAllActive()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createWindow(repos)
      }
    })

    let cleanedUp = false
    const cleanup = async (): Promise<void> => {
      if (cleanedUp) return
      cleanedUp = true
      globalShortcut.unregisterAll()
      if (boundsSaveTimer) {
        clearTimeout(boundsSaveTimer)
        boundsSaveTimer = null
      }
      if (tracksChangedTimer) {
        clearTimeout(tracksChangedTimer)
        tracksChangedTimer = null
      }
      await watcher.closeAll()
      try {
        db.close()
      } catch {
        // Ignore DB close errors during shutdown.
      }
    }

    app.on('before-quit', () => {
      void cleanup()
    })

    app.on('will-quit', () => {
      globalShortcut.unregisterAll()
    })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
