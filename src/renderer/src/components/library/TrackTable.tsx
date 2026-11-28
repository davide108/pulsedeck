import { useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  FolderOpen,
  FolderPlus,
  Heart,
  Info,
  ListPlus,
  Music,
  Play,
  Shuffle,
  Trash2
} from 'lucide-react'
import { ArtworkCover } from '@/components/common/ArtworkCover'
import { ContextMenu, type ContextMenuItem } from '@/components/common/ContextMenu'
import { EnergyMeter } from '@/components/common/EnergyMeter'
import { KeyBadge } from '@/components/common/KeyBadge'
import { useLibraryStore } from '@/store/useLibraryStore'
import { usePlayerStore } from '@/store/usePlayerStore'
import type { TrackQueryFilter, TrackRecord } from '@shared/types'
import { formatBpm, formatDuration, getFileManagerLabel } from '@/utils/format'

export interface PlaylistTrackActions {
  onMoveUp: (index: number) => void
  onMoveDown: (index: number) => void
  onRemove: (trackId: number) => void
}

interface TrackTableProps {
  tracks?: TrackRecord[]
  playlistActions?: PlaylistTrackActions
  emptyTitle?: string
  emptyDescription?: string
}

export function TrackTable({
  tracks: tracksProp,
  playlistActions,
  emptyTitle,
  emptyDescription
}: TrackTableProps) {
  const storeTracks = useLibraryStore((s) => s.tracks)
  const folders = useLibraryStore((s) => s.folders)
  const playlists = useLibraryStore((s) => s.playlists)
  const filter = useLibraryStore((s) => s.filter)
  const toggleSort = useLibraryStore((s) => s.toggleSort)
  const resetFilter = useLibraryStore((s) => s.resetFilter)
  const addFolder = useLibraryStore((s) => s.addFolder)
  const addTrackToPlaylist = useLibraryStore((s) => s.addTrackToPlaylist)
  const revealTrackInFolder = useLibraryStore((s) => s.revealTrackInFolder)
  const openTrackInfo = useLibraryStore((s) => s.openTrackInfo)
  const toggleTrackLike = useLibraryStore((s) => s.toggleTrackLike)

  const activeTrackId = usePlayerStore((s) => s.activeTrack?.id ?? null)
  const isPlaying = usePlayerStore((s) => s.isPlaying)
  const playTrack = usePlayerStore((s) => s.playTrack)
  const crossfadeToTrack = usePlayerStore((s) => s.crossfadeToTrack)

  const tracks = tracksProp ?? storeTracks
  const parentRef = useRef<HTMLDivElement>(null)

  const [contextState, setContextState] = useState<{
    x: number
    y: number
    track: TrackRecord
  } | null>(null)

  const rowVirtualizer = useVirtualizer({
    count: tracks.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 58,
    overscan: 12
  })

  const gridTemplate = playlistActions
    ? 'grid-cols-[40px_minmax(210px,2.2fr)_minmax(120px,1.2fr)_110px_68px_72px_96px_32px_64px_84px]'
    : 'grid-cols-[40px_minmax(220px,2.2fr)_minmax(130px,1.2fr)_116px_70px_74px_100px_32px_66px]'

  const renderSortHeader = (
    label: string,
    column: NonNullable<TrackQueryFilter['sortBy']>,
    align: 'left' | 'right' = 'left'
  ) => {
    const active = filter.sortBy === column
    return (
      <button
        type="button"
        onClick={() => toggleSort(column)}
        className={`inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider transition-colors ${
          align === 'right' ? 'justify-end' : ''
        } ${active ? 'text-accentGlow' : 'text-slate-400 hover:text-white'}`}
      >
        <span>{label}</span>
        {active ? (
          filter.sortDir === 'desc' ? (
            <ArrowDown className="h-3 w-3" />
          ) : (
            <ArrowUp className="h-3 w-3" />
          )
        ) : (
          <ArrowUpDown className="h-3 w-3 opacity-35" />
        )}
      </button>
    )
  }

  const contextMenuItems = useMemo<ContextMenuItem[]>(() => {
    if (!contextState) return []
    const { track } = contextState
    const playlistChildren: ContextMenuItem[] =
      playlists.length > 0
        ? playlists.map((pl) => ({
            id: `pl-${pl.id}`,
            label: pl.name,
            icon: <ListPlus className="h-3.5 w-3.5" />,
            onClick: () => void addTrackToPlaylist(pl.id, track.id)
          }))
        : [
            {
              id: 'no-pl',
              label: 'Create a playlist in sidebar first',
              disabled: true
            }
          ]

    const items: ContextMenuItem[] = [
      {
        id: 'play-now',
        label: 'Play Now',
        icon: <Play className="h-3.5 w-3.5" />,
        onClick: () => void playTrack(track, tracks)
      },
      {
        id: 'crossfade-now',
        label: 'Crossfade Now',
        icon: <Shuffle className="h-3.5 w-3.5" />,
        dividerAfter: true,
        onClick: () => void crossfadeToTrack(track, tracks)
      },
      {
        id: 'toggle-like',
        label: track.isLiked ? 'Remove from Liked Songs' : 'Save to Liked Songs',
        icon: (
          <Heart
            className={`h-3.5 w-3.5 ${track.isLiked ? 'fill-rose-400 text-rose-400' : ''}`}
          />
        ),
        onClick: () => void toggleTrackLike(track.id)
      },
      {
        id: 'track-info',
        label: 'Track Info & Edit Metadata',
        icon: <Info className="h-3.5 w-3.5" />,
        dividerAfter: true,
        onClick: () => openTrackInfo(track)
      },
      {
        id: 'add-playlist',
        label: 'Add to Playlist',
        icon: <ListPlus className="h-3.5 w-3.5" />,
        children: playlistChildren
      },
      {
        id: 'reveal',
        label: `Reveal in ${getFileManagerLabel()}`,
        icon: <FolderOpen className="h-3.5 w-3.5" />,
        onClick: () => void revealTrackInFolder(track.id)
      }
    ]

    if (playlistActions) {
      items.push({
        id: 'remove-from-playlist',
        label: 'Remove from Playlist',
        icon: <Trash2 className="h-3.5 w-3.5" />,
        danger: true,
        onClick: () => playlistActions.onRemove(track.id)
      })
    }

    return items
  }, [
    contextState,
    playlists,
    tracks,
    addTrackToPlaylist,
    playTrack,
    crossfadeToTrack,
    openTrackInfo,
    revealTrackInFolder,
    toggleTrackLike,
    playlistActions
  ])

  if (tracks.length === 0) {
    const noFolders = folders.length === 0
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-10 text-center">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-slate-400">
          <Music className="h-7 w-7" />
        </div>
        <h3 className="text-base font-semibold text-white">
          {emptyTitle ?? (noFolders ? 'Your Library Is Empty' : 'No Matching Tracks')}
        </h3>
        <p className="mt-1.5 max-w-sm text-xs text-slate-400">
          {emptyDescription ??
            (noFolders
              ? 'Connect a local music folder to index your tracks and unlock BPM, key, and Auto-DJ mixing.'
              : 'Try adjusting your search or filter criteria.')}
        </p>
        {noFolders ? (
          <button
            type="button"
            onClick={() => void addFolder()}
            className="mt-5 inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-white shadow-glow hover:brightness-110 transition-all"
          >
            <FolderPlus className="h-4 w-4" />
            <span>Add Music Folder</span>
          </button>
        ) : (
          (filter.search ||
            filter.genre ||
            filter.camelotKey ||
            filter.bpmMin != null ||
            filter.bpmMax != null ||
            filter.folderId != null) && (
            <button
              type="button"
              onClick={resetFilter}
              className="mt-4 rounded-xl border border-white/10 bg-white/[0.05] px-4 py-2 text-xs font-medium text-slate-200 hover:bg-white/10 transition-colors"
            >
              Reset Filters
            </button>
          )
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Sticky Column Headers */}
      <div
        className={`grid ${gridTemplate} items-center gap-3 border-b border-white/[0.07] bg-surface/65 px-5 py-2.5 text-left backdrop-blur-md select-none`}
      >
        <span className="text-center text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          #
        </span>
        <div className="flex items-center gap-2">
          {renderSortHeader('Title', 'title')}
          <span className="text-slate-600">/</span>
          {renderSortHeader('Artist', 'artist')}
        </div>
        {renderSortHeader('Album', 'album')}
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          Genre
        </span>
        {renderSortHeader('BPM', 'bpm', 'right')}
        {renderSortHeader('Key', 'camelot_key')}
        {renderSortHeader('Energy', 'energy')}
        <span title="Liked" className="flex items-center justify-center">
          <Heart className="mx-auto h-3 w-3 text-slate-500" />
        </span>
        {renderSortHeader('Time', 'duration', 'right')}
        {playlistActions && (
          <span className="text-right text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Order
          </span>
        )}
      </div>

      {/* Virtualized Rows */}
      <div ref={parentRef} className="flex-1 overflow-y-auto px-3 py-1.5">
        <div
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative'
          }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const track = tracks[virtualRow.index]
            const isActive = track.id === activeTrackId
            return (
              <div
                key={track.id}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`
                }}
                onDoubleClick={() => void playTrack(track, tracks)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setContextState({ x: e.clientX, y: e.clientY, track })
                }}
                className={`group grid ${gridTemplate} items-center gap-3 rounded-xl px-2.5 transition-colors select-none ${
                  isActive
                    ? 'bg-accent/15 border border-accent/30'
                    : 'border border-transparent hover:bg-white/[0.045]'
                }`}
              >
                {/* Index / Play Trigger */}
                <div className="flex items-center justify-center">
                  <button
                    type="button"
                    onClick={() => void playTrack(track, tracks)}
                    title={isActive && isPlaying ? 'Playing' : `Play ${track.title}`}
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-accent hover:text-white transition-colors"
                  >
                    {isActive && isPlaying ? (
                      <span className="flex items-end gap-0.5 h-3">
                        <span className="w-0.5 h-2 bg-accentGlow animate-pulse rounded-full" />
                        <span className="w-0.5 h-3 bg-accent animate-pulse rounded-full" />
                        <span className="w-0.5 h-1.5 bg-accentGlow animate-pulse rounded-full" />
                      </span>
                    ) : (
                      <>
                        <span className="font-mono text-[11px] tabular-nums text-slate-500 group-hover:hidden">
                          {virtualRow.index + 1}
                        </span>
                        <Play className="hidden h-3.5 w-3.5 group-hover:block" />
                      </>
                    )}
                  </button>
                </div>

                {/* Artwork + Title / Artist */}
                <div className="flex min-w-0 items-center gap-3">
                  <ArtworkCover
                    artworkPath={track.artworkPath}
                    alt={track.album}
                    className="h-9 w-9"
                    iconClassName="h-4 w-4"
                  />
                  <div className="min-w-0 flex-1">
                    <p
                      className={`truncate text-xs font-semibold ${
                        isActive ? 'text-accentGlow' : 'text-slate-100'
                      }`}
                    >
                      {track.title}
                    </p>
                    <p className="truncate text-[11px] text-slate-400">{track.artist}</p>
                  </div>
                </div>

                {/* Album */}
                <div className="min-w-0 truncate text-xs text-slate-300">{track.album}</div>

                {/* Genre Pill */}
                <div className="min-w-0">
                  {track.genre ? (
                    <span className="inline-block max-w-full truncate rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-medium text-slate-300">
                      {track.genre}
                    </span>
                  ) : (
                    <span className="text-[11px] text-slate-600">—</span>
                  )}
                </div>

                {/* BPM */}
                <div className="text-right font-mono text-xs tabular-nums text-slate-200">
                  {formatBpm(track.bpm)}
                </div>

                {/* Camelot KeyBadge */}
                <div>
                  <KeyBadge
                    camelotKey={track.camelotKey}
                    musicalKey={track.musicalKey}
                    size="xs"
                  />
                </div>

                {/* EnergyMeter */}
                <div>
                  <EnergyMeter energy={track.energy} />
                </div>

                {/* Like / Heart */}
                <div className="flex items-center justify-center">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      void toggleTrackLike(track.id)
                    }}
                    onDoubleClick={(e) => e.stopPropagation()}
                    title={track.isLiked ? 'Remove from Liked Songs' : 'Save to Liked Songs'}
                    aria-label={track.isLiked ? 'Remove from Liked Songs' : 'Save to Liked Songs'}
                    className={`flex h-7 w-7 items-center justify-center rounded-lg transition-all ${
                      track.isLiked
                        ? 'text-rose-400 hover:bg-rose-500/15 hover:text-rose-300 opacity-100'
                        : `text-slate-500 hover:bg-white/10 hover:text-rose-400 ${
                            isActive
                              ? 'opacity-70'
                              : 'opacity-0 group-hover:opacity-100 focus:opacity-100'
                          }`
                    }`}
                  >
                    <Heart className={`h-3.5 w-3.5 ${track.isLiked ? 'fill-rose-400' : ''}`} />
                  </button>
                </div>

                {/* Duration */}
                <div className="text-right font-mono text-xs tabular-nums text-slate-400">
                  {formatDuration(track.duration)}
                </div>

                {/* Playlist Reorder / Remove */}
                {playlistActions && (
                  <div className="flex items-center justify-end gap-0.5">
                    <button
                      type="button"
                      disabled={virtualRow.index === 0}
                      onClick={() => playlistActions.onMoveUp(virtualRow.index)}
                      title="Move up"
                      className="flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-white/10 hover:text-white disabled:opacity-25"
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={virtualRow.index === tracks.length - 1}
                      onClick={() => playlistActions.onMoveDown(virtualRow.index)}
                      title="Move down"
                      className="flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-white/10 hover:text-white disabled:opacity-25"
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => playlistActions.onRemove(track.id)}
                      title="Remove from playlist"
                      className="flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-rose-500/20 hover:text-rose-300"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {contextState && (
        <ContextMenu
          x={contextState.x}
          y={contextState.y}
          items={contextMenuItems}
          onClose={() => setContextState(null)}
        />
      )}
    </div>
  )
}
