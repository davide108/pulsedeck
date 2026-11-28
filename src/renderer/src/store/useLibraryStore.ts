import { create } from 'zustand'
import { usePlayerStore } from '@/store/usePlayerStore'
import type {
  AutoDjScope,
  FolderRecord,
  LibraryFacets,
  LibraryView,
  PlaylistRecord,
  ScanProgressEvent,
  SmartViewId,
  TrackMetadataUpdateInput,
  TrackQueryFilter,
  TrackRecord,
  TrackTechnicalInfo
} from '@shared/types'

const DEFAULT_FACETS: LibraryFacets = {
  genres: [],
  keys: [],
  minBpm: null,
  maxBpm: null,
  totalTracks: 0,
  analyzedTracks: 0,
  likedTracks: 0
}

const DEFAULT_FILTER: TrackQueryFilter = {
  search: '',
  genre: null,
  camelotKey: null,
  bpmMin: null,
  bpmMax: null,
  folderId: null,
  sortBy: undefined,
  sortDir: 'asc'
}

export interface AlbumSelection {
  album: string
  artist: string
}

interface LibraryState {
  activeView: LibraryView
  activeSmartView: SmartViewId
  selectedPlaylistId: number | null
  selectedAlbum: AlbumSelection | null
  selectedArtist: string | null
  filter: TrackQueryFilter
  folders: FolderRecord[]
  tracks: TrackRecord[]
  allTracks: TrackRecord[]
  facets: LibraryFacets
  playlists: PlaylistRecord[]
  scanProgress: Record<number, ScanProgressEvent>
  isLoadingTracks: boolean
  isInitialized: boolean
  focusSearchNonce: number
  errorMessage: string | null
  editingTrack: TrackRecord | null

  init: () => Promise<() => void>
  refreshAll: () => Promise<void>
  refreshTracks: () => Promise<void>
  getScopedCandidates: (scope: AutoDjScope) => Promise<TrackRecord[]>

  setView: (
    view: LibraryView,
    options?: { smartView?: SmartViewId; playlistId?: number | null }
  ) => void
  setFilter: (partial: Partial<TrackQueryFilter>) => void
  resetFilter: () => void
  toggleSort: (column: NonNullable<TrackQueryFilter['sortBy']>) => void
  setSelectedAlbum: (album: AlbumSelection | null) => void
  setSelectedArtist: (artist: string | null) => void
  triggerFocusSearch: () => void
  clearError: () => void

  addFolder: () => Promise<FolderRecord | null>
  removeFolder: (folderId: number) => Promise<void>
  toggleFolderActive: (folderId: number, isActive: boolean) => Promise<void>
  rescanFolder: (folderId?: number) => Promise<void>

  createPlaylist: (name: string, description?: string | null) => Promise<PlaylistRecord | null>
  renamePlaylist: (
    playlistId: number,
    name: string,
    description?: string | null
  ) => Promise<void>
  deletePlaylist: (playlistId: number) => Promise<void>
  addTrackToPlaylist: (playlistId: number, trackId: number) => Promise<void>
  removeTrackFromPlaylist: (playlistId: number, trackId: number) => Promise<void>
  reorderPlaylistTracks: (playlistId: number, orderedTrackIds: number[]) => Promise<void>
  revealTrackInFolder: (trackId: number) => Promise<void>

  openTrackInfo: (track: TrackRecord) => void
  closeTrackInfo: () => void
  updateTrackMetadata: (
    trackId: number,
    patch: TrackMetadataUpdateInput
  ) => Promise<TrackRecord | null>
  reloadTrackMetadataFromFile: (trackId: number) => Promise<TrackRecord | null>
  pickTrackArtwork: (trackId: number) => Promise<TrackRecord | null>
  inspectTrackFile: (trackId: number) => Promise<TrackTechnicalInfo | null>
  toggleTrackLike: (trackId: number, liked?: boolean) => Promise<TrackRecord | null>
}

let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null
let tracksChangedDebounceTimer: ReturnType<typeof setTimeout> | null = null
let queryRequestToken = 0

function buildEffectiveFilter(state: {
  activeView: LibraryView
  activeSmartView: SmartViewId
  selectedPlaylistId: number | null
  filter: TrackQueryFilter
}): TrackQueryFilter {
  const base: TrackQueryFilter = {
    search: state.filter.search?.trim() || undefined,
    genre: state.filter.genre || null,
    camelotKey: state.filter.camelotKey || null,
    bpmMin: state.filter.bpmMin ?? null,
    bpmMax: state.filter.bpmMax ?? null,
    folderId: state.filter.folderId ?? null,
    sortBy: state.filter.sortBy,
    sortDir: state.filter.sortDir ?? 'asc',
    includeMissing: false
  }

  if (state.activeView === 'playlist' && state.selectedPlaylistId !== null) {
    base.playlistId = state.selectedPlaylistId
    base.folderId = null
    base.smartView = null
  } else if (state.activeView === 'smart') {
    base.smartView = state.activeSmartView
    base.playlistId = null
  } else {
    base.playlistId = null
    base.smartView = null
  }

  return base
}

function isUnfilteredDefaultQuery(filter: TrackQueryFilter): boolean {
  return (
    !filter.search &&
    filter.genre == null &&
    filter.camelotKey == null &&
    filter.bpmMin == null &&
    filter.bpmMax == null &&
    filter.folderId == null &&
    filter.playlistId == null &&
    filter.smartView == null &&
    !filter.sortBy &&
    !filter.includeMissing
  )
}

export const useLibraryStore = create<LibraryState>((set, get) => {
  const runTrackMutation = async (
    mutate: () => Promise<TrackRecord | null>,
    fallbackError: string
  ): Promise<TrackRecord | null> => {
    try {
      const updated = await mutate()
      if (!updated) return null
      set((state) => ({
        editingTrack: state.editingTrack?.id === updated.id ? updated : state.editingTrack,
        tracks: state.tracks.map((t) => (t.id === updated.id ? updated : t)),
        allTracks: state.allTracks.map((t) => (t.id === updated.id ? updated : t))
      }))
      usePlayerStore.getState().refreshActiveTrack(updated)
      await get().refreshAll()
      return updated
    } catch (err) {
      set({ errorMessage: err instanceof Error ? err.message : fallbackError })
      return null
    }
  }

  return {
  activeView: 'tracks',
  activeSmartView: 'all',
  selectedPlaylistId: null,
  selectedAlbum: null,
  selectedArtist: null,
  filter: { ...DEFAULT_FILTER },
  folders: [],
  tracks: [],
  allTracks: [],
  facets: { ...DEFAULT_FACETS },
  playlists: [],
  scanProgress: {},
  isLoadingTracks: false,
  isInitialized: false,
  focusSearchNonce: 0,
  errorMessage: null,
  editingTrack: null,

  init: async () => {
    await get().refreshAll()
    set({ isInitialized: true })

    const unsubTracks = window.api.events.onTracksChanged(() => {
      if (tracksChangedDebounceTimer) {
        clearTimeout(tracksChangedDebounceTimer)
      }
      tracksChangedDebounceTimer = setTimeout(() => {
        tracksChangedDebounceTimer = null
        void get().refreshAll()
      }, 150)
    })

    const unsubScan = window.api.events.onScanProgress((event) => {
      set((state) => ({
        scanProgress: {
          ...state.scanProgress,
          [event.folderId]: event
        }
      }))

      if (event.phase === 'done') {
        void get().refreshAll()
        setTimeout(() => {
          set((state) => {
            const current = state.scanProgress[event.folderId]
            if (!current || current.phase !== 'done') return state
            const next = { ...state.scanProgress }
            delete next[event.folderId]
            return { scanProgress: next }
          })
        }, 3500)
      }
    })

    return () => {
      unsubTracks()
      unsubScan()
      if (searchDebounceTimer) {
        clearTimeout(searchDebounceTimer)
        searchDebounceTimer = null
      }
      if (tracksChangedDebounceTimer) {
        clearTimeout(tracksChangedDebounceTimer)
        tracksChangedDebounceTimer = null
      }
    }
  },

  refreshAll: async () => {
    try {
      const effectiveFilter = buildEffectiveFilter(get())
      if (isUnfilteredDefaultQuery(effectiveFilter)) {
        const [folders, playlists, facets, tracks] = await Promise.all([
          window.api.folders.list(),
          window.api.playlists.list(),
          window.api.tracks.getFacets(),
          window.api.tracks.query({ includeMissing: false })
        ])
        set({ folders, playlists, facets, tracks, allTracks: tracks })
        return
      }

      const [folders, playlists, facets, tracks, allTracks] = await Promise.all([
        window.api.folders.list(),
        window.api.playlists.list(),
        window.api.tracks.getFacets(),
        window.api.tracks.query(effectiveFilter),
        window.api.tracks.query({ includeMissing: false })
      ])
      set({ folders, playlists, facets, tracks, allTracks })
    } catch (err) {
      set({
        errorMessage: err instanceof Error ? err.message : 'Failed to load music library'
      })
    }
  },

  refreshTracks: async () => {
    const token = ++queryRequestToken
    set({ isLoadingTracks: true })
    try {
      const effectiveFilter = buildEffectiveFilter(get())
      const tracks = await window.api.tracks.query(effectiveFilter)
      if (token === queryRequestToken) {
        set({ tracks, isLoadingTracks: false })
      }
    } catch (err) {
      if (token === queryRequestToken) {
        set({
          isLoadingTracks: false,
          errorMessage: err instanceof Error ? err.message : 'Failed to query tracks'
        })
      }
    }
  },

  getScopedCandidates: async (scope) => {
    if (scope.type === 'folder') {
      return window.api.tracks.query({ folderId: scope.folderId, includeMissing: false })
    }
    if (scope.type === 'playlist') {
      return window.api.tracks.query({ playlistId: scope.playlistId, includeMissing: false })
    }
    if (scope.type === 'liked') {
      return window.api.tracks.query({ smartView: 'liked', includeMissing: false })
    }
    const cached = get().allTracks
    if (cached.length > 0) return cached
    return window.api.tracks.query({ includeMissing: false })
  },

  setView: (view, options) => {
    set((state) => {
      const nextSmart = options?.smartView ?? state.activeSmartView
      const nextPlaylist =
        options?.playlistId !== undefined ? options.playlistId : state.selectedPlaylistId

      // Clear explicit sort when entering playlist or smart view so natural ordering takes effect
      const shouldResetSort =
        (view === 'playlist' || view === 'smart') && state.activeView !== view

      return {
        activeView: view,
        activeSmartView: nextSmart,
        selectedPlaylistId: nextPlaylist,
        selectedAlbum: view === 'albums' ? state.selectedAlbum : null,
        selectedArtist: view === 'artists' ? state.selectedArtist : null,
        filter: shouldResetSort ? { ...state.filter, sortBy: undefined } : state.filter
      }
    })
    if (view !== 'folders' && view !== 'autodj' && view !== 'settings') {
      void get().refreshTracks()
    }
  },

  setFilter: (partial) => {
    const isSearchOnly =
      'search' in partial &&
      Object.keys(partial).every((k) => k === 'search')

    set((state) => ({
      filter: { ...state.filter, ...partial },
      selectedAlbum: null
    }))

    if (searchDebounceTimer) {
      clearTimeout(searchDebounceTimer)
      searchDebounceTimer = null
    }

    if (isSearchOnly) {
      searchDebounceTimer = setTimeout(() => {
        searchDebounceTimer = null
        void get().refreshTracks()
      }, 170)
    } else {
      void get().refreshTracks()
    }
  },

  resetFilter: () => {
    if (searchDebounceTimer) {
      clearTimeout(searchDebounceTimer)
      searchDebounceTimer = null
    }
    set({
      filter: { ...DEFAULT_FILTER },
      selectedAlbum: null
    })
    void get().refreshTracks()
  },

  toggleSort: (column) => {
    set((state) => {
      const currentBy = state.filter.sortBy
      const currentDir = state.filter.sortDir ?? 'asc'
      let nextDir: 'asc' | 'desc' = 'asc'
      if (currentBy === column) {
        nextDir = currentDir === 'asc' ? 'desc' : 'asc'
      } else if (column === 'added_at' || column === 'play_count' || column === 'energy') {
        nextDir = 'desc'
      }
      return {
        filter: {
          ...state.filter,
          sortBy: column,
          sortDir: nextDir
        }
      }
    })
    void get().refreshTracks()
  },

  setSelectedAlbum: (album) => set({ selectedAlbum: album }),
  setSelectedArtist: (artist) => set({ selectedArtist: artist }),
  triggerFocusSearch: () => set((state) => ({ focusSearchNonce: state.focusSearchNonce + 1 })),
  clearError: () => set({ errorMessage: null }),

  addFolder: async () => {
    try {
      const folder = await window.api.folders.add()
      if (folder) {
        await get().refreshAll()
      }
      return folder
    } catch (err) {
      set({ errorMessage: err instanceof Error ? err.message : 'Failed to add folder' })
      return null
    }
  },

  removeFolder: async (folderId) => {
    try {
      await window.api.folders.remove(folderId)
      set((state) => ({
        filter:
          state.filter.folderId === folderId
            ? { ...state.filter, folderId: null }
            : state.filter
      }))
      await get().refreshAll()
    } catch (err) {
      set({ errorMessage: err instanceof Error ? err.message : 'Failed to remove folder' })
    }
  },

  toggleFolderActive: async (folderId, isActive) => {
    try {
      await window.api.folders.toggleActive(folderId, isActive)
      await get().refreshAll()
    } catch (err) {
      set({ errorMessage: err instanceof Error ? err.message : 'Failed to update folder' })
    }
  },

  rescanFolder: async (folderId) => {
    try {
      await window.api.folders.rescan(folderId)
    } catch (err) {
      set({ errorMessage: err instanceof Error ? err.message : 'Failed to rescan folder' })
    }
  },

  createPlaylist: async (name, description) => {
    const trimmed = name.trim()
    if (!trimmed) return null
    try {
      const created = await window.api.playlists.create(trimmed, description ?? null)
      const playlists = await window.api.playlists.list()
      set({ playlists })
      return created
    } catch (err) {
      set({ errorMessage: err instanceof Error ? err.message : 'Failed to create playlist' })
      return null
    }
  },

  renamePlaylist: async (playlistId, name, description) => {
    const trimmed = name.trim()
    if (!trimmed) return
    try {
      await window.api.playlists.rename(playlistId, trimmed, description)
      const playlists = await window.api.playlists.list()
      set({ playlists })
    } catch (err) {
      set({ errorMessage: err instanceof Error ? err.message : 'Failed to rename playlist' })
    }
  },

  deletePlaylist: async (playlistId) => {
    try {
      await window.api.playlists.delete(playlistId)
      const state = get()
      const wasSelected = state.selectedPlaylistId === playlistId
      const playlists = await window.api.playlists.list()
      set({
        playlists,
        selectedPlaylistId: wasSelected ? null : state.selectedPlaylistId,
        activeView: wasSelected && state.activeView === 'playlist' ? 'tracks' : state.activeView
      })
      if (wasSelected) {
        await get().refreshTracks()
      }
    } catch (err) {
      set({ errorMessage: err instanceof Error ? err.message : 'Failed to delete playlist' })
    }
  },

  addTrackToPlaylist: async (playlistId, trackId) => {
    try {
      await window.api.playlists.addTrack(playlistId, trackId)
      const playlists = await window.api.playlists.list()
      set({ playlists })
      if (get().activeView === 'playlist' && get().selectedPlaylistId === playlistId) {
        await get().refreshTracks()
      }
    } catch (err) {
      set({ errorMessage: err instanceof Error ? err.message : 'Failed to add track to playlist' })
    }
  },

  removeTrackFromPlaylist: async (playlistId, trackId) => {
    try {
      await window.api.playlists.removeTrack(playlistId, trackId)
      const playlists = await window.api.playlists.list()
      set({ playlists })
      if (get().activeView === 'playlist' && get().selectedPlaylistId === playlistId) {
        await get().refreshTracks()
      }
    } catch (err) {
      set({
        errorMessage: err instanceof Error ? err.message : 'Failed to remove track from playlist'
      })
    }
  },

  reorderPlaylistTracks: async (playlistId, orderedTrackIds) => {
    try {
      await window.api.playlists.reorderTracks(playlistId, orderedTrackIds)
      if (get().activeView === 'playlist' && get().selectedPlaylistId === playlistId) {
        await get().refreshTracks()
      }
    } catch (err) {
      set({ errorMessage: err instanceof Error ? err.message : 'Failed to reorder playlist' })
    }
  },

  revealTrackInFolder: async (trackId) => {
    try {
      await window.api.tracks.revealInFolder(trackId)
    } catch (err) {
      set({ errorMessage: err instanceof Error ? err.message : 'Failed to reveal track' })
    }
  },

  openTrackInfo: (track) => set({ editingTrack: track }),

  closeTrackInfo: () => set({ editingTrack: null }),

  updateTrackMetadata: (trackId, patch) =>
    runTrackMutation(
      () => window.api.tracks.updateMetadata(trackId, patch),
      'Failed to update track metadata'
    ),

  reloadTrackMetadataFromFile: (trackId) =>
    runTrackMutation(
      () => window.api.tracks.reloadMetadata(trackId),
      'Failed to reload track metadata from file'
    ),

  pickTrackArtwork: (trackId) =>
    runTrackMutation(
      () => window.api.tracks.pickArtwork(trackId),
      'Failed to update track artwork'
    ),

  inspectTrackFile: async (trackId) => {
    try {
      return await window.api.tracks.inspectFile(trackId)
    } catch (err) {
      set({ errorMessage: err instanceof Error ? err.message : 'Failed to inspect track file' })
      return null
    }
  },

  toggleTrackLike: async (trackId, liked) => {
    const prevState = get()
    const prevTracks = prevState.tracks
    const prevAllTracks = prevState.allTracks
    const prevEditingTrack = prevState.editingTrack
    const prevFacets = prevState.facets
    const playerActiveTrack = usePlayerStore.getState().activeTrack
    const existing =
      prevTracks.find((t) => t.id === trackId) ??
      prevAllTracks.find((t) => t.id === trackId) ??
      (prevEditingTrack?.id === trackId ? prevEditingTrack : undefined) ??
      (playerActiveTrack?.id === trackId ? playerActiveTrack : undefined)

    const prevLiked = Boolean(existing?.isLiked)
    const nextLiked = liked !== undefined ? liked : !prevLiked
    const nextLikedAt = nextLiked ? (existing?.likedAt ?? Date.now()) : null
    const likedDelta = existing ? (nextLiked === prevLiked ? 0 : nextLiked ? 1 : -1) : 0

    const applyLikePatch = (track: TrackRecord): TrackRecord =>
      track.id === trackId ? { ...track, isLiked: nextLiked, likedAt: nextLikedAt } : track

    set((state) => {
      const inLikedSmartView = state.activeView === 'smart' && state.activeSmartView === 'liked'
      const nextTracks =
        inLikedSmartView && !nextLiked
          ? state.tracks.filter((t) => t.id !== trackId)
          : state.tracks.map(applyLikePatch)
      return {
        tracks: nextTracks,
        allTracks: state.allTracks.map(applyLikePatch),
        editingTrack:
          state.editingTrack?.id === trackId
            ? applyLikePatch(state.editingTrack)
            : state.editingTrack,
        facets: {
          ...state.facets,
          likedTracks: Math.max(0, state.facets.likedTracks + likedDelta)
        }
      }
    })

    if (existing) {
      usePlayerStore.getState().refreshActiveTrack(applyLikePatch(existing))
    }

    try {
      const updated = await window.api.tracks.toggleLike(trackId, liked)
      if (updated) {
        set((state) => {
          const inLikedSmartView = state.activeView === 'smart' && state.activeSmartView === 'liked'
          const nextTracks =
            inLikedSmartView && !updated.isLiked
              ? state.tracks.filter((t) => t.id !== updated.id)
              : state.tracks.map((t) => (t.id === updated.id ? updated : t))
          return {
            tracks: nextTracks,
            allTracks: state.allTracks.map((t) => (t.id === updated.id ? updated : t)),
            editingTrack: state.editingTrack?.id === updated.id ? updated : state.editingTrack
          }
        })
        usePlayerStore.getState().refreshActiveTrack(updated)
      }
      await get().refreshAll()
      return updated
    } catch (err) {
      set({
        tracks: prevTracks,
        allTracks: prevAllTracks,
        editingTrack: prevEditingTrack,
        facets: prevFacets,
        errorMessage: err instanceof Error ? err.message : 'Failed to toggle liked status'
      })
      if (existing) {
        usePlayerStore.getState().refreshActiveTrack(existing)
      }
      return null
    }
  }
}})
