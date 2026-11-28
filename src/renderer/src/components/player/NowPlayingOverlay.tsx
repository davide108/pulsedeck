import {
  ChevronDown,
  Disc3,
  Gauge,
  Heart,
  Info,
  Mic2,
  Pause,
  PictureInPicture2,
  Play,
  Radio,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Sparkles,
  Volume2,
  Wand2
} from 'lucide-react'
import { ArtworkCover } from '@/components/common/ArtworkCover'
import { EnergyMeter } from '@/components/common/EnergyMeter'
import { KeyBadge } from '@/components/common/KeyBadge'
import { AutoDjQueuePanel } from '@/components/player/AutoDjQueuePanel'
import { LyricsPanel } from '@/components/player/LyricsPanel'
import { SpectrumVisualizer } from '@/components/player/SpectrumVisualizer'
import { WaveformScrubber } from '@/components/player/WaveformScrubber'
import { useLibraryStore } from '@/store/useLibraryStore'
import { usePlayerStore } from '@/store/usePlayerStore'
import { formatBpm, formatDuration, formatReplayGain } from '@/utils/format'

export function NowPlayingOverlay() {
  const open = usePlayerStore((s) => s.nowPlayingOpen)
  const tab = usePlayerStore((s) => s.nowPlayingTab)
  const activeTrack = usePlayerStore((s) => s.activeTrack)
  const isPlaying = usePlayerStore((s) => s.isPlaying)
  const telemetry = usePlayerStore((s) => s.telemetry)
  const autoDjEnabled = usePlayerStore((s) => s.autoDjConfig.enabled)
  const shuffle = usePlayerStore((s) => s.shuffle)
  const repeatMode = usePlayerStore((s) => s.repeatMode)
  const showWaveformCues = usePlayerStore((s) => s.appearanceSettings.showWaveformCues)

  const setNowPlayingOpen = usePlayerStore((s) => s.setNowPlayingOpen)
  const setNowPlayingTab = usePlayerStore((s) => s.setNowPlayingTab)
  const setMiniPlayer = usePlayerStore((s) => s.setMiniPlayer)
  const togglePlayPause = usePlayerStore((s) => s.togglePlayPause)
  const skipNext = usePlayerStore((s) => s.skipNext)
  const previousTrack = usePlayerStore((s) => s.previousTrack)
  const seek = usePlayerStore((s) => s.seek)
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle)
  const cycleRepeatMode = usePlayerStore((s) => s.cycleRepeatMode)
  const toggleAutoDj = usePlayerStore((s) => s.toggleAutoDj)
  const triggerManualCrossfade = usePlayerStore((s) => s.triggerManualCrossfade)
  const toggleTrackLike = useLibraryStore((s) => s.toggleTrackLike)

  if (!open) return null

  const activeDeck = telemetry.decks[telemetry.activeDeckId]
  const duration = activeDeck.duration || activeTrack?.duration || 0
  const currentTime = activeDeck.currentTime || 0

  return (
    <div className="fixed inset-x-0 top-11 bottom-0 z-40 flex flex-col overflow-hidden bg-obsidian/95 accent-ambient-bg backdrop-blur-3xl">
      {/* Top Overlay Header */}
      <div className="flex items-center justify-between border-b border-white/[0.07] px-6 py-3">
        <div className="inline-flex rounded-xl border border-white/10 bg-black/30 p-1">
          <button
            type="button"
            onClick={() => setNowPlayingTab('visualizer')}
            className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all ${
              tab === 'visualizer'
                ? 'bg-accent text-white shadow-glow'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span>Now Playing</span>
          </button>

          <button
            type="button"
            onClick={() => setNowPlayingTab('lyrics')}
            className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all ${
              tab === 'lyrics'
                ? 'bg-accent text-white shadow-glow'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Mic2 className="h-3.5 w-3.5" />
            <span>Lyrics</span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          {activeTrack && (
            <button
              type="button"
              onClick={() => void toggleTrackLike(activeTrack.id)}
              title="Toggle Liked Song (H)"
              aria-label={
                activeTrack.isLiked ? 'Remove from Liked Songs' : 'Save to Liked Songs'
              }
              className={`inline-flex h-8 items-center gap-1.5 rounded-xl border px-3 text-xs transition-colors ${
                activeTrack.isLiked
                  ? 'border-rose-500/40 bg-rose-500/15 text-rose-300 hover:bg-rose-500/25'
                  : 'border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/10 hover:text-white'
              }`}
            >
              <Heart
                className={`h-3.5 w-3.5 ${activeTrack.isLiked ? 'fill-rose-400 text-rose-400' : ''}`}
              />
              <span>{activeTrack.isLiked ? 'Liked' : 'Like'}</span>
            </button>
          )}

          {activeTrack && (
            <button
              type="button"
              onClick={() => useLibraryStore.getState().openTrackInfo(activeTrack)}
              title="Track Info & Edit Metadata (I)"
              className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-xs text-slate-300 hover:bg-white/10 hover:text-white transition-colors"
            >
              <Info className="h-3.5 w-3.5" />
              <span>Track Info</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => void setMiniPlayer(true)}
            title="Switch to Mini-Player"
            className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-xs text-slate-300 hover:bg-white/10 hover:text-white transition-colors"
          >
            <PictureInPicture2 className="h-3.5 w-3.5" />
            <span>Mini-Player</span>
          </button>

          <button
            type="button"
            onClick={() => setNowPlayingOpen(false)}
            title="Close overlay (Esc)"
            className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.05] px-3 text-xs font-medium text-slate-200 hover:bg-white/10 hover:text-white transition-colors"
          >
            <ChevronDown className="h-4 w-4" />
            <span>Minimize</span>
          </button>
        </div>
      </div>

      {/* Main Content Split */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Stage */}
        <div
          className={`flex-1 p-6 ${
            tab === 'lyrics' ? 'flex flex-col overflow-hidden' : 'overflow-y-auto'
          }`}
        >
          {tab === 'lyrics' ? (
            <LyricsPanel />
          ) : (
            <div className="mx-auto flex h-full max-w-3xl flex-col justify-between gap-6">
              {/* Centerpiece Artwork + Track Info + DSP Pills */}
              <div className="flex flex-col items-center gap-6 pt-2 md:flex-row md:items-end">
                <div className="relative shrink-0">
                  <div
                    className="absolute -inset-4 rounded-3xl opacity-45 blur-2xl transition-opacity duration-500"
                    style={{
                      background:
                        'radial-gradient(circle, rgb(var(--accent-rgb) / 0.65), rgb(var(--accent-glow-rgb) / 0.35), transparent 70%)'
                    }}
                  />
                  <ArtworkCover
                    artworkPath={activeTrack?.artworkPath}
                    alt={activeTrack?.album || 'Now Playing'}
                    className="relative h-56 w-56 shadow-2xl md:h-64 md:w-64"
                    iconClassName="h-20 w-20"
                    roundedClassName="rounded-3xl"
                  />
                </div>

                <div className="min-w-0 flex-1 text-center md:text-left">
                  <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-accentGlow">
                    <Radio className="h-3 w-3" />
                    <span>
                      Deck {telemetry.activeDeckId} ·{' '}
                      {autoDjEnabled
                        ? 'Auto-Mix Active'
                        : `Normal Mode${shuffle ? ' · Shuffle' : ''}${
                            repeatMode === 'all'
                              ? ' · Repeat All'
                              : repeatMode === 'one'
                                ? ' · Repeat One'
                                : ''
                          }`}
                    </span>
                  </div>

                  <h1 className="mt-3 truncate text-2xl font-bold tracking-tight text-white md:text-3xl">
                    {activeTrack?.title ?? 'No Track Selected'}
                  </h1>
                  <p className="mt-1 truncate text-base font-medium text-slate-300">
                    {activeTrack?.artist ?? 'Choose a song from your library to play'}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-slate-400">
                    {activeTrack?.album ?? ''}
                    {activeTrack?.year ? ` · ${activeTrack.year}` : ''}
                    {activeTrack?.genre ? ` · ${activeTrack.genre}` : ''}
                  </p>

                  {/* Track DSP Pills */}
                  {activeTrack && (
                    <div className="mt-4 flex flex-wrap items-center justify-center gap-2 md:justify-start">
                      <span className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.05] px-2.5 py-1 font-mono text-xs text-slate-100">
                        <Gauge className="h-3.5 w-3.5 text-accentGlow" />
                        <span>{formatBpm(activeTrack.bpm)} BPM</span>
                        {activeTrack.bpmSource && (
                          <span className="text-[9px] uppercase text-slate-400">
                            ({activeTrack.bpmSource})
                          </span>
                        )}
                      </span>

                      <KeyBadge
                        camelotKey={activeTrack.camelotKey}
                        musicalKey={activeTrack.musicalKey}
                        showMusicalName
                        size="md"
                      />

                      <div className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.05] px-2.5 py-1">
                        <span className="text-[10px] uppercase tracking-wider text-slate-400">
                          Energy
                        </span>
                        <EnergyMeter energy={activeTrack.energy} size="md" />
                      </div>

                      <span className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.05] px-2.5 py-1 font-mono text-xs text-slate-300">
                        <Volume2 className="h-3.5 w-3.5 text-slate-400" />
                        RG {formatReplayGain(activeTrack.replaygainDb)}
                      </span>

                      <span className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.05] px-2.5 py-1 font-mono text-xs uppercase text-slate-300">
                        <Disc3 className="h-3.5 w-3.5 text-slate-400" />
                        {activeTrack.format}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* 60fps AnalyserNode Spectrum Visualizer */}
              <div className="rounded-2xl glass-panel p-4">
                <SpectrumVisualizer height={116} barCount={64} />
              </div>

              {/* Full Scrubber + Transport */}
              <div className="rounded-2xl glass-panel p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <span className="w-11 text-right font-mono text-xs tabular-nums text-slate-400">
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
                    height={52}
                    className="flex-1"
                  />
                  <span className="w-11 font-mono text-xs tabular-nums text-slate-400">
                    {formatDuration(duration)}
                  </span>
                </div>

                <div className="flex flex-wrap items-center justify-center gap-3">
                  <button
                    type="button"
                    onClick={toggleShuffle}
                    title={shuffle ? 'Shuffle: On (S)' : 'Shuffle: Off (S)'}
                    aria-label="Toggle shuffle"
                    className={`flex h-9 w-9 items-center justify-center rounded-full border transition-colors ${
                      shuffle
                        ? 'border-accent/45 bg-accent/20 text-accentGlow'
                        : 'border-white/10 bg-white/[0.04] text-slate-400 hover:bg-white/10 hover:text-white'
                    } ${autoDjEnabled ? 'opacity-45' : ''}`}
                  >
                    <Shuffle className="h-4 w-4" />
                  </button>

                  <button
                    type="button"
                    onClick={() => void previousTrack()}
                    className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-slate-200 hover:bg-white/10 hover:text-white transition-colors"
                  >
                    <SkipBack className="h-4 w-4" />
                  </button>

                  <button
                    type="button"
                    onClick={() => void togglePlayPause()}
                    className="flex h-12 w-12 items-center justify-center rounded-full bg-accent text-white shadow-glow hover:brightness-110 active:scale-95 transition-all"
                  >
                    {isPlaying ? (
                      <Pause className="h-5 w-5" />
                    ) : (
                      <Play className="ml-0.5 h-5 w-5" />
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => void skipNext()}
                    className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-slate-200 hover:bg-white/10 hover:text-white transition-colors"
                  >
                    <SkipForward className="h-4 w-4" />
                  </button>

                  <button
                    type="button"
                    onClick={cycleRepeatMode}
                    title={`Repeat: ${repeatMode} (R)`}
                    aria-label={`Repeat mode: ${repeatMode}`}
                    className={`flex h-9 w-9 items-center justify-center rounded-full border transition-colors ${
                      repeatMode !== 'off'
                        ? 'border-accent/45 bg-accent/20 text-accentGlow'
                        : 'border-white/10 bg-white/[0.04] text-slate-400 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    {repeatMode === 'one' ? (
                      <Repeat1 className="h-4 w-4" />
                    ) : (
                      <Repeat className="h-4 w-4" />
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={toggleAutoDj}
                    className={`ml-1 inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-xs font-semibold transition-all ${
                      autoDjEnabled
                        ? 'border-accent/50 bg-accent/20 text-white shadow-glow'
                        : 'border-white/10 bg-white/[0.04] text-slate-300 hover:text-white'
                    }`}
                  >
                    <Radio
                      className={`h-3.5 w-3.5 ${autoDjEnabled ? 'text-accentGlow animate-pulse' : ''}`}
                    />
                    <span>Auto-Mix</span>
                  </button>

                  {autoDjEnabled && (
                    <button
                      type="button"
                      onClick={() => void triggerManualCrossfade()}
                      className="inline-flex h-9 items-center gap-2 rounded-full border border-accent/40 bg-accent/15 px-4 text-xs font-semibold text-white hover:bg-accent/25 transition-colors"
                    >
                      <Wand2 className="h-3.5 w-3.5 text-accentGlow" />
                      <span>Mix Next</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Transparent Auto-DJ Queue */}
        <aside className="hidden w-96 shrink-0 border-l border-white/[0.07] bg-surface/45 lg:flex lg:flex-col">
          <AutoDjQueuePanel compact showDeckControls={false} />
        </aside>
      </div>
    </div>
  )
}
