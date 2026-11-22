import { useEffect, useRef } from 'react'
import {
  Activity,
  Copy,
  Disc3,
  Loader2,
  Minus,
  PictureInPicture2,
  Search,
  Settings,
  Square,
  X
} from 'lucide-react'
import { useLibraryStore } from '@/store/useLibraryStore'
import { usePlayerStore } from '@/store/usePlayerStore'
import { getModKeyLabel, isMacPlatform } from '@/utils/format'

export function TitleBar() {
  const activeView = useLibraryStore((s) => s.activeView)
  const search = useLibraryStore((s) => s.filter.search ?? '')
  const facets = useLibraryStore((s) => s.facets)
  const scanProgress = useLibraryStore((s) => s.scanProgress)
  const focusSearchNonce = useLibraryStore((s) => s.focusSearchNonce)
  const setFilter = useLibraryStore((s) => s.setFilter)
  const setView = useLibraryStore((s) => s.setView)

  const analysisProgress = usePlayerStore((s) => s.analysisProgress)
  const isMaximized = usePlayerStore((s) => s.isMaximized)
  const autoDjEnabled = usePlayerStore((s) => s.autoDjConfig.enabled)
  const setMiniPlayer = usePlayerStore((s) => s.setMiniPlayer)
  const minimizeWindow = usePlayerStore((s) => s.minimizeWindow)
  const toggleMaximizeWindow = usePlayerStore((s) => s.toggleMaximizeWindow)
  const closeWindow = usePlayerStore((s) => s.closeWindow)

  const searchInputRef = useRef<HTMLInputElement>(null)
  const isMac = isMacPlatform()
  const modKey = getModKeyLabel()

  useEffect(() => {
    if (focusSearchNonce > 0) {
      searchInputRef.current?.focus()
      searchInputRef.current?.select()
    }
  }, [focusSearchNonce])

  const activeScan = Object.values(scanProgress).find(
    (ev) => ev.phase === 'discovering' || ev.phase === 'indexing'
  )

  const pendingAnalyzeCount = Math.max(0, facets.totalTracks - facets.analyzedTracks)
  const showAnalysisBadge = analysisProgress.running || pendingAnalyzeCount > 0

  const handleQuickSearchChange = (value: string) => {
    if (
      value.trim() &&
      (activeView === 'folders' || activeView === 'autodj' || activeView === 'settings')
    ) {
      setView('tracks')
    }
    setFilter({ search: value })
  }

  return (
    <header className="drag-region flex h-11 shrink-0 items-center justify-between border-b border-white/[0.07] bg-obsidian/90 px-3 select-none backdrop-blur-xl">
      {/* Brand (extra left pad on macOS to clear native traffic-light controls) */}
      <div className={`flex items-center gap-2.5 ${isMac ? 'pl-[76px]' : 'pl-1'}`}>
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-accent to-accentGlow text-white shadow-glow">
          <Disc3 className="h-4 w-4" />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold tracking-tight text-white">PulseDeck</span>
          {autoDjEnabled && (
            <span className="hidden sm:inline-flex items-center gap-1 rounded-full border border-accent/35 bg-accent/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent">
              <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
              Auto-Mix
            </span>
          )}
        </div>
      </div>

      {/* Quick Search (F) */}
      <div className="no-drag mx-4 flex w-full max-w-md items-center">
        <div className="relative w-full">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            ref={searchInputRef}
            type="text"
            value={search}
            onChange={(e) => handleQuickSearchChange(e.target.value)}
            placeholder="Quick search tracks, artists, genres..."
            aria-label="Quick search"
            className="h-7 w-full rounded-lg border border-white/10 bg-white/[0.04] pl-8 pr-12 text-xs text-slate-100 placeholder:text-slate-500 focus:border-accent/60 focus:bg-white/[0.07] focus:outline-none transition-colors"
          />
          {search ? (
            <button
              type="button"
              onClick={() => setFilter({ search: '' })}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
              title="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : (
            <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5 font-mono text-[9px] text-slate-500">
              F
            </kbd>
          )}
        </div>
      </div>

      {/* Status + Mini Player + Window Controls */}
      <div className="no-drag flex items-center gap-1.5">
        {activeScan && (
          <button
            type="button"
            onClick={() => setView('folders')}
            className="hidden md:flex items-center gap-1.5 rounded-lg border border-accent/25 bg-accent/10 px-2.5 py-1 text-[11px] text-slate-200 hover:bg-accent/20 transition-colors"
            title="View folder scan progress"
          >
            <Loader2 className="h-3 w-3 animate-spin text-accent" />
            <span className="max-w-[140px] truncate">
              Scanning {activeScan.folderName}
              {activeScan.total > 0 ? ` (${activeScan.scanned}/${activeScan.total})` : ''}
            </span>
          </button>
        )}

        {!activeScan && showAnalysisBadge && (
          <div
            className="hidden lg:flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] text-slate-300"
            title={
              analysisProgress.currentTitle
                ? `Analyzing BPM, key & waveform: ${analysisProgress.currentTitle}`
                : `${facets.analyzedTracks} of ${facets.totalTracks} tracks analyzed`
            }
          >
            <Activity
              className={`h-3 w-3 ${analysisProgress.running ? 'animate-pulse text-accentGlow' : 'text-slate-400'}`}
            />
            <span className="tabular-nums">
              {analysisProgress.running && analysisProgress.total > 0
                ? `DSP ${analysisProgress.completed}/${analysisProgress.total}`
                : `DSP ${facets.analyzedTracks}/${facets.totalTracks}`}
            </span>
          </div>
        )}

        <button
          type="button"
          onClick={() => setView(activeView === 'settings' ? 'tracks' : 'settings')}
          title={`Settings (${modKey}+,)`}
          aria-label="Open Settings"
          className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors ${
            activeView === 'settings'
              ? 'bg-accent/20 text-accentGlow'
              : 'text-slate-400 hover:bg-white/10 hover:text-white'
          }`}
        >
          <Settings className="h-3.5 w-3.5" />
        </button>

        <button
          type="button"
          onClick={() => void setMiniPlayer(true)}
          title="Switch to Mini-Player"
          className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-white/10 hover:text-white transition-colors"
        >
          <PictureInPicture2 className="h-3.5 w-3.5" />
        </button>

        {!isMac && (
          <>
            <div className="mx-1 h-4 w-px bg-white/10" />

            <button
              type="button"
              onClick={minimizeWindow}
              aria-label="Minimize window"
              className="flex h-7 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-white/10 hover:text-white transition-colors"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>

            <button
              type="button"
              onClick={toggleMaximizeWindow}
              aria-label={isMaximized ? 'Restore window' : 'Maximize window'}
              className="flex h-7 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-white/10 hover:text-white transition-colors"
            >
              {isMaximized ? <Copy className="h-3 w-3" /> : <Square className="h-3 w-3" />}
            </button>

            <button
              type="button"
              onClick={closeWindow}
              aria-label="Close window"
              className="flex h-7 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-rose-500/80 hover:text-white transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </>
        )}
      </div>
    </header>
  )
}
