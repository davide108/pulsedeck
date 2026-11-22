import { getCamelotCompatibility } from '../../../shared/camelot'
import type {
  DeckEqState,
  DeckId,
  DeckTelemetry,
  MixStyle,
  TrackRecord,
  TransitionTelemetry
} from '../../../shared/types'

export interface CrossfadeOptions {
  style: MixStyle
  durationSec: number
  tempoMatchEnabled?: boolean
  tempoMatchMaxPct?: number
  startOffsetSec?: number
}

export interface EngineError {
  track: TrackRecord | null
  deckId: DeckId
  code: 'MISSING_FILE' | 'LOAD_ERROR' | 'DECODE_ERROR' | 'PLAYBACK_ERROR'
  message: string
}

export interface EngineTelemetrySnapshot {
  activeDeckId: DeckId
  decks: Record<DeckId, DeckTelemetry>
  transition: TransitionTelemetry
}

interface RateRampState {
  startTime: number
  endTime: number
  startRate: number
  endRate: number
}

interface InternalDeckState {
  deckId: DeckId
  track: TrackRecord | null
  buffer: AudioBuffer | null
  source: AudioBufferSourceNode | null
  status: DeckTelemetry['status']
  duration: number
  playheadPosSec: number
  lastSyncAudioTime: number
  playbackRate: number
  rateRamp: RateRampState | null
  crossfadeTargetGain: number
  normalizationGain: number
  eq: DeckEqState
  lowEq: BiquadFilterNode
  midEq: BiquadFilterNode
  highEq: BiquadFilterNode
  normGain: GainNode
  crossfadeGain: GainNode
  loadController: AbortController | null
  loadSeq: number
}

interface ActiveTransitionState {
  active: boolean
  style: MixStyle
  startTime: number
  durationSec: number
  fromDeck: DeckId
  toDeck: DeckId
  bpmDeltaPct: number | null
  tempoMatched: boolean
  keyCompatibilityLabel: string | null
  fromInitialLowEq: number
  timerId: ReturnType<typeof setTimeout> | null
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function dbToLinear(db: number): number {
  return Math.pow(10, db / 20)
}

function resetAudioParam(param: AudioParam, now: number, value?: number): void {
  if (typeof param.cancelAndHoldAtTime === 'function') {
    param.cancelAndHoldAtTime(now)
  }
  param.cancelScheduledValues(now)
  if (value !== undefined) {
    param.setValueAtTime(value, now)
  }
}

function buildEqualPowerCurves(points = 64): { outCurve: Float32Array; inCurve: Float32Array } {
  const outCurve = new Float32Array(points)
  const inCurve = new Float32Array(points)
  const denom = points - 1
  for (let i = 0; i < points; i++) {
    const t = i / denom
    outCurve[i] = Math.cos(t * Math.PI * 0.5)
    inCurve[i] = Math.sin(t * Math.PI * 0.5)
  }
  return { outCurve, inCurve }
}

const EQUAL_POWER_CURVES = buildEqualPowerCurves(64)

function integrateRateOverInterval(
  t0: number,
  t1: number,
  baseRate: number,
  ramp: RateRampState | null
): { deltaTrackSec: number; endRate: number } {
  if (t1 <= t0) {
    return { deltaTrackSec: 0, endRate: baseRate }
  }
  if (!ramp) {
    return { deltaTrackSec: (t1 - t0) * baseRate, endRate: baseRate }
  }

  const rateAt = (t: number): number => {
    if (t <= ramp.startTime) return ramp.startRate
    if (t >= ramp.endTime || ramp.endTime <= ramp.startTime) return ramp.endRate
    const alpha = (t - ramp.startTime) / (ramp.endTime - ramp.startTime)
    return ramp.startRate + (ramp.endRate - ramp.startRate) * alpha
  }

  let delta = 0
  const points = [t0]
  if (ramp.startTime > t0 && ramp.startTime < t1) points.push(ramp.startTime)
  if (ramp.endTime > t0 && ramp.endTime < t1) points.push(ramp.endTime)
  points.push(t1)

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]
    const b = points[i + 1]
    const rA = rateAt(a)
    const rB = rateAt(b)
    delta += ((rA + rB) * 0.5) * (b - a)
  }

  return { deltaTrackSec: delta, endRate: rateAt(t1) }
}

function computeTempoMatchRate(
  fromBpm: number | null,
  toBpm: number | null,
  maxPct: number
): { rate: number; bpmDeltaPct: number | null; tempoMatched: boolean } {
  if (!fromBpm || !toBpm || fromBpm <= 0 || toBpm <= 0 || maxPct <= 0) {
    return { rate: 1, bpmDeltaPct: null, tempoMatched: false }
  }

  const multiples = [1, 0.5, 2]
  let bestRate = 1
  let bestAbsDiff = Infinity

  for (const mult of multiples) {
    const effectiveTo = toBpm * mult
    const candidateRate = fromBpm / effectiveTo
    const diff = Math.abs(candidateRate - 1)
    if (diff < bestAbsDiff) {
      bestAbsDiff = diff
      bestRate = candidateRate
    }
  }

  const maxFraction = clamp(maxPct, 0, 8) / 100
  if (bestAbsDiff <= maxFraction && bestAbsDiff > 0.0005) {
    return {
      rate: Number(bestRate.toFixed(4)),
      bpmDeltaPct: Number(((bestRate - 1) * 100).toFixed(2)),
      tempoMatched: true
    }
  }

  if (bestAbsDiff <= 0.0005) {
    return { rate: 1, bpmDeltaPct: 0, tempoMatched: true }
  }

  return {
    rate: 1,
    bpmDeltaPct: Number(((bestRate - 1) * 100).toFixed(2)),
    tempoMatched: false
  }
}

export class DualDeckEngine {
  private ctx: AudioContext | null = null
  private masterGain: GainNode | null = null
  private limiter: DynamicsCompressorNode | null = null
  private analyser: AnalyserNode | null = null
  private decks: Record<DeckId, InternalDeckState> | null = null

  private activeDeckId: DeckId = 'A'
  private masterVolume = 0.85
  private muted = false
  private replayGainEnabled = true
  private limiterEnabled = true
  private disposed = false
  private transition: ActiveTransitionState | null = null
  private frequencyScratch: Uint8Array | null = null

  private trackEndedListeners = new Set<(track: TrackRecord, deckId: DeckId) => void>()
  private errorListeners = new Set<(error: EngineError) => void>()
  private transitionEndedListeners = new Set<(toDeck: DeckId, track: TrackRecord | null) => void>()

  onTrackEnded(listener: (track: TrackRecord, deckId: DeckId) => void): () => void {
    this.trackEndedListeners.add(listener)
    return () => {
      this.trackEndedListeners.delete(listener)
    }
  }

  onError(listener: (error: EngineError) => void): () => void {
    this.errorListeners.add(listener)
    return () => {
      this.errorListeners.delete(listener)
    }
  }

  onTransitionEnded(listener: (toDeck: DeckId, track: TrackRecord | null) => void): () => void {
    this.transitionEndedListeners.add(listener)
    return () => {
      this.transitionEndedListeners.delete(listener)
    }
  }

  private emitError(error: EngineError): void {
    for (const listener of this.errorListeners) {
      try {
        listener(error)
      } catch {
        // Ignore subscriber error
      }
    }
  }

  private emitTrackEnded(track: TrackRecord, deckId: DeckId): void {
    for (const listener of this.trackEndedListeners) {
      try {
        listener(track, deckId)
      } catch {
        // Ignore subscriber error
      }
    }
  }

  private emitTransitionEnded(toDeck: DeckId, track: TrackRecord | null): void {
    for (const listener of this.transitionEndedListeners) {
      try {
        listener(toDeck, track)
      } catch {
        // Ignore subscriber error
      }
    }
  }

  private ensureAudioGraph(): {
    ctx: AudioContext
    decks: Record<DeckId, InternalDeckState>
    masterGain: GainNode
    analyser: AnalyserNode
  } {
    if (this.disposed) {
      throw new Error('DualDeckEngine has been disposed')
    }
    if (this.ctx && this.decks && this.masterGain && this.analyser) {
      return {
        ctx: this.ctx,
        decks: this.decks,
        masterGain: this.masterGain,
        analyser: this.analyser
      }
    }

    const ctx = new AudioContext()
    const masterGain = ctx.createGain()
    masterGain.gain.setValueAtTime(this.muted ? 0 : this.masterVolume, ctx.currentTime)

    const limiter = ctx.createDynamicsCompressor()
    limiter.threshold.setValueAtTime(this.limiterEnabled ? -1 : 0, ctx.currentTime)
    limiter.knee.setValueAtTime(this.limiterEnabled ? 6 : 0, ctx.currentTime)
    limiter.ratio.setValueAtTime(this.limiterEnabled ? 12 : 1, ctx.currentTime)
    limiter.attack.setValueAtTime(0.003, ctx.currentTime)
    limiter.release.setValueAtTime(0.1, ctx.currentTime)

    const analyser = ctx.createAnalyser()
    analyser.fftSize = 2048
    analyser.smoothingTimeConstant = 0.8

    masterGain.connect(limiter)
    limiter.connect(analyser)
    analyser.connect(ctx.destination)

    const createDeck = (deckId: DeckId, initialGain: number): InternalDeckState => {
      const lowEq = ctx.createBiquadFilter()
      lowEq.type = 'lowshelf'
      lowEq.frequency.setValueAtTime(250, ctx.currentTime)
      lowEq.gain.setValueAtTime(0, ctx.currentTime)

      const midEq = ctx.createBiquadFilter()
      midEq.type = 'peaking'
      midEq.frequency.setValueAtTime(1000, ctx.currentTime)
      midEq.Q.setValueAtTime(1.0, ctx.currentTime)
      midEq.gain.setValueAtTime(0, ctx.currentTime)

      const highEq = ctx.createBiquadFilter()
      highEq.type = 'highshelf'
      highEq.frequency.setValueAtTime(4000, ctx.currentTime)
      highEq.gain.setValueAtTime(0, ctx.currentTime)

      const normGain = ctx.createGain()
      normGain.gain.setValueAtTime(1, ctx.currentTime)

      const crossfadeGain = ctx.createGain()
      crossfadeGain.gain.setValueAtTime(initialGain, ctx.currentTime)

      lowEq.connect(midEq)
      midEq.connect(highEq)
      highEq.connect(normGain)
      normGain.connect(crossfadeGain)
      crossfadeGain.connect(masterGain)

      return {
        deckId,
        track: null,
        buffer: null,
        source: null,
        status: 'idle',
        duration: 0,
        playheadPosSec: 0,
        lastSyncAudioTime: ctx.currentTime,
        playbackRate: 1,
        rateRamp: null,
        crossfadeTargetGain: initialGain,
        normalizationGain: 1,
        eq: { low: 0, mid: 0, high: 0 },
        lowEq,
        midEq,
        highEq,
        normGain,
        crossfadeGain,
        loadController: null,
        loadSeq: 0
      }
    }

    const decks: Record<DeckId, InternalDeckState> = {
      A: createDeck('A', 1),
      B: createDeck('B', 0)
    }

    this.ctx = ctx
    this.masterGain = masterGain
    this.limiter = limiter
    this.analyser = analyser
    this.decks = decks
    this.frequencyScratch = new Uint8Array(analyser.frequencyBinCount)

    return { ctx, decks, masterGain, analyser }
  }

  private async ensureRunningContext(): Promise<AudioContext> {
    const { ctx } = this.ensureAudioGraph()
    if (ctx.state === 'suspended') {
      await ctx.resume()
    }
    return ctx
  }

  private stopAndDisconnectSource(deck: InternalDeckState): void {
    const src = deck.source
    if (!src) return
    deck.source = null
    src.onended = null
    try {
      src.stop()
    } catch {
      // Source may already be stopped
    }
    try {
      src.disconnect()
    } catch {
      // Ignore disconnect errors
    }
  }

  private releaseDeckBuffer(deck: InternalDeckState): void {
    this.stopAndDisconnectSource(deck)
    deck.buffer = null
    deck.track = null
    deck.duration = 0
    deck.playheadPosSec = 0
    deck.playbackRate = 1
    deck.rateRamp = null
    deck.status = 'idle'
    deck.eq = { low: 0, mid: 0, high: 0 }
    if (this.ctx) {
      const now = this.ctx.currentTime
      resetAudioParam(deck.lowEq.gain, now, 0)
      resetAudioParam(deck.midEq.gain, now, 0)
      resetAudioParam(deck.highEq.gain, now, 0)
    }
  }

  private cancelDeckLoad(deck: InternalDeckState): void {
    deck.loadSeq++
    if (deck.loadController) {
      deck.loadController.abort()
      deck.loadController = null
    }
  }

  private async loadTrackIntoDeck(
    deck: InternalDeckState,
    track: TrackRecord,
    setLoadingStatus: boolean
  ): Promise<boolean> {
    const { ctx } = this.ensureAudioGraph()
    this.cancelDeckLoad(deck)

    const seq = deck.loadSeq
    const controller = new AbortController()
    deck.loadController = controller

    if (setLoadingStatus) {
      deck.track = track
      deck.status = 'loading'
    }

    try {
      const res = await fetch(`media://track/${track.id}`, { signal: controller.signal })
      if (controller.signal.aborted || seq !== deck.loadSeq || this.disposed) {
        return false
      }

      if (res.status === 404) {
        if (typeof window !== 'undefined' && window.api?.tracks) {
          void window.api.tracks.markMissing(track.id, true).catch(() => {})
        }
        this.emitError({
          track,
          deckId: deck.deckId,
          code: 'MISSING_FILE',
          message: `Audio file missing: ${track.title}`
        })
        if (setLoadingStatus && seq === deck.loadSeq) {
          this.releaseDeckBuffer(deck)
        }
        return false
      }

      if (!res.ok) {
        this.emitError({
          track,
          deckId: deck.deckId,
          code: 'LOAD_ERROR',
          message: `Failed to load ${track.title} (HTTP ${res.status})`
        })
        if (setLoadingStatus && seq === deck.loadSeq) {
          this.releaseDeckBuffer(deck)
        }
        return false
      }

      const arrayBuffer = await res.arrayBuffer()
      if (controller.signal.aborted || seq !== deck.loadSeq || this.disposed) {
        return false
      }

      let decoded: AudioBuffer | null = await ctx.decodeAudioData(arrayBuffer)
      if (controller.signal.aborted || seq !== deck.loadSeq || this.disposed) {
        decoded = null
        return false
      }

      this.stopAndDisconnectSource(deck)
      deck.buffer = decoded
      deck.track = track
      deck.duration = decoded.duration || track.duration
      deck.playheadPosSec = 0
      deck.lastSyncAudioTime = ctx.currentTime
      deck.playbackRate = 1
      deck.rateRamp = null

      const rgDb = clamp(track.replaygainDb ?? 0, -12, 12)
      const norm = this.replayGainEnabled ? clamp(dbToLinear(rgDb), 0.25, 4.0) : 1
      deck.normalizationGain = Number(norm.toFixed(4))
      resetAudioParam(deck.normGain.gain, ctx.currentTime, norm)

      return true
    } catch (err) {
      if (controller.signal.aborted || seq !== deck.loadSeq || this.disposed) {
        return false
      }
      this.emitError({
        track,
        deckId: deck.deckId,
        code: 'DECODE_ERROR',
        message: err instanceof Error ? err.message : `Failed to decode ${track.title}`
      })
      if (setLoadingStatus && seq === deck.loadSeq) {
        this.releaseDeckBuffer(deck)
      }
      return false
    } finally {
      if (deck.loadController === controller) {
        deck.loadController = null
      }
    }
  }

  private startDeckSource(
    deck: InternalDeckState,
    offsetSec: number,
    playbackRate = 1,
    rateRamp: RateRampState | null = null
  ): void {
    if (!this.ctx || !deck.buffer || !deck.track) return

    this.stopAndDisconnectSource(deck)

    const ctx = this.ctx
    const now = ctx.currentTime
    const clampedOffset = clamp(offsetSec, 0, Math.max(0, deck.duration - 0.01))

    const source = ctx.createBufferSource()
    source.buffer = deck.buffer
    source.playbackRate.setValueAtTime(playbackRate, now)
    if (rateRamp) {
      source.playbackRate.setValueAtTime(rateRamp.startRate, rateRamp.startTime)
      source.playbackRate.linearRampToValueAtTime(rateRamp.endRate, rateRamp.endTime)
    }

    source.connect(deck.lowEq)

    const startedTrack = deck.track
    source.onended = () => {
      if (deck.source !== source) return
      this.stopAndDisconnectSource(deck)
      deck.playheadPosSec = deck.duration
      deck.rateRamp = null
      deck.playbackRate = 1
      deck.status = 'idle'
      deck.buffer = null
      if (!this.disposed) {
        this.emitTrackEnded(startedTrack, deck.deckId)
      }
    }

    deck.source = source
    deck.playheadPosSec = clampedOffset
    deck.lastSyncAudioTime = now
    deck.playbackRate = playbackRate
    deck.rateRamp = rateRamp

    source.start(now, clampedOffset)
  }

  private syncDeckPlayhead(deck: InternalDeckState): void {
    if (!this.ctx) return
    if (
      deck.status !== 'playing' &&
      deck.status !== 'fading-in' &&
      deck.status !== 'fading-out'
    ) {
      return
    }
    if (this.ctx.state !== 'running') {
      deck.lastSyncAudioTime = this.ctx.currentTime
      return
    }

    const now = this.ctx.currentTime
    const { deltaTrackSec, endRate } = integrateRateOverInterval(
      deck.lastSyncAudioTime,
      now,
      deck.playbackRate,
      deck.rateRamp
    )

    deck.playheadPosSec = clamp(deck.playheadPosSec + deltaTrackSec, 0, deck.duration)
    deck.lastSyncAudioTime = now
    deck.playbackRate = endRate

    if (deck.rateRamp && now >= deck.rateRamp.endTime) {
      deck.rateRamp = null
      deck.playbackRate = 1
    }
  }

  private finalizeTransition(): void {
    if (!this.transition || !this.decks || !this.ctx) return
    const tr = this.transition
    this.transition = null
    if (tr.timerId) {
      clearTimeout(tr.timerId)
    }

    const fromDeck = this.decks[tr.fromDeck]
    const toDeck = this.decks[tr.toDeck]
    const now = this.ctx.currentTime

    // Release outgoing deck source & AudioBuffer immediately
    resetAudioParam(fromDeck.crossfadeGain.gain, now, 0)
    fromDeck.crossfadeTargetGain = 0
    this.releaseDeckBuffer(fromDeck)

    // Ensure incoming deck is cleanly settled at full gain and nominal EQ
    resetAudioParam(toDeck.crossfadeGain.gain, now, 1)
    toDeck.crossfadeTargetGain = 1

    if (tr.style === 'bass-swap') {
      resetAudioParam(toDeck.lowEq.gain, now, 0)
      toDeck.eq.low = 0
    }

    if (toDeck.status === 'fading-in') {
      toDeck.status = 'playing'
    }

    this.emitTransitionEnded(tr.toDeck, toDeck.track)
  }

  private syncTransition(): void {
    if (!this.transition || !this.ctx) return
    if (this.ctx.currentTime >= this.transition.startTime + this.transition.durationSec) {
      this.finalizeTransition()
    }
  }

  async playTrackImmediate(track: TrackRecord, offsetSec = 0): Promise<boolean> {
    if (this.disposed) return false
    const ctx = await this.ensureRunningContext()
    const decks = this.decks!

    // Cancel any active transition immediately
    if (this.transition) {
      this.finalizeTransition()
    }

    const targetDeckId = this.activeDeckId
    const standbyDeckId: DeckId = targetDeckId === 'A' ? 'B' : 'A'
    const targetDeck = decks[targetDeckId]
    const standbyDeck = decks[standbyDeckId]

    // Ensure standby is completely quiet and released if it had an old buffer
    this.cancelDeckLoad(standbyDeck)
    resetAudioParam(standbyDeck.crossfadeGain.gain, ctx.currentTime, 0)
    standbyDeck.crossfadeTargetGain = 0
    if (standbyDeck.source || standbyDeck.buffer) {
      this.releaseDeckBuffer(standbyDeck)
    }

    // Reuse already-decoded buffer if playing the exact same track on targetDeck
    const alreadyLoaded = targetDeck.track?.id === track.id && targetDeck.buffer !== null
    if (!alreadyLoaded) {
      const ok = await this.loadTrackIntoDeck(targetDeck, track, true)
      if (!ok) return false
    }

    const now = ctx.currentTime
    resetAudioParam(targetDeck.crossfadeGain.gain, now, 1)
    targetDeck.crossfadeTargetGain = 1
    resetAudioParam(targetDeck.lowEq.gain, now, targetDeck.eq.low)
    resetAudioParam(targetDeck.midEq.gain, now, targetDeck.eq.mid)
    resetAudioParam(targetDeck.highEq.gain, now, targetDeck.eq.high)

    targetDeck.status = 'playing'
    this.startDeckSource(targetDeck, offsetSec, 1, null)
    return true
  }

  async preloadStandby(track: TrackRecord): Promise<boolean> {
    if (this.disposed) return false
    const { decks } = this.ensureAudioGraph()
    const standbyId: DeckId = this.activeDeckId === 'A' ? 'B' : 'A'
    const standbyDeck = decks[standbyId]

    if (standbyDeck.track?.id === track.id && standbyDeck.buffer !== null) {
      return true
    }
    if (standbyDeck.status === 'fading-out' || standbyDeck.status === 'fading-in') {
      return false
    }

    const ok = await this.loadTrackIntoDeck(standbyDeck, track, false)
    if (ok) {
      standbyDeck.status = 'idle'
    }
    return ok
  }

  async crossfadeTo(targetTrack: TrackRecord, options: CrossfadeOptions): Promise<boolean> {
    if (this.disposed) return false
    const ctx = await this.ensureRunningContext()
    const decks = this.decks!

    const currentActive = decks[this.activeDeckId]
    this.syncDeckPlayhead(currentActive)

    // If nothing is currently loaded/playing, start immediately
    if (!currentActive.track || !currentActive.buffer || currentActive.status === 'idle') {
      return this.playTrackImmediate(targetTrack, options.startOffsetSec ?? 0)
    }

    // If a previous transition is still running, finish it first so decks swap cleanly
    if (this.transition) {
      this.finalizeTransition()
    }

    const fromDeckId = this.activeDeckId
    const toDeckId: DeckId = fromDeckId === 'A' ? 'B' : 'A'
    const fromDeck = decks[fromDeckId]
    const toDeck = decks[toDeckId]

    const alreadyPreloaded = toDeck.track?.id === targetTrack.id && toDeck.buffer !== null
    if (!alreadyPreloaded) {
      const ok = await this.loadTrackIntoDeck(toDeck, targetTrack, true)
      if (!ok) {
        return false
      }
    }

    // Resume fromDeck if it was paused so crossfade actually mixes out smoothly
    if (fromDeck.status === 'paused' && fromDeck.buffer) {
      this.startDeckSource(fromDeck, fromDeck.playheadPosSec, fromDeck.playbackRate, fromDeck.rateRamp)
    }

    this.syncDeckPlayhead(fromDeck)
    const now = ctx.currentTime
    const startOffset = clamp(options.startOffsetSec ?? 0, 0, Math.max(0, toDeck.duration - 0.5))

    let mixDuration = options.style === 'quick-cut' ? 0.5 : Math.max(0.5, options.durationSec)
    const incomingAvailable = Math.max(0.25, toDeck.duration - startOffset)
    const outgoingRemaining = Math.max(0.25, fromDeck.duration - fromDeck.playheadPosSec)
    mixDuration = Math.min(mixDuration, incomingAvailable, outgoingRemaining)
    mixDuration = Math.max(0.2, mixDuration)

    // Tempo match during overlap + 6s post-mix glide back to 1.0
    const tempoMatchEnabled = options.tempoMatchEnabled ?? true
    const maxPct = options.tempoMatchMaxPct ?? 8
    const tempoInfo = tempoMatchEnabled
      ? computeTempoMatchRate(fromDeck.track?.bpm ?? null, targetTrack.bpm, maxPct)
      : { rate: 1, bpmDeltaPct: null, tempoMatched: false }

    const initialToRate = tempoInfo.tempoMatched ? tempoInfo.rate : 1
    let rateRamp: RateRampState | null = null
    if (tempoInfo.tempoMatched && Math.abs(initialToRate - 1) > 0.0005) {
      const glideStart = now + mixDuration
      const glideEnd = glideStart + 6.0
      rateRamp = {
        startTime: glideStart,
        endTime: glideEnd,
        startRate: initialToRate,
        endRate: 1.0
      }
    }

    // Schedule crossfade gains (64-pt Equal-Power curve)
    resetAudioParam(fromDeck.crossfadeGain.gain, now)
    fromDeck.crossfadeGain.gain.setValueCurveAtTime(EQUAL_POWER_CURVES.outCurve, now, mixDuration)
    fromDeck.crossfadeTargetGain = 0

    resetAudioParam(toDeck.crossfadeGain.gain, now)
    toDeck.crossfadeGain.gain.setValueCurveAtTime(EQUAL_POWER_CURVES.inCurve, now, mixDuration)
    toDeck.crossfadeTargetGain = 1

    const fromInitialLow = fromDeck.eq.low
    resetAudioParam(toDeck.midEq.gain, now, 0)
    resetAudioParam(toDeck.highEq.gain, now, 0)
    toDeck.eq = { low: 0, mid: 0, high: 0 }

    if (options.style === 'bass-swap') {
      const t40 = now + mixDuration * 0.4
      const t60 = now + mixDuration * 0.6

      resetAudioParam(fromDeck.lowEq.gain, now, fromInitialLow)
      fromDeck.lowEq.gain.setValueAtTime(fromInitialLow, t40)
      fromDeck.lowEq.gain.linearRampToValueAtTime(-24, t60)

      resetAudioParam(toDeck.lowEq.gain, now, -24)
      toDeck.lowEq.gain.setValueAtTime(-24, t40)
      toDeck.lowEq.gain.linearRampToValueAtTime(0, t60)
      toDeck.eq.low = -24
    } else {
      resetAudioParam(toDeck.lowEq.gain, now, 0)
    }

    fromDeck.status = 'fading-out'
    toDeck.status = 'fading-in'
    this.activeDeckId = toDeckId

    this.startDeckSource(toDeck, startOffset, initialToRate, rateRamp)

    const harm = getCamelotCompatibility(fromDeck.track?.camelotKey ?? null, targetTrack.camelotKey)
    const keyLabel =
      fromDeck.track?.camelotKey && targetTrack.camelotKey
        ? `${fromDeck.track.camelotKey} → ${targetTrack.camelotKey} (${harm.relation})`
        : targetTrack.camelotKey ?? null

    const timerId = setTimeout(() => {
      if (!this.disposed) {
        this.finalizeTransition()
      }
    }, Math.ceil((mixDuration + 0.05) * 1000))

    this.transition = {
      active: true,
      style: options.style,
      startTime: now,
      durationSec: mixDuration,
      fromDeck: fromDeckId,
      toDeck: toDeckId,
      bpmDeltaPct: tempoInfo.bpmDeltaPct,
      tempoMatched: tempoInfo.tempoMatched,
      keyCompatibilityLabel: keyLabel,
      fromInitialLowEq: fromInitialLow,
      timerId
    }

    return true
  }

  async pause(): Promise<void> {
    if (this.disposed || !this.ctx || !this.decks) return

    if (this.transition) {
      this.syncDeckPlayhead(this.decks.A)
      this.syncDeckPlayhead(this.decks.B)
      if (this.transition.timerId) {
        clearTimeout(this.transition.timerId)
        this.transition.timerId = null
      }
      if (this.ctx.state === 'running') {
        await this.ctx.suspend()
      }
      return
    }

    const active = this.decks[this.activeDeckId]
    if (active.status === 'playing') {
      this.syncDeckPlayhead(active)
      this.stopAndDisconnectSource(active)
      active.status = 'paused'
    }
  }

  async resume(): Promise<void> {
    if (this.disposed || !this.ctx || !this.decks) return

    if (this.transition) {
      if (this.ctx.state === 'suspended') {
        await this.ctx.resume()
      }
      const remainingMs = Math.max(
        20,
        (this.transition.startTime + this.transition.durationSec - this.ctx.currentTime) * 1000 + 30
      )
      this.decks.A.lastSyncAudioTime = this.ctx.currentTime
      this.decks.B.lastSyncAudioTime = this.ctx.currentTime
      this.transition.timerId = setTimeout(() => {
        if (!this.disposed) {
          this.finalizeTransition()
        }
      }, remainingMs)
      return
    }

    await this.ensureRunningContext()
    const active = this.decks[this.activeDeckId]
    if (active.status === 'paused' && active.buffer && active.track) {
      active.status = 'playing'
      this.startDeckSource(active, active.playheadPosSec, active.playbackRate, active.rateRamp)
    }
  }

  seek(positionSec: number): void {
    if (this.disposed || !this.decks) return
    const active = this.decks[this.activeDeckId]
    if (!active.buffer || !active.track) return

    const wasPausedDuringTransition = Boolean(this.transition && this.ctx?.state === 'suspended')
    if (this.transition) {
      this.finalizeTransition()
      if (this.ctx?.state === 'suspended') {
        void this.ctx.resume()
      }
      if (wasPausedDuringTransition) {
        active.status = 'paused'
      }
    }

    const clamped = clamp(positionSec, 0, Math.max(0, active.duration - 0.05))
    active.playheadPosSec = clamped

    if (active.status === 'playing' || active.status === 'fading-in') {
      active.status = 'playing'
      this.startDeckSource(active, clamped, active.playbackRate, active.rateRamp)
    }
  }

  setMasterVolume(volume: number): void {
    this.masterVolume = clamp(volume, 0, 1)
    if (this.ctx && this.masterGain) {
      const now = this.ctx.currentTime
      this.masterGain.gain.setTargetAtTime(this.muted ? 0 : this.masterVolume, now, 0.015)
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted
    if (this.ctx && this.masterGain) {
      const now = this.ctx.currentTime
      this.masterGain.gain.setTargetAtTime(this.muted ? 0 : this.masterVolume, now, 0.015)
    }
  }

  setDeckEq(deckId: DeckId, band: keyof DeckEqState, gainDb: number): void {
    const clampedDb = clamp(gainDb, -24, 12)
    if (!this.decks || !this.ctx) return
    const deck = this.decks[deckId]
    deck.eq[band] = clampedDb
    const now = this.ctx.currentTime
    const node = band === 'low' ? deck.lowEq : band === 'mid' ? deck.midEq : deck.highEq
    node.gain.setTargetAtTime(clampedDb, now, 0.015)
  }

  resetAllDeckEq(): void {
    for (const deckId of ['A', 'B'] as const) {
      this.setDeckEq(deckId, 'low', 0)
      this.setDeckEq(deckId, 'mid', 0)
      this.setDeckEq(deckId, 'high', 0)
    }
  }

  setReplayGainEnabled(enabled: boolean): void {
    this.replayGainEnabled = enabled
    if (!this.ctx || !this.decks) return
    const now = this.ctx.currentTime
    for (const deck of [this.decks.A, this.decks.B]) {
      const rgDb = clamp(deck.track?.replaygainDb ?? 0, -12, 12)
      const norm =
        enabled && deck.track ? clamp(dbToLinear(rgDb), 0.25, 4.0) : 1
      deck.normalizationGain = Number(norm.toFixed(4))
      deck.normGain.gain.setTargetAtTime(norm, now, 0.02)
    }
  }

  setLimiterEnabled(enabled: boolean): void {
    this.limiterEnabled = enabled
    if (!this.ctx || !this.limiter) return
    const now = this.ctx.currentTime
    this.limiter.threshold.setTargetAtTime(enabled ? -1 : 0, now, 0.015)
    this.limiter.knee.setTargetAtTime(enabled ? 6 : 0, now, 0.015)
    this.limiter.ratio.setTargetAtTime(enabled ? 12 : 1, now, 0.015)
  }

  getActiveDeckId(): DeckId {
    return this.activeDeckId
  }

  getActiveTrack(): TrackRecord | null {
    if (!this.decks) return null
    return this.decks[this.activeDeckId].track
  }

  getFrequencyData(target?: Uint8Array): Uint8Array {
    if (!this.analyser) {
      return target ?? new Uint8Array(1024)
    }
    const out =
      target && target.length >= this.analyser.frequencyBinCount
        ? target
        : (this.frequencyScratch ?? new Uint8Array(this.analyser.frequencyBinCount))
    this.analyser.getByteFrequencyData(
      out as unknown as Parameters<AnalyserNode['getByteFrequencyData']>[0]
    )
    return out
  }

  getTelemetry(): EngineTelemetrySnapshot {
    if (!this.decks || !this.ctx) {
      const emptyDeck = (deckId: DeckId, gain: number): DeckTelemetry => ({
        deckId,
        track: null,
        status: 'idle',
        currentTime: 0,
        duration: 0,
        playbackRate: 1,
        crossfadeGain: gain,
        normalizationGain: 1,
        eq: { low: 0, mid: 0, high: 0 }
      })
      return {
        activeDeckId: this.activeDeckId,
        decks: {
          A: emptyDeck('A', 1),
          B: emptyDeck('B', 0)
        },
        transition: {
          active: false,
          style: 'equal-power',
          progress: 0,
          durationSec: 0,
          fromDeck: 'A',
          toDeck: 'B',
          bpmDeltaPct: null,
          tempoMatched: false,
          keyCompatibilityLabel: null
        }
      }
    }

    this.syncDeckPlayhead(this.decks.A)
    this.syncDeckPlayhead(this.decks.B)
    this.syncTransition()

    const now = this.ctx.currentTime
    const tr = this.transition
    const progress =
      tr && tr.durationSec > 0 ? clamp((now - tr.startTime) / tr.durationSec, 0, 1) : 0

    const computeDeckTelemetry = (deck: InternalDeckState): DeckTelemetry => {
      let cfGain = deck.crossfadeTargetGain
      const eq: DeckEqState = { ...deck.eq }

      if (tr) {
        if (deck.deckId === tr.fromDeck) {
          cfGain = Math.cos(progress * Math.PI * 0.5)
          if (tr.style === 'bass-swap') {
            if (progress < 0.4) eq.low = tr.fromInitialLowEq
            else if (progress >= 0.6) eq.low = -24
            else {
              const alpha = (progress - 0.4) / 0.2
              eq.low = tr.fromInitialLowEq + (-24 - tr.fromInitialLowEq) * alpha
            }
          }
        } else if (deck.deckId === tr.toDeck) {
          cfGain = Math.sin(progress * Math.PI * 0.5)
          if (tr.style === 'bass-swap') {
            if (progress < 0.4) eq.low = -24
            else if (progress >= 0.6) eq.low = 0
            else {
              const alpha = (progress - 0.4) / 0.2
              eq.low = -24 + 24 * alpha
            }
          }
        }
      } else {
        cfGain = deck.deckId === this.activeDeckId ? 1 : 0
      }

      return {
        deckId: deck.deckId,
        track: deck.track,
        status: deck.status,
        currentTime: Number(deck.playheadPosSec.toFixed(3)),
        duration: Number(deck.duration.toFixed(3)),
        playbackRate: Number(deck.playbackRate.toFixed(4)),
        crossfadeGain: Number(cfGain.toFixed(3)),
        normalizationGain: deck.normalizationGain,
        eq: {
          low: Number(eq.low.toFixed(2)),
          mid: Number(eq.mid.toFixed(2)),
          high: Number(eq.high.toFixed(2))
        }
      }
    }

    return {
      activeDeckId: this.activeDeckId,
      decks: {
        A: computeDeckTelemetry(this.decks.A),
        B: computeDeckTelemetry(this.decks.B)
      },
      transition: tr
        ? {
            active: true,
            style: tr.style,
            progress: Number(progress.toFixed(3)),
            durationSec: Number(tr.durationSec.toFixed(2)),
            fromDeck: tr.fromDeck,
            toDeck: tr.toDeck,
            bpmDeltaPct: tr.bpmDeltaPct,
            tempoMatched: tr.tempoMatched,
            keyCompatibilityLabel: tr.keyCompatibilityLabel
          }
        : {
            active: false,
            style: 'equal-power',
            progress: 0,
            durationSec: 0,
            fromDeck: this.activeDeckId,
            toDeck: this.activeDeckId === 'A' ? 'B' : 'A',
            bpmDeltaPct: null,
            tempoMatched: false,
            keyCompatibilityLabel: null
          }
    }
  }

  dispose(): void {
    this.disposed = true
    if (this.transition?.timerId) {
      clearTimeout(this.transition.timerId)
      this.transition = null
    }
    if (this.decks) {
      this.cancelDeckLoad(this.decks.A)
      this.cancelDeckLoad(this.decks.B)
      this.releaseDeckBuffer(this.decks.A)
      this.releaseDeckBuffer(this.decks.B)
      for (const deck of [this.decks.A, this.decks.B]) {
        try {
          deck.lowEq.disconnect()
          deck.midEq.disconnect()
          deck.highEq.disconnect()
          deck.normGain.disconnect()
          deck.crossfadeGain.disconnect()
        } catch {
          // Ignore disconnect errors
        }
      }
      this.decks = null
    }
    try {
      this.masterGain?.disconnect()
      this.limiter?.disconnect()
      this.analyser?.disconnect()
    } catch {
      // Ignore disconnect errors
    }
    this.masterGain = null
    this.limiter = null
    this.analyser = null
    if (this.ctx) {
      void this.ctx.close().catch(() => {})
      this.ctx = null
    }
    this.trackEndedListeners.clear()
    this.errorListeners.clear()
    this.transitionEndedListeners.clear()
  }
}
