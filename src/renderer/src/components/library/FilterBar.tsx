import { FilterX, Folder, KeyRound, Search, SlidersHorizontal, X } from 'lucide-react'
import { camelotToMusicalName } from '@shared/camelot'
import { useLibraryStore } from '@/store/useLibraryStore'

interface FilterBarProps {
  showFolderFilter?: boolean
}

export function FilterBar({ showFolderFilter = true }: FilterBarProps) {
  const filter = useLibraryStore((s) => s.filter)
  const facets = useLibraryStore((s) => s.facets)
  const folders = useLibraryStore((s) => s.folders)
  const tracksCount = useLibraryStore((s) => s.tracks.length)
  const setFilter = useLibraryStore((s) => s.setFilter)
  const resetFilter = useLibraryStore((s) => s.resetFilter)

  const hasActiveFilter = Boolean(
    filter.search?.trim() ||
      filter.genre ||
      filter.camelotKey ||
      filter.bpmMin != null ||
      filter.bpmMax != null ||
      (showFolderFilter && filter.folderId != null)
  )

  const parseBpmInput = (val: string): number | null => {
    const trimmed = val.trim()
    if (!trimmed) return null
    const parsed = Number(trimmed)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] bg-surface/40 px-5 py-2.5 backdrop-blur-md">
      {/* Instant search */}
      <div className="relative min-w-[200px] flex-1 max-w-xs">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          value={filter.search ?? ''}
          onChange={(e) => setFilter({ search: e.target.value })}
          placeholder="Filter title, artist, album, genre..."
          className="h-8 w-full rounded-lg border border-white/10 bg-white/[0.04] pl-8 pr-7 text-xs text-slate-100 placeholder:text-slate-500 focus:border-accent/60 focus:bg-white/[0.07] focus:outline-none transition-colors"
        />
        {filter.search && (
          <button
            type="button"
            onClick={() => setFilter({ search: '' })}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
            title="Clear search"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Genre select */}
      <div className="relative flex items-center">
        <SlidersHorizontal className="pointer-events-none absolute left-2.5 h-3 w-3 text-slate-400" />
        <select
          value={filter.genre ?? ''}
          onChange={(e) => setFilter({ genre: e.target.value || null })}
          aria-label="Filter by genre"
          className="h-8 rounded-lg border border-white/10 bg-[#121520] pl-7 pr-6 text-xs text-slate-200 focus:border-accent/60 focus:outline-none"
        >
          <option value="">All Genres</option>
          {facets.genres.map((genre) => (
            <option key={genre} value={genre}>
              {genre}
            </option>
          ))}
        </select>
      </div>

      {/* Camelot Key select */}
      <div className="relative flex items-center">
        <KeyRound className="pointer-events-none absolute left-2.5 h-3 w-3 text-slate-400" />
        <select
          value={filter.camelotKey ?? ''}
          onChange={(e) => setFilter({ camelotKey: e.target.value || null })}
          aria-label="Filter by Camelot key"
          className="h-8 rounded-lg border border-white/10 bg-[#121520] pl-7 pr-6 text-xs text-slate-200 focus:border-accent/60 focus:outline-none"
        >
          <option value="">All Keys</option>
          {facets.keys.map((key) => {
            const musical = camelotToMusicalName(key)
            return (
              <option key={key} value={key}>
                {musical ? `${key} · ${musical}` : key}
              </option>
            )
          })}
        </select>
      </div>

      {/* BPM Min / Max */}
      <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] px-2 h-8">
        <span className="text-[11px] font-medium text-slate-400">BPM</span>
        <input
          type="number"
          min={40}
          max={250}
          value={filter.bpmMin ?? ''}
          onChange={(e) => setFilter({ bpmMin: parseBpmInput(e.target.value) })}
          placeholder={facets.minBpm ? String(Math.round(facets.minBpm)) : 'Min'}
          aria-label="Minimum BPM"
          className="w-12 bg-transparent text-center font-mono text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none"
        />
        <span className="text-slate-500">–</span>
        <input
          type="number"
          min={40}
          max={250}
          value={filter.bpmMax ?? ''}
          onChange={(e) => setFilter({ bpmMax: parseBpmInput(e.target.value) })}
          placeholder={facets.maxBpm ? String(Math.round(facets.maxBpm)) : 'Max'}
          aria-label="Maximum BPM"
          className="w-12 bg-transparent text-center font-mono text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none"
        />
      </div>

      {/* Source Folder select */}
      {showFolderFilter && folders.length > 0 && (
        <div className="relative flex items-center">
          <Folder className="pointer-events-none absolute left-2.5 h-3 w-3 text-slate-400" />
          <select
            value={filter.folderId ?? ''}
            onChange={(e) =>
              setFilter({ folderId: e.target.value ? Number(e.target.value) : null })
            }
            aria-label="Filter by source folder"
            className="h-8 max-w-[160px] rounded-lg border border-white/10 bg-[#121520] pl-7 pr-6 text-xs text-slate-200 focus:border-accent/60 focus:outline-none"
          >
            <option value="">All Folders</option>
            {folders
              .filter((f) => f.isActive)
              .map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name}
                </option>
              ))}
          </select>
        </div>
      )}

      {hasActiveFilter && (
        <button
          type="button"
          onClick={resetFilter}
          className="inline-flex h-8 items-center gap-1 rounded-lg border border-white/10 bg-white/[0.05] px-2.5 text-xs font-medium text-slate-300 hover:bg-white/10 hover:text-white transition-colors"
        >
          <FilterX className="h-3.5 w-3.5" />
          <span>Reset</span>
        </button>
      )}

      <div className="ml-auto text-[11px] font-medium tabular-nums text-slate-400">
        {tracksCount} {tracksCount === 1 ? 'track' : 'tracks'}
      </div>
    </div>
  )
}
