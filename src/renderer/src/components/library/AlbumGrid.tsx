import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowLeft, Disc, Play } from 'lucide-react'
import { ArtworkCover } from '@/components/common/ArtworkCover'
import { FilterBar } from '@/components/library/FilterBar'
import { TrackTable } from '@/components/library/TrackTable'
import { useLibraryStore } from '@/store/useLibraryStore'
import { usePlayerStore } from '@/store/usePlayerStore'
import type { TrackRecord } from '@shared/types'
import { formatDuration } from '@/utils/format'

interface AlbumGroup {
  key: string
  album: string
  artist: string
  year: number | null
  artworkPath: string | null
  tracks: TrackRecord[]
  totalDuration: number
}

function getAlbumGridColumns(width: number): number {
  if (width >= 1280) return 6
  if (width >= 1024) return 5
  if (width >= 768) return 4
  if (width >= 640) return 3
  return 2
}

export function AlbumGrid() {
  const tracks = useLibraryStore((s) => s.tracks)
  const selectedAlbum = useLibraryStore((s) => s.selectedAlbum)
  const setSelectedAlbum = useLibraryStore((s) => s.setSelectedAlbum)
  const playTrack = usePlayerStore((s) => s.playTrack)

  const albums = useMemo<AlbumGroup[]>(() => {
    const map = new Map<string, AlbumGroup>()
    for (const track of tracks) {
      const albumName = track.album?.trim() || 'Unknown Album'
      const artistName = track.albumArtist?.trim() || track.artist?.trim() || 'Unknown Artist'
      const key = `${albumName.toLowerCase()}::${artistName.toLowerCase()}`
      const existing = map.get(key)
      if (existing) {
        existing.tracks.push(track)
        existing.totalDuration += track.duration || 0
        if (!existing.artworkPath && track.artworkPath) {
          existing.artworkPath = track.artworkPath
        }
        if (!existing.year && track.year) {
          existing.year = track.year
        }
      } else {
        map.set(key, {
          key,
          album: albumName,
          artist: artistName,
          year: track.year,
          artworkPath: track.artworkPath,
          tracks: [track],
          totalDuration: track.duration || 0
        })
      }
    }

    const list = Array.from(map.values())
    for (const group of list) {
      group.tracks.sort(
        (a, b) => (a.trackNumber ?? 9999) - (b.trackNumber ?? 9999) || a.title.localeCompare(b.title)
      )
    }
    list.sort((a, b) => a.album.localeCompare(b.album))
    return list
  }, [tracks])

  const activeGroup = useMemo(() => {
    if (!selectedAlbum) return null
    const targetKey = `${selectedAlbum.album.toLowerCase()}::${selectedAlbum.artist.toLowerCase()}`
    return albums.find((g) => g.key === targetKey) ?? null
  }, [albums, selectedAlbum])

  const parentRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState<number>(() =>
    typeof window !== 'undefined' ? window.innerWidth : 1024
  )

  const showGrid = !activeGroup && albums.length > 0

  useEffect(() => {
    if (!showGrid) return
    const el = parentRef.current
    if (!el) return

    const updateWidth = (width: number) => {
      if (width > 0) {
        setContainerWidth((prev) => (prev === width ? prev : width))
      }
    }

    updateWidth(el.clientWidth)

    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        updateWidth(el.clientWidth || Math.round(entry.contentRect.width))
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [showGrid])

  const columns = getAlbumGridColumns(containerWidth)
  const rowCount = Math.ceil(albums.length / columns)
  const estimatedRowHeight = useMemo(() => {
    const innerWidth = Math.max(240, containerWidth - 48)
    const cardWidth = Math.max(120, (innerWidth - (columns - 1) * 16) / columns)
    return Math.round(cardWidth + 60)
  }, [containerWidth, columns])

  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimatedRowHeight,
    gap: 16,
    overscan: 4
  })

  useEffect(() => {
    rowVirtualizer.measure()
  }, [rowVirtualizer, columns, estimatedRowHeight])

  if (activeGroup) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        {/* Album Detail Banner */}
        <div className="flex items-center gap-5 border-b border-white/[0.07] bg-surface/50 px-6 py-5 backdrop-blur-md">
          <button
            type="button"
            onClick={() => setSelectedAlbum(null)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.05] text-slate-300 hover:bg-white/10 hover:text-white transition-colors"
            title="Back to albums"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>

          <ArtworkCover
            artworkPath={activeGroup.artworkPath}
            alt={activeGroup.album}
            className="h-20 w-20 shadow-glow"
            iconClassName="h-8 w-8"
            roundedClassName="rounded-2xl"
          />

          <div className="min-w-0 flex-1">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-accentGlow">
              Album
            </span>
            <h1 className="mt-0.5 truncate text-xl font-bold text-white">
              {activeGroup.album}
            </h1>
            <p className="mt-0.5 text-xs text-slate-300">
              {activeGroup.artist}
              {activeGroup.year ? ` · ${activeGroup.year}` : ''} · {activeGroup.tracks.length}{' '}
              {activeGroup.tracks.length === 1 ? 'track' : 'tracks'} ·{' '}
              {formatDuration(activeGroup.totalDuration)}
            </p>
          </div>

          {activeGroup.tracks.length > 0 && (
            <button
              type="button"
              onClick={() => void playTrack(activeGroup.tracks[0], activeGroup.tracks)}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-accent px-5 text-xs font-semibold text-white shadow-glow hover:brightness-110 transition-all"
            >
              <Play className="h-4 w-4" />
              <span>Play Album</span>
            </button>
          )}
        </div>

        <TrackTable tracks={activeGroup.tracks} />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <FilterBar />

      {albums.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center p-10 text-center">
          <Disc className="mb-3 h-10 w-10 text-slate-600" />
          <p className="text-sm font-semibold text-slate-300">No Albums Found</p>
          <p className="mt-1 text-xs text-slate-500">
            Adjust your filters or add a music folder to populate albums.
          </p>
        </div>
      ) : (
        <div ref={parentRef} className="flex-1 overflow-y-auto p-6">
          <div
            style={{
              height: `${rowVirtualizer.getTotalSize()}px`,
              width: '100%',
              position: 'relative'
            }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const startIdx = virtualRow.index * columns
              const rowAlbums = albums.slice(startIdx, startIdx + columns)
              return (
                <div
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  ref={rowVirtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start}px)`,
                    gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`
                  }}
                  className="grid gap-4"
                >
                  {rowAlbums.map((group) => (
                    <div
                      key={group.key}
                      onClick={() =>
                        setSelectedAlbum({ album: group.album, artist: group.artist })
                      }
                      className="group cursor-pointer rounded-2xl glass-panel p-3 transition-all hover:border-accent/40 hover:bg-white/[0.06]"
                    >
                      <div className="relative aspect-square w-full overflow-hidden rounded-xl">
                        <ArtworkCover
                          artworkPath={group.artworkPath}
                          alt={group.album}
                          className="h-full w-full"
                          iconClassName="h-10 w-10"
                          roundedClassName="rounded-xl"
                        />
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            if (group.tracks[0]) {
                              void playTrack(group.tracks[0], group.tracks)
                            }
                          }}
                          title={`Play ${group.album}`}
                          className="absolute right-2.5 bottom-2.5 flex h-10 w-10 translate-y-2 items-center justify-center rounded-full bg-accent text-white opacity-0 shadow-glow transition-all group-hover:translate-y-0 group-hover:opacity-100 hover:scale-105"
                        >
                          <Play className="ml-0.5 h-4 w-4" />
                        </button>
                      </div>

                      <div className="mt-2.5 min-w-0">
                        <p className="truncate text-xs font-semibold text-white">{group.album}</p>
                        <p className="mt-0.5 truncate text-[11px] text-slate-400">{group.artist}</p>
                        <p className="mt-1 font-mono text-[10px] text-slate-500">
                          {group.tracks.length} {group.tracks.length === 1 ? 'track' : 'tracks'}
                          {group.year ? ` · ${group.year}` : ''}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
