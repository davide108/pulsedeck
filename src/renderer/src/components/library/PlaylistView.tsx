import { useEffect, useState } from 'react'
import {
  Check,
  Clock,
  Flame,
  Heart,
  ListMusic,
  Pencil,
  Play,
  Radio,
  Trash2,
  TrendingUp,
  X
} from 'lucide-react'
import { FilterBar } from '@/components/library/FilterBar'
import { TrackTable, type PlaylistTrackActions } from '@/components/library/TrackTable'
import { useLibraryStore } from '@/store/useLibraryStore'
import { usePlayerStore } from '@/store/usePlayerStore'
import type { SmartViewId } from '@shared/types'

const SMART_VIEW_META: Record<
  SmartViewId,
  { title: string; subtitle: string; badge: string }
> = {
  all: {
    title: 'All Library Tracks',
    subtitle: 'Complete collection across all active watched folders.',
    badge: 'Library'
  },
  liked: {
    title: 'Liked Songs',
    subtitle: 'Your favorite tracks, ordered from most recently liked.',
    badge: 'Favorites'
  },
  recently_added: {
    title: 'Recently Added',
    subtitle: 'Fresh arrivals indexed from your watched music folders.',
    badge: 'Smart View'
  },
  most_played: {
    title: 'Most Played',
    subtitle: 'Your highest-rotation tracks ranked by live & Auto-DJ play counts.',
    badge: 'Smart View'
  },
  high_energy: {
    title: 'High Energy',
    subtitle: 'Peak-hour selections with DSP energy rating ≥ 0.65.',
    badge: 'Smart View'
  }
}

export function PlaylistView() {
  const activeView = useLibraryStore((s) => s.activeView)
  const activeSmartView = useLibraryStore((s) => s.activeSmartView)
  const selectedPlaylistId = useLibraryStore((s) => s.selectedPlaylistId)
  const playlists = useLibraryStore((s) => s.playlists)
  const tracks = useLibraryStore((s) => s.tracks)
  const renamePlaylist = useLibraryStore((s) => s.renamePlaylist)
  const deletePlaylist = useLibraryStore((s) => s.deletePlaylist)
  const removeTrackFromPlaylist = useLibraryStore((s) => s.removeTrackFromPlaylist)
  const reorderPlaylistTracks = useLibraryStore((s) => s.reorderPlaylistTracks)

  const playTrack = usePlayerStore((s) => s.playTrack)
  const updateAutoDjConfig = usePlayerStore((s) => s.updateAutoDjConfig)

  const playlist =
    activeView === 'playlist' && selectedPlaylistId !== null
      ? playlists.find((p) => p.id === selectedPlaylistId) ?? null
      : null

  const [editing, setEditing] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    setEditing(false)
    setConfirmDelete(false)
    if (playlist) {
      setDraftName(playlist.name)
    }
  }, [playlist?.id, playlist?.name])

  if (activeView === 'smart') {
    const meta = SMART_VIEW_META[activeSmartView]
    const isLikedView = activeSmartView === 'liked'
    const Icon = isLikedView
      ? Heart
      : activeSmartView === 'recently_added'
        ? Clock
        : activeSmartView === 'most_played'
          ? TrendingUp
          : Flame

    return (
      <div className="flex h-full flex-col overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/[0.07] bg-gradient-to-r from-accent/15 via-surface/60 to-accentGlow/10 px-6 py-5">
          <div className="flex items-center gap-4">
            <div
              className={`flex h-12 w-12 items-center justify-center rounded-2xl border ${
                isLikedView
                  ? 'border-rose-500/35 bg-rose-500/15 text-rose-400'
                  : 'border-accent/35 bg-accent/20 text-accentGlow shadow-glow'
              }`}
            >
              <Icon className="h-6 w-6" />
            </div>
            <div>
              <span
                className={`text-[10px] font-semibold uppercase tracking-widest ${
                  isLikedView ? 'text-rose-400' : 'text-accentGlow'
                }`}
              >
                {meta.badge}
              </span>
              <h1 className="text-xl font-bold text-white">{meta.title}</h1>
              <p className="text-xs text-slate-300">{meta.subtitle}</p>
            </div>
          </div>

          {tracks.length > 0 && (
            <div className="flex items-center gap-2">
              {isLikedView && (
                <button
                  type="button"
                  onClick={() => {
                    updateAutoDjConfig({ enabled: true, scope: { type: 'liked' } })
                    void playTrack(tracks[0], tracks)
                  }}
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-accent/35 bg-accent/15 px-3.5 text-xs font-semibold text-white hover:bg-accent/25 transition-colors"
                >
                  <Radio className="h-3.5 w-3.5 text-accentGlow" />
                  <span>Auto-DJ Liked</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => void playTrack(tracks[0], tracks)}
                className="inline-flex h-9 items-center gap-2 rounded-xl bg-accent px-4 text-xs font-semibold text-white shadow-glow hover:brightness-110 transition-all"
              >
                <Play className="h-3.5 w-3.5" />
                <span>Play Top Track</span>
              </button>
            </div>
          )}
        </div>

        <FilterBar />
        <TrackTable
          emptyTitle={`No tracks in ${meta.title}`}
          emptyDescription={
            activeSmartView === 'liked'
              ? 'Click the heart icon on any song or press H while playing to add tracks to Liked Songs.'
              : activeSmartView === 'most_played'
                ? 'Play tracks to build your rotation history.'
                : activeSmartView === 'high_energy'
                  ? 'Tracks with DSP energy ≥ 0.65 will appear here once analyzed.'
                  : 'Add a music folder to see newly indexed tracks.'
          }
        />
      </div>
    )
  }

  if (!playlist) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-10 text-center">
        <ListMusic className="mb-3 h-10 w-10 text-slate-600" />
        <h2 className="text-base font-semibold text-white">Select or Create a Playlist</h2>
        <p className="mt-1 text-xs text-slate-400">
          Use the + New button in the sidebar to create custom DJ crates and playlists.
        </p>
      </div>
    )
  }

  const handleSaveRename = async () => {
    const trimmed = draftName.trim()
    setEditing(false)
    if (trimmed && trimmed !== playlist.name) {
      await renamePlaylist(playlist.id, trimmed, playlist.description)
    } else {
      setDraftName(playlist.name)
    }
  }

  const playlistActions: PlaylistTrackActions = {
    onMoveUp: (index) => {
      if (index <= 0 || index >= tracks.length) return
      const ids = tracks.map((t) => t.id)
      const [item] = ids.splice(index, 1)
      ids.splice(index - 1, 0, item)
      void reorderPlaylistTracks(playlist.id, ids)
    },
    onMoveDown: (index) => {
      if (index < 0 || index >= tracks.length - 1) return
      const ids = tracks.map((t) => t.id)
      const [item] = ids.splice(index, 1)
      ids.splice(index + 1, 0, item)
      void reorderPlaylistTracks(playlist.id, ids)
    },
    onRemove: (trackId) => {
      void removeTrackFromPlaylist(playlist.id, trackId)
    }
  }

  const handleMixPlaylistWithAutoDj = async () => {
    updateAutoDjConfig({
      enabled: true,
      scope: { type: 'playlist', playlistId: playlist.id }
    })
    if (tracks[0]) {
      await playTrack(tracks[0], tracks)
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Playlist Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/[0.07] bg-gradient-to-r from-accent/15 via-surface/60 to-transparent px-6 py-5">
        <div className="flex items-center gap-4 min-w-0 flex-1">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-accent/35 bg-accent/20 text-accent shadow-glow">
            <ListMusic className="h-7 w-7" />
          </div>

          <div className="min-w-0 flex-1">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-accentGlow">
              Playlist
            </span>

            {editing ? (
              <div className="mt-1 flex items-center gap-2 max-w-sm">
                <input
                  type="text"
                  autoFocus
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleSaveRename()
                    if (e.key === 'Escape') {
                      setEditing(false)
                      setDraftName(playlist.name)
                    }
                  }}
                  className="h-8 flex-1 rounded-lg border border-accent/50 bg-black/40 px-2.5 text-sm font-semibold text-white focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => void handleSaveRename()}
                  className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-white"
                >
                  <Check className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditing(false)
                    setDraftName(playlist.name)
                  }}
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-slate-300"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <h1 className="truncate text-xl font-bold text-white">{playlist.name}</h1>
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  title="Rename playlist"
                  className="rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-white transition-colors"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            <p className="mt-0.5 text-xs text-slate-400">
              {tracks.length} {tracks.length === 1 ? 'track' : 'tracks'}
              {playlist.description ? ` · ${playlist.description}` : ''}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {tracks.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => void handleMixPlaylistWithAutoDj()}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-accent/35 bg-accent/15 px-3.5 text-xs font-semibold text-white hover:bg-accent/25 transition-colors"
              >
                <Radio className="h-3.5 w-3.5 text-accentGlow" />
                <span>Auto-DJ Playlist</span>
              </button>
              <button
                type="button"
                onClick={() => void playTrack(tracks[0], tracks)}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-accent px-4 text-xs font-semibold text-white shadow-glow hover:brightness-110 transition-all"
              >
                <Play className="h-3.5 w-3.5" />
                <span>Play</span>
              </button>
            </>
          )}

          {confirmDelete ? (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => void deletePlaylist(playlist.id)}
                className="h-9 rounded-xl bg-rose-500 px-3 text-xs font-semibold text-white hover:bg-rose-400"
              >
                Confirm Delete
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="h-9 rounded-xl border border-white/10 bg-white/5 px-2.5 text-xs text-slate-300"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              title="Delete playlist"
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-slate-400 hover:border-rose-500/40 hover:bg-rose-500/15 hover:text-rose-300 transition-colors"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      <FilterBar showFolderFilter={false} />
      <TrackTable
        playlistActions={playlistActions}
        emptyTitle="Playlist Is Empty"
        emptyDescription="Right-click any track in your library and choose Add to Playlist."
      />
    </div>
  )
}
