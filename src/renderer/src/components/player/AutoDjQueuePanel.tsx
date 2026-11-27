import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  ArrowDown,
  ArrowUp,
  Check,
  GripVertical,
  Library,
  ListPlus,
  Lock,
  Play,
  Radio,
  RefreshCw,
  Search,
  Trash2,
  Unlock,
  Wand2,
  X
} from 'lucide-react'
import { ArtworkCover } from '@/components/common/ArtworkCover'
import { KeyBadge } from '@/components/common/KeyBadge'
import { useLibraryStore } from '@/store/useLibraryStore'
import { usePlayerStore } from '@/store/usePlayerStore'
import type { AutoDjScope, DeckId, TrackRecord } from '@shared/types'
import { setTrackDragData } from '@/utils/deckDrag'
import { formatBpm, formatDuration } from '@/utils/format'

type PanelTab = 'queue' | 'library'
type LibrarySortKey = 'title' | 'bpm' | 'key' | 'energy' | 'added_at'

interface AutoDjQueuePanelProps {
  compact?: boolean
  showDeckControls?: boolean
  className?: string
}

const SORT_OPTIONS: Array<{ id: LibrarySortKey; label: string; defaultDir: 'asc' | 'desc' }> = [
  { id: 'title', label: 'Title', defaultDir: 'asc' },
  { id: 'bpm', label: 'BPM', defaultDir: 'asc' },
  { id: 'key', label: 'Key', defaultDir: 'asc' },
  { id: 'energy', label: 'Energy', defaultDir: 'desc' },
  { id: 'added_at', label: 'Recently Added', defaultDir: 'desc' }
]

function parseCamelotRank(camelotKey: string | null): number {
  if (!camelotKey) return 999
  const match = /^(\d{1,2})([AB])$/i.exec(camelotKey.trim())
  if (!match) return 998
  const num = Number(match[1])
  const letterOffset = match[2].toUpperCase() === 'A' ? 0 : 1
  return num * 2 + letterOffset
}

function matchesSearchTokens(track: TrackRecord, tokens: string[]): boolean {
  if (tokens.length === 0) return true
  const haystack = [
    track.title,
    track.artist,
    track.album,
    track.genre ?? '',
    track.camelotKey ?? '',
    track.musicalKey ?? '',
    track.bpm ? `${Math.round(track.bpm)} ${track.bpm.toFixed(1)}` : ''
  ]
    .join(' ')
    .toLowerCase()

  for (let i = 0; i < tokens.length; i++) {
    if (!haystack.includes(tokens[i])) return false
  }
  return true
}

export function AutoDjQueuePanel({
  compact = false,
  showDeckControls = false,
  className = ''
}: AutoDjQueuePanelProps) {
  const [activeTab, setActiveTab] = useState<PanelTab>('queue')
  const [searchQuery, setSearchQuery] = useState('')
  const [sortBy, setSortBy] = useState<LibrarySortKey>('title')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [recentlyQueuedId, setRecentlyQueuedId] = useState<number | null>(null)
  const queueFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const libraryScrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    return () => {
      if (queueFeedbackTimerRef.current) {
        clearTimeout(queueFeedbackTimerRef.current)
      }
    }
  }, [])

  const folders = useLibraryStore((s) => s.folders)
  const playlists = useLibraryStore((s) => s.playlists)
  const allTracks = useLibraryStore((s) => s.allTracks)

  const activeTrack = usePlayerStore((s) => s.activeTrack)
  const deckATrackId = usePlayerStore((s) => s.telemetry.decks.A.track?.id ?? null)
  const deckBTrackId = usePlayerStore((s) => s.telemetry.decks.B.track?.id ?? null)
  const autoDjQueue = usePlayerStore((s) => s.autoDjQueue)
  const autoDjConfig = usePlayerStore((s) => s.autoDjConfig)
  const toggleAutoDj = usePlayerStore((s) => s.toggleAutoDj)
  const updateAutoDjConfig = usePlayerStore((s) => s.updateAutoDjConfig)
  const toggleQueueLock = usePlayerStore((s) => s.toggleQueueLock)
  const reorderQueue = usePlayerStore((s) => s.reorderQueue)
  const removeFromQueue = usePlayerStore((s) => s.removeFromQueue)
  const rerollQueue = usePlayerStore((s) => s.rerollQueue)
  const playTrack = usePlayerStore((s) => s.playTrack)
  const triggerManualCrossfade = usePlayerStore((s) => s.triggerManualCrossfade)
  const loadTrackToDeck = usePlayerStore((s) => s.loadTrackToDeck)
  const addTrackToAutoDjQueue = usePlayerStore((s) => s.addTrackToAutoDjQueue)

  const activeFolders = folders.filter((f) => f.isActive)

  const filteredLibraryTracks = useMemo(() => {
    const tokens = searchQuery
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)

    const filtered =
      tokens.length > 0
        ? allTracks.filter((track) => matchesSearchTokens(track, tokens))
        : [...allTracks]

    const dir = sortDir === 'asc' ? 1 : -1

    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'bpm': {
          const av = a.bpm ?? (sortDir === 'asc' ? Number.POSITIVE_INFINITY : -1)
          const bv = b.bpm ?? (sortDir === 'asc' ? Number.POSITIVE_INFINITY : -1)
          if (av !== bv) return (av - bv) * dir
          return a.title.localeCompare(b.title)
        }
        case 'key': {
          const av = parseCamelotRank(a.camelotKey)
          const bv = parseCamelotRank(b.camelotKey)
          if (av !== bv) return (av - bv) * dir
          return a.title.localeCompare(b.title)
        }
        case 'energy': {
          const av = a.energy ?? -1
          const bv = b.energy ?? -1
          if (av !== bv) return (av - bv) * dir
          return a.title.localeCompare(b.title)
        }
        case 'added_at': {
          if (a.addedAt !== b.addedAt) return (a.addedAt - b.addedAt) * dir
          return a.title.localeCompare(b.title)
        }
        case 'title':
        default: {
          const cmp = a.title.localeCompare(b.title)
          if (cmp !== 0) return cmp * dir
          return a.artist.localeCompare(b.artist)
        }
      }
    })

    return filtered
  }, [allTracks, searchQuery, sortBy, sortDir])

  const rowStride = compact ? (showDeckControls ? 74 : 68) : 78
  const libraryVirtualizer = useVirtualizer({
    count: activeTab === 'library' ? filteredLibraryTracks.length : 0,
    getScrollElement: () => libraryScrollRef.current,
    estimateSize: () => rowStride,
    overscan: 8
  })

  const handleScopeTypeChange = (nextType: AutoDjScope['type']) => {
    if (nextType === 'library') {
      updateAutoDjConfig({ scope: { type: 'library' } })
      return
    }
    if (nextType === 'folder') {
      const targetId =
        autoDjConfig.scope.type === 'folder'
          ? autoDjConfig.scope.folderId
          : activeFolders[0]?.id
      if (targetId != null) {
        updateAutoDjConfig({ scope: { type: 'folder', folderId: targetId } })
      }
      return
    }
    if (nextType === 'playlist') {
      const targetId =
        autoDjConfig.scope.type === 'playlist'
          ? autoDjConfig.scope.playlistId
          : playlists[0]?.id
      if (targetId != null) {
        updateAutoDjConfig({ scope: { type: 'playlist', playlistId: targetId } })
      }
    }
  }

  const handleSortChange = (nextKey: LibrarySortKey) => {
    setSortBy(nextKey)
    const option = SORT_OPTIONS.find((o) => o.id === nextKey)
    if (option) {
      setSortDir(option.defaultDir)
    }
  }

  const handleLoadToDeck = (deckId: DeckId, track: TrackRecord) => {
    void loadTrackToDeck(deckId, track, { autoplay: false })
  }

  const handleAddToQueue = (track: TrackRecord) => {
    addTrackToAutoDjQueue(track)
    setRecentlyQueuedId(track.id)
    if (queueFeedbackTimerRef.current) {
      clearTimeout(queueFeedbackTimerRef.current)
    }
    queueFeedbackTimerRef.current = setTimeout(() => {
      setRecentlyQueuedId((current) => (current === track.id ? null : current))
      queueFeedbackTimerRef.current = null
    }, 900)
  }

  return (
    <div className={`flex h-full flex-col overflow-hidden ${className}`}>
      {/* Header + 2-Tab Switcher */}
      <div className="border-b border-white/[0.07] px-3.5 pt-3 pb-3">
        {/* Top Tab Switcher: Up Next | Library */}
        <div
          role="tablist"
          aria-label="DJ browser tabs"
          className="grid grid-cols-2 gap-1 rounded-xl border border-white/10 bg-black/30 p-1"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'queue'}
            onClick={() => setActiveTab('queue')}
            className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-all ${
              activeTab === 'queue'
                ? 'bg-accent text-white shadow-glow'
                : 'text-slate-400 hover:bg-white/[0.05] hover:text-slate-200'
            }`}
          >
            <Radio
              className={`h-3.5 w-3.5 shrink-0 ${
                autoDjConfig.enabled && activeTab !== 'queue'
                  ? 'text-accentGlow animate-pulse'
                  : ''
              }`}
            />
            <span>Up Next</span>
            <span
              className={`rounded-full px-1.5 py-0.5 font-mono text-[10px] tabular-nums ${
                activeTab === 'queue'
                  ? 'bg-white/20 text-white'
                  : 'bg-white/[0.08] text-slate-300'
              }`}
            >
              {autoDjQueue.length}
            </span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'library'}
            onClick={() => setActiveTab('library')}
            className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-all ${
              activeTab === 'library'
                ? 'bg-accent text-white shadow-glow'
                : 'text-slate-400 hover:bg-white/[0.05] hover:text-slate-200'
            }`}
          >
            <Library className="h-3.5 w-3.5 shrink-0" />
            <span>Library</span>
            <span
              className={`rounded-full px-1.5 py-0.5 font-mono text-[10px] tabular-nums ${
                activeTab === 'library'
                  ? 'bg-white/20 text-white'
                  : 'bg-white/[0.08] text-slate-300'
              }`}
            >
              {allTracks.length}
            </span>
          </button>
        </div>

        {/* Tab-Specific Header Controls */}
        {activeTab === 'queue' ? (
          <div className="mt-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-semibold text-slate-200">Auto-Mix</span>
                <button
                  type="button"
                  onClick={toggleAutoDj}
                  className={`rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-all ${
                    autoDjConfig.enabled
                      ? 'border-accent/50 bg-accent/20 text-white shadow-glow'
                      : 'border-white/10 bg-white/[0.04] text-slate-400 hover:text-white'
                  }`}
                >
                  {autoDjConfig.enabled ? 'ON' : 'OFF'}
                </button>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={rerollQueue}
                  title="Reroll unlocked upcoming tracks"
                  className="inline-flex h-7 items-center gap-1 rounded-lg border border-white/10 bg-white/[0.05] px-2.5 text-[11px] font-medium text-slate-200 hover:bg-white/10 hover:text-white transition-colors"
                >
                  <RefreshCw className="h-3 w-3" />
                  <span>Reroll</span>
                </button>

                {autoDjQueue.length > 0 && (
                  <button
                    type="button"
                    onClick={() => void triggerManualCrossfade()}
                    title="Mix into next queued track now"
                    className="inline-flex h-7 items-center gap-1 rounded-lg bg-accent px-2.5 text-[11px] font-semibold text-white shadow-glow hover:brightness-110 transition-all"
                  >
                    <Wand2 className="h-3 w-3" />
                    <span>Mix Next</span>
                  </button>
                )}
              </div>
            </div>

            {!autoDjConfig.enabled && (
              <div className="mt-2.5 flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[11px] text-slate-300">
                <span>Normal playback is active. Enable Auto-Mix to mix automatically.</span>
                <button
                  type="button"
                  onClick={toggleAutoDj}
                  className="shrink-0 rounded-lg border border-accent/40 bg-accent/25 px-2.5 py-1 text-[10px] font-semibold text-white hover:bg-accent/40 transition-colors"
                >
                  Enable
                </button>
              </div>
            )}

            {/* Scope Selector */}
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Source
              </span>
              <div className="inline-flex rounded-lg border border-white/10 bg-black/25 p-0.5">
                {(['library', 'folder', 'playlist'] as const).map((scopeType) => {
                  const disabled =
                    (scopeType === 'folder' && activeFolders.length === 0) ||
                    (scopeType === 'playlist' && playlists.length === 0)
                  const active = autoDjConfig.scope.type === scopeType
                  return (
                    <button
                      key={scopeType}
                      type="button"
                      disabled={disabled}
                      onClick={() => handleScopeTypeChange(scopeType)}
                      className={`rounded-md px-2 py-1 text-[11px] font-medium capitalize transition-colors ${
                        active
                          ? 'bg-accent/25 text-white'
                          : 'text-slate-400 hover:text-slate-200 disabled:opacity-35'
                      }`}
                    >
                      {scopeType}
                    </button>
                  )
                })}
              </div>

              {autoDjConfig.scope.type === 'folder' && activeFolders.length > 0 && (
                <select
                  value={autoDjConfig.scope.folderId}
                  onChange={(e) =>
                    updateAutoDjConfig({
                      scope: { type: 'folder', folderId: Number(e.target.value) }
                    })
                  }
                  aria-label="Select Auto-DJ folder scope"
                  className="h-7 max-w-[160px] rounded-lg border border-white/10 bg-[#121520] px-2 text-xs text-slate-200 focus:border-accent/60 focus:outline-none"
                >
                  {activeFolders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              )}

              {autoDjConfig.scope.type === 'playlist' && playlists.length > 0 && (
                <select
                  value={autoDjConfig.scope.playlistId}
                  onChange={(e) =>
                    updateAutoDjConfig({
                      scope: { type: 'playlist', playlistId: Number(e.target.value) }
                    })
                  }
                  aria-label="Select Auto-DJ playlist scope"
                  className="h-7 max-w-[160px] rounded-lg border border-white/10 bg-[#121520] px-2 text-xs text-slate-200 focus:border-accent/60 focus:outline-none"
                >
                  {playlists.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Current Anchor Summary */}
            {activeTrack && !compact && (
              <div className="mt-2.5 flex items-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.03] px-2.5 py-1.5 text-xs">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-accentGlow">
                  Anchor
                </span>
                <span className="truncate font-medium text-white">{activeTrack.title}</span>
                <span className="text-slate-500">·</span>
                <span className="shrink-0 font-mono text-[10px] text-slate-300">
                  {formatBpm(activeTrack.bpm)} BPM
                </span>
                <KeyBadge camelotKey={activeTrack.camelotKey} size="xs" />
              </div>
            )}
          </div>
        ) : (
          /* Library Search & Sort Controls */
          <div className="mt-3 space-y-2">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search title, artist, album, BPM, key..."
                aria-label="Search library tracks"
                className="h-8 w-full rounded-xl border border-white/10 bg-black/35 pr-8 pl-8 text-xs text-white placeholder:text-slate-500 focus:border-accent/60 focus:outline-none"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  title="Clear search"
                  aria-label="Clear search"
                  className="absolute top-1/2 right-2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 hover:bg-white/10 hover:text-white"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <div className="flex items-center justify-between gap-2 text-[11px]">
              <span className="font-mono text-[10px] tabular-nums text-slate-400">
                {searchQuery.trim()
                  ? `${filteredLibraryTracks.length} / ${allTracks.length} matches`
                  : showDeckControls
                    ? `${allTracks.length} tracks · Drag onto Deck A / B`
                    : `${allTracks.length} tracks`}
              </span>

              <div className="flex items-center gap-1">
                <select
                  value={sortBy}
                  onChange={(e) => handleSortChange(e.target.value as LibrarySortKey)}
                  aria-label="Sort library tracks"
                  className="h-6 rounded-lg border border-white/10 bg-[#121520] px-1.5 text-[11px] text-slate-200 focus:border-accent/60 focus:outline-none"
                >
                  {SORT_OPTIONS.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
                  title={sortDir === 'asc' ? 'Ascending order' : 'Descending order'}
                  aria-label="Toggle sort direction"
                  className="flex h-6 w-6 items-center justify-center rounded-lg border border-white/10 bg-white/[0.05] text-slate-300 hover:bg-white/10 hover:text-white"
                >
                  {sortDir === 'asc' ? (
                    <ArrowUp className="h-3 w-3" />
                  ) : (
                    <ArrowDown className="h-3 w-3" />
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Tab Body */}
      {activeTab === 'queue' ? (
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {autoDjQueue.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 p-6 text-center">
              <Radio className="mb-2.5 h-8 w-8 text-slate-600" />
              <p className="text-xs font-semibold text-slate-300">Auto-DJ Queue Empty</p>
              <p className="mt-1 max-w-xs text-[11px] text-slate-500">
                {showDeckControls
                  ? 'Add at least two tracks in your selected scope or switch to the Library tab to drag tracks onto Deck A & B.'
                  : 'Add at least two tracks in your selected scope or switch to the Library tab to add tracks to Up Next.'}
              </p>
            </div>
          ) : (
            autoDjQueue.map((item, idx) => {
              const { track } = item
              const matchPct = Math.round(Math.max(0, Math.min(1, item.score)) * 100)
              const onDeckA = deckATrackId === track.id
              const onDeckB = deckBTrackId === track.id

              return (
                <div
                  key={`${track.id}-${idx}`}
                  draggable={showDeckControls}
                  onDragStart={showDeckControls ? (e) => setTrackDragData(e, track.id) : undefined}
                  className={`group rounded-xl border p-2.5 transition-all ${
                    showDeckControls ? 'cursor-grab active:cursor-grabbing ' : ''
                  }${
                    item.locked
                      ? 'border-accent/40 bg-accent/10'
                      : idx === 0
                        ? 'border-accentGlow/30 bg-white/[0.05]'
                        : 'border-white/[0.07] bg-white/[0.03] hover:bg-white/[0.055]'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <div className="flex shrink-0 items-center gap-0.5 text-slate-500">
                      {showDeckControls && (
                        <GripVertical className="h-3.5 w-3.5 opacity-45 group-hover:opacity-90" />
                      )}
                      <span className="w-3.5 text-center font-mono text-[10px] font-semibold">
                        {idx + 1}
                      </span>
                    </div>

                    <div className="relative shrink-0">
                      <ArtworkCover
                        artworkPath={track.artworkPath}
                        alt={track.album}
                        className={compact ? 'h-9 w-9' : 'h-10 w-10'}
                        iconClassName="h-4 w-4"
                      />
                      <button
                        type="button"
                        onClick={() => void playTrack(track)}
                        title={`Play ${track.title} now`}
                        className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Play className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <p className="truncate text-xs font-semibold text-white">{track.title}</p>
                        {idx === 0 && (
                          <span className="shrink-0 rounded bg-accentGlow/20 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-accentGlow">
                            Next
                          </span>
                        )}
                      </div>
                      <p className="truncate text-[11px] text-slate-400">
                        {track.artist} · {formatDuration(track.duration)}
                      </p>

                      {/* Match Pills */}
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        <span className="rounded bg-white/[0.07] px-1.5 py-0.5 font-mono text-[10px] text-slate-200">
                          {formatBpm(track.bpm)} BPM
                        </span>
                        <KeyBadge camelotKey={track.camelotKey} size="xs" />
                        {track.genre && (
                          <span className="max-w-[96px] truncate rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-slate-300">
                            {track.genre}
                          </span>
                        )}
                        <span
                          className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium text-accentGlow"
                          title={`BPM ${Math.round(item.bpmScore * 100)}% · Key ${Math.round(item.harmonicScore * 100)}% · Flow ${Math.round(item.flowScore * 100)}%`}
                        >
                          {item.harmonicRelation !== 'Unknown Key'
                            ? item.harmonicRelation
                            : item.matchReason}{' '}
                          · {matchPct}%
                        </span>
                      </div>
                    </div>

                    {/* Deck Load + Queue Controls */}
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      {showDeckControls && (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleLoadToDeck('A', track)}
                            title="Load onto Deck A"
                            className={`flex h-5 w-6 items-center justify-center rounded border font-mono text-[10px] font-bold transition-colors ${
                              onDeckA
                                ? 'border-indigo-400 bg-indigo-500/40 text-white'
                                : 'border-indigo-400/35 bg-indigo-500/15 text-indigo-200 hover:bg-indigo-500/35 hover:text-white'
                            }`}
                          >
                            A
                          </button>
                          <button
                            type="button"
                            onClick={() => handleLoadToDeck('B', track)}
                            title="Load onto Deck B"
                            className={`flex h-5 w-6 items-center justify-center rounded border font-mono text-[10px] font-bold transition-colors ${
                              onDeckB
                                ? 'border-cyan-400 bg-cyan-500/40 text-white'
                                : 'border-cyan-400/35 bg-cyan-500/15 text-cyan-200 hover:bg-cyan-500/35 hover:text-white'
                            }`}
                          >
                            B
                          </button>
                        </div>
                      )}

                      <div className="flex items-center gap-0.5">
                        <button
                          type="button"
                          onClick={() => toggleQueueLock(idx)}
                          title={item.locked ? 'Unlock slot' : 'Lock track in this slot'}
                          className={`flex h-6 w-6 items-center justify-center rounded-md transition-colors ${
                            item.locked
                              ? 'bg-accent/25 text-accentGlow'
                              : 'text-slate-400 hover:bg-white/10 hover:text-white'
                          }`}
                        >
                          {item.locked ? (
                            <Lock className="h-3 w-3" />
                          ) : (
                            <Unlock className="h-3 w-3" />
                          )}
                        </button>

                        <button
                          type="button"
                          disabled={idx === 0}
                          onClick={() => reorderQueue(idx, idx - 1)}
                          title="Move up"
                          className="flex h-6 w-5 items-center justify-center rounded-md text-slate-400 hover:bg-white/10 hover:text-white disabled:opacity-25"
                        >
                          <ArrowUp className="h-3 w-3" />
                        </button>

                        <button
                          type="button"
                          disabled={idx === autoDjQueue.length - 1}
                          onClick={() => reorderQueue(idx, idx + 1)}
                          title="Move down"
                          className="flex h-6 w-5 items-center justify-center rounded-md text-slate-400 hover:bg-white/10 hover:text-white disabled:opacity-25"
                        >
                          <ArrowDown className="h-3 w-3" />
                        </button>

                        <button
                          type="button"
                          onClick={() => removeFromQueue(idx)}
                          title="Remove from queue"
                          className="flex h-6 w-5 items-center justify-center rounded-md text-slate-400 hover:bg-rose-500/20 hover:text-rose-300"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>
      ) : (
        /* Full Library Browser Tab (Virtualized) */
        <div ref={libraryScrollRef} className="flex-1 overflow-y-auto p-3">
          {filteredLibraryTracks.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 p-6 text-center">
              <Library className="mb-2.5 h-8 w-8 text-slate-600" />
              <p className="text-xs font-semibold text-slate-300">
                {allTracks.length === 0 ? 'Your Library Is Empty' : 'No Matching Tracks'}
              </p>
              <p className="mt-1 max-w-xs text-[11px] text-slate-500">
                {allTracks.length === 0
                  ? showDeckControls
                    ? 'Add a music folder from the sidebar to browse and drag tracks onto Deck A & B.'
                    : 'Add a music folder from the sidebar to browse and queue tracks.'
                  : 'Try another title, artist, genre, BPM, or Camelot key.'}
              </p>
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="mt-3 rounded-lg border border-white/15 bg-white/[0.06] px-3 py-1 text-[11px] font-semibold text-white hover:bg-white/15 transition-colors"
                >
                  Clear Search
                </button>
              )}
            </div>
          ) : (
            <div
              style={{
                height: `${libraryVirtualizer.getTotalSize()}px`,
                width: '100%',
                position: 'relative'
              }}
            >
              {libraryVirtualizer.getVirtualItems().map((virtualRow) => {
                const track = filteredLibraryTracks[virtualRow.index]
                if (!track) return null
                const onDeckA = deckATrackId === track.id
                const onDeckB = deckBTrackId === track.id
                const wasQueued = recentlyQueuedId === track.id

                const isHighlighted = showDeckControls
                  ? onDeckA || onDeckB
                  : activeTrack?.id === track.id

                return (
                  <div
                    key={track.id}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: `${rowStride - 6}px`,
                      transform: `translateY(${virtualRow.start}px)`
                    }}
                    draggable={showDeckControls}
                    onDragStart={
                      showDeckControls ? (e) => setTrackDragData(e, track.id) : undefined
                    }
                    className={`group flex items-center gap-2 rounded-xl border px-2.5 transition-all ${
                      showDeckControls ? 'cursor-grab active:cursor-grabbing ' : ''
                    }${
                      isHighlighted
                        ? showDeckControls
                          ? 'border-white/20 bg-white/[0.06]'
                          : 'border-accent/35 bg-accent/10'
                        : 'border-white/[0.07] bg-white/[0.025] hover:border-white/15 hover:bg-white/[0.055]'
                    }`}
                  >
                    {showDeckControls && (
                      <GripVertical className="h-3.5 w-3.5 shrink-0 text-slate-500 opacity-50 group-hover:opacity-95" />
                    )}

                    <div className="relative shrink-0">
                      <ArtworkCover
                        artworkPath={track.artworkPath}
                        alt={track.album}
                        className={compact ? 'h-9 w-9' : 'h-10 w-10'}
                        iconClassName="h-4 w-4"
                      />
                      <button
                        type="button"
                        onClick={() => void playTrack(track)}
                        title={`Play ${track.title} now`}
                        className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Play className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold text-white">{track.title}</p>
                      <p className="truncate text-[11px] text-slate-400">
                        {track.artist} · {formatDuration(track.duration)}
                      </p>
                      <div className="mt-1 flex items-center gap-1 overflow-hidden">
                        <span className="shrink-0 rounded bg-white/[0.07] px-1.5 py-0.5 font-mono text-[10px] text-slate-200">
                          {formatBpm(track.bpm)} BPM
                        </span>
                        <KeyBadge camelotKey={track.camelotKey} size="xs" />
                        {track.energy !== null && (
                          <span className="shrink-0 rounded bg-white/[0.05] px-1.5 py-0.5 font-mono text-[9px] text-slate-400">
                            E{Math.round(track.energy * 100)}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Quick Deck Load (A / B) + Add to Queue */}
                    <div className="flex shrink-0 flex-col items-end justify-center gap-1">
                      {showDeckControls && (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleLoadToDeck('A', track)}
                            title={`Load "${track.title}" onto Deck A`}
                            className={`flex h-6 w-6 items-center justify-center rounded-md border font-mono text-[10px] font-bold transition-colors ${
                              onDeckA
                                ? 'border-indigo-400 bg-indigo-500 text-white shadow-[0_0_8px_rgba(99,102,241,0.5)]'
                                : 'border-indigo-400/35 bg-indigo-500/15 text-indigo-200 hover:bg-indigo-500/35 hover:text-white'
                            }`}
                          >
                            A
                          </button>
                          <button
                            type="button"
                            onClick={() => handleLoadToDeck('B', track)}
                            title={`Load "${track.title}" onto Deck B`}
                            className={`flex h-6 w-6 items-center justify-center rounded-md border font-mono text-[10px] font-bold transition-colors ${
                              onDeckB
                                ? 'border-cyan-400 bg-cyan-500 text-slate-950 shadow-[0_0_8px_rgba(34,211,238,0.5)]'
                                : 'border-cyan-400/35 bg-cyan-500/15 text-cyan-200 hover:bg-cyan-500/35 hover:text-white'
                            }`}
                          >
                            B
                          </button>
                        </div>
                      )}

                      <button
                        type="button"
                        onClick={() => handleAddToQueue(track)}
                        title={`Add "${track.title}" to Up Next queue`}
                        className={`inline-flex items-center gap-1 rounded-md border text-[10px] font-medium transition-colors ${
                          showDeckControls ? 'h-5 px-1.5' : 'h-6 px-2'
                        } ${
                          wasQueued
                            ? 'border-emerald-400/50 bg-emerald-500/20 text-emerald-200'
                            : 'border-white/10 bg-white/[0.04] text-slate-300 hover:border-accent/40 hover:bg-accent/15 hover:text-white'
                        }`}
                      >
                        {wasQueued ? (
                          <>
                            <Check className="h-2.5 w-2.5" />
                            <span>Added</span>
                          </>
                        ) : (
                          <>
                            <ListPlus className="h-2.5 w-2.5" />
                            <span>Queue</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
