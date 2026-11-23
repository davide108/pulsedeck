import { useState, type ReactNode } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  Disc,
  Flame,
  Folder,
  FolderCog,
  ListMusic,
  Music2,
  Plus,
  Settings,
  Sliders,
  Sparkles,
  TrendingUp,
  Users
} from 'lucide-react'
import { useLibraryStore } from '@/store/useLibraryStore'
import { usePlayerStore } from '@/store/usePlayerStore'
import { getModKeyLabel } from '@/utils/format'

export function Sidebar() {
  const activeView = useLibraryStore((s) => s.activeView)
  const activeSmartView = useLibraryStore((s) => s.activeSmartView)
  const selectedPlaylistId = useLibraryStore((s) => s.selectedPlaylistId)
  const filterFolderId = useLibraryStore((s) => s.filter.folderId)
  const folders = useLibraryStore((s) => s.folders)
  const playlists = useLibraryStore((s) => s.playlists)
  const facets = useLibraryStore((s) => s.facets)
  const scanProgress = useLibraryStore((s) => s.scanProgress)
  const setView = useLibraryStore((s) => s.setView)
  const setFilter = useLibraryStore((s) => s.setFilter)
  const createPlaylist = useLibraryStore((s) => s.createPlaylist)

  const sidebarCollapsed = usePlayerStore((s) => s.sidebarCollapsed)
  const setSidebarCollapsed = usePlayerStore((s) => s.setSidebarCollapsed)
  const autoDjEnabled = usePlayerStore((s) => s.autoDjConfig.enabled)
  const autoDjQueueCount = usePlayerStore((s) => s.autoDjQueue.length)
  const transitionActive = usePlayerStore((s) => s.telemetry.transition.active)

  const [creatingPlaylist, setCreatingPlaylist] = useState(false)
  const [newPlaylistName, setNewPlaylistName] = useState('')

  const handleCreatePlaylist = async () => {
    const trimmed = newPlaylistName.trim()
    if (!trimmed) {
      setCreatingPlaylist(false)
      return
    }
    const created = await createPlaylist(trimmed)
    setNewPlaylistName('')
    setCreatingPlaylist(false)
    if (created) {
      setView('playlist', { playlistId: created.id })
    }
  }

  const navItemClass = (isActive: boolean) =>
    `group flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-xs font-medium transition-all ${
      isActive
        ? 'bg-accent/20 text-white border border-accent/35 shadow-sm'
        : 'text-slate-400 border border-transparent hover:bg-white/[0.05] hover:text-slate-100'
    }`

  const renderSectionTitle = (label: string, action?: ReactNode) => {
    if (sidebarCollapsed) return <div className="my-2 border-t border-white/[0.06]" />
    return (
      <div className="mt-4 mb-1.5 flex items-center justify-between px-2.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        <span>{label}</span>
        {action}
      </div>
    )
  }

  return (
    <aside
      className={`flex h-full shrink-0 flex-col border-r border-white/[0.07] bg-surface/55 backdrop-blur-xl transition-all duration-200 ${
        sidebarCollapsed ? 'w-16' : 'w-60'
      }`}
    >
      {/* Top Collapse Bar */}
      <div className="flex items-center justify-between px-3 pt-3 pb-1">
        {!sidebarCollapsed && (
          <span className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">
            Library
          </span>
        )}
        <button
          type="button"
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={`flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-white/10 hover:text-white transition-colors ${
            sidebarCollapsed ? 'mx-auto' : ''
          }`}
        >
          {sidebarCollapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* Navigation Scroll Area */}
      <div className="flex-1 overflow-y-auto px-2.5 pb-4">
        {/* Core Library Views */}
        <div className="space-y-0.5">
          <button
            type="button"
            onClick={() => {
              setFilter({ folderId: null })
              setView('tracks')
            }}
            title="All Tracks"
            className={navItemClass(activeView === 'tracks' && !filterFolderId)}
          >
            <Music2 className="h-4 w-4 shrink-0" />
            {!sidebarCollapsed && (
              <>
                <span className="flex-1 truncate text-left">Tracks</span>
                <span className="font-mono text-[10px] tabular-nums text-slate-500">
                  {facets.totalTracks}
                </span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => setView('albums')}
            title="Albums"
            className={navItemClass(activeView === 'albums')}
          >
            <Disc className="h-4 w-4 shrink-0" />
            {!sidebarCollapsed && <span className="flex-1 truncate text-left">Albums</span>}
          </button>

          <button
            type="button"
            onClick={() => setView('artists')}
            title="Artists"
            className={navItemClass(activeView === 'artists')}
          >
            <Users className="h-4 w-4 shrink-0" />
            {!sidebarCollapsed && <span className="flex-1 truncate text-left">Artists</span>}
          </button>
        </div>

        {/* Smart Views */}
        {renderSectionTitle('Smart Views')}
        <div className="space-y-0.5">
          <button
            type="button"
            onClick={() => setView('smart', { smartView: 'recently_added' })}
            title="Recently Added"
            className={navItemClass(
              activeView === 'smart' && activeSmartView === 'recently_added'
            )}
          >
            <Clock className="h-4 w-4 shrink-0" />
            {!sidebarCollapsed && (
              <span className="flex-1 truncate text-left">Recently Added</span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setView('smart', { smartView: 'most_played' })}
            title="Most Played"
            className={navItemClass(activeView === 'smart' && activeSmartView === 'most_played')}
          >
            <TrendingUp className="h-4 w-4 shrink-0" />
            {!sidebarCollapsed && (
              <span className="flex-1 truncate text-left">Most Played</span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setView('smart', { smartView: 'high_energy' })}
            title="High Energy"
            className={navItemClass(activeView === 'smart' && activeSmartView === 'high_energy')}
          >
            <Flame className="h-4 w-4 shrink-0" />
            {!sidebarCollapsed && (
              <span className="flex-1 truncate text-left">High Energy</span>
            )}
          </button>
        </div>

        {/* DJ Booth Tab */}
        {renderSectionTitle('DJ Engine')}
        <button
          type="button"
          onClick={() => {
            setView('autodj')
            usePlayerStore.getState().setNowPlayingOpen(false)
          }}
          title="DJ Booth"
          className={navItemClass(activeView === 'autodj')}
        >
          <span className="relative flex shrink-0 items-center justify-center">
            <Sliders
              className={`h-4 w-4 ${
                transitionActive || autoDjEnabled ? 'text-accentGlow' : ''
              }`}
            />
            {sidebarCollapsed && (transitionActive || autoDjEnabled) && (
              <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
                <span
                  className={`absolute inline-flex h-full w-full rounded-full bg-accentGlow opacity-75 ${
                    transitionActive ? 'animate-ping' : 'animate-pulse'
                  }`}
                />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-accentGlow shadow-glow" />
              </span>
            )}
          </span>
          {!sidebarCollapsed && (
            <>
              <span className="flex-1 truncate text-left">DJ Booth</span>
              {(transitionActive || autoDjEnabled) && (
                <span
                  className="relative flex h-2 w-2 shrink-0"
                  title={transitionActive ? 'Live transition active' : 'Auto-Mix enabled'}
                >
                  <span
                    className={`absolute inline-flex h-full w-full rounded-full bg-accentGlow opacity-75 ${
                      transitionActive ? 'animate-ping' : 'animate-pulse'
                    }`}
                  />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-accentGlow shadow-glow" />
                </span>
              )}
              <span className="rounded-full bg-white/[0.08] px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-slate-300">
                {autoDjQueueCount}
              </span>
            </>
          )}
        </button>

        {/* Watched Folders */}
        {renderSectionTitle(
          'Folders',
          <button
            type="button"
            onClick={() => setView('folders')}
            title="Manage watched folders"
            className="rounded p-0.5 text-slate-400 hover:bg-white/10 hover:text-white"
          >
            <FolderCog className="h-3.5 w-3.5" />
          </button>
        )}

        <div className="space-y-0.5">
          <button
            type="button"
            onClick={() => setView('folders')}
            title="Manage Folders"
            className={navItemClass(activeView === 'folders')}
          >
            <FolderCog className="h-4 w-4 shrink-0" />
            {!sidebarCollapsed && (
              <>
                <span className="flex-1 truncate text-left">Manage Folders</span>
                <span className="font-mono text-[10px] tabular-nums text-slate-500">
                  {folders.filter((f) => f.isActive).length}/{folders.length}
                </span>
              </>
            )}
          </button>

          {!sidebarCollapsed &&
            folders.map((folder) => {
              const progress = scanProgress[folder.id]
              const isScanning =
                progress?.phase === 'discovering' || progress?.phase === 'indexing'
              const isFiltered = activeView === 'tracks' && filterFolderId === folder.id
              return (
                <button
                  key={folder.id}
                  type="button"
                  onClick={() => {
                    if (!folder.isActive) {
                      setView('folders')
                      return
                    }
                    setFilter({ folderId: folder.id })
                    setView('tracks')
                  }}
                  title={`${folder.path} (${folder.isActive ? 'Active' : 'Disabled'})`}
                  className={navItemClass(isFiltered)}
                >
                  <Folder className="h-3.5 w-3.5 shrink-0" />
                  <span className="flex-1 truncate text-left">{folder.name}</span>
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${
                      isScanning
                        ? 'bg-accentGlow animate-ping'
                        : folder.isActive
                          ? 'bg-emerald-400/80'
                          : 'bg-slate-600'
                    }`}
                  />
                </button>
              )
            })}
        </div>

        {/* Playlists */}
        {renderSectionTitle(
          'Playlists',
          <button
            type="button"
            onClick={() => {
              setCreatingPlaylist(true)
            }}
            title="Create playlist"
            className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold text-accent hover:bg-accent/15 transition-colors"
          >
            <Plus className="h-3 w-3" />
            <span>New</span>
          </button>
        )}

        {!sidebarCollapsed && creatingPlaylist && (
          <div className="mb-1.5 px-1">
            <input
              type="text"
              autoFocus
              value={newPlaylistName}
              onChange={(e) => setNewPlaylistName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  void handleCreatePlaylist()
                } else if (e.key === 'Escape') {
                  setCreatingPlaylist(false)
                  setNewPlaylistName('')
                }
              }}
              onBlur={() => void handleCreatePlaylist()}
              placeholder="Playlist name..."
              className="h-7 w-full rounded-lg border border-accent/50 bg-black/40 px-2.5 text-xs text-white placeholder:text-slate-500 focus:outline-none"
            />
          </div>
        )}

        <div className="space-y-0.5">
          {sidebarCollapsed ? (
            <button
              type="button"
              onClick={() => {
                setSidebarCollapsed(false)
                setCreatingPlaylist(true)
              }}
              title="Playlists"
              className={navItemClass(activeView === 'playlist')}
            >
              <ListMusic className="h-4 w-4 shrink-0" />
            </button>
          ) : playlists.length === 0 ? (
            <p className="px-2.5 py-1.5 text-[11px] text-slate-600">No playlists yet</p>
          ) : (
            playlists.map((pl) => (
              <button
                key={pl.id}
                type="button"
                onClick={() => setView('playlist', { playlistId: pl.id })}
                title={pl.name}
                className={navItemClass(
                  activeView === 'playlist' && selectedPlaylistId === pl.id
                )}
              >
                <Sparkles className="h-3.5 w-3.5 shrink-0 opacity-75" />
                <span className="flex-1 truncate text-left">{pl.name}</span>
                <span className="font-mono text-[10px] tabular-nums text-slate-500">
                  {pl.trackCount}
                </span>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Pinned Bottom Settings Trigger */}
      <div className="border-t border-white/[0.07] p-2.5">
        <button
          type="button"
          onClick={() => setView('settings')}
          title={`Settings (${getModKeyLabel()}+,)`}
          className={navItemClass(activeView === 'settings')}
        >
          <Settings className="h-4 w-4 shrink-0" />
          {!sidebarCollapsed && <span className="flex-1 truncate text-left">Settings</span>}
        </button>
      </div>
    </aside>
  )
}
