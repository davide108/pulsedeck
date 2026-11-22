import { Activity, Disc3, Gauge, Shuffle, Sliders } from 'lucide-react'
import { getCamelotCompatibility } from '@shared/camelot'
import type { DeckEqState, DeckId, DeckTelemetry, MixStyle } from '@shared/types'
import { ArtworkCover } from '@/components/common/ArtworkCover'
import { EnergyMeter } from '@/components/common/EnergyMeter'
import { KeyBadge } from '@/components/common/KeyBadge'
import { WaveformScrubber } from '@/components/player/WaveformScrubber'
import { usePlayerStore } from '@/store/usePlayerStore'
import { formatBpm, formatDuration, formatPitchShift } from '@/utils/format'

const MIX_STYLES: Array<{ id: MixStyle; label: string; hint: string }> = [
  { id: 'equal-power', label: 'Equal-Power', hint: 'Smooth cosine/sine blend' },
  { id: 'bass-swap', label: 'Bass-Swap', hint: 'EQ low-end swap at 40–60%' },
  { id: 'quick-cut', label: 'Quick Cut', hint: 'Crisp 0.5s DJ cut' }
]

const BAR_OPTIONS: Array<4 | 8 | 16> = [4, 8, 16]

function EqMeterBand({
  label,
  valueDb,
  onChange
}: {
  label: string
  valueDb: number
  onChange: (db: number) => void
}) {
  // Map -24..+12 dB -> 0..100%
  const pct = Math.max(0, Math.min(100, ((valueDb + 24) / 36) * 100))
  const isCut = valueDb < -1
  const isBoost = valueDb > 1

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[10px]">
        <span className="font-semibold uppercase tracking-wider text-slate-400">{label}</span>
        <span
          className={`font-mono tabular-nums ${
            isCut ? 'text-rose-300' : isBoost ? 'text-accentGlow' : 'text-slate-300'
          }`}
        >
          {valueDb > 0 ? `+${valueDb.toFixed(1)}` : valueDb.toFixed(1)} dB
        </span>
      </div>
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-full rounded-full transition-all duration-75 ${
            isCut
              ? 'bg-rose-400/80'
              : isBoost
                ? 'bg-accentGlow'
                : 'bg-gradient-to-r from-accent to-accentGlow'
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
          aria-label={`${label} EQ gain`}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </div>
    </div>
  )
}

function DeckCard({
  deck,
  isActiveDeck,
  isTransitioning,
  showCueMarkers,
  onSeek,
  onEqChange
}: {
  deck: DeckTelemetry
  isActiveDeck: boolean
  isTransitioning: boolean
  showCueMarkers: boolean
  onSeek: (sec: number) => void
  onEqChange: (band: keyof DeckEqState, db: number) => void
}) {
  const track = deck.track
  const hasShift = Math.abs(deck.playbackRate - 1) > 0.001

  const statusBadge =
    deck.status === 'fading-in'
      ? { text: 'MIXING IN', cls: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' }
      : deck.status === 'fading-out'
        ? { text: 'MIXING OUT', cls: 'bg-amber-500/20 text-amber-300 border-amber-500/40' }
        : deck.status === 'playing'
          ? { text: 'ON AIR', cls: 'bg-accent/25 text-accentGlow border-accent/50' }
          : deck.status === 'paused'
            ? { text: 'PAUSED', cls: 'bg-white/10 text-slate-300 border-white/15' }
            : deck.status === 'loading'
              ? { text: 'LOADING', cls: 'bg-sky-500/20 text-sky-300 border-sky-500/40' }
              : track
                ? { text: 'CUED', cls: 'bg-white/10 text-slate-300 border-white/15' }
                : { text: 'IDLE', cls: 'bg-white/[0.04] text-slate-500 border-white/10' }

  const effectiveBpm =
    track?.bpm && track.bpm > 0 ? (track.bpm * deck.playbackRate).toFixed(1) : null

  return (
    <div
      className={`rounded-2xl glass-panel p-4 transition-all ${
        isActiveDeck
          ? 'border-accent/45 shadow-glow'
          : deck.status === 'fading-out'
            ? 'border-amber-500/35'
            : 'border-white/[0.08]'
      }`}
    >
      {/* Deck Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={`flex h-6 items-center rounded-lg px-2 font-mono text-xs font-bold ${
              deck.deckId === 'A'
                ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-400/30'
                : 'bg-cyan-500/20 text-cyan-300 border border-cyan-400/30'
            }`}
          >
            DECK {deck.deckId}
          </span>
          <span
            className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wider ${statusBadge.cls}`}
          >
            {statusBadge.text}
          </span>
        </div>

        <div className="flex items-center gap-2 font-mono text-[11px] tabular-nums">
          <span className="text-slate-400">
            Gain <strong className="text-slate-200">{Math.round(deck.crossfadeGain * 100)}%</strong>
          </span>
          {track && (
            <span className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-slate-300">
              RG {deck.normalizationGain.toFixed(2)}x
            </span>
          )}
        </div>
      </div>

      {/* Track Info + BPM / Pitch / Key */}
      <div className="mt-3 flex items-center gap-3">
        <ArtworkCover
          artworkPath={track?.artworkPath}
          alt={track?.album || `Deck ${deck.deckId}`}
          className="h-14 w-14"
          iconClassName="h-6 w-6"
          roundedClassName="rounded-xl"
        />

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white">
            {track?.title ?? `Deck ${deck.deckId} Empty`}
          </p>
          <p className="truncate text-xs text-slate-400">
            {track?.artist ?? 'Waiting for next Auto-DJ or manual track'}
          </p>

          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.05] px-2 py-0.5 font-mono text-[11px] text-white">
              <Gauge className="h-3 w-3 text-accentGlow" />
              {effectiveBpm ? `${effectiveBpm} BPM` : `${formatBpm(track?.bpm)} BPM`}
            </span>

            <span
              className={`rounded-md border px-1.5 py-0.5 font-mono text-[10px] tabular-nums ${
                hasShift
                  ? 'border-accentGlow/45 bg-accentGlow/15 text-accentGlow font-semibold'
                  : 'border-white/10 bg-white/[0.04] text-slate-400'
              }`}
              title={`Playback rate: ${deck.playbackRate.toFixed(4)}x`}
            >
              {deck.playbackRate.toFixed(3)}x ({formatPitchShift(deck.playbackRate)})
            </span>

            <KeyBadge camelotKey={track?.camelotKey ?? null} showMusicalName size="xs" />
            {track && <EnergyMeter energy={track.energy} showValue={false} />}
          </div>
        </div>
      </div>

      {/* Parallel Live Waveform */}
      <div className="mt-3.5 rounded-xl border border-white/[0.07] bg-black/35 p-2.5">
        <WaveformScrubber
          peaks={track?.waveformPeaks}
          duration={deck.duration || track?.duration || 0}
          currentTime={deck.currentTime}
          introCueSec={track?.introCueSec}
          outroCueSec={track?.outroCueSec}
          showCueMarkers={showCueMarkers}
          interactive={Boolean(track && isActiveDeck && !isTransitioning)}
          onSeek={onSeek}
          height={58}
          accentColorRgb={deck.deckId === 'A' ? '129 140 248' : '34 211 238'}
        />
        <div className="mt-1.5 flex justify-between font-mono text-[10px] tabular-nums text-slate-400">
          <span>{formatDuration(deck.currentTime)}</span>
          <span>
            -{formatDuration(Math.max(0, (deck.duration || track?.duration || 0) - deck.currentTime))}
          </span>
        </div>
      </div>

      {/* Live 3-Band EQ Meters */}
      <div className="mt-3 grid grid-cols-3 gap-3 rounded-xl border border-white/[0.07] bg-white/[0.025] p-3">
        <EqMeterBand
          label="Low"
          valueDb={deck.eq.low}
          onChange={(db) => onEqChange('low', db)}
        />
        <EqMeterBand
          label="Mid"
          valueDb={deck.eq.mid}
          onChange={(db) => onEqChange('mid', db)}
        />
        <EqMeterBand
          label="High"
          valueDb={deck.eq.high}
          onChange={(db) => onEqChange('high', db)}
        />
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
  const seek = usePlayerStore((s) => s.seek)
  const setDeckEq = usePlayerStore((s) => s.setDeckEq)
  const triggerManualCrossfade = usePlayerStore((s) => s.triggerManualCrossfade)

  const deckA = telemetry.decks.A
  const deckB = telemetry.decks.B
  const tr = telemetry.transition

  // Crossfader position 0 (Deck A) -> 1 (Deck B)
  const aPow = deckA.crossfadeGain * deckA.crossfadeGain
  const bPow = deckB.crossfadeGain * deckB.crossfadeGain
  const crossfaderPos = aPow + bPow > 0.0001 ? bPow / (aPow + bPow) : telemetry.activeDeckId === 'B' ? 1 : 0

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

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto pr-1">
      {/* Mix Style & Duration Controls */}
      <div className="rounded-2xl glass-panel p-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          {/* Mix Style */}
          <div className="space-y-1.5">
            <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              <Sliders className="h-3 w-3 text-accentGlow" />
              Transition Style
            </span>
            <div className="inline-flex rounded-xl border border-white/10 bg-black/30 p-1">
              {MIX_STYLES.map((style) => {
                const active = autoDjConfig.mixStyle === style.id
                return (
                  <button
                    key={style.id}
                    type="button"
                    title={style.hint}
                    onClick={() => updateAutoDjConfig({ mixStyle: style.id })}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
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
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Mix Length
              </span>
              <div className="inline-flex rounded-md border border-white/10 bg-black/30 p-0.5 text-[10px]">
                <button
                  type="button"
                  onClick={() => updateAutoDjConfig({ durationMode: 'fixed' })}
                  className={`rounded px-2 py-0.5 font-semibold ${
                    autoDjConfig.durationMode === 'fixed'
                      ? 'bg-white/15 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Seconds
                </button>
                <button
                  type="button"
                  onClick={() => updateAutoDjConfig({ durationMode: 'bars' })}
                  className={`rounded px-2 py-0.5 font-semibold ${
                    autoDjConfig.durationMode === 'bars'
                      ? 'bg-white/15 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Bars (BPM)
                </button>
              </div>
            </div>

            {autoDjConfig.durationMode === 'fixed' ? (
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={4}
                  max={16}
                  step={1}
                  disabled={autoDjConfig.mixStyle === 'quick-cut'}
                  value={autoDjConfig.durationSec}
                  onChange={(e) => updateAutoDjConfig({ durationSec: Number(e.target.value) })}
                  aria-label="Transition duration in seconds"
                  className="h-1.5 w-32 accent-indigo-400 disabled:opacity-40"
                />
                <span className="w-10 font-mono text-xs tabular-nums text-white">
                  {autoDjConfig.mixStyle === 'quick-cut' ? '0.5s' : `${autoDjConfig.durationSec}s`}
                </span>
              </div>
            ) : (
              <div className="inline-flex rounded-xl border border-white/10 bg-black/30 p-1">
                {BAR_OPTIONS.map((bars) => (
                  <button
                    key={bars}
                    type="button"
                    disabled={autoDjConfig.mixStyle === 'quick-cut'}
                    onClick={() => updateAutoDjConfig({ durationBars: bars })}
                    className={`rounded-lg px-2.5 py-1 font-mono text-xs font-semibold transition-colors disabled:opacity-40 ${
                      autoDjConfig.durationBars === bars
                        ? 'bg-accent/30 text-accentGlow'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {bars} Bars
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Tempo Match + Manual Mix Trigger */}
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() =>
                updateAutoDjConfig({ tempoMatchEnabled: !autoDjConfig.tempoMatchEnabled })
              }
              className={`inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold transition-colors ${
                autoDjConfig.tempoMatchEnabled
                  ? 'border-accentGlow/40 bg-accentGlow/15 text-accentGlow'
                  : 'border-white/10 bg-white/[0.04] text-slate-400 hover:text-white'
              }`}
              title={`Pitch-sync tracks within ±${autoDjConfig.tempoMatchMaxPct}% during overlap`}
            >
              <Activity className="h-3.5 w-3.5" />
              <span>Tempo Match ±{autoDjConfig.tempoMatchMaxPct}%</span>
            </button>

            <button
              type="button"
              onClick={() => void triggerManualCrossfade()}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-accent px-4 text-xs font-semibold text-white shadow-glow hover:brightness-110 transition-all"
            >
              <Shuffle className="h-3.5 w-3.5" />
              <span>Mix Now</span>
            </button>
          </div>
        </div>
      </div>

      {/* Parallel Deck A & Deck B */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <DeckCard
          deck={deckA}
          isActiveDeck={telemetry.activeDeckId === 'A'}
          isTransitioning={tr.active}
          showCueMarkers={showWaveformCues}
          onSeek={seek}
          onEqChange={(band, db) => setDeckEq('A', band, db)}
        />
        <DeckCard
          deck={deckB}
          isActiveDeck={telemetry.activeDeckId === 'B'}
          isTransitioning={tr.active}
          showCueMarkers={showWaveformCues}
          onSeek={seek}
          onEqChange={(band, db) => setDeckEq('B', band, db)}
        />
      </div>

      {/* Animated Crossfader & Harmonic Bridge */}
      <div className="rounded-2xl glass-panel p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2">
            <Disc3
              className={`h-4 w-4 ${
                tr.active ? 'animate-spin text-accentGlow' : 'text-slate-400'
              }`}
            />
            <span className="font-semibold text-white">
              {tr.active
                ? `Active Transition: Deck ${tr.fromDeck} → Deck ${tr.toDeck} (${Math.round(tr.progress * 100)}%)`
                : `Active Output: Deck ${telemetry.activeDeckId}`}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {tr.active && tr.bpmDeltaPct !== null && (
              <span className="rounded-full border border-accentGlow/30 bg-accentGlow/10 px-2.5 py-0.5 font-mono text-[11px] text-accentGlow">
                {tr.tempoMatched ? 'Synced' : 'Free BPM'} ({tr.bpmDeltaPct >= 0 ? '+' : ''}
                {tr.bpmDeltaPct}%)
              </span>
            )}

            <span
              className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${
                harmonicMatch.compatible
                  ? 'border-emerald-500/35 bg-emerald-500/15 text-emerald-300'
                  : 'border-white/10 bg-white/[0.05] text-slate-300'
              }`}
            >
              Harmonic: {tr.keyCompatibilityLabel ?? harmonicMatch.relation}
            </span>
          </div>
        </div>

        {/* Crossfader Track */}
        <div className="flex items-center gap-4">
          <span className="font-mono text-xs font-bold text-indigo-300">DECK A</span>
          <div className="relative flex h-8 flex-1 items-center rounded-xl border border-white/10 bg-black/40 px-3">
            <div className="h-1.5 w-full rounded-full bg-gradient-to-r from-indigo-500/50 via-white/15 to-cyan-400/50" />
            <div
              className="absolute top-1/2 h-6 w-10 -translate-x-1/2 -translate-y-1/2 rounded-lg border border-white/30 bg-gradient-to-b from-slate-100 to-slate-300 shadow-lg transition-[left] duration-75"
              style={{ left: `${Math.max(5, Math.min(95, crossfaderPos * 100))}%` }}
            >
              <div className="mx-auto mt-1.5 h-3 w-0.5 rounded-full bg-obsidian/70" />
            </div>
          </div>
          <span className="font-mono text-xs font-bold text-cyan-300">DECK B</span>
        </div>
      </div>
    </div>
  )
}
