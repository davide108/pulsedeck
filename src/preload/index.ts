import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC_CHANNELS, type IpcApi } from '../shared/ipc'
import type {
  AppSettings,
  LyricsFetchOptions,
  MediaCommand,
  PlayHistoryInput,
  SaveLyricsInput,
  ScanProgressEvent,
  TrackAnalysisPayload,
  TrackMetadataUpdateInput,
  TrackQueryFilter,
  WindowStateEvent
} from '../shared/types'

const api: IpcApi = {
  platform: process.platform,
  folders: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.FOLDERS_LIST),
    add: () => ipcRenderer.invoke(IPC_CHANNELS.FOLDERS_ADD),
    remove: (folderId: number) => ipcRenderer.invoke(IPC_CHANNELS.FOLDERS_REMOVE, folderId),
    toggleActive: (folderId: number, isActive: boolean) =>
      ipcRenderer.invoke(IPC_CHANNELS.FOLDERS_TOGGLE_ACTIVE, folderId, isActive),
    rescan: (folderId?: number) => ipcRenderer.invoke(IPC_CHANNELS.FOLDERS_RESCAN, folderId)
  },

  tracks: {
    query: (filter?: TrackQueryFilter) => ipcRenderer.invoke(IPC_CHANNELS.TRACKS_QUERY, filter),
    getById: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.TRACKS_GET_BY_ID, id),
    getFacets: () => ipcRenderer.invoke(IPC_CHANNELS.TRACKS_GET_FACETS),
    getPendingAnalysis: (limit?: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.TRACKS_GET_PENDING_ANALYSIS, limit),
    saveAnalysis: (payload: TrackAnalysisPayload) =>
      ipcRenderer.invoke(IPC_CHANNELS.TRACKS_SAVE_ANALYSIS, payload),
    markMissing: (trackId: number, isMissing: boolean) =>
      ipcRenderer.invoke(IPC_CHANNELS.TRACKS_MARK_MISSING, trackId, isMissing),
    revealInFolder: (trackId: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.TRACKS_REVEAL_IN_FOLDER, trackId),
    updateMetadata: (trackId: number, patch: TrackMetadataUpdateInput) =>
      ipcRenderer.invoke(IPC_CHANNELS.TRACKS_UPDATE_METADATA, trackId, patch),
    reloadMetadata: (trackId: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.TRACKS_RELOAD_METADATA, trackId),
    inspectFile: (trackId: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.TRACKS_INSPECT_FILE, trackId),
    pickArtwork: (trackId: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.TRACKS_PICK_ARTWORK, trackId)
  },

  lyrics: {
    getForTrack: (trackId: number, options?: LyricsFetchOptions) =>
      ipcRenderer.invoke(IPC_CHANNELS.LYRICS_GET_FOR_TRACK, trackId, options),
    save: (input: SaveLyricsInput) => ipcRenderer.invoke(IPC_CHANNELS.LYRICS_SAVE, input),
    importFile: (trackId: number) => ipcRenderer.invoke(IPC_CHANNELS.LYRICS_IMPORT_FILE, trackId),
    updateOffset: (trackId: number, offsetMs: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.LYRICS_UPDATE_OFFSET, trackId, offsetMs),
    delete: (trackId: number) => ipcRenderer.invoke(IPC_CHANNELS.LYRICS_DELETE, trackId)
  },

  playlists: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.PLAYLISTS_LIST),
    create: (name: string, description?: string | null) =>
      ipcRenderer.invoke(IPC_CHANNELS.PLAYLISTS_CREATE, name, description),
    rename: (playlistId: number, name: string, description?: string | null) =>
      ipcRenderer.invoke(IPC_CHANNELS.PLAYLISTS_RENAME, playlistId, name, description),
    delete: (playlistId: number) => ipcRenderer.invoke(IPC_CHANNELS.PLAYLISTS_DELETE, playlistId),
    addTrack: (playlistId: number, trackId: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.PLAYLISTS_ADD_TRACK, playlistId, trackId),
    removeTrack: (playlistId: number, trackId: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.PLAYLISTS_REMOVE_TRACK, playlistId, trackId),
    reorderTracks: (playlistId: number, orderedTrackIds: number[]) =>
      ipcRenderer.invoke(IPC_CHANNELS.PLAYLISTS_REORDER_TRACKS, playlistId, orderedTrackIds)
  },

  history: {
    recordPlay: (entry: PlayHistoryInput) =>
      ipcRenderer.invoke(IPC_CHANNELS.HISTORY_RECORD_PLAY, entry),
    getRecent: (limit?: number) => ipcRenderer.invoke(IPC_CHANNELS.HISTORY_GET_RECENT, limit)
  },

  settings: {
    getAll: () => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET_ALL),
    set: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) =>
      ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_SET, key, value)
  },

  window: {
    minimize: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_MINIMIZE),
    maximizeToggle: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_MAXIMIZE_TOGGLE),
    close: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_CLOSE),
    setMiniPlayer: (enabled: boolean) =>
      ipcRenderer.invoke(IPC_CHANNELS.WINDOW_SET_MINI_PLAYER, enabled),
    isMaximized: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_IS_MAXIMIZED)
  },

  events: {
    onScanProgress: (callback: (event: ScanProgressEvent) => void) => {
      const listener = (_event: IpcRendererEvent, payload: ScanProgressEvent): void => {
        callback(payload)
      }
      ipcRenderer.on(IPC_CHANNELS.EVENT_SCAN_PROGRESS, listener)
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.EVENT_SCAN_PROGRESS, listener)
      }
    },

    onTracksChanged: (callback: () => void) => {
      const listener = (): void => {
        callback()
      }
      ipcRenderer.on(IPC_CHANNELS.EVENT_TRACKS_CHANGED, listener)
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.EVENT_TRACKS_CHANGED, listener)
      }
    },

    onMediaCommand: (callback: (command: MediaCommand) => void) => {
      const listener = (_event: IpcRendererEvent, command: MediaCommand): void => {
        callback(command)
      }
      ipcRenderer.on(IPC_CHANNELS.EVENT_MEDIA_COMMAND, listener)
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.EVENT_MEDIA_COMMAND, listener)
      }
    },

    onWindowStateChanged: (callback: (state: WindowStateEvent) => void) => {
      const listener = (_event: IpcRendererEvent, state: WindowStateEvent): void => {
        callback(state)
      }
      ipcRenderer.on(IPC_CHANNELS.EVENT_WINDOW_STATE_CHANGED, listener)
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.EVENT_WINDOW_STATE_CHANGED, listener)
      }
    }
  }
}

contextBridge.exposeInMainWorld('api', api)
