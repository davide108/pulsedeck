import { useMemo } from 'react'
import { Play, Users } from 'lucide-react'
import { ArtworkCover } from '@/components/common/ArtworkCover'
import { FilterBar } from '@/components/library/FilterBar'
import { TrackTable } from '@/components/library/TrackTable'
import { useLibraryStore } from '@/store/useLibraryStore'
import { usePlayerStore } from '@/store/usePlayerStore'
import type { TrackRecord } from '@shared/types'

interface ArtistSummary {
  name: string
  tracks: TrackRecord[]
  albums: Array<{ album: string; artworkPath: string | null; count: number }>
  artworkPath: string | null
}

export function ArtistView() {
  const tracks = useLibraryStore((s) => s.tracks)
  const selectedArtist = useLibraryStore((s) => s.selectedArtist)
  const setSelectedArtist = useLibraryStore((s) => s.setSelectedArtist)
  const playTrack = usePlayerStore((s) => s.playTrack)

  const artists = useMemo<ArtistSummary[]>(() => {
    const byArtist = new Map<string, TrackRecord[]>()
    for (const track of tracks) {
      const name = track.artist?.trim() || 'Unknown Artist'
      const arr = byArtist.get(name)
      if (arr) {
        arr.push(track)
      } else {
        byArtist.set(name, [track])
      }
    }

    const result: ArtistSummary[] = []
    for (const [name, list] of byArtist.entries()) {
      const albumMap = new Map<string, { album: string; artworkPath: string | null; count: number }>()
      let artworkPath: string | null = null
      for (const tr of list) {
        if (!artworkPath && tr.artworkPath) artworkPath = tr.artworkPath
        const alb = tr.album?.trim() || 'Unknown Album'
        const prev = albumMap.get(alb)
        if (prev) {
          prev.count++
          if (!prev.artworkPath && tr.artworkPath) prev.artworkPath = tr.artworkPath
        } else {
          albumMap.set(alb, { album: alb, artworkPath: tr.artworkPath, count: 1 })
        }
      }
      result.push({
        name,
        tracks: list,
        albums: Array.from(albumMap.values()),
        artworkPath
      })
    }

    result.sort((a, b) => a.name.localeCompare(b.name))
    return result
  }, [tracks])

  const activeArtist = useMemo(() => {
    if (artists.length === 0) return null
    if (selectedArtist) {
      const match = artists.find((a) => a.name === selectedArtist)
      if (match) return match
    }
    return artists[0]
  }, [artists, selectedArtist])

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <FilterBar />

      {artists.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center p-10 text-center">
          <Users className="mb-3 h-10 w-10 text-slate-600" />
          <p className="text-sm font-semibold text-slate-300">No Artists Found</p>
          <p className="mt-1 text-xs text-slate-500">
            Adjust your filters or add a music folder to browse artists.
          </p>
        </div>
      ) : (
        <div className="flex flex-1 overflow-hidden">
          {/* Left Artist Directory */}
          <div className="w-64 shrink-0 overflow-y-auto border-r border-white/[0.07] bg-surface/35 p-2.5 space-y-1">
            {artists.map((artist) => {
              const selected = activeArtist?.name === artist.name
              return (
                <button
                  key={artist.name}
                  type="button"
                  onClick={() => setSelectedArtist(artist.name)}
                  className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors ${
                    selected
                      ? 'bg-accent/20 border border-accent/35 text-white'
                      : 'border border-transparent text-slate-300 hover:bg-white/[0.05] hover:text-white'
                  }`}
                >
                  <ArtworkCover
                    artworkPath={artist.artworkPath}
                    alt={artist.name}
                    className="h-9 w-9"
                    iconClassName="h-4 w-4"
                    roundedClassName="rounded-full"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold">{artist.name}</p>
                    <p className="text-[10px] text-slate-400">
                      {artist.albums.length} {artist.albums.length === 1 ? 'album' : 'albums'} ·{' '}
                      {artist.tracks.length} {artist.tracks.length === 1 ? 'track' : 'tracks'}
                    </p>
                  </div>
                </button>
              )
            })}
          </div>

          {/* Right Artist Detail */}
          {activeArtist && (
            <div className="flex flex-1 flex-col overflow-hidden">
              <div className="border-b border-white/[0.07] bg-surface/40 px-6 py-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-4 min-w-0">
                    <ArtworkCover
                      artworkPath={activeArtist.artworkPath}
                      alt={activeArtist.name}
                      className="h-14 w-14 shadow-glow"
                      iconClassName="h-6 w-6"
                      roundedClassName="rounded-full"
                    />
                    <div className="min-w-0">
                      <span className="text-[10px] font-semibold uppercase tracking-widest text-accentGlow">
                        Artist
                      </span>
                      <h2 className="truncate text-lg font-bold text-white">{activeArtist.name}</h2>
                      <p className="text-xs text-slate-400">
                        {activeArtist.albums.length}{' '}
                        {activeArtist.albums.length === 1 ? 'album' : 'albums'} ·{' '}
                        {activeArtist.tracks.length}{' '}
                        {activeArtist.tracks.length === 1 ? 'track' : 'tracks'}
                      </p>
                    </div>
                  </div>

                  {activeArtist.tracks[0] && (
                    <button
                      type="button"
                      onClick={() => void playTrack(activeArtist.tracks[0], activeArtist.tracks)}
                      className="inline-flex h-9 items-center gap-2 rounded-xl bg-accent px-4 text-xs font-semibold text-white shadow-glow hover:brightness-110 transition-all"
                    >
                      <Play className="h-3.5 w-3.5" />
                      <span>Play Artist</span>
                    </button>
                  )}
                </div>

                {/* Grouped Album Chips */}
                {activeArtist.albums.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {activeArtist.albums.map((alb) => (
                      <div
                        key={alb.album}
                        className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] text-slate-200"
                      >
                        <ArtworkCover
                          artworkPath={alb.artworkPath}
                          alt={alb.album}
                          className="h-5 w-5"
                          iconClassName="h-3 w-3"
                          roundedClassName="rounded"
                        />
                        <span className="max-w-[160px] truncate font-medium">{alb.album}</span>
                        <span className="font-mono text-[10px] text-slate-500">({alb.count})</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <TrackTable tracks={activeArtist.tracks} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
