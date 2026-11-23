import type {
  AppSettings,
  FolderRecord,
  LibraryFacets,
  LyricsFetchOptions,
  MediaCommand,
  PlayHistoryInput,
  PlayHistoryRecord,
  PlaylistRecord,
  SaveLyricsInput,
  ScanProgressEvent,
  TrackAnalysisPayload,
  TrackLyricsRecord,
  TrackMetadataUpdateInput,
  TrackQueryFilter,
  TrackRecord,
  TrackTechnicalInfo,
  UpdateState,
  WindowStateEvent
} from './types'

export const IPC_CHANNELS = {
  FOLDERS_LIST: 'folders:list',
  FOLDERS_ADD: 'folders:add',
  FOLDERS_REMOVE: 'folders:remove',
  FOLDERS_TOGGLE_ACTIVE: 'folders:toggleActive',
  FOLDERS_RESCAN: 'folders:rescan',

  TRACKS_QUERY: 'tracks:query',
  TRACKS_GET_BY_ID: 'tracks:getById',
  TRACKS_GET_FACETS: 'tracks:getFacets',
  TRACKS_GET_PENDING_ANALYSIS: 'tracks:getPendingAnalysis',
  TRACKS_SAVE_ANALYSIS: 'tracks:saveAnalysis',
  TRACKS_MARK_MISSING: 'tracks:markMissing',
  TRACKS_REVEAL_IN_FOLDER: 'tracks:revealInFolder',
  TRACKS_UPDATE_METADATA: 'tracks:updateMetadata',
  TRACKS_RELOAD_METADATA: 'tracks:reloadMetadata',
  TRACKS_INSPECT_FILE: 'tracks:inspectFile',
  TRACKS_PICK_ARTWORK: 'tracks:pickArtwork',

  LYRICS_GET_FOR_TRACK: 'lyrics:getForTrack',
  LYRICS_SAVE: 'lyrics:save',
  LYRICS_IMPORT_FILE: 'lyrics:importFile',
  LYRICS_UPDATE_OFFSET: 'lyrics:updateOffset',
  LYRICS_DELETE: 'lyrics:delete',

  PLAYLISTS_LIST: 'playlists:list',
  PLAYLISTS_CREATE: 'playlists:create',
  PLAYLISTS_RENAME: 'playlists:rename',
  PLAYLISTS_DELETE: 'playlists:delete',
  PLAYLISTS_ADD_TRACK: 'playlists:addTrack',
  PLAYLISTS_REMOVE_TRACK: 'playlists:removeTrack',
  PLAYLISTS_REORDER_TRACKS: 'playlists:reorderTracks',

  HISTORY_RECORD_PLAY: 'history:recordPlay',
  HISTORY_GET_RECENT: 'history:getRecent',

  SETTINGS_GET_ALL: 'settings:getAll',
  SETTINGS_SET: 'settings:set',

  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_MAXIMIZE_TOGGLE: 'window:maximizeToggle',
  WINDOW_CLOSE: 'window:close',
  WINDOW_SET_MINI_PLAYER: 'window:setMiniPlayer',
  WINDOW_IS_MAXIMIZED: 'window:isMaximized',

  UPDATER_GET_STATE: 'updater:getState',
  UPDATER_CHECK: 'updater:check',
  UPDATER_DOWNLOAD: 'updater:download',
  UPDATER_INSTALL: 'updater:install',
  UPDATER_OPEN_RELEASE_PAGE: 'updater:openReleasePage',

  EVENT_SCAN_PROGRESS: 'library:scanProgress',
  EVENT_TRACKS_CHANGED: 'library:tracksChanged',
  EVENT_MEDIA_COMMAND: 'media:command',
  EVENT_WINDOW_STATE_CHANGED: 'window:stateChanged',
  EVENT_UPDATE_STATE: 'updater:stateChanged'
} as const

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS]

export interface IpcApi {
  platform: NodeJS.Platform
  folders: {
    list: () => Promise<FolderRecord[]>
    add: () => Promise<FolderRecord | null>
    remove: (folderId: number) => Promise<void>
    toggleActive: (folderId: number, isActive: boolean) => Promise<FolderRecord | null>
    rescan: (folderId?: number) => Promise<void>
  }
  tracks: {
    query: (filter?: TrackQueryFilter) => Promise<TrackRecord[]>
    getById: (id: number) => Promise<TrackRecord | null>
    getFacets: () => Promise<LibraryFacets>
    getPendingAnalysis: (limit?: number) => Promise<TrackRecord[]>
    saveAnalysis: (payload: TrackAnalysisPayload) => Promise<void>
    markMissing: (trackId: number, isMissing: boolean) => Promise<void>
    revealInFolder: (trackId: number) => Promise<void>
    updateMetadata: (trackId: number, patch: TrackMetadataUpdateInput) => Promise<TrackRecord | null>
    reloadMetadata: (trackId: number) => Promise<TrackRecord | null>
    inspectFile: (trackId: number) => Promise<TrackTechnicalInfo | null>
    pickArtwork: (trackId: number) => Promise<TrackRecord | null>
  }
  lyrics: {
    getForTrack: (trackId: number, options?: LyricsFetchOptions) => Promise<TrackLyricsRecord | null>
    save: (input: SaveLyricsInput) => Promise<TrackLyricsRecord>
    importFile: (trackId: number) => Promise<TrackLyricsRecord | null>
    updateOffset: (trackId: number, offsetMs: number) => Promise<TrackLyricsRecord | null>
    delete: (trackId: number) => Promise<void>
  }
  playlists: {
    list: () => Promise<PlaylistRecord[]>
    create: (name: string, description?: string | null) => Promise<PlaylistRecord>
    rename: (
      playlistId: number,
      name: string,
      description?: string | null
    ) => Promise<PlaylistRecord | null>
    delete: (playlistId: number) => Promise<void>
    addTrack: (playlistId: number, trackId: number) => Promise<void>
    removeTrack: (playlistId: number, trackId: number) => Promise<void>
    reorderTracks: (playlistId: number, orderedTrackIds: number[]) => Promise<void>
  }
  history: {
    recordPlay: (entry: PlayHistoryInput) => Promise<PlayHistoryRecord>
    getRecent: (limit?: number) => Promise<PlayHistoryRecord[]>
  }
  settings: {
    getAll: () => Promise<AppSettings>
    set: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => Promise<AppSettings>
  }
  window: {
    minimize: () => Promise<void>
    maximizeToggle: () => Promise<boolean>
    close: () => Promise<void>
    setMiniPlayer: (enabled: boolean) => Promise<void>
    isMaximized: () => Promise<boolean>
  }
  updater: {
    getState: () => Promise<UpdateState>
    checkForUpdates: () => Promise<UpdateState>
    downloadUpdate: () => Promise<UpdateState>
    quitAndInstall: () => Promise<void>
    openReleasePage: () => Promise<void>
  }
  events: {
    onScanProgress: (callback: (event: ScanProgressEvent) => void) => () => void
    onTracksChanged: (callback: () => void) => () => void
    onMediaCommand: (callback: (command: MediaCommand) => void) => () => void
    onWindowStateChanged: (callback: (state: WindowStateEvent) => void) => () => void
    onUpdateState: (callback: (state: UpdateState) => void) => () => void
  }
}
