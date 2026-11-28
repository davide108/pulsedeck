import fs from 'node:fs'
import path from 'node:path'
import { type BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { IPC_CHANNELS } from '../shared/ipc'
import type {
  AppSettings,
  LyricsFetchOptions,
  PlayHistoryInput,
  SaveLyricsInput,
  TrackAnalysisPayload,
  TrackMetadataUpdateInput,
  TrackQueryFilter
} from '../shared/types'
import type { Repositories } from './db/repositories'
import type { LyricsService } from './lyrics/lyricsService'
import type { ArtworkCache } from './scanner/artworkCache'
import type { FolderScanner } from './scanner/folderScanner'
import type { FolderWatcher } from './scanner/folderWatcher'
import { extractTrackMetadata, inspectTrackFile } from './scanner/metadata'
import type { UpdateService } from './updater/updateService'

const MAX_LYRICS_IMPORT_BYTES = 1024 * 1024
const MAX_ARTWORK_IMPORT_BYTES = 20 * 1024 * 1024

export interface WindowController {
  minimize: () => void
  maximizeToggle: () => boolean
  close: () => void
  setMiniPlayer: (enabled: boolean) => void
  isMaximized: () => boolean
}

export interface IpcHandlerDeps {
  repos: Repositories
  scanner: FolderScanner
  watcher: FolderWatcher
  artworkCache: ArtworkCache
  lyricsService: LyricsService
  updateService: UpdateService
  getMainWindow: () => BrowserWindow | null
  windowController: WindowController
  emitTracksChanged: () => void
  scheduleTracksChanged: () => void
}

/**
 * Registers all main-process IPC handlers matching `IPC_CHANNELS` and `IpcApi`.
 */
export function registerIpcHandlers(deps: IpcHandlerDeps): void {
  const {
    repos,
    scanner,
    watcher,
    artworkCache,
    lyricsService,
    updateService,
    getMainWindow,
    windowController,
    emitTracksChanged,
    scheduleTracksChanged
  } = deps

  const openDialog = (options: Electron.OpenDialogOptions): Promise<Electron.OpenDialogReturnValue> => {
    const win = getMainWindow()
    return win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options)
  }

  ipcMain.handle(IPC_CHANNELS.FOLDERS_LIST, () => repos.folders.list())

  ipcMain.handle(IPC_CHANNELS.FOLDERS_ADD, async () => {
    const result = await openDialog({
      title: 'Select Music Folder',
      properties: ['openDirectory']
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    const folder = repos.folders.add(result.filePaths[0])
    await watcher.syncFolders(repos.folders.list())
    void scanner.scanFolder(folder)
    return folder
  })

  ipcMain.handle(IPC_CHANNELS.FOLDERS_REMOVE, async (_event, folderId: number) => {
    await watcher.unwatchFolder(folderId)
    repos.folders.remove(folderId)
    emitTracksChanged()
  })

  ipcMain.handle(
    IPC_CHANNELS.FOLDERS_TOGGLE_ACTIVE,
    async (_event, folderId: number, isActive: boolean) => {
      const updated = repos.folders.toggleActive(folderId, Boolean(isActive))
      await watcher.syncFolders(repos.folders.list())
      emitTracksChanged()
      return updated
    }
  )

  ipcMain.handle(IPC_CHANNELS.FOLDERS_RESCAN, async (_event, folderId?: number) => {
    if (typeof folderId === 'number') {
      const folder = repos.folders.getById(folderId)
      if (folder) {
        await scanner.scanFolder(folder)
      }
      return
    }
    await scanner.scanAllActive()
  })

  ipcMain.handle(IPC_CHANNELS.TRACKS_QUERY, (_event, filter?: TrackQueryFilter) =>
    repos.tracks.query(filter)
  )

  ipcMain.handle(IPC_CHANNELS.TRACKS_GET_BY_ID, (_event, id: number) => repos.tracks.getById(id))

  ipcMain.handle(IPC_CHANNELS.TRACKS_GET_FACETS, () => repos.tracks.getFacets())

  ipcMain.handle(IPC_CHANNELS.TRACKS_GET_PENDING_ANALYSIS, (_event, limit?: number) =>
    repos.tracks.getPendingAnalysis(limit)
  )

  ipcMain.handle(IPC_CHANNELS.TRACKS_SAVE_ANALYSIS, (_event, payload: TrackAnalysisPayload) => {
    repos.tracks.saveAnalysis(payload)
    scheduleTracksChanged()
  })

  ipcMain.handle(
    IPC_CHANNELS.TRACKS_MARK_MISSING,
    (_event, trackId: number, isMissing: boolean) => {
      repos.tracks.markMissing(trackId, Boolean(isMissing))
      emitTracksChanged()
    }
  )

  ipcMain.handle(IPC_CHANNELS.TRACKS_REVEAL_IN_FOLDER, async (_event, trackId: number) => {
    const track = repos.tracks.getById(trackId)
    if (!track) return
    if (fs.existsSync(track.filePath)) {
      shell.showItemInFolder(track.filePath)
      return
    }
    const parentDir = path.dirname(track.filePath)
    if (fs.existsSync(parentDir)) {
      await shell.openPath(parentDir)
    }
  })

  ipcMain.handle(
    IPC_CHANNELS.TRACKS_UPDATE_METADATA,
    (_event, trackId: number, patch: TrackMetadataUpdateInput) => {
      const updated = repos.tracks.updateMetadata(trackId, patch)
      if (updated) {
        emitTracksChanged()
      }
      return updated
    }
  )

  ipcMain.handle(IPC_CHANNELS.TRACKS_RELOAD_METADATA, async (_event, trackId: number) => {
    const track = repos.tracks.getById(trackId)
    if (!track) return null

    try {
      const stat = await fs.promises.stat(track.filePath)
      if (!stat.isFile()) return null
    } catch {
      return null
    }

    const meta = await extractTrackMetadata(track.filePath, artworkCache)
    const updated = repos.tracks.applyFileMetadata(trackId, meta)
    if (updated) {
      emitTracksChanged()
    }
    return updated
  })

  ipcMain.handle(IPC_CHANNELS.TRACKS_INSPECT_FILE, async (_event, trackId: number) => {
    const track = repos.tracks.getById(trackId)
    if (!track) return null
    return inspectTrackFile(track)
  })

  ipcMain.handle(IPC_CHANNELS.TRACKS_PICK_ARTWORK, async (_event, trackId: number) => {
    const track = repos.tracks.getById(trackId)
    if (!track) return null

    const result = await openDialog({
      title: 'Select Cover Artwork',
      properties: ['openFile'],
      filters: [
        {
          name: 'Images',
          extensions: ['jpg', 'jpeg', 'png', 'webp']
        }
      ]
    })
    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    const imagePath = result.filePaths[0]
    const stat = await fs.promises.stat(imagePath)
    if (!stat.isFile() || stat.size === 0 || stat.size > MAX_ARTWORK_IMPORT_BYTES) {
      throw new Error('Selected artwork image is invalid or exceeds 20 MB.')
    }

    const data = await fs.promises.readFile(imagePath)
    const ext = path.extname(imagePath).toLowerCase()
    const mimeType =
      ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg'
    const artworkPath = await artworkCache.save(data, mimeType)
    if (!artworkPath) return null

    const updated = repos.tracks.updateMetadata(trackId, { artworkPath })
    if (updated) {
      emitTracksChanged()
    }
    return updated
  })

  ipcMain.handle(
    IPC_CHANNELS.TRACKS_TOGGLE_LIKE,
    (_event, trackId: number, liked?: boolean) => {
      const updated = repos.tracks.toggleLike(trackId, liked)
      if (updated) {
        emitTracksChanged()
      }
      return updated
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.LYRICS_GET_FOR_TRACK,
    (_event, trackId: number, options?: LyricsFetchOptions) =>
      lyricsService.getForTrack(trackId, options)
  )

  ipcMain.handle(IPC_CHANNELS.LYRICS_SAVE, (_event, input: SaveLyricsInput) =>
    repos.lyrics.save(input)
  )

  ipcMain.handle(IPC_CHANNELS.LYRICS_IMPORT_FILE, async (_event, trackId: number) => {
    const track = repos.tracks.getById(trackId)
    if (!track) return null

    const result = await openDialog({
      title: 'Import Lyrics File',
      properties: ['openFile'],
      filters: [
        {
          name: 'Lyrics Files',
          extensions: ['lrc', 'txt']
        }
      ]
    })
    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    const filePath = result.filePaths[0]
    const stat = await fs.promises.stat(filePath)
    if (!stat.isFile()) return null
    if (stat.size > MAX_LYRICS_IMPORT_BYTES) {
      throw new Error('Lyrics file exceeds the 1 MB size limit.')
    }

    const rawText = await fs.promises.readFile(filePath, 'utf8')
    if (Buffer.byteLength(rawText, 'utf8') > MAX_LYRICS_IMPORT_BYTES) {
      throw new Error('Lyrics file exceeds the 1 MB size limit.')
    }

    return lyricsService.importFromRawText(trackId, rawText)
  })

  ipcMain.handle(IPC_CHANNELS.LYRICS_UPDATE_OFFSET, (_event, trackId: number, offsetMs: number) =>
    repos.lyrics.updateOffset(trackId, offsetMs)
  )

  ipcMain.handle(IPC_CHANNELS.LYRICS_DELETE, (_event, trackId: number) => {
    repos.lyrics.delete(trackId)
  })

  ipcMain.handle(IPC_CHANNELS.PLAYLISTS_LIST, () => repos.playlists.list())

  ipcMain.handle(
    IPC_CHANNELS.PLAYLISTS_CREATE,
    (_event, name: string, description?: string | null) => repos.playlists.create(name, description)
  )

  ipcMain.handle(
    IPC_CHANNELS.PLAYLISTS_RENAME,
    (_event, playlistId: number, name: string, description?: string | null) =>
      repos.playlists.rename(playlistId, name, description)
  )

  ipcMain.handle(IPC_CHANNELS.PLAYLISTS_DELETE, (_event, playlistId: number) => {
    repos.playlists.delete(playlistId)
  })

  ipcMain.handle(
    IPC_CHANNELS.PLAYLISTS_ADD_TRACK,
    (_event, playlistId: number, trackId: number) => {
      repos.playlists.addTrack(playlistId, trackId)
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.PLAYLISTS_REMOVE_TRACK,
    (_event, playlistId: number, trackId: number) => {
      repos.playlists.removeTrack(playlistId, trackId)
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.PLAYLISTS_REORDER_TRACKS,
    (_event, playlistId: number, orderedTrackIds: number[]) => {
      repos.playlists.reorderTracks(playlistId, orderedTrackIds)
    }
  )

  ipcMain.handle(IPC_CHANNELS.HISTORY_RECORD_PLAY, (_event, entry: PlayHistoryInput) =>
    repos.history.recordPlay(entry)
  )

  ipcMain.handle(IPC_CHANNELS.HISTORY_GET_RECENT, (_event, limit?: number) =>
    repos.history.getRecent(limit)
  )

  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET_ALL, () => repos.settings.getAll())

  ipcMain.handle(
    IPC_CHANNELS.SETTINGS_SET,
    <K extends keyof AppSettings>(_event: Electron.IpcMainInvokeEvent, key: K, value: AppSettings[K]) =>
      repos.settings.set(key, value)
  )

  ipcMain.handle(IPC_CHANNELS.WINDOW_MINIMIZE, () => {
    windowController.minimize()
  })

  ipcMain.handle(IPC_CHANNELS.WINDOW_MAXIMIZE_TOGGLE, () => windowController.maximizeToggle())

  ipcMain.handle(IPC_CHANNELS.WINDOW_CLOSE, () => {
    windowController.close()
  })

  ipcMain.handle(IPC_CHANNELS.WINDOW_SET_MINI_PLAYER, (_event, enabled: boolean) => {
    windowController.setMiniPlayer(Boolean(enabled))
  })

  ipcMain.handle(IPC_CHANNELS.WINDOW_IS_MAXIMIZED, () => windowController.isMaximized())

  ipcMain.handle(IPC_CHANNELS.UPDATER_GET_STATE, () => updateService.getState())
  ipcMain.handle(IPC_CHANNELS.UPDATER_CHECK, () => updateService.checkForUpdates())
  ipcMain.handle(IPC_CHANNELS.UPDATER_DOWNLOAD, () => updateService.downloadUpdate())
  ipcMain.handle(IPC_CHANNELS.UPDATER_INSTALL, () => updateService.quitAndInstall())
  ipcMain.handle(IPC_CHANNELS.UPDATER_OPEN_RELEASE_PAGE, () => updateService.openReleasePage())
}
