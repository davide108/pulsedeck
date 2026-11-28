import {
  Heart,
  Info,
  Loader2,
  Maximize2,
  Mic2,
  Pause,
  Play,
  Radio,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX,
  Wand2
} from 'lucide-react'
import { ArtworkCover } from '@/components/common/ArtworkCover'
import { KeyBadge } from '@/components/common/KeyBadge'
import { WaveformScrubber } from '@/components/player/WaveformScrubber'
import { useLibraryStore } from '@/store/useLibraryStore'
import { usePlayerStore } from '@/store/usePlayerStore'
import { formatBpm, formatDuration } from '@/utils/format'

export function PlayerBar() {
  const activeTrack = usePlayerStore((s) => s.activeTrack)
  const isPlaying = usePlayerStore((s) => s.isPlaying)
  const telemetry = usePlayerStore((s) => s.telemetry)
  const autoDjEnabled = usePlayerStore((s) => s.autoDjConfig.enabled)
  const shuffle = usePlayerStore((s) => s.shuffle)
  const repeatMode = usePlayerStore((s) => s.repeatMode)
  const showWaveformCues = usePlayerStore((s) => s.appearanceSettings.showWaveformCues)
  const queueLength = usePlayerStore((s) => s.autoDjQueue.length)
  const volume = usePlayerStore((s) => s.volume)
  const muted = usePlayerStore((s) => s.muted)

  const togglePlayPause = usePlayerStore((s) => s.togglePlayPause)
  const skipNext = usePlayerStore((s) => s.skipNext)
  const previousTrack = usePlayerStore((s) => s.previousTrack)
  const seek = usePlayerStore((s) => s.seek)
  const setVolume = usePlayerStore((s) => s.setVolume)
  const toggleMute = usePlayerStore((s) => s.toggleMute)
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle)
  const cycleRepeatMode = usePlayerStore((s) => s.cycleRepeatMode)
  const toggleAutoDj = usePlayerStore((s) => s.toggleAutoDj)
  const triggerManualCrossfade = usePlayerStore((s) => s.triggerManualCrossfade)
  const setNowPlayingOpen = usePlayerStore((s) => s.setNowPlayingOpen)
  const openTrackInfo = useLibraryStore((s) => s.openTrackInfo)
  const toggleTrackLike = useLibraryStore((s) => s.toggleTrackLike)

  const activeDeck = telemetry.decks[telemetry.activeDeckId]
  const duration = activeDeck.duration || activeTrack?.duration || 0
  const currentTime = activeDeck.currentTime || 0
  const isLoading = activeDeck.status === 'loading'
  const tr = telemetry.transition

  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2

  return (
    <footer className="relative z-30 flex h-[88px] shrink-0 items-center justify-between gap-4 border-t border-white/[0.08] bg-obsidian/90 px-4 backdrop-blur-2xl select-none">
      {/* Left: Track Info */}
      <div
        onClick={() => setNowPlayingOpen(true, 'visualizer')}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter') setNowPlayingOpen(true, 'visualizer')
        }}
        title="Open Now Playing view"
        className="group flex w-[26%] min-w-[200px] cursor-pointer items-center gap-3 rounded-xl p-1.5 hover:bg-white/[0.04] transition-colors"
      >
        <ArtworkCover
          artworkPath={activeTrack?.artworkPath}
          alt={activeTrack?.album || 'No track loaded'}
          className={`h-12 w-12 transition-shadow ${isPlaying ? 'shadow-glow' : ''}`}
          iconClassName="h-5 w-5"
          roundedClassName="rounded-xl"
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-xs font-semibold text-white group-hover:text-accentGlow transition-colors">
              {activeTrack?.title ?? 'Ready to Play'}
            </p>
            {activeTrack && (
              <span className="shrink-0 rounded bg-white/[0.07] px-1 py-0.5 font-mono text-[9px] font-bold text-slate-400">
                {telemetry.activeDeckId}
              </span>
            )}
          </div>
          <p className="truncate text-[11px] text-slate-400">
            {activeTrack?.artist ?? 'Select a track from your library'}
          </p>
          {activeTrack && (
            <div className="mt-1 flex items-center gap-1.5">
              <span className="font-mono text-[10px] text-slate-400">
                {formatBpm(activeTrack.bpm)} BPM
              </span>
              <KeyBadge camelotKey={activeTrack.camelotKey} size="xs" />
            </div>
          )}
        </div>

        {activeTrack && (
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                void toggleTrackLike(activeTrack.id)
              }}
              onKeyDown={(e) => e.stopPropagation()}
              title={
                activeTrack.isLiked
                  ? 'Remove from Liked Songs (H)'
                  : 'Save to Liked Songs (H)'
              }
              aria-label={
                activeTrack.isLiked ? 'Remove from Liked Songs' : 'Save to Liked Songs'
              }
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-all ${
                activeTrack.isLiked
                  ? 'text-rose-400 hover:bg-rose-500/15 hover:text-rose-300 opacity-100'
                  : 'text-slate-400 opacity-70 hover:bg-white/10 hover:text-rose-400 group-hover:opacity-100'
              }`}
            >
              <Heart className={`h-3.5 w-3.5 ${activeTrack.isLiked ? 'fill-rose-400' : ''}`} />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                openTrackInfo(activeTrack)
              }}
              onKeyDown={(e) => e.stopPropagation()}
              title="Track Info & Edit Metadata (I)"
              aria-label="Track Info & Edit Metadata"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-400 opacity-70 hover:bg-white/10 hover:text-white group-hover:opacity-100 transition-all"
            >
              <Info className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Center: Transport + Waveform Scrubber */}
      <div className="flex flex-1 max-w-2xl flex-col items-center gap-1">
        {/* Controls & Live Transition Indicator */}
        <div className="flex w-full items-center justify-center gap-3">
          <div className="flex flex-1 items-center justify-end">
            {tr.active && (
              <button
                type="button"
                onClick={() => {
                  useLibraryStore.getState().setView('autodj')
                  setNowPlayingOpen(false)
                }}
                className="inline-flex items-center gap-1.5 rounded-full border border-accentGlow/40 bg-accentGlow/15 px-2.5 py-0.5 text-[10px] font-semibold text-accentGlow animate-pulse"
                title="Open DJ Booth"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-accentGlow" />
                <span>
                  {tr.fromDeck}→{tr.toDeck} · {Math.round(tr.progress * 100)}%
                </span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={toggleShuffle}
              title={
                autoDjEnabled
                  ? `Shuffle: ${shuffle ? 'On' : 'Off'} (Auto-Mix chooses queued tracks while enabled)`
                  : shuffle
                    ? 'Shuffle: On (S)'
                    : 'Shuffle: Off (S)'
              }
              aria-label={shuffle ? 'Disable shuffle' : 'Enable shuffle'}
              className={`flex h-7 w-7 items-center justify-center rounded-full border transition-colors ${
                shuffle
                  ? 'border-accent/40 bg-accent/20 text-accentGlow'
                  : 'border-transparent text-slate-400 hover:bg-white/10 hover:text-white'
              } ${autoDjEnabled ? 'opacity-45' : ''}`}
            >
              <Shuffle className="h-3.5 w-3.5" />
            </button>

            <button
              type="button"
              onClick={() => void previousTrack()}
              title="Previous track"
              aria-label="Previous track"
              className="flex h-8 w-8 items-center justify-center rounded-full text-slate-300 hover:bg-white/10 hover:text-white transition-colors"
            >
              <SkipBack className="h-4 w-4" />
            </button>

            <button
              type="button"
              onClick={() => void togglePlayPause()}
              title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
              aria-label={isPlaying ? 'Pause' : 'Play'}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-white shadow-glow hover:brightness-110 active:scale-95 transition-all"
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : isPlaying ? (
                <Pause className="h-4 w-4" />
              ) : (
                <Play className="ml-0.5 h-4 w-4" />
              )}
            </button>

            <button
              type="button"
              onClick={() => void skipNext()}
              title="Next track"
              aria-label="Next track"
              className="flex h-8 w-8 items-center justify-center rounded-full text-slate-300 hover:bg-white/10 hover:text-white transition-colors"
            >
              <SkipForward className="h-4 w-4" />
            </button>

            <button
              type="button"
              onClick={cycleRepeatMode}
              title={
                repeatMode === 'off'
                  ? 'Repeat: Off (R)'
                  : repeatMode === 'all'
                    ? 'Repeat All: Replay list at end (R)'
                    : 'Repeat One: Replay same song (R)'
              }
              aria-label={`Repeat mode: ${repeatMode}`}
              className={`relative flex h-7 w-7 items-center justify-center rounded-full border transition-colors ${
                repeatMode !== 'off'
                  ? 'border-accent/40 bg-accent/20 text-accentGlow'
                  : 'border-transparent text-slate-400 hover:bg-white/10 hover:text-white'
              }`}
            >
              {repeatMode === 'one' ? (
                <Repeat1 className="h-3.5 w-3.5" />
              ) : (
                <Repeat className="h-3.5 w-3.5" />
              )}
            </button>
          </div>

          <div className="flex flex-1 items-center justify-start">
            {autoDjEnabled && (
              <button
                type="button"
                disabled={!activeTrack || queueLength === 0}
                onClick={() => void triggerManualCrossfade()}
                title="Crossfade into next Auto-Mix track now"
                className="inline-flex h-7 items-center gap-1 rounded-full border border-white/10 bg-white/[0.05] px-2.5 text-[10px] font-semibold text-slate-200 hover:border-accent/40 hover:bg-accent/15 hover:text-white disabled:opacity-35 transition-colors"
              >
                <Wand2 className="h-3 w-3 text-accentGlow" />
                <span>Mix Next</span>
              </button>
            )}
          </div>
        </div>

        {/* Waveform Scrubber Row */}
        <div className="flex w-full items-center gap-2.5">
          <span className="w-10 text-right font-mono text-[10px] tabular-nums text-slate-400">
            {formatDuration(currentTime)}
          </span>
          <WaveformScrubber
            peaks={activeTrack?.waveformPeaks}
            duration={duration}
            currentTime={currentTime}
            introCueSec={activeTrack?.introCueSec}
            outroCueSec={activeTrack?.outroCueSec}
            showCueMarkers={showWaveformCues}
            onSeek={seek}
            height={34}
            className="flex-1"
          />
          <span className="w-10 font-mono text-[10px] tabular-nums text-slate-400">
            {formatDuration(duration)}
          </span>
        </div>
      </div>

      {/* Right: Auto-Mix, Volume, Lyrics / Expand */}
      <div className="flex w-[26%] min-w-[250px] items-center justify-end gap-2">
        <button
          type="button"
          onClick={toggleAutoDj}
          title="Toggle Auto-Mix harmonic transitions (D)"
          className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[11px] font-semibold transition-all ${
            autoDjEnabled
              ? 'border-accent/50 bg-accent/20 text-white shadow-glow'
              : 'border-white/10 bg-white/[0.04] text-slate-400 hover:text-white'
          }`}
        >
          <Radio className={`h-3.5 w-3.5 ${autoDjEnabled ? 'text-accentGlow animate-pulse' : ''}`} />
          <span>Auto-Mix</span>
          <kbd className="rounded bg-black/30 px-1 font-mono text-[9px] opacity-75">D</kbd>
        </button>

        {/* Volume */}
        <div className="flex items-center gap-1.5 rounded-xl border border-white/[0.07] bg-white/[0.03] px-2 py-1">
          <button
            type="button"
            onClick={toggleMute}
            title={muted ? 'Unmute (M)' : 'Mute (M)'}
            aria-label={muted ? 'Unmute' : 'Mute'}
            className="text-slate-300 hover:text-white transition-colors"
          >
            <VolumeIcon className="h-4 w-4" />
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={muted ? 0 : volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            aria-label="Master volume"
            className="h-1 w-16 cursor-pointer accent-indigo-400"
          />
        </div>

        <button
          type="button"
          onClick={() => setNowPlayingOpen(true, 'lyrics')}
          title="Lyrics (L)"
          aria-label="Open Lyrics"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-slate-300 hover:border-accent/40 hover:bg-accent/15 hover:text-white transition-colors"
        >
          <Mic2 className="h-4 w-4" />
        </button>

        <button
          type="button"
          onClick={() => setNowPlayingOpen(true, 'visualizer')}
          title="Expand Now Playing view"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-slate-300 hover:border-accent/40 hover:bg-accent/15 hover:text-white transition-colors"
        >
          <Maximize2 className="h-4 w-4" />
        </button>
      </div>
    </footer>
  )
}
