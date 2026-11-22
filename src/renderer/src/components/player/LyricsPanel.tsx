import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent
} from 'react'
import {
  Edit3,
  FileUp,
  Loader2,
  Mic2,
  Music2,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Sparkles,
  Trash2,
  X
} from 'lucide-react'
import {
  findActiveLyricIndex,
  isSyncedLrc,
  parseLrc,
  stripLrcTimestamps
} from '@shared/lrcParser'
import type {
  LyricsFetchOptions,
  LyricsLine,
  LyricsSource,
  TrackLyricsRecord
} from '@shared/types'
import { usePlayerStore } from '@/store/usePlayerStore'
import { formatDuration } from '@/utils/format'

const OFFSET_MIN_MS = -15000
const OFFSET_MAX_MS = 15000
const OFFSET_STEP_MS = 500
const AUTO_SCROLL_PAUSE_MS = 4000

function formatSourceLabel(source: LyricsSource): string {
  switch (source) {
    case 'lrclib':
      return 'LRCLIB'
    case 'sidecar':
      return 'Local File'
    case 'embedded':
      return 'Embedded'
    case 'user':
      return 'Imported'
  }
}

function formatOffsetSeconds(offsetMs: number): string {
  const sec = offsetMs / 1000
  if (Math.abs(sec) < 0.05) {
    return '+0.0s'
  }
  const sign = sec > 0 ? '+' : ''
  return `${sign}${sec.toFixed(1)}s`
}

export function LyricsPanel() {
  const activeTrack = usePlayerStore((s) => s.activeTrack)
  const telemetry = usePlayerStore((s) => s.telemetry)
  const seek = usePlayerStore((s) => s.seek)
  const autoFetchLyrics = usePlayerStore((s) => s.librarySettings.autoFetchLyrics)
  const pushToast = usePlayerStore((s) => s.pushToast)

  const [lyrics, setLyrics] = useState<TrackLyricsRecord | null>(null)
  const [loading, setLoading] = useState(false)
  const [busyAction, setBusyAction] = useState<'import' | 'save' | 'clear' | 'offset' | null>(null)
  const [hasCheckedTrack, setHasCheckedTrack] = useState(false)

  const [showCustomSearch, setShowCustomSearch] = useState(false)
  const [customTitle, setCustomTitle] = useState('')
  const [customArtist, setCustomArtist] = useState('')

  const [isEditing, setIsEditing] = useState(false)
  const [draftText, setDraftText] = useState('')
  const [autoScrollPaused, setAutoScrollPaused] = useState(false)

  const requestSeqRef = useRef(0)
  const activeTrackIdRef = useRef<number | null>(activeTrack?.id ?? null)
  const offsetMsRef = useRef(0)
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const activeLineRef = useRef<HTMLButtonElement | null>(null)
  const pauseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastScrolledKeyRef = useRef<string>('')

  activeTrackIdRef.current = activeTrack?.id ?? null
  offsetMsRef.current = lyrics?.offsetMs ?? 0

  const clearPauseTimer = useCallback(() => {
    if (pauseTimerRef.current !== null) {
      clearTimeout(pauseTimerRef.current)
      pauseTimerRef.current = null
    }
  }, [])

  const pauseAutoScrollTemporarily = useCallback(() => {
    clearPauseTimer()
    lastScrolledKeyRef.current = ''
    setAutoScrollPaused(true)
    pauseTimerRef.current = setTimeout(() => {
      pauseTimerRef.current = null
      setAutoScrollPaused(false)
    }, AUTO_SCROLL_PAUSE_MS)
  }, [clearPauseTimer])

  useEffect(() => {
    return () => {
      clearPauseTimer()
    }
  }, [clearPauseTimer])

  const fetchLyricsForTrack = useCallback(
    async (trackId: number, options: LyricsFetchOptions, notifyWhenMissing: boolean) => {
      const seq = ++requestSeqRef.current
      setLoading(true)
      try {
        const result = await window.api.lyrics.getForTrack(trackId, options)
        if (requestSeqRef.current !== seq) return null
        setLyrics(result)
        setHasCheckedTrack(true)
        if (!result && notifyWhenMissing) {
          pushToast({
            type: 'info',
            title: 'Lyrics Not Found',
            message: 'No matching lyrics found on LRCLIB. Try Custom Search or import an .lrc file.'
          })
        }
        return result
      } catch (err) {
        if (requestSeqRef.current !== seq) return null
        setHasCheckedTrack(true)
        if (notifyWhenMissing) {
          pushToast({
            type: 'error',
            title: 'Lyrics Lookup Failed',
            message: err instanceof Error ? err.message : 'Unable to fetch lyrics.'
          })
        }
        return null
      } finally {
        if (requestSeqRef.current === seq) {
          setLoading(false)
        }
      }
    },
    [pushToast]
  )

  // Fetch cached/local/online lyrics whenever active track changes
  useEffect(() => {
    clearPauseTimer()
    setAutoScrollPaused(false)
    setIsEditing(false)
    setShowCustomSearch(false)
    setHasCheckedTrack(false)
    lastScrolledKeyRef.current = ''

    if (!activeTrack) {
      requestSeqRef.current += 1
      setLyrics(null)
      setLoading(false)
      setCustomTitle('')
      setCustomArtist('')
      return
    }

    setLyrics(null)
    setCustomTitle(activeTrack.title)
    setCustomArtist(activeTrack.artist)

    const allowOnline = usePlayerStore.getState().librarySettings.autoFetchLyrics
    void fetchLyricsForTrack(activeTrack.id, { allowOnline }, false)
  }, [activeTrack?.id, clearPauseTimer, fetchLyricsForTrack])

  const parsedLines = useMemo<LyricsLine[]>(() => {
    if (!lyrics?.syncedLyrics) return []
    return parseLrc(lyrics.syncedLyrics)
  }, [lyrics?.syncedLyrics])

  const plainText = useMemo(() => {
    if (lyrics?.plainLyrics && lyrics.plainLyrics.trim().length > 0) {
      return lyrics.plainLyrics.trim()
    }
    if (lyrics?.syncedLyrics && parsedLines.length === 0) {
      return stripLrcTimestamps(lyrics.syncedLyrics).trim()
    }
    return ''
  }, [lyrics?.plainLyrics, lyrics?.syncedLyrics, parsedLines.length])

  const isSyncedMode = parsedLines.length > 0
  const isInstrumentalMode =
    Boolean(lyrics?.isInstrumental) && !isSyncedMode && plainText.length === 0
  const hasDisplayableLyrics = isSyncedMode || plainText.length > 0 || isInstrumentalMode

  const activeDeck = telemetry.decks[telemetry.activeDeckId]
  const currentTime = activeDeck.currentTime || 0
  const offsetMs = lyrics?.offsetMs ?? 0

  const activeIndex = useMemo(() => {
    if (!isSyncedMode) return -1
    return findActiveLyricIndex(parsedLines, currentTime, offsetMs)
  }, [isSyncedMode, parsedLines, currentTime, offsetMs])

  // Smoothly auto-scroll active line to center unless user manually paused scrolling
  useEffect(() => {
    if (!isSyncedMode || isEditing || autoScrollPaused || activeIndex < 0) return
    const scrollKey = `${activeTrack?.id ?? 'none'}:${activeIndex}`
    if (lastScrolledKeyRef.current === scrollKey) return
    lastScrolledKeyRef.current = scrollKey
    activeLineRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [activeTrack?.id, activeIndex, autoScrollPaused, isEditing, isSyncedMode])

  const sourceBadge = useMemo(() => {
    if (!lyrics) return null
    const mode = isSyncedMode ? 'Synced' : isInstrumentalMode ? 'Instrumental' : 'Static'
    return `${mode} · ${formatSourceLabel(lyrics.source)}`
  }, [lyrics, isSyncedMode, isInstrumentalMode])

  const draftDetectedSynced = useMemo(() => isSyncedLrc(draftText), [draftText])

  const handleRefetchOnline = () => {
    if (!activeTrack || loading) return
    void fetchLyricsForTrack(activeTrack.id, { forceRefresh: true, allowOnline: true }, true)
  }

  const handleCustomSearchSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!activeTrack || loading) return
    const title = customTitle.trim()
    const artist = customArtist.trim()
    if (!title) {
      pushToast({
        type: 'info',
        title: 'Title Required',
        message: 'Enter a song title before searching LRCLIB.'
      })
      return
    }
    const found = await fetchLyricsForTrack(
      activeTrack.id,
      {
        forceRefresh: true,
        allowOnline: true,
        customTitle: title,
        customArtist: artist
      },
      true
    )
    if (found) {
      setShowCustomSearch(false)
    }
  }

  const handleImportFile = async () => {
    if (!activeTrack || busyAction) return
    const trackId = activeTrack.id
    const seq = ++requestSeqRef.current
    setBusyAction('import')
    try {
      const imported = await window.api.lyrics.importFile(trackId)
      if (requestSeqRef.current !== seq || activeTrackIdRef.current !== trackId) return
      if (imported) {
        setLyrics(imported)
        setIsEditing(false)
        setShowCustomSearch(false)
        setHasCheckedTrack(true)
        pushToast({
          type: 'info',
          title: 'Lyrics Imported',
          message: isSyncedLrc(imported.syncedLyrics)
            ? 'Imported synced LRC timestamps for this track.'
            : 'Imported plain text lyrics for this track.'
        })
      }
    } catch (err) {
      pushToast({
        type: 'error',
        title: 'Import Failed',
        message: err instanceof Error ? err.message : 'Could not import lyrics file.'
      })
    } finally {
      setBusyAction(null)
    }
  }

  const handleOpenEditor = () => {
    setDraftText(lyrics?.syncedLyrics ?? lyrics?.plainLyrics ?? '')
    setShowCustomSearch(false)
    setIsEditing(true)
  }

  const handleSaveDraft = async () => {
    if (!activeTrack || busyAction) return
    const trimmed = draftText.trim()
    if (!trimmed) return

    const trackId = activeTrack.id
    const seq = ++requestSeqRef.current
    setBusyAction('save')
    try {
      const synced = isSyncedLrc(trimmed)
      const saved = await window.api.lyrics.save({
        trackId,
        syncedLyrics: synced ? trimmed : null,
        plainLyrics: synced ? stripLrcTimestamps(trimmed) || null : trimmed,
        source: 'user',
        isInstrumental: false,
        offsetMs: lyrics?.offsetMs ?? 0
      })
      if (requestSeqRef.current !== seq || activeTrackIdRef.current !== trackId) return
      setLyrics(saved)
      setIsEditing(false)
      setHasCheckedTrack(true)
      pushToast({
        type: 'info',
        title: 'Lyrics Saved',
        message: synced ? 'Saved as synced LRC lyrics.' : 'Saved as static lyrics.'
      })
    } catch (err) {
      pushToast({
        type: 'error',
        title: 'Save Failed',
        message: err instanceof Error ? err.message : 'Unable to save lyrics.'
      })
    } finally {
      setBusyAction(null)
    }
  }

  const handleClearLyrics = async () => {
    if (!activeTrack || !lyrics || busyAction) return
    const trackId = activeTrack.id
    const seq = ++requestSeqRef.current
    setBusyAction('clear')
    try {
      await window.api.lyrics.delete(trackId)
      if (requestSeqRef.current !== seq || activeTrackIdRef.current !== trackId) return
      setLyrics(null)
      setIsEditing(false)
      pushToast({
        type: 'info',
        title: 'Lyrics Cleared',
        message: `Removed lyrics for "${activeTrack.title}".`
      })
    } catch (err) {
      pushToast({
        type: 'error',
        title: 'Clear Failed',
        message: err instanceof Error ? err.message : 'Unable to clear lyrics.'
      })
    } finally {
      setBusyAction(null)
    }
  }

  const handleUpdateOffset = async (nextOffsetMs: number) => {
    if (!activeTrack || !lyrics) return
    const trackId = activeTrack.id
    const clamped = Math.max(OFFSET_MIN_MS, Math.min(OFFSET_MAX_MS, Math.round(nextOffsetMs)))
    offsetMsRef.current = clamped
    setLyrics((prev) => (prev ? { ...prev, offsetMs: clamped } : prev))
    try {
      const updated = await window.api.lyrics.updateOffset(trackId, clamped)
      if (activeTrackIdRef.current !== trackId) return
      if (updated) {
        setLyrics(updated)
      }
    } catch (err) {
      pushToast({
        type: 'error',
        title: 'Offset Update Failed',
        message: err instanceof Error ? err.message : 'Could not update lyric timing offset.'
      })
    }
  }

  const handleSeekLine = (line: LyricsLine) => {
    clearPauseTimer()
    setAutoScrollPaused(false)
    seek(Math.max(0, line.timeSec - offsetMs / 1000))
  }

  const handleResumeAutoScroll = () => {
    clearPauseTimer()
    setAutoScrollPaused(false)
    lastScrolledKeyRef.current = ''
    activeLineRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  const handleContainerPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      pauseAutoScrollTemporarily()
    }
  }

  if (!activeTrack) {
    return (
      <div className="mx-auto flex h-full max-w-3xl flex-col items-center justify-center p-6 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-slate-400">
          <Mic2 className="h-8 w-8" />
        </div>
        <h2 className="mt-4 text-lg font-semibold text-white">No Track Playing</h2>
        <p className="mt-1.5 max-w-sm text-xs text-slate-400">
          Select and play a song from your library to view synced timestamps, search LRCLIB, or import local `.lrc` lyrics.
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto flex h-full max-w-4xl flex-col gap-3 overflow-hidden">
      {/* Top Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl glass-panel px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-sm font-bold text-white">{activeTrack.title}</h2>
            {sourceBadge && (
              <span
                title={
                  lyrics?.providerTrackName
                    ? `Matched: ${lyrics.providerTrackName}${
                        lyrics.providerArtistName ? ` — ${lyrics.providerArtistName}` : ''
                      }`
                    : undefined
                }
                className="inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent/15 px-2.5 py-0.5 text-[10px] font-semibold text-accentGlow"
              >
                <Sparkles className="h-2.5 w-2.5" />
                <span>{sourceBadge}</span>
              </span>
            )}
            {loading && lyrics && (
              <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
                <Loader2 className="h-3 w-3 animate-spin text-accentGlow" />
                <span>Updating...</span>
              </span>
            )}
          </div>
          <p className="truncate text-xs text-slate-400">
            {activeTrack.artist}
            {activeTrack.album ? ` · ${activeTrack.album}` : ''}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            disabled={loading}
            onClick={handleRefetchOnline}
            title="Refetch lyrics from LRCLIB"
            className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.04] px-2.5 text-xs font-medium text-slate-200 hover:bg-white/10 hover:text-white disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin text-accentGlow' : ''}`} />
            <span>Refetch</span>
          </button>

          <button
            type="button"
            onClick={() => setShowCustomSearch((prev) => !prev)}
            title="Search LRCLIB with custom title and artist"
            className={`inline-flex h-8 items-center gap-1.5 rounded-xl border px-2.5 text-xs font-medium transition-colors ${
              showCustomSearch
                ? 'border-accent/50 bg-accent/20 text-white'
                : 'border-white/10 bg-white/[0.04] text-slate-200 hover:bg-white/10 hover:text-white'
            }`}
          >
            <Search className="h-3.5 w-3.5" />
            <span>Custom Search</span>
          </button>

          <button
            type="button"
            disabled={busyAction !== null}
            onClick={() => void handleImportFile()}
            title="Import local .lrc or .txt lyrics file"
            className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.04] px-2.5 text-xs font-medium text-slate-200 hover:bg-white/10 hover:text-white disabled:opacity-50 transition-colors"
          >
            <FileUp className="h-3.5 w-3.5" />
            <span>Import .lrc / .txt</span>
          </button>

          <button
            type="button"
            onClick={isEditing ? () => setIsEditing(false) : handleOpenEditor}
            title="Paste or edit lyrics manually"
            className={`inline-flex h-8 items-center gap-1.5 rounded-xl border px-2.5 text-xs font-medium transition-colors ${
              isEditing
                ? 'border-accent/50 bg-accent/20 text-white'
                : 'border-white/10 bg-white/[0.04] text-slate-200 hover:bg-white/10 hover:text-white'
            }`}
          >
            <Edit3 className="h-3.5 w-3.5" />
            <span>Paste / Edit</span>
          </button>

          <button
            type="button"
            disabled={!lyrics || busyAction !== null}
            onClick={() => void handleClearLyrics()}
            title="Clear saved lyrics for this track"
            className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-rose-500/25 bg-rose-500/10 px-2.5 text-xs font-medium text-rose-200 hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-40 transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>Clear</span>
          </button>
        </div>
      </div>

      {/* Custom Search Bar */}
      {showCustomSearch && (
        <form
          onSubmit={(e) => void handleCustomSearchSubmit(e)}
          className="flex flex-wrap items-center gap-2 rounded-2xl glass-panel px-4 py-3"
        >
          <input
            type="text"
            value={customTitle}
            onChange={(e) => setCustomTitle(e.target.value)}
            placeholder="Track title..."
            aria-label="Custom lyrics search title"
            className="h-8 min-w-[180px] flex-1 rounded-xl border border-white/10 bg-black/40 px-3 text-xs text-white placeholder:text-slate-500 focus:border-accent/60 focus:outline-none"
          />
          <input
            type="text"
            value={customArtist}
            onChange={(e) => setCustomArtist(e.target.value)}
            placeholder="Artist name..."
            aria-label="Custom lyrics search artist"
            className="h-8 min-w-[160px] flex-1 rounded-xl border border-white/10 bg-black/40 px-3 text-xs text-white placeholder:text-slate-500 focus:border-accent/60 focus:outline-none"
          />
          <button
            type="submit"
            disabled={loading || !customTitle.trim()}
            className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-accent px-3.5 text-xs font-semibold text-white shadow-glow hover:brightness-110 disabled:opacity-50 transition-all"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
            <span>Search LRCLIB</span>
          </button>
          <button
            type="button"
            onClick={() => setShowCustomSearch(false)}
            aria-label="Close custom search"
            className="flex h-8 w-8 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-slate-400 hover:text-white transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </form>
      )}

      {/* Main Lyrics Viewport */}
      <div className="relative flex flex-1 flex-col overflow-hidden rounded-2xl glass-panel">
        {isEditing ? (
          <div className="flex flex-1 flex-col gap-3 p-4 overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-white">Paste or Edit Lyrics</span>
                <span className="rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-0.5 text-[10px] font-medium text-slate-300">
                  {draftText.trim().length === 0
                    ? 'Supports [mm:ss.xx] LRC or plain text'
                    : draftDetectedSynced
                      ? 'Auto-detected: Synced LRC'
                      : 'Auto-detected: Plain Static Lyrics'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsEditing(false)}
                  className="h-8 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-xs font-medium text-slate-300 hover:bg-white/10 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!draftText.trim() || busyAction === 'save'}
                  onClick={() => void handleSaveDraft()}
                  className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-accent px-3.5 text-xs font-semibold text-white shadow-glow hover:brightness-110 disabled:opacity-45 transition-all"
                >
                  {busyAction === 'save' ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Save className="h-3.5 w-3.5" />
                  )}
                  <span>Save Lyrics</span>
                </button>
              </div>
            </div>

            <textarea
              value={draftText}
              onChange={(e) => setDraftText(e.target.value)}
              placeholder={'[00:12.50] First synced line...\n[00:17.20] Second synced line...\n\nOr paste plain static lyrics here.'}
              spellCheck={false}
              className="flex-1 resize-none rounded-xl border border-white/10 bg-black/40 p-4 font-mono text-xs leading-relaxed text-slate-100 placeholder:text-slate-500 focus:border-accent/60 focus:outline-none"
            />
          </div>
        ) : loading && !hasDisplayableLyrics ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-accentGlow" />
            <div>
              <p className="text-sm font-semibold text-white">Searching Lyrics</p>
              <p className="mt-0.5 text-xs text-slate-400">
                Checking local cache, embedded tags, and LRCLIB for &ldquo;{activeTrack.title}&rdquo;...
              </p>
            </div>
          </div>
        ) : isInstrumentalMode ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-accent/35 bg-accent/15 text-accentGlow shadow-glow">
              <Music2 className="h-7 w-7" />
            </div>
            <div>
              <span className="inline-flex items-center rounded-full border border-accent/35 bg-accent/15 px-3 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-accentGlow">
                Instrumental Track
              </span>
              <h3 className="mt-2 text-base font-semibold text-white">No Spoken Vocals</h3>
              <p className="mt-1 max-w-md text-xs text-slate-400">
                This track is marked as instrumental. If it does contain vocals, try Custom Search, import an `.lrc` file, or paste lyrics manually.
              </p>
            </div>
          </div>
        ) : isSyncedMode ? (
          <>
            <div
              ref={scrollContainerRef}
              onWheel={pauseAutoScrollTemporarily}
              onTouchMove={pauseAutoScrollTemporarily}
              onPointerDown={handleContainerPointerDown}
              className="flex-1 overflow-y-auto overflow-x-hidden px-6 py-24"
            >
              <div className="mx-auto flex max-w-2xl flex-col items-center gap-3 text-center">
                {parsedLines.map((line, index) => {
                  const isActive = index === activeIndex
                  const isPast = activeIndex !== -1 && index < activeIndex
                  return (
                    <button
                      key={`${line.timeSec}-${index}`}
                      ref={isActive ? activeLineRef : undefined}
                      type="button"
                      onClick={() => handleSeekLine(line)}
                      title={`Seek to ${formatDuration(Math.max(0, line.timeSec - offsetMs / 1000))}`}
                      style={
                        isActive
                          ? { textShadow: '0 0 22px rgb(var(--accent-glow-rgb) / 0.5)' }
                          : undefined
                      }
                      className={`group relative w-full rounded-xl px-4 py-2 text-center transition-all duration-300 ease-out cursor-pointer ${
                        isActive
                          ? 'scale-[1.01] bg-white/[0.05] text-xl font-bold text-white shadow-[0_0_24px_-8px_rgb(var(--accent-rgb)/0.55)] md:text-2xl'
                          : isPast
                            ? 'text-base font-medium text-slate-500/75 hover:bg-white/[0.03] hover:text-slate-200 md:text-lg'
                            : 'text-base font-medium text-slate-300/75 hover:bg-white/[0.03] hover:text-white md:text-lg'
                      }`}
                    >
                      <span className="leading-snug">{line.text}</span>
                      <span className="ml-2 inline-block align-middle font-mono text-[10px] font-normal text-slate-500 opacity-0 transition-opacity group-hover:opacity-100">
                        {formatDuration(line.timeSec)}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>

            {autoScrollPaused && (
              <button
                type="button"
                onClick={handleResumeAutoScroll}
                className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 inline-flex items-center gap-1.5 rounded-full border border-accentGlow/45 bg-accent/90 px-4 py-1.5 text-xs font-semibold text-white shadow-glow backdrop-blur-md hover:brightness-110 transition-all"
              >
                <Sparkles className="h-3.5 w-3.5" />
                <span>Sync to Playback</span>
              </button>
            )}
          </>
        ) : plainText.length > 0 ? (
          <div className="flex-1 overflow-y-auto px-6 py-8">
            <div className="mx-auto max-w-xl text-center">
              <div className="mb-5 inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] text-slate-400">
                <span>Static Lyrics · Scroll manually or import an .lrc file for timed sync</span>
              </div>
              <p className="whitespace-pre-wrap text-base leading-relaxed text-slate-200 md:text-lg">
                {plainText}
              </p>
            </div>
          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-slate-400">
              <Mic2 className="h-7 w-7" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-white">
                {hasCheckedTrack ? 'No Lyrics Found' : 'Lyrics Unavailable'}
              </h3>
              <p className="mt-1 max-w-md text-xs text-slate-400">
                {!autoFetchLyrics
                  ? 'Automatic online lookup is disabled in Settings. Search LRCLIB manually, import a local .lrc/.txt file, or paste lyrics.'
                  : 'No local, embedded, or cached LRCLIB lyrics were matched for this track.'}
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                disabled={loading}
                onClick={() =>
                  void fetchLyricsForTrack(
                    activeTrack.id,
                    { forceRefresh: true, allowOnline: true },
                    true
                  )
                }
                className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-accent px-4 text-xs font-semibold text-white shadow-glow hover:brightness-110 disabled:opacity-50 transition-all"
              >
                <Search className="h-3.5 w-3.5" />
                <span>Search LRCLIB</span>
              </button>

              <button
                type="button"
                disabled={busyAction !== null}
                onClick={() => void handleImportFile()}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.05] px-4 text-xs font-semibold text-slate-200 hover:bg-white/10 hover:text-white transition-colors"
              >
                <FileUp className="h-3.5 w-3.5" />
                <span>Import .lrc / .txt</span>
              </button>

              <button
                type="button"
                onClick={handleOpenEditor}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.05] px-4 text-xs font-semibold text-slate-200 hover:bg-white/10 hover:text-white transition-colors"
              >
                <Edit3 className="h-3.5 w-3.5" />
                <span>Paste Lyrics</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Inline Timing Offset Bar (Synced Mode) */}
      {isSyncedMode && !isEditing && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl glass-panel px-4 py-2">
          <div className="flex items-center gap-2 text-xs text-slate-300">
            <span className="font-semibold text-slate-200">Timing Offset</span>
            <span className="hidden text-[11px] text-slate-400 sm:inline">
              Click any lyric line to seek playback
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={offsetMs <= OFFSET_MIN_MS}
              onClick={() => void handleUpdateOffset(offsetMsRef.current - OFFSET_STEP_MS)}
              title="Delay lyrics by 0.5s"
              className="h-7 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 font-mono text-xs font-semibold text-slate-200 hover:bg-white/10 hover:text-white disabled:opacity-35 transition-colors"
            >
              -0.5s
            </button>

            <span className="min-w-[60px] rounded-lg border border-white/10 bg-black/35 px-2.5 py-1 text-center font-mono text-xs font-semibold tabular-nums text-accentGlow">
              {formatOffsetSeconds(offsetMs)}
            </span>

            <button
              type="button"
              disabled={offsetMs >= OFFSET_MAX_MS}
              onClick={() => void handleUpdateOffset(offsetMsRef.current + OFFSET_STEP_MS)}
              title="Advance lyrics by 0.5s"
              className="h-7 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 font-mono text-xs font-semibold text-slate-200 hover:bg-white/10 hover:text-white disabled:opacity-35 transition-colors"
            >
              +0.5s
            </button>

            <button
              type="button"
              disabled={offsetMs === 0}
              onClick={() => void handleUpdateOffset(0)}
              title="Reset timing offset to 0s"
              className="inline-flex h-7 items-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 font-mono text-xs font-medium text-slate-300 hover:bg-white/10 hover:text-white disabled:opacity-35 transition-colors"
            >
              <RotateCcw className="h-3 w-3" />
              <span>0s</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
