import { useEffect, useRef, useState, type DragEvent } from 'react'
import {
  Activity,
  ArrowUpFromLine,
  Crosshair,
  Disc3,
  Gauge,
  Link2,
  Minus,
  Pause,
  Play,
  Plus,
  Repeat,
  RotateCcw,
  Shuffle,
  Sliders,
  Volume2
} from 'lucide-react'
import { getCamelotCompatibility } from '@shared/camelot'
import type { DeckEqState, DeckId, DeckTelemetry, MixStyle, TrackRecord } from '@shared/types'
import { ArtworkCover } from '@/components/common/ArtworkCover'
import { EnergyMeter } from '@/components/common/EnergyMeter'
import { KeyBadge } from '@/components/common/KeyBadge'
import { WaveformScrubber } from '@/components/player/WaveformScrubber'
import { useLibraryStore } from '@/store/useLibraryStore'
import { usePlayerStore } from '@/store/usePlayerStore'
import { getDraggedTrackId, hasTrackDragData } from '@/utils/deckDrag'
import { formatBpm, formatDuration, formatPitchShift } from '@/utils/format'

const MIX_STYLES: Array<{ id: MixStyle; label: string; hint: string }> = [
  { id: 'equal-power', label: 'Equal-Power', hint: 'Smooth cosine/sine blend' },
  { id: 'bass-swap', label: 'Bass-Swap', hint: 'EQ low-end swap at 40–60%' },
  { id: 'quick-cut', label: 'Quick Cut', hint: 'Crisp 0.5s DJ cut' }
]

const BAR_OPTIONS: Array<4 | 8 | 16> = [4, 8, 16]
const LOOP_BEAT_OPTIONS: Array<4 | 8 | 16> = [4, 8, 16]
const PITCH_NUDGE_STEP = 0.005

function EqMeterBand({
  label,
  valueDb,
  killed,
  accentClass,
  onChange,
  onToggleKill,
  onResetBand
}: {
  label: string
  valueDb: number
  killed: boolean
  accentClass: string
  onChange: (db: number) => void
  onToggleKill: () => void
  onResetBand: () => void
}) {
  // Map -24..+12 dB -> 0..100%
  const pct = killed ? 0 : Math.max(0, Math.min(100, ((valueDb + 24) / 36) * 100))
  const isCut = !killed && valueDb < -0.5
  const isBoost = !killed && valueDb > 0.5

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-1 text-[10px]">
        <button
          type="button"
          onDoubleClick={onResetBand}
          title={`Double-click to reset ${label} EQ to 0 dB`}
          className="font-semibold uppercase tracking-wide text-slate-400 hover:text-slate-200 transition-colors"
        >
          {label}
        </button>

        <div className="flex items-center gap-1">
          <span
            className={`font-mono text-[9px] tabular-nums ${
              killed
                ? 'font-bold text-rose-300'
                : isCut
                  ? 'text-rose-300'
                  : isBoost
                    ? 'text-accentGlow'
                    : 'text-slate-400'
            }`}
          >
            {killed ? 'KILL' : valueDb > 0 ? `+${valueDb.toFixed(1)}` : valueDb.toFixed(1)}
          </span>
          <button
            type="button"
            onClick={onToggleKill}
            title={killed ? `Unkill ${label} EQ` : `Kill ${label} EQ`}
            aria-label={`Kill ${label} EQ`}
            aria-pressed={killed}
            className={`flex h-4 w-4 items-center justify-center rounded border font-mono text-[9px] font-bold transition-all ${
              killed
                ? 'border-rose-400/70 bg-rose-500/35 text-rose-100 shadow-[0_0_8px_rgba(244,63,94,0.45)]'
                : 'border-white/15 bg-white/[0.04] text-slate-400 hover:border-rose-400/40 hover:text-rose-200'
            }`}
          >
            K
          </button>
        </div>
      </div>

      <div
        className={`relative h-2 w-full overflow-hidden rounded-full bg-white/10 ${
          killed ? 'opacity-50' : ''
        }`}
        onDoubleClick={onResetBand}
      >
        {/* 0 dB unity marker (24 / 36 = 66.67%) */}
        <div
          className="pointer-events-none absolute top-0 bottom-0 w-px bg-white/25"
          style={{ left: '66.67%' }}
        />
        <div
          className={`h-full rounded-full transition-all duration-75 ${
            killed
              ? 'bg-rose-500/40'
              : isCut
                ? 'bg-rose-400/80'
                : isBoost
                  ? 'bg-accentGlow'
                  : accentClass
          }`}
          style={{ width: `${pct}%` }}
        />
        <input
          type="range"
          min={-24}
          max={12}
          step={0.5}
          value={valueDb}
          onChange={(e) => onChange(Number(e.target.value))}
          onDoubleClick={onResetBand}
          aria-label={`${label} EQ gain`}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </div>
    </div>
  )
}

interface DeckCardProps {
  deck: DeckTelemetry
  oppositeDeck: DeckTelemetry
  isActiveDeck: boolean
  showCueMarkers: boolean
  onLoadTrack: (track: TrackRecord) => void
  onUnload: () => void
  onTogglePlayPause: () => void
  onSeek: (sec: number) => void
  onSetPlaybackRate: (rate: number) => void
  onNudgePlaybackRate: (delta: number) => void
  onSyncBpm: () => void
  onSetCuePoint: () => void
  onJumpToCue: () => void
  onToggleLoop: () => void
  onSetLoopBeats: (beats: 4 | 8 | 16) => void
  onEqChange: (band: keyof DeckEqState, db: number) => void
  onToggleEqKill: (band: keyof DeckEqState) => void
  onResetEq: () => void
  onFilterChange: (value: number) => void
  onChannelGainChange: (gain: number) => void
}

function DeckCard({
  deck,
  oppositeDeck,
  isActiveDeck,
  showCueMarkers,
  onLoadTrack,
  onUnload,
  onTogglePlayPause,
  onSeek,
  onSetPlaybackRate,
  onNudgePlaybackRate,
  onSyncBpm,
  onSetCuePoint,
  onJumpToCue,
  onToggleLoop,
  onSetLoopBeats,
  onEqChange,
  onToggleEqKill,
  onResetEq,
  onFilterChange,
  onChannelGainChange
}: DeckCardProps) {
  const [isDragOver, setIsDragOver] = useState(false)
  const [justDropped, setJustDropped] = useState(false)
  const dragDepthRef = useRef(0)
  const dropFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (dropFlashTimerRef.current) {
        clearTimeout(dropFlashTimerRef.current)
      }
    }
  }, [])

  const isDeckA = deck.deckId === 'A'
  const track = deck.track
  const duration = deck.duration || track?.duration || 0
  const eqKill = deck.eqKill ?? { low: false, mid: false, high: false }
  const filterValue = deck.filterValue ?? 0
  const channelGain = deck.channelGain ?? 1
  const cuePointSec = deck.cuePointSec ?? 0
  const loopEnabled = deck.loopEnabled ?? false
  const loopBeats = deck.loopBeats ?? 4
  const loopStartSec = deck.loopStartSec ?? null
  const loopEndSec = deck.loopEndSec ?? null

  const isDeckPlaying =
    deck.status === 'playing' || deck.status === 'fading-in' || deck.status === 'fading-out'
  const hasPitchShift = Math.abs(deck.playbackRate - 1) > 0.001
  const hasEqModification =
    Math.abs(deck.eq.low) > 0.05 ||
    Math.abs(deck.eq.mid) > 0.05 ||
    Math.abs(deck.eq.high) > 0.05 ||
    eqKill.low ||
    eqKill.mid ||
    eqKill.high

  const effectiveBpmValue =
    track?.bpm && track.bpm > 0 ? track.bpm * deck.playbackRate : null
  const oppositeEffectiveBpm =
    oppositeDeck.track?.bpm && oppositeDeck.track.bpm > 0
      ? oppositeDeck.track.bpm * oppositeDeck.playbackRate
      : null
  const canSyncBpm = Boolean(effectiveBpmValue && oppositeEffectiveBpm)
  const isBpmSynced =
    canSyncBpm &&
    effectiveBpmValue !== null &&
    oppositeEffectiveBpm !== null &&
    Math.abs(effectiveBpmValue - oppositeEffectiveBpm) < 0.2

  const statusBadge =
    deck.status === 'fading-in'
      ? { text: 'MIXING IN', cls: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' }
      : deck.status === 'fading-out'
        ? { text: 'MIXING OUT', cls: 'bg-amber-500/20 text-amber-300 border-amber-500/40' }
        : deck.status === 'playing'
          ? isDeckA
            ? { text: 'ON AIR', cls: 'bg-indigo-500/25 text-indigo-200 border-indigo-400/50' }
            : { text: 'ON AIR', cls: 'bg-cyan-500/25 text-cyan-200 border-cyan-400/50' }
          : deck.status === 'paused'
            ? { text: 'PAUSED', cls: 'bg-white/10 text-slate-300 border-white/15' }
            : deck.status === 'loading'
              ? { text: 'LOADING', cls: 'bg-sky-500/20 text-sky-300 border-sky-500/40' }
              : track
                ? { text: 'CUED', cls: 'bg-white/10 text-slate-200 border-white/15' }
                : { text: 'IDLE', cls: 'bg-white/[0.04] text-slate-500 border-white/10' }

  const filterLabel =
    filterValue < -0.02
      ? `LPF ${Math.round(Math.abs(filterValue) * 100)}%`
      : filterValue > 0.02
        ? `HPF ${Math.round(filterValue * 100)}%`
        : 'FLAT'

  // Loop & cue overlay geometry on waveform
  const loopOverlay =
    loopEnabled &&
    duration > 0 &&
    loopStartSec !== null &&
    loopEndSec !== null &&
    loopEndSec > loopStartSec
      ? {
          leftPct: Math.max(0, Math.min(100, (loopStartSec / duration) * 100)),
          widthPct: Math.max(
            1,
            Math.min(100, ((loopEndSec - loopStartSec) / duration) * 100)
          )
        }
      : null

  const cueMarkerPct =
    track && duration > 0 && cuePointSec > 0.05
      ? Math.max(0, Math.min(100, (cuePointSec / duration) * 100))
      : null

  const handleDragEnter = (e: DragEvent<HTMLDivElement>) => {
    if (!hasTrackDragData(e)) return
    e.preventDefault()
    dragDepthRef.current += 1
    setIsDragOver(true)
  }

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!hasTrackDragData(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    if (!isDragOver) {
      setIsDragOver(true)
    }
  }

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    if (!hasTrackDragData(e) && dragDepthRef.current === 0) return
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) {
      setIsDragOver(false)
    }
  }

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    dragDepthRef.current = 0
    setIsDragOver(false)

    const trackId = getDraggedTrackId(e)
    if (trackId === null) return

    const libraryTracks = useLibraryStore.getState().allTracks
    const fallbackTracks = usePlayerStore.getState().libraryTracks
    const found =
      libraryTracks.find((t) => t.id === trackId) ??
      fallbackTracks.find((t) => t.id === trackId)

    if (!found) return

    onLoadTrack(found)
    setJustDropped(true)
    if (dropFlashTimerRef.current) clearTimeout(dropFlashTimerRef.current)
    dropFlashTimerRef.current = setTimeout(() => {
      setJustDropped(false)
      dropFlashTimerRef.current = null
    }, 800)
  }

  const pitchPctText =
    Math.abs(deck.playbackRate - 1) < 0.0005 ? '+0.0%' : formatPitchShift(deck.playbackRate)
  const pitchFillLeftPct =
    deck.playbackRate >= 1
      ? 50
      : Math.max(0, ((deck.playbackRate - 0.88) / 0.24) * 100)
  const pitchFillWidthPct = Math.min(50, (Math.abs(deck.playbackRate - 1) / 0.12) * 50)

  const filterFillLeftPct = filterValue >= 0 ? 50 : Math.max(0, ((filterValue + 1) / 2) * 100)
  const filterFillWidthPct = Math.min(50, Math.abs(filterValue) * 50)

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      data-deck-id={deck.deckId}
      className={`relative rounded-2xl glass-panel p-3 transition-all ${
        justDropped
          ? isDeckA
            ? 'border-indigo-400 shadow-[0_0_24px_rgba(99,102,241,0.45)]'
            : 'border-cyan-400 shadow-[0_0_24px_rgba(34,211,238,0.45)]'
          : isActiveDeck
            ? isDeckA
              ? 'border-indigo-400/45 shadow-glow'
              : 'border-cyan-400/45 shadow-glow'
            : deck.status === 'fading-out'
              ? 'border-amber-500/35'
              : 'border-white/[0.08]'
      }`}
    >
      {/* Drag & Drop Glowing Overlay */}
      {isDragOver && (
        <div
          className={`pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center rounded-2xl border-2 border-dashed backdrop-blur-[2px] transition-all ${
            isDeckA
              ? 'border-indigo-400 bg-indigo-950/65 shadow-[inset_0_0_36px_rgba(99,102,241,0.4)]'
              : 'border-cyan-400 bg-cyan-950/65 shadow-[inset_0_0_36px_rgba(34,211,238,0.4)]'
          }`}
        >
          <div
            className={`rounded-xl border px-4 py-2 text-xs font-bold tracking-wide shadow-2xl ${
              isDeckA
                ? 'border-indigo-300/60 bg-indigo-500/30 text-indigo-100'
                : 'border-cyan-300/60 bg-cyan-500/30 text-cyan-100'
            }`}
          >
            Drop track to load on Deck {deck.deckId}
          </div>
        </div>
      )}

      {/* Deck Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span
            className={`flex h-5 items-center rounded-md px-1.5 font-mono text-[11px] font-bold ${
              isDeckA
                ? 'border border-indigo-400/35 bg-indigo-500/20 text-indigo-300'
                : 'border border-cyan-400/35 bg-cyan-500/20 text-cyan-300'
            }`}
          >
            DECK {deck.deckId}
          </span>
          <span
            className={`rounded-full border px-1.5 py-px text-[9px] font-semibold tracking-wider ${statusBadge.cls}`}
          >
            {statusBadge.text}
          </span>
        </div>

        <div className="flex items-center gap-1.5 font-mono text-[10px] tabular-nums">
          <span className="text-slate-400">
            Out{' '}
            <strong className="text-slate-200">
              {Math.round(deck.crossfadeGain * channelGain * 100)}%
            </strong>
          </span>
          {track && (
            <span className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[9px] text-slate-300">
              RG {deck.normalizationGain.toFixed(2)}x
            </span>
          )}
        </div>
      </div>

      {/* Track Info + BPM / Pitch / Key */}
      <div className="mt-2 flex items-center gap-2.5">
        <ArtworkCover
          artworkPath={track?.artworkPath}
          alt={track?.album || `Deck ${deck.deckId}`}
          className="h-11 w-11 shrink-0"
          iconClassName="h-5 w-5"
          roundedClassName="rounded-xl"
        />

        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold leading-tight text-white">
            {track?.title ?? `Deck ${deck.deckId} Empty`}
          </p>
          <p className="truncate text-[11px] text-slate-400">
            {track?.artist ?? 'Drag & drop a track here or click A / B in the browser'}
          </p>

          <div className="mt-1 flex flex-wrap items-center gap-1">
            <span className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.05] px-1.5 py-px font-mono text-[10px] text-white">
              <Gauge className={`h-2.5 w-2.5 ${isDeckA ? 'text-indigo-300' : 'text-cyan-300'}`} />
              {effectiveBpmValue
                ? `${effectiveBpmValue.toFixed(1)} BPM`
                : `${formatBpm(track?.bpm)} BPM`}
            </span>

            <span
              className={`rounded-md border px-1.5 py-px font-mono text-[10px] tabular-nums ${
                hasPitchShift
                  ? isDeckA
                    ? 'border-indigo-400/45 bg-indigo-500/20 font-semibold text-indigo-200'
                    : 'border-cyan-400/45 bg-cyan-500/20 font-semibold text-cyan-200'
                  : 'border-white/10 bg-white/[0.04] text-slate-400'
              }`}
              title={`Playback rate: ${deck.playbackRate.toFixed(4)}x`}
            >
              {pitchPctText}
            </span>

            <KeyBadge camelotKey={track?.camelotKey ?? null} showMusicalName size="xs" />
            {track && <EnergyMeter energy={track.energy} showValue={false} />}
          </div>
        </div>
      </div>

      {/* Interactive Live Waveform + Cue & Loop Visuals */}
      <div className="mt-2 rounded-xl border border-white/[0.07] bg-black/40 p-1.5">
        <div className="relative">
          <WaveformScrubber
            peaks={track?.waveformPeaks}
            duration={duration}
            currentTime={deck.currentTime}
            introCueSec={track?.introCueSec}
            outroCueSec={track?.outroCueSec}
            showCueMarkers={showCueMarkers}
            interactive={Boolean(track)}
            onSeek={onSeek}
            height={42}
            accentColorRgb={isDeckA ? '129 140 248' : '34 211 238'}
          />

          {/* Active Loop Region Highlight */}
          {loopOverlay && (
            <div
              className="pointer-events-none absolute top-0 bottom-0 border-x border-emerald-400/80 bg-emerald-400/20"
              style={{
                left: `${loopOverlay.leftPct}%`,
                width: `${loopOverlay.widthPct}%`
              }}
            >
              <span className="absolute top-0.5 left-1 rounded bg-emerald-500/90 px-1 py-px font-mono text-[8px] font-bold text-slate-950">
                {loopBeats}B
              </span>
            </div>
          )}

          {/* User Cue Point Marker */}
          {cueMarkerPct !== null && (
            <div
              className="pointer-events-none absolute top-0 bottom-0 w-px bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.9)]"
              style={{ left: `${cueMarkerPct}%` }}
            >
              <span className="absolute bottom-0.5 left-1 rounded bg-amber-400/90 px-1 py-px font-mono text-[8px] font-bold text-slate-950">
                CUE
              </span>
            </div>
          )}
        </div>

        <div className="mt-0.5 flex items-center justify-between font-mono text-[10px] tabular-nums text-slate-400">
          <span>{formatDuration(deck.currentTime)}</span>
          {track && (
            <span className="text-[9px] text-amber-300/80">
              CUE {formatDuration(cuePointSec)}
              {loopEnabled ? ` · LOOP ${loopBeats}B` : ''}
            </span>
          )}
          <span>-{formatDuration(Math.max(0, duration - deck.currentTime))}</span>
        </div>
      </div>

      {/* Deck Transport Row */}
      <div className="mt-2 flex items-center gap-1.5">
        <button
          type="button"
          disabled={!track}
          onClick={onTogglePlayPause}
          title={isDeckPlaying ? `Pause Deck ${deck.deckId}` : `Play Deck ${deck.deckId}`}
          aria-label={isDeckPlaying ? `Pause Deck ${deck.deckId}` : `Play Deck ${deck.deckId}`}
          className={`inline-flex h-7 flex-1 items-center justify-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-40 ${
            isDeckPlaying
              ? isDeckA
                ? 'border-indigo-400/60 bg-indigo-500 text-white shadow-[0_0_14px_rgba(99,102,241,0.45)]'
                : 'border-cyan-400/60 bg-cyan-500 text-slate-950 shadow-[0_0_14px_rgba(34,211,238,0.45)]'
              : 'border-white/15 bg-white/[0.08] text-white hover:bg-white/15'
          }`}
        >
          {isDeckPlaying ? (
            <>
              <Pause className="h-3.5 w-3.5 shrink-0" />
              <span>Pause</span>
            </>
          ) : (
            <>
              <Play className="h-3.5 w-3.5 shrink-0" />
              <span>Play</span>
            </>
          )}
        </button>

        <button
          type="button"
          disabled={!track}
          onClick={(e) => {
            if (e.shiftKey) {
              onSetCuePoint()
            } else {
              onJumpToCue()
            }
          }}
          title="Jump to Cue point (Shift+Click to set Cue here)"
          className="inline-flex h-7 items-center justify-center rounded-lg border border-amber-400/35 bg-amber-500/15 px-2.5 text-[11px] font-bold tracking-wide text-amber-200 hover:bg-amber-500/25 transition-colors disabled:cursor-not-allowed disabled:opacity-35"
        >
          CUE
        </button>

        <button
          type="button"
          disabled={!track}
          onClick={onSetCuePoint}
          title="Set Cue point at current playback position"
          aria-label={`Set cue point on Deck ${deck.deckId}`}
          className="inline-flex h-7 items-center justify-center gap-1 rounded-lg border border-white/10 bg-white/[0.05] px-2 text-[10px] font-semibold text-slate-300 hover:border-amber-400/40 hover:bg-amber-500/15 hover:text-amber-200 transition-colors disabled:cursor-not-allowed disabled:opacity-35"
        >
          <Crosshair className="h-3 w-3 shrink-0" />
          <span>Set</span>
        </button>

        <button
          type="button"
          disabled={!canSyncBpm}
          onClick={onSyncBpm}
          title={
            canSyncBpm
              ? `Sync Deck ${deck.deckId} BPM to Deck ${oppositeDeck.deckId}`
              : 'Load tracks with BPM on both decks to sync'
          }
          className={`inline-flex h-7 items-center justify-center gap-1 rounded-lg border px-2 text-[11px] font-bold tracking-wide transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
            isBpmSynced
              ? 'border-emerald-400/50 bg-emerald-500/20 text-emerald-200'
              : 'border-white/10 bg-white/[0.05] text-slate-200 hover:bg-white/10 hover:text-white'
          }`}
        >
          <Link2 className="h-3 w-3 shrink-0" />
          <span>SYNC</span>
        </button>

        <button
          type="button"
          disabled={!track}
          onClick={onUnload}
          title={`Eject / clear Deck ${deck.deckId}`}
          aria-label={`Eject Deck ${deck.deckId}`}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-slate-400 hover:border-rose-400/40 hover:bg-rose-500/15 hover:text-rose-200 transition-colors disabled:cursor-not-allowed disabled:opacity-35"
        >
          <ArrowUpFromLine className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Loop Controls Row */}
      <div className="mt-1.5 flex items-center justify-between gap-2 rounded-xl border border-white/[0.07] bg-white/[0.02] px-2 py-1">
        <button
          type="button"
          disabled={!track}
          onClick={onToggleLoop}
          aria-pressed={loopEnabled}
          title={loopEnabled ? 'Disable beat loop' : `Enable ${loopBeats}-beat loop`}
          className={`inline-flex h-6 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-35 ${
            loopEnabled
              ? 'border-emerald-400/60 bg-emerald-500/25 text-emerald-200 shadow-[0_0_10px_rgba(16,185,129,0.3)]'
              : 'border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/10 hover:text-white'
          }`}
        >
          <Repeat className="h-3 w-3" />
          <span>Loop</span>
        </button>

        <div className="flex items-center gap-1.5">
          <span className="text-[9px] font-semibold uppercase tracking-wider text-slate-500">
            Beats
          </span>
          <div className="inline-flex rounded-lg border border-white/10 bg-black/30 p-0.5">
            {LOOP_BEAT_OPTIONS.map((beats) => {
              const active = loopBeats === beats
              return (
                <button
                  key={beats}
                  type="button"
                  disabled={!track}
                  onClick={() => onSetLoopBeats(beats)}
                  className={`rounded-md px-2 py-0.5 font-mono text-[10px] font-semibold transition-colors disabled:opacity-40 ${
                    active
                      ? loopEnabled
                        ? 'bg-emerald-500/35 text-emerald-100'
                        : 'bg-white/15 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {beats}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* Tempo / Pitch Control */}
      <div className="mt-1.5 rounded-xl border border-white/[0.07] bg-white/[0.025] px-2.5 py-1.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Tempo
            </span>
            <span
              className={`font-mono text-[11px] font-semibold tabular-nums ${
                hasPitchShift
                  ? isDeckA
                    ? 'text-indigo-300'
                    : 'text-cyan-300'
                  : 'text-slate-300'
              }`}
            >
              {pitchPctText}
            </span>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onNudgePlaybackRate(-PITCH_NUDGE_STEP)}
              title="Nudge tempo down (-0.5%)"
              aria-label={`Nudge Deck ${deck.deckId} tempo down`}
              className="flex h-5 w-6 items-center justify-center rounded-md border border-white/10 bg-white/[0.05] text-slate-300 hover:bg-white/15 hover:text-white transition-colors"
            >
              <Minus className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={() => onSetPlaybackRate(1)}
              title="Reset tempo to 0%"
              className={`h-5 rounded-md border px-1.5 font-mono text-[10px] font-semibold transition-colors ${
                hasPitchShift
                  ? 'border-white/20 bg-white/10 text-white hover:bg-white/20'
                  : 'border-white/10 bg-white/[0.03] text-slate-400 hover:text-slate-200'
              }`}
            >
              0%
            </button>
            <button
              type="button"
              onClick={() => onNudgePlaybackRate(PITCH_NUDGE_STEP)}
              title="Nudge tempo up (+0.5%)"
              aria-label={`Nudge Deck ${deck.deckId} tempo up`}
              className="flex h-5 w-6 items-center justify-center rounded-md border border-white/10 bg-white/[0.05] text-slate-300 hover:bg-white/15 hover:text-white transition-colors"
            >
              <Plus className="h-3 w-3" />
            </button>
          </div>
        </div>

        <div className="mt-1 flex items-center gap-2">
          <span className="font-mono text-[9px] text-slate-500">-12%</span>
          <div className="relative flex h-3.5 flex-1 items-center">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className={`h-full rounded-full ${isDeckA ? 'bg-indigo-400' : 'bg-cyan-400'}`}
                style={{
                  marginLeft: `${pitchFillLeftPct}%`,
                  width: `${pitchFillWidthPct}%`
                }}
              />
            </div>
            <div className="pointer-events-none absolute top-0.5 bottom-0.5 left-1/2 w-px bg-white/30" />
            <input
              type="range"
              min={0.88}
              max={1.12}
              step={0.002}
              value={deck.playbackRate}
              onChange={(e) => onSetPlaybackRate(Number(e.target.value))}
              onDoubleClick={() => onSetPlaybackRate(1)}
              aria-label={`Deck ${deck.deckId} tempo pitch`}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
            <div
              className={`pointer-events-none absolute top-1/2 h-3 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-sm border border-white/60 shadow ${
                isDeckA ? 'bg-indigo-300' : 'bg-cyan-300'
              }`}
              style={{
                left: `${Math.max(3, Math.min(97, ((deck.playbackRate - 0.88) / 0.24) * 100))}%`
              }}
            />
          </div>
          <span className="font-mono text-[9px] text-slate-500">+12%</span>
        </div>
      </div>

      {/* Channel Mixer Strip (3-Band EQ + Kill + Color Filter + Channel Gain) */}
      <div className="mt-1.5 rounded-xl border border-white/[0.07] bg-white/[0.025] p-2 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Channel Mixer
          </span>
          <button
            type="button"
            onClick={onResetEq}
            title="Reset 3-band EQ & kills to flat"
            className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
              hasEqModification
                ? 'border-white/20 bg-white/10 text-white hover:bg-white/20'
                : 'border-white/10 bg-white/[0.03] text-slate-400 hover:text-slate-200'
            }`}
          >
            <RotateCcw className="h-2.5 w-2.5" />
            <span>Reset EQ</span>
          </button>
        </div>

        {/* 3-Band EQ + Kill */}
        <div className="grid grid-cols-3 gap-2">
          <EqMeterBand
            label="Low"
            valueDb={deck.eq.low}
            killed={eqKill.low}
            accentClass={isDeckA ? 'bg-indigo-400' : 'bg-cyan-400'}
            onChange={(db) => onEqChange('low', db)}
            onToggleKill={() => onToggleEqKill('low')}
            onResetBand={() => onEqChange('low', 0)}
          />
          <EqMeterBand
            label="Mid"
            valueDb={deck.eq.mid}
            killed={eqKill.mid}
            accentClass={isDeckA ? 'bg-indigo-400' : 'bg-cyan-400'}
            onChange={(db) => onEqChange('mid', db)}
            onToggleKill={() => onToggleEqKill('mid')}
            onResetBand={() => onEqChange('mid', 0)}
          />
          <EqMeterBand
            label="High"
            valueDb={deck.eq.high}
            killed={eqKill.high}
            accentClass={isDeckA ? 'bg-indigo-400' : 'bg-cyan-400'}
            onChange={(db) => onEqChange('high', db)}
            onToggleKill={() => onToggleEqKill('high')}
            onResetBand={() => onEqChange('high', 0)}
          />
        </div>

        {/* Color Filter + Channel Volume */}
        <div className="grid grid-cols-2 gap-2.5 border-t border-white/[0.06] pt-1.5">
          {/* Color Filter (-1 LPF .. 0 Flat .. +1 HPF) */}
          <div className="space-y-0.5">
            <div className="flex items-center justify-between text-[10px]">
              <span className="font-semibold uppercase tracking-wider text-slate-400">Filter</span>
              <button
                type="button"
                onClick={() => onFilterChange(0)}
                title="Reset filter to FLAT"
                className={`font-mono text-[10px] tabular-nums transition-colors ${
                  filterValue < -0.02
                    ? 'font-semibold text-amber-300 hover:text-white'
                    : filterValue > 0.02
                      ? 'font-semibold text-sky-300 hover:text-white'
                      : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {filterLabel}
              </button>
            </div>
            <div
              className="relative flex h-3.5 items-center"
              onDoubleClick={() => onFilterChange(0)}
              title="Color Filter: Left = LPF, Center = Flat, Right = HPF (Double-click to reset)"
            >
              <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className={`h-full rounded-full ${
                    filterValue < 0 ? 'bg-amber-400/90' : 'bg-sky-400/90'
                  }`}
                  style={{
                    marginLeft: `${filterFillLeftPct}%`,
                    width: `${filterFillWidthPct}%`
                  }}
                />
              </div>
              <div className="pointer-events-none absolute top-0.5 bottom-0.5 left-1/2 w-px bg-white/30" />
              <input
                type="range"
                min={-1}
                max={1}
                step={0.01}
                value={filterValue}
                onChange={(e) => onFilterChange(Number(e.target.value))}
                onDoubleClick={() => onFilterChange(0)}
                aria-label={`Deck ${deck.deckId} color filter`}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              />
              <div
                className="pointer-events-none absolute top-1/2 h-3 w-2 -translate-x-1/2 -translate-y-1/2 rounded-sm border border-white/60 bg-slate-100 shadow"
                style={{
                  left: `${Math.max(4, Math.min(96, ((filterValue + 1) / 2) * 100))}%`
                }}
              />
            </div>
          </div>

          {/* Channel Volume Fader (0%..100%) */}
          <div className="space-y-0.5">
            <div className="flex items-center justify-between text-[10px]">
              <span className="inline-flex items-center gap-1 font-semibold uppercase tracking-wider text-slate-400">
                <Volume2 className="h-3 w-3" />
                <span>Vol</span>
              </span>
              <span className="font-mono text-[10px] tabular-nums text-slate-200">
                {Math.round(channelGain * 100)}%
              </span>
            </div>
            <div className="relative flex h-3.5 items-center">
              <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className={`h-full rounded-full transition-all duration-75 ${
                    isDeckA
                      ? 'bg-gradient-to-r from-indigo-500 to-indigo-300'
                      : 'bg-gradient-to-r from-cyan-500 to-cyan-300'
                  }`}
                  style={{ width: `${Math.max(0, Math.min(100, channelGain * 100))}%` }}
                />
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={channelGain}
                onChange={(e) => onChannelGainChange(Number(e.target.value))}
                onDoubleClick={() => onChannelGainChange(1)}
                aria-label={`Deck ${deck.deckId} channel volume`}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              />
              <div
                className="pointer-events-none absolute top-1/2 h-3 w-2 -translate-x-1/2 -translate-y-1/2 rounded-sm border border-white/60 bg-slate-100 shadow"
                style={{
                  left: `${Math.max(4, Math.min(96, channelGain * 100))}%`
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export function DualDeckView() {
  const telemetry = usePlayerStore((s) => s.telemetry)
  const autoDjConfig = usePlayerStore((s) => s.autoDjConfig)
  const autoDjQueue = usePlayerStore((s) => s.autoDjQueue)
  const showWaveformCues = usePlayerStore((s) => s.appearanceSettings.showWaveformCues)
  const updateAutoDjConfig = usePlayerStore((s) => s.updateAutoDjConfig)
  const triggerManualCrossfade = usePlayerStore((s) => s.triggerManualCrossfade)

  const loadTrackToDeck = usePlayerStore((s) => s.loadTrackToDeck)
  const unloadDeck = usePlayerStore((s) => s.unloadDeck)
  const toggleDeckPlayPause = usePlayerStore((s) => s.toggleDeckPlayPause)
  const seekDeck = usePlayerStore((s) => s.seekDeck)
  const setDeckPlaybackRate = usePlayerStore((s) => s.setDeckPlaybackRate)
  const nudgeDeckPlaybackRate = usePlayerStore((s) => s.nudgeDeckPlaybackRate)
  const syncDeckBpm = usePlayerStore((s) => s.syncDeckBpm)
  const setDeckCuePoint = usePlayerStore((s) => s.setDeckCuePoint)
  const jumpToDeckCue = usePlayerStore((s) => s.jumpToDeckCue)
  const toggleDeckLoop = usePlayerStore((s) => s.toggleDeckLoop)
  const setDeckLoopBeats = usePlayerStore((s) => s.setDeckLoopBeats)
  const setDeckEq = usePlayerStore((s) => s.setDeckEq)
  const toggleDeckEqKill = usePlayerStore((s) => s.toggleDeckEqKill)
  const resetDeckEq = usePlayerStore((s) => s.resetDeckEq)
  const setDeckFilter = usePlayerStore((s) => s.setDeckFilter)
  const setDeckChannelGain = usePlayerStore((s) => s.setDeckChannelGain)
  const setCrossfader = usePlayerStore((s) => s.setCrossfader)

  const deckA = telemetry.decks.A
  const deckB = telemetry.decks.B
  const tr = telemetry.transition

  // Interactive crossfader position 0 (Deck A) -> 1 (Deck B)
  const crossfaderPos = Math.max(0, Math.min(1, telemetry.crossfader ?? 0))

  // Harmonic compatibility between Deck A & Deck B (or active deck & queued next track)
  const standbyTrack =
    telemetry.activeDeckId === 'A'
      ? deckB.track ?? autoDjQueue[0]?.track ?? null
      : deckA.track ?? autoDjQueue[0]?.track ?? null
  const primaryTrack = telemetry.decks[telemetry.activeDeckId].track

  const harmonicMatch = getCamelotCompatibility(
    primaryTrack?.camelotKey ?? null,
    standbyTrack?.camelotKey ?? null
  )

  const handleLoadDeck = (deckId: DeckId, track: TrackRecord) => {
    void loadTrackToDeck(deckId, track, { autoplay: false })
  }

  return (
    <div className="flex flex-col gap-2.5">
      {/* Compact Single-Row Mix Style & Duration Bar */}
      <div className="rounded-2xl glass-panel px-3 py-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* Mix Style */}
          <div className="flex items-center gap-1.5">
            <Sliders className="h-3.5 w-3.5 shrink-0 text-accentGlow" />
            <div className="inline-flex rounded-xl border border-white/10 bg-black/30 p-0.5">
              {MIX_STYLES.map((style) => {
                const active = autoDjConfig.mixStyle === style.id
                return (
                  <button
                    key={style.id}
                    type="button"
                    title={style.hint}
                    onClick={() => updateAutoDjConfig({ mixStyle: style.id })}
                    className={`whitespace-nowrap rounded-lg px-2 py-1 text-[11px] font-semibold transition-all ${
                      active
                        ? 'bg-accent text-white shadow-glow'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {style.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Duration Mode & Value */}
          <div className="flex items-center gap-1.5">
            <div className="inline-flex rounded-lg border border-white/10 bg-black/30 p-0.5 text-[10px]">
              <button
                type="button"
                onClick={() => updateAutoDjConfig({ durationMode: 'fixed' })}
                className={`rounded px-1.5 py-0.5 font-semibold ${
                  autoDjConfig.durationMode === 'fixed'
                    ? 'bg-white/15 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Sec
              </button>
              <button
                type="button"
                onClick={() => updateAutoDjConfig({ durationMode: 'bars' })}
                className={`rounded px-1.5 py-0.5 font-semibold ${
                  autoDjConfig.durationMode === 'bars'
                    ? 'bg-white/15 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Bars
              </button>
            </div>

            {autoDjConfig.durationMode === 'fixed' ? (
              <div className="flex items-center gap-1.5">
                <input
                  type="range"
                  min={4}
                  max={16}
                  step={1}
                  disabled={autoDjConfig.mixStyle === 'quick-cut'}
                  value={autoDjConfig.durationSec}
                  onChange={(e) => updateAutoDjConfig({ durationSec: Number(e.target.value) })}
                  aria-label="Transition duration in seconds"
                  className="h-1.5 w-16 accent-indigo-400 disabled:opacity-40"
                />
                <span className="w-7 font-mono text-[11px] tabular-nums text-white">
                  {autoDjConfig.mixStyle === 'quick-cut' ? '0.5s' : `${autoDjConfig.durationSec}s`}
                </span>
              </div>
            ) : (
              <div className="inline-flex rounded-lg border border-white/10 bg-black/30 p-0.5">
                {BAR_OPTIONS.map((bars) => (
                  <button
                    key={bars}
                    type="button"
                    disabled={autoDjConfig.mixStyle === 'quick-cut'}
                    onClick={() => updateAutoDjConfig({ durationBars: bars })}
                    className={`rounded-md px-1.5 py-0.5 font-mono text-[10px] font-semibold transition-colors disabled:opacity-40 ${
                      autoDjConfig.durationBars === bars
                        ? 'bg-accent/30 text-accentGlow'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {bars}B
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Tempo Match + Manual Mix Trigger */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() =>
                updateAutoDjConfig({ tempoMatchEnabled: !autoDjConfig.tempoMatchEnabled })
              }
              className={`inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-lg border px-2 text-[11px] font-semibold transition-colors ${
                autoDjConfig.tempoMatchEnabled
                  ? 'border-accentGlow/40 bg-accentGlow/15 text-accentGlow'
                  : 'border-white/10 bg-white/[0.04] text-slate-400 hover:text-white'
              }`}
              title={`Pitch-sync tracks within ±${autoDjConfig.tempoMatchMaxPct}% during overlap`}
            >
              <Activity className="h-3 w-3 shrink-0" />
              <span>Tempo ±{autoDjConfig.tempoMatchMaxPct}%</span>
            </button>

            <button
              type="button"
              onClick={() => void triggerManualCrossfade()}
              className="inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-lg bg-accent px-2.5 text-[11px] font-semibold text-white shadow-glow hover:brightness-110 transition-all"
            >
              <Shuffle className="h-3 w-3 shrink-0" />
              <span>Mix Now</span>
            </button>
          </div>
        </div>
      </div>

      {/* Parallel Deck A & Deck B */}
      <div className="grid grid-cols-1 gap-2.5 xl:grid-cols-2">
        <DeckCard
          deck={deckA}
          oppositeDeck={deckB}
          isActiveDeck={telemetry.activeDeckId === 'A'}
          showCueMarkers={showWaveformCues}
          onLoadTrack={(track) => handleLoadDeck('A', track)}
          onUnload={() => unloadDeck('A')}
          onTogglePlayPause={() => void toggleDeckPlayPause('A')}
          onSeek={(sec) => seekDeck('A', sec)}
          onSetPlaybackRate={(rate) => setDeckPlaybackRate('A', rate)}
          onNudgePlaybackRate={(delta) => nudgeDeckPlaybackRate('A', delta)}
          onSyncBpm={() => syncDeckBpm('A')}
          onSetCuePoint={() => setDeckCuePoint('A')}
          onJumpToCue={() => jumpToDeckCue('A')}
          onToggleLoop={() => toggleDeckLoop('A')}
          onSetLoopBeats={(beats) => setDeckLoopBeats('A', beats)}
          onEqChange={(band, db) => setDeckEq('A', band, db)}
          onToggleEqKill={(band) => toggleDeckEqKill('A', band)}
          onResetEq={() => resetDeckEq('A')}
          onFilterChange={(value) => setDeckFilter('A', value)}
          onChannelGainChange={(gain) => setDeckChannelGain('A', gain)}
        />
        <DeckCard
          deck={deckB}
          oppositeDeck={deckA}
          isActiveDeck={telemetry.activeDeckId === 'B'}
          showCueMarkers={showWaveformCues}
          onLoadTrack={(track) => handleLoadDeck('B', track)}
          onUnload={() => unloadDeck('B')}
          onTogglePlayPause={() => void toggleDeckPlayPause('B')}
          onSeek={(sec) => seekDeck('B', sec)}
          onSetPlaybackRate={(rate) => setDeckPlaybackRate('B', rate)}
          onNudgePlaybackRate={(delta) => nudgeDeckPlaybackRate('B', delta)}
          onSyncBpm={() => syncDeckBpm('B')}
          onSetCuePoint={() => setDeckCuePoint('B')}
          onJumpToCue={() => jumpToDeckCue('B')}
          onToggleLoop={() => toggleDeckLoop('B')}
          onSetLoopBeats={(beats) => setDeckLoopBeats('B', beats)}
          onEqChange={(band, db) => setDeckEq('B', band, db)}
          onToggleEqKill={(band) => toggleDeckEqKill('B', band)}
          onResetEq={() => resetDeckEq('B')}
          onFilterChange={(value) => setDeckFilter('B', value)}
          onChannelGainChange={(gain) => setDeckChannelGain('B', gain)}
        />
      </div>

      {/* Interactive Crossfader & Harmonic Bridge */}
      <div className="rounded-2xl glass-panel px-3.5 py-2">
        <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-1.5">
            <Disc3
              className={`h-3.5 w-3.5 ${
                tr.active ? 'animate-spin text-accentGlow' : 'text-slate-400'
              }`}
            />
            <span className="font-semibold text-white">
              {tr.active
                ? `Active Transition: Deck ${tr.fromDeck} → Deck ${tr.toDeck} (${Math.round(tr.progress * 100)}%)`
                : `Active Output: Deck ${telemetry.activeDeckId}`}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {tr.active && tr.bpmDeltaPct !== null && (
              <span className="rounded-full border border-accentGlow/30 bg-accentGlow/10 px-2 py-0.5 font-mono text-[10px] text-accentGlow">
                {tr.tempoMatched ? 'Synced' : 'Free BPM'} ({tr.bpmDeltaPct >= 0 ? '+' : ''}
                {tr.bpmDeltaPct}%)
              </span>
            )}

            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                harmonicMatch.compatible
                  ? 'border-emerald-500/35 bg-emerald-500/15 text-emerald-300'
                  : 'border-white/10 bg-white/[0.05] text-slate-300'
              }`}
            >
              Harmonic: {tr.keyCompatibilityLabel ?? harmonicMatch.relation}
            </span>
          </div>
        </div>

        {/* Interactive Crossfader Rail + Quick Snap Buttons */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setCrossfader(0)}
            title="Snap crossfader to Deck A"
            className={`h-7 min-w-[34px] rounded-lg border px-2 font-mono text-xs font-bold transition-all ${
              crossfaderPos <= 0.03
                ? 'border-indigo-400/70 bg-indigo-500/30 text-indigo-100 shadow-[0_0_12px_rgba(99,102,241,0.35)]'
                : 'border-white/10 bg-white/[0.04] text-indigo-300 hover:bg-indigo-500/20'
            }`}
          >
            A
          </button>

          <div className="relative flex h-8 flex-1 items-center rounded-xl border border-white/10 bg-black/45 px-3">
            <div className="h-1.5 w-full rounded-full bg-gradient-to-r from-indigo-500/70 via-white/20 to-cyan-400/70" />
            {/* Center detent tick */}
            <div className="pointer-events-none absolute top-1.5 bottom-1.5 left-1/2 w-0.5 -translate-x-1/2 rounded-full bg-white/30" />
            {/* Tactile fader handle */}
            <div
              className="pointer-events-none absolute top-1/2 h-5 w-9 -translate-x-1/2 -translate-y-1/2 rounded-md border border-white/40 bg-gradient-to-b from-slate-100 to-slate-300 shadow-lg transition-[left] duration-75"
              style={{ left: `${Math.max(4, Math.min(96, crossfaderPos * 100))}%` }}
            >
              <div className="mx-auto mt-1 h-2.5 w-0.5 rounded-full bg-obsidian/70" />
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={crossfaderPos}
              onChange={(e) => setCrossfader(Number(e.target.value))}
              aria-label="Deck A to Deck B crossfader"
              className="absolute inset-0 h-full w-full cursor-ew-resize opacity-0"
            />
          </div>

          <button
            type="button"
            onClick={() => setCrossfader(1)}
            title="Snap crossfader to Deck B"
            className={`h-7 min-w-[34px] rounded-lg border px-2 font-mono text-xs font-bold transition-all ${
              crossfaderPos >= 0.97
                ? 'border-cyan-400/70 bg-cyan-500/30 text-cyan-100 shadow-[0_0_12px_rgba(34,211,238,0.35)]'
                : 'border-white/10 bg-white/[0.04] text-cyan-300 hover:bg-cyan-500/20'
            }`}
          >
            B
          </button>
        </div>

        <div className="mt-1 flex items-center justify-between px-1 font-mono text-[10px] tabular-nums">
          <span className="text-indigo-300/80">
            Deck A {Math.round(deckA.crossfadeGain * 100)}%
          </span>
          <button
            type="button"
            onClick={() => setCrossfader(0.5)}
            title="Center crossfader (50/50 blend)"
            className={`rounded-md border px-2 py-px text-[10px] font-semibold transition-all ${
              Math.abs(crossfaderPos - 0.5) <= 0.03
                ? 'border-white/40 bg-white/20 text-white'
                : 'border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/10 hover:text-white'
            }`}
          >
            50/50
          </button>
          <span className="text-cyan-300/80">
            Deck B {Math.round(deckB.crossfadeGain * 100)}%
          </span>
        </div>
      </div>
    </div>
  )
}
