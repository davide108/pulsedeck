import {
  Maximize2,
  Pause,
  Play,
  Radio,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward
} from 'lucide-react'
import { ArtworkCover } from '@/components/common/ArtworkCover'
import { KeyBadge } from '@/components/common/KeyBadge'
import { usePlayerStore } from '@/store/usePlayerStore'
import { formatBpm, formatDuration } from '@/utils/format'

export function MiniPlayer() {
  const activeTrack = usePlayerStore((s) => s.activeTrack)
  const isPlaying = usePlayerStore((s) => s.isPlaying)
  const telemetry = usePlayerStore((s) => s.telemetry)
  const autoDjEnabled = usePlayerStore((s) => s.autoDjConfig.enabled)
  const shuffle = usePlayerStore((s) => s.shuffle)
  const repeatMode = usePlayerStore((s) => s.repeatMode)

  const togglePlayPause = usePlayerStore((s) => s.togglePlayPause)
  const skipNext = usePlayerStore((s) => s.skipNext)
  const previousTrack = usePlayerStore((s) => s.previousTrack)
  const seek = usePlayerStore((s) => s.seek)
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle)
  const cycleRepeatMode = usePlayerStore((s) => s.cycleRepeatMode)
  const toggleAutoDj = usePlayerStore((s) => s.toggleAutoDj)
  const setMiniPlayer = usePlayerStore((s) => s.setMiniPlayer)

  const activeDeck = telemetry.decks[telemetry.activeDeckId]
  const duration = activeDeck.duration || activeTrack?.duration || 0
  const currentTime = activeDeck.currentTime || 0
  const progressPct = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0

  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (duration <= 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    if (rect.width <= 0) return
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    seek(ratio * duration)
  }

  return (
    <div className="drag-region accent-ambient-bg flex h-screen w-screen flex-col justify-between overflow-hidden bg-obsidian p-3 text-slate-100 select-none border border-white/10">
      {/* Top row: Artwork, Info, Expand */}
      <div className="flex items-center gap-3">
        <ArtworkCover
          artworkPath={activeTrack?.artworkPath}
          alt={activeTrack?.album || 'PulseDeck'}
          className="h-14 w-14 shadow-glow"
          iconClassName="h-6 w-6"
          roundedClassName="rounded-xl"
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-sm font-semibold text-white">
              {activeTrack?.title ?? 'PulseDeck Ready'}
            </p>
          </div>
          <p className="truncate text-xs text-slate-400">
            {activeTrack?.artist ?? 'Select a track to begin'}
          </p>
          <div className="mt-1 flex items-center gap-1.5">
            {activeTrack?.bpm && (
              <span className="rounded bg-white/[0.07] px-1.5 py-0.5 font-mono text-[10px] text-slate-300">
                {formatBpm(activeTrack.bpm)} BPM
              </span>
            )}
            {activeTrack?.camelotKey && <KeyBadge camelotKey={activeTrack.camelotKey} size="xs" />}
            {telemetry.transition.active && (
              <span className="rounded bg-accent/25 px-1.5 py-0.5 text-[10px] font-semibold text-accentGlow animate-pulse">
                Mixing
              </span>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={() => void setMiniPlayer(false)}
          title="Return to Full Player"
          className="no-drag flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.05] text-slate-300 hover:bg-white/15 hover:text-white transition-colors"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Mini Clickable Progress Bar */}
      <div className="no-drag space-y-1">
        <div
          onClick={handleProgressClick}
          role="slider"
          aria-label="Track progress"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(currentTime)}
          className="group relative h-2 w-full cursor-pointer rounded-full bg-white/10 overflow-hidden"
        >
          <div
            className="h-full rounded-full bg-gradient-to-r from-accent to-accentGlow transition-[width] duration-75"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <div className="flex justify-between font-mono text-[10px] tabular-nums text-slate-400">
          <span>{formatDuration(currentTime)}</span>
          <span>{formatDuration(duration)}</span>
        </div>
      </div>

      {/* Controls Row */}
      <div className="no-drag flex items-center justify-between">
        <button
          type="button"
          onClick={toggleAutoDj}
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold transition-all ${
            autoDjEnabled
              ? 'border-accent/50 bg-accent/20 text-white shadow-glow'
              : 'border-white/10 bg-white/[0.04] text-slate-400 hover:text-white'
          }`}
        >
          <Radio className={`h-3 w-3 ${autoDjEnabled ? 'text-accentGlow' : ''}`} />
          <span>Auto-Mix</span>
        </button>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={toggleShuffle}
            title={shuffle ? 'Shuffle: On' : 'Shuffle: Off'}
            aria-label="Toggle shuffle"
            className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors ${
              shuffle
                ? 'bg-accent/20 text-accentGlow'
                : 'text-slate-400 hover:bg-white/10 hover:text-white'
            } ${autoDjEnabled ? 'opacity-45' : ''}`}
          >
            <Shuffle className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            onClick={() => void previousTrack()}
            aria-label="Previous track"
            className="flex h-8 w-8 items-center justify-center rounded-full text-slate-300 hover:bg-white/10 hover:text-white transition-colors"
          >
            <SkipBack className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={() => void togglePlayPause()}
            aria-label={isPlaying ? 'Pause' : 'Play'}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-white shadow-glow hover:brightness-110 transition-all"
          >
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="ml-0.5 h-4 w-4" />}
          </button>

          <button
            type="button"
            onClick={() => void skipNext()}
            aria-label="Next track"
            className="flex h-8 w-8 items-center justify-center rounded-full text-slate-300 hover:bg-white/10 hover:text-white transition-colors"
          >
            <SkipForward className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={cycleRepeatMode}
            title={`Repeat: ${repeatMode}`}
            aria-label={`Repeat mode: ${repeatMode}`}
            className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors ${
              repeatMode !== 'off'
                ? 'bg-accent/20 text-accentGlow'
                : 'text-slate-400 hover:bg-white/10 hover:text-white'
            }`}
          >
            {repeatMode === 'one' ? (
              <Repeat1 className="h-3.5 w-3.5" />
            ) : (
              <Repeat className="h-3.5 w-3.5" />
            )}
          </button>
        </div>

        <span className="w-[64px] text-right font-mono text-[10px] text-slate-500">
          Deck {telemetry.activeDeckId}
        </span>
      </div>
    </div>
  )
}
