import {
  createAutoDjSession,
  generateAutoDjQueue,
  reanchorSession,
  recordEarlySkip,
  type AutoDjSessionState
} from '../../../shared/autoDjEngine'
import {
  buildShuffleOrder,
  resolveNormalNextTrack,
  resolveNormalPreviousTrack
} from '../../../shared/playbackOrder'
import {
  DEFAULT_AUTO_DJ_CONFIG,
  type AutoDjConfig,
  type AutoDjQueueItem,
  type PlayHistoryInput,
  type RepeatMode,
  type TrackRecord
} from '../../../shared/types'
import type { DualDeckEngine } from './DualDeckEngine'

const QUEUE_TARGET_COUNT = 8
const PRELOAD_LEAD_SEC = 15
const DEFAULT_MANUAL_CROSSFADE_SEC = 1.75
const DEFAULT_EARLY_SKIP_THRESHOLD_SEC = 20

type QueueListener = (queue: AutoDjQueueItem[]) => void
type ConfigListener = (config: AutoDjConfig) => void
type ActiveTrackListener = (track: TrackRecord | null, source: 'manual' | 'autodj') => void

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export class TransitionScheduler {
  private engine: DualDeckEngine
  private config: AutoDjConfig
  private session: AutoDjSessionState
  private queue: AutoDjQueueItem[] = []
  private allTracks: TrackRecord[] = []
  private playbackList: TrackRecord[] = []
  private playlistScopedTracks: TrackRecord[] | null = null
  private historyStack: TrackRecord[] = []
  private shuffle = false
  private repeatMode: RepeatMode = 'off'
  private shuffleOrderIds: number[] = []
  private manualCrossfadeSec = DEFAULT_MANUAL_CROSSFADE_SEC
  private earlySkipThresholdSec = DEFAULT_EARLY_SKIP_THRESHOLD_SEC

  private activeTrack: TrackRecord | null = null
  private activeSource: 'manual' | 'autodj' = 'manual'
  private activePlayedSec = 0
  private lastTickTimestampMs = 0

  private preloadedTrackId: number | null = null
  private transitionInFlight = false
  private actionSeq = 0
  private disposed = false
  private tickTimer: ReturnType<typeof setInterval> | null = null

  private unsubTrackEnded: (() => void) | null = null
  private unsubEngineError: (() => void) | null = null

  private queueListeners = new Set<QueueListener>()
  private configListeners = new Set<ConfigListener>()
  private activeTrackListeners = new Set<ActiveTrackListener>()

  constructor(engine: DualDeckEngine, initialConfig: AutoDjConfig = DEFAULT_AUTO_DJ_CONFIG) {
    this.engine = engine
    this.config = { ...initialConfig }
    this.session = createAutoDjSession(null)

    this.unsubTrackEnded = this.engine.onTrackEnded((endedTrack, deckId) => {
      if (this.disposed) return
      if (deckId !== this.engine.getActiveDeckId()) return
      void this.handleNaturalTrackEnd(endedTrack)
    })

    this.unsubEngineError = this.engine.onError((err) => {
      if (this.disposed || !err.track) return
      // Remove broken track from queue if it failed to load/decode
      const badId = err.track.id
      if (this.queue.some((q) => q.track.id === badId)) {
        this.queue = this.queue.filter((q) => q.track.id !== badId)
        this.regenerateQueue(true, [badId])
      }
    })

    this.tickTimer = setInterval(() => {
      this.tick()
    }, 250)
  }

  onQueueChange(listener: QueueListener): () => void {
    this.queueListeners.add(listener)
    listener([...this.queue])
    return () => {
      this.queueListeners.delete(listener)
    }
  }

  onConfigChange(listener: ConfigListener): () => void {
    this.configListeners.add(listener)
    listener({ ...this.config })
    return () => {
      this.configListeners.delete(listener)
    }
  }

  onActiveTrackChange(listener: ActiveTrackListener): () => void {
    this.activeTrackListeners.add(listener)
    listener(this.activeTrack, this.activeSource)
    return () => {
      this.activeTrackListeners.delete(listener)
    }
  }

  private emitQueue(): void {
    const snapshot = [...this.queue]
    for (const listener of this.queueListeners) {
      try {
        listener(snapshot)
      } catch {
        // Ignore subscriber error
      }
    }
  }

  private emitConfig(): void {
    const snapshot = { ...this.config }
    for (const listener of this.configListeners) {
      try {
        listener(snapshot)
      } catch {
        // Ignore subscriber error
      }
    }
  }

  private emitActiveTrack(): void {
    for (const listener of this.activeTrackListeners) {
      try {
        listener(this.activeTrack, this.activeSource)
      } catch {
        // Ignore subscriber error
      }
    }
  }

  getConfig(): AutoDjConfig {
    return { ...this.config }
  }

  getQueue(): AutoDjQueueItem[] {
    return [...this.queue]
  }

  getSession(): AutoDjSessionState {
    return this.session
  }

  getActiveTrack(): TrackRecord | null {
    return this.activeTrack
  }

  getActiveSource(): 'manual' | 'autodj' {
    return this.activeSource
  }

  setCandidates(tracks: TrackRecord[]): void {
    this.allTracks = tracks.filter((t) => !t.isMissing)

    // Keep playbackList metadata fresh (e.g., after DSP analysis finishes)
    if (this.playbackList.length > 0) {
      const freshById = new Map(this.allTracks.map((t) => [t.id, t]))
      this.playbackList = this.playbackList
        .map((t) => freshById.get(t.id) ?? t)
        .filter((t) => !t.isMissing)
    }

    // Keep activeTrack metadata in sync if analysis just completed
    if (this.activeTrack) {
      const updated = this.allTracks.find((t) => t.id === this.activeTrack!.id)
      if (updated) {
        this.activeTrack = updated
        this.session = {
          ...this.session,
          anchor: {
            ...this.session.anchor,
            bpm: updated.bpm,
            camelotKey: updated.camelotKey,
            genre: updated.genre,
            energy: updated.energy,
            artist: updated.artist
          }
        }
      }
    }

    if (this.config.scope.type === 'playlist') {
      void this.refreshPlaylistScope(this.config.scope.playlistId)
      return
    }

    this.regenerateQueue(true)
  }

  setConfig(partial: Partial<AutoDjConfig>): void {
    const prevScope = this.config.scope
    const nextConfig: AutoDjConfig = {
      ...this.config,
      ...partial
    }
    this.config = nextConfig
    this.emitConfig()

    const scopeChanged = JSON.stringify(prevScope) !== JSON.stringify(nextConfig.scope)
    if (nextConfig.scope.type === 'playlist' && scopeChanged) {
      this.playlistScopedTracks = null
      void this.refreshPlaylistScope(nextConfig.scope.playlistId)
      return
    }

    if (nextConfig.scope.type !== 'playlist') {
      this.playlistScopedTracks = null
    }

    if (scopeChanged || partial.enabled !== undefined) {
      this.preloadedTrackId = null
      this.regenerateQueue(true)
    }
  }

  setShuffle(enabled: boolean): void {
    this.shuffle = enabled
    if (enabled) {
      this.shuffleOrderIds = buildShuffleOrder(
        this.getActivePlaybackList(),
        this.activeTrack?.id ?? null
      )
    } else {
      this.shuffleOrderIds = []
    }
  }

  setRepeatMode(mode: RepeatMode): void {
    this.repeatMode = mode
  }

  setPlaybackContext(tracks: TrackRecord[]): void {
    this.playbackList = tracks.filter((t) => !t.isMissing)
    if (this.shuffle) {
      this.shuffleOrderIds = buildShuffleOrder(
        this.getActivePlaybackList(),
        this.activeTrack?.id ?? null
      )
    }
  }

  setAudioOptions(opts: {
    manualCrossfadeSec?: number
    earlySkipThresholdSec?: number
  }): void {
    if (
      typeof opts.manualCrossfadeSec === 'number' &&
      Number.isFinite(opts.manualCrossfadeSec)
    ) {
      this.manualCrossfadeSec = clamp(opts.manualCrossfadeSec, 0.25, 8)
    }
    if (
      typeof opts.earlySkipThresholdSec === 'number' &&
      Number.isFinite(opts.earlySkipThresholdSec)
    ) {
      this.earlySkipThresholdSec = clamp(opts.earlySkipThresholdSec, 5, 60)
    }
  }

  private getActivePlaybackList(): TrackRecord[] {
    return this.playbackList.length > 0 ? this.playbackList : this.allTracks
  }

  getInitialTrackForPlay(): TrackRecord | null {
    if (this.config.enabled) {
      return this.queue[0]?.track ?? this.allTracks[0] ?? null
    }
    const list = this.getActivePlaybackList()
    if (list.length === 0) return null
    if (this.shuffle) {
      if (this.shuffleOrderIds.length !== list.length) {
        this.shuffleOrderIds = buildShuffleOrder(list, null)
      }
      const byId = new Map(list.map((t) => [t.id, t]))
      return byId.get(this.shuffleOrderIds[0]) ?? list[0]
    }
    return list[0]
  }

  private async refreshPlaylistScope(playlistId: number): Promise<void> {
    if (typeof window === 'undefined' || !window.api?.tracks) return
    try {
      const tracks = await window.api.tracks.query({ playlistId, includeMissing: false })
      if (
        this.disposed ||
        this.config.scope.type !== 'playlist' ||
        this.config.scope.playlistId !== playlistId
      ) {
        return
      }
      this.playlistScopedTracks = tracks.filter((t) => !t.isMissing)
      this.regenerateQueue(true)
    } catch {
      // Keep current candidates on query error
    }
  }

  private getScopedCandidates(): TrackRecord[] {
    const scope = this.config.scope
    if (scope.type === 'folder') {
      return this.allTracks.filter((t) => t.folderId === scope.folderId && !t.isMissing)
    }
    if (scope.type === 'playlist') {
      return (this.playlistScopedTracks ?? []).filter((t) => !t.isMissing)
    }
    return this.allTracks.filter((t) => !t.isMissing)
  }

  private computeMixDuration(outgoing: TrackRecord | null, incoming: TrackRecord | null): number {
    if (this.config.mixStyle === 'quick-cut') {
      return 0.5
    }

    let desiredSec: number
    if (this.config.durationMode === 'bars') {
      const bpm =
        outgoing?.bpm && outgoing.bpm > 0
          ? outgoing.bpm
          : incoming?.bpm && incoming.bpm > 0
            ? incoming.bpm
            : 120
      desiredSec = (this.config.durationBars * 4 * 60) / bpm
    } else {
      desiredSec = this.config.durationSec
    }

    const outDuration = outgoing?.duration && outgoing.duration > 0 ? outgoing.duration : 60
    const maxSafe = Math.max(1.5, Math.min(24, outDuration * 0.4))
    return Number(clamp(desiredSec, 1, maxSafe).toFixed(2))
  }

  private getCurrentPlayedSeconds(): number {
    const extraSec =
      this.lastTickTimestampMs > 0 ? Math.max(0, (Date.now() - this.lastTickTimestampMs) / 1000) : 0
    return Number((this.activePlayedSec + extraSec).toFixed(2))
  }

  private logPlayHistory(
    track: TrackRecord | null,
    durationPlayedSec: number,
    wasSkippedEarly: boolean,
    source: 'manual' | 'autodj'
  ): void {
    if (!track || typeof window === 'undefined' || !window.api?.history) return
    const entry: PlayHistoryInput = {
      trackId: track.id,
      durationPlayedSec: Math.max(0, Number(durationPlayedSec.toFixed(2))),
      wasSkippedEarly,
      source
    }
    void window.api.history.recordPlay(entry).catch(() => {})
  }

  private regenerateQueue(deterministic: boolean, excludeIds: number[] = []): void {
    const candidates = this.getScopedCandidates()
    const lockedSlots = this.queue.map((item) => (item.locked ? item : null))
    const anchor = this.activeTrack ?? this.session.anchor

    const nextQueue = generateAutoDjQueue({
      anchor,
      candidates,
      session: this.session,
      lockedItems: lockedSlots,
      count: QUEUE_TARGET_COUNT,
      deterministic,
      excludeTrackIds: excludeIds
    })

    this.queue = nextQueue
    this.emitQueue()
  }

  toggleLock(index: number): void {
    if (index < 0 || index >= this.queue.length) return
    this.queue = this.queue.map((item, idx) =>
      idx === index ? { ...item, locked: !item.locked } : item
    )
    this.emitQueue()
  }

  reorderQueue(fromIndex: number, toIndex: number): void {
    if (
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= this.queue.length ||
      toIndex >= this.queue.length ||
      fromIndex === toIndex
    ) {
      return
    }
    const next = [...this.queue]
    const [moved] = next.splice(fromIndex, 1)
    next.splice(toIndex, 0, { ...moved, locked: true })
    this.queue = next
    if (fromIndex === 0 || toIndex === 0) {
      this.preloadedTrackId = null
    }
    this.emitQueue()
  }

  removeFromQueue(index: number): void {
    if (index < 0 || index >= this.queue.length) return
    const removed = this.queue[index]
    this.queue = this.queue.filter((_, idx) => idx !== index)
    if (index === 0) {
      this.preloadedTrackId = null
    }
    this.regenerateQueue(true, removed ? [removed.track.id] : [])
  }

  rerollQueue(): void {
    this.preloadedTrackId = null
    this.regenerateQueue(false)
  }

  private shiftTopAndRegenerate(
    playedTrack: TrackRecord,
    deterministic = true
  ): void {
    if (this.queue.length > 0 && this.queue[0].track.id === playedTrack.id) {
      this.queue = this.queue.slice(1)
    } else {
      this.queue = this.queue.filter((item) => item.track.id !== playedTrack.id)
    }
    this.session = reanchorSession(this.session, playedTrack)
    this.regenerateQueue(deterministic)
  }

  async onManualTrackSelect(
    selectedTrack: TrackRecord,
    contextTracks?: TrackRecord[]
  ): Promise<boolean> {
    return this.switchToManualTrack(selectedTrack, this.config.enabled, contextTracks)
  }

  async crossfadeToManualTrack(
    selectedTrack: TrackRecord,
    contextTracks?: TrackRecord[]
  ): Promise<boolean> {
    return this.switchToManualTrack(selectedTrack, true, contextTracks)
  }

  private async switchToManualTrack(
    selectedTrack: TrackRecord,
    allowCrossfade: boolean,
    contextTracks?: TrackRecord[]
  ): Promise<boolean> {
    if (this.disposed) return false
    if (contextTracks && contextTracks.length > 0) {
      this.setPlaybackContext(contextTracks)
    }

    if (this.shuffle) {
      const activeList = this.getActivePlaybackList()
      if (
        activeList.some((t) => t.id === selectedTrack.id) &&
        !this.shuffleOrderIds.includes(selectedTrack.id)
      ) {
        this.shuffleOrderIds = buildShuffleOrder(activeList, selectedTrack.id)
      }
    }

    const seq = ++this.actionSeq
    this.transitionInFlight = true

    try {
      const prevTrack = this.activeTrack ?? this.engine.getActiveTrack()
      const telemetry = this.engine.getTelemetry()
      const prevDeck = telemetry.decks[telemetry.activeDeckId]
      const playedSec = this.getCurrentPlayedSeconds()

      if (prevTrack && prevTrack.id !== selectedTrack.id) {
        const isEarlySkip =
          this.activeSource === 'autodj' && playedSec < this.earlySkipThresholdSec
        if (isEarlySkip) {
          this.session = recordEarlySkip(
            this.session,
            prevTrack,
            playedSec,
            this.earlySkipThresholdSec
          )
        }
        this.logPlayHistory(prevTrack, playedSec, isEarlySkip, this.activeSource)
        this.historyStack = [prevTrack, ...this.historyStack].slice(0, 50)
      }

      this.preloadedTrackId = null
      const shouldCrossfade =
        allowCrossfade &&
        prevTrack !== null &&
        (prevDeck.status === 'playing' || prevDeck.status === 'fading-in')

      const ok = shouldCrossfade
        ? await this.engine.crossfadeTo(selectedTrack, {
            style: 'equal-power',
            durationSec: this.manualCrossfadeSec,
            tempoMatchEnabled: false,
            startOffsetSec: 0
          })
        : await this.engine.playTrackImmediate(selectedTrack, 0)

      if (seq !== this.actionSeq || this.disposed || !ok) return ok

      this.activeTrack = selectedTrack
      this.activeSource = 'manual'
      this.activePlayedSec = 0
      this.lastTickTimestampMs = Date.now()
      this.emitActiveTrack()

      this.queue = this.queue.filter((q) => q.track.id !== selectedTrack.id)
      this.session = reanchorSession(this.session, selectedTrack)
      this.regenerateQueue(true)

      return true
    } finally {
      if (seq === this.actionSeq) {
        this.transitionInFlight = false
      }
    }
  }

  async onSkipNext(): Promise<boolean> {
    if (this.disposed) return false

    let nextTrack: TrackRecord | null = null
    if (this.config.enabled) {
      nextTrack = this.pickNextFallbackTrack()
    } else {
      const resolved = resolveNormalNextTrack({
        orderedTracks: this.getActivePlaybackList(),
        shuffleOrderIds: this.shuffleOrderIds,
        currentTrackId: this.activeTrack?.id ?? null,
        shuffle: this.shuffle,
        repeatMode: this.repeatMode,
        reason: 'manual-next'
      })
      if (resolved.nextShuffleOrderIds) {
        this.shuffleOrderIds = resolved.nextShuffleOrderIds
      }
      nextTrack = resolved.nextTrack
    }

    if (!nextTrack) return false

    const seq = ++this.actionSeq
    this.transitionInFlight = true

    try {
      const prevTrack = this.activeTrack ?? this.engine.getActiveTrack()
      const telemetry = this.engine.getTelemetry()
      const prevDeck = telemetry.decks[telemetry.activeDeckId]
      const playedSec = this.getCurrentPlayedSeconds()

      if (prevTrack) {
        const isEarlySkip =
          this.activeSource === 'autodj' && playedSec < this.earlySkipThresholdSec
        if (isEarlySkip) {
          this.session = recordEarlySkip(
            this.session,
            prevTrack,
            playedSec,
            this.earlySkipThresholdSec
          )
        }
        this.logPlayHistory(prevTrack, playedSec, isEarlySkip, this.activeSource)
        this.historyStack = [prevTrack, ...this.historyStack].slice(0, 50)
      }

      this.preloadedTrackId = null
      const shouldCrossfade =
        this.config.enabled &&
        prevTrack !== null &&
        (prevDeck.status === 'playing' || prevDeck.status === 'fading-in')

      const ok = shouldCrossfade
        ? await this.engine.crossfadeTo(nextTrack, {
            style: 'equal-power',
            durationSec: this.manualCrossfadeSec,
            tempoMatchEnabled: false,
            startOffsetSec: 0
          })
        : await this.engine.playTrackImmediate(nextTrack, 0)

      if (seq !== this.actionSeq || this.disposed || !ok) return ok

      this.activeTrack = nextTrack
      this.activeSource = this.config.enabled ? 'autodj' : 'manual'
      this.activePlayedSec = 0
      this.lastTickTimestampMs = Date.now()
      this.emitActiveTrack()

      this.shiftTopAndRegenerate(nextTrack, true)
      return true
    } finally {
      if (seq === this.actionSeq) {
        this.transitionInFlight = false
      }
    }
  }

  async onPreviousTrack(): Promise<boolean> {
    if (this.disposed) return false
    const telemetry = this.engine.getTelemetry()
    const currentPos = telemetry.decks[telemetry.activeDeckId].currentTime
    if (currentPos > 3) {
      this.engine.seek(0)
      return true
    }

    const resolved = resolveNormalPreviousTrack({
      orderedTracks: this.getActivePlaybackList(),
      shuffleOrderIds: this.shuffleOrderIds,
      currentTrackId: this.activeTrack?.id ?? null,
      shuffle: this.shuffle,
      repeatMode: this.repeatMode,
      historyStack: this.historyStack
    })

    if (resolved.consumedHistory) {
      this.historyStack.shift()
    }

    const prev = resolved.prevTrack
    if (!prev) {
      this.engine.seek(0)
      return false
    }

    const seq = ++this.actionSeq
    this.transitionInFlight = true
    try {
      this.preloadedTrackId = null
      const ok = await this.engine.playTrackImmediate(prev, 0)
      if (seq !== this.actionSeq || this.disposed || !ok) return ok

      this.activeTrack = prev
      this.activeSource = 'manual'
      this.activePlayedSec = 0
      this.lastTickTimestampMs = Date.now()
      this.emitActiveTrack()

      this.session = reanchorSession(this.session, prev)
      this.regenerateQueue(true)
      return true
    } finally {
      if (seq === this.actionSeq) {
        this.transitionInFlight = false
      }
    }
  }

  async triggerManualCrossfadeNow(): Promise<boolean> {
    if (this.disposed) return false
    const nextTrack = this.pickNextFallbackTrack()
    if (!nextTrack) return false

    const seq = ++this.actionSeq
    this.transitionInFlight = true

    try {
      const prevTrack = this.activeTrack ?? this.engine.getActiveTrack()
      const playedSec = this.getCurrentPlayedSeconds()
      if (prevTrack) {
        this.logPlayHistory(prevTrack, playedSec, false, this.activeSource)
        this.historyStack = [prevTrack, ...this.historyStack].slice(0, 50)
      }

      const mixDuration = this.computeMixDuration(prevTrack, nextTrack)
      const introOffset =
        nextTrack.introCueSec && nextTrack.introCueSec > 0 && nextTrack.introCueSec < (nextTrack.duration || 30) * 0.35
          ? nextTrack.introCueSec
          : 0

      this.preloadedTrackId = null
      const ok = await this.engine.crossfadeTo(nextTrack, {
        style: this.config.mixStyle,
        durationSec: mixDuration,
        tempoMatchEnabled: this.config.tempoMatchEnabled,
        tempoMatchMaxPct: this.config.tempoMatchMaxPct,
        startOffsetSec: introOffset
      })

      if (seq !== this.actionSeq || this.disposed || !ok) return ok

      this.activeTrack = nextTrack
      this.activeSource = this.config.enabled ? 'autodj' : 'manual'
      this.activePlayedSec = 0
      this.lastTickTimestampMs = Date.now()
      this.emitActiveTrack()

      this.shiftTopAndRegenerate(nextTrack, true)
      return true
    } finally {
      if (seq === this.actionSeq) {
        this.transitionInFlight = false
      }
    }
  }

  private pickNextFallbackTrack(allowWrap = true): TrackRecord | null {
    if (this.config.enabled && this.queue.length > 0) {
      return this.queue[0].track
    }
    const candidates = this.getScopedCandidates()
    if (candidates.length === 0) return null
    if (!this.activeTrack) return candidates[0]
    const idx = candidates.findIndex((t) => t.id === this.activeTrack!.id)
    if (idx === -1) return candidates[0]
    if (!allowWrap && idx + 1 >= candidates.length) return null
    return candidates[(idx + 1) % candidates.length]
  }

  private async executeScheduledAutoTransition(nextItem: AutoDjQueueItem): Promise<void> {
    const seq = ++this.actionSeq
    this.transitionInFlight = true

    try {
      const prevTrack = this.activeTrack ?? this.engine.getActiveTrack()
      const playedSec = this.getCurrentPlayedSeconds()
      if (prevTrack) {
        this.logPlayHistory(prevTrack, playedSec, false, this.activeSource)
        this.historyStack = [prevTrack, ...this.historyStack].slice(0, 50)
      }

      const mixDuration = this.computeMixDuration(prevTrack, nextItem.track)
      const introOffset =
        nextItem.track.introCueSec &&
        nextItem.track.introCueSec > 0 &&
        nextItem.track.introCueSec < (nextItem.track.duration || 30) * 0.35
          ? nextItem.track.introCueSec
          : 0

      this.preloadedTrackId = null
      const ok = await this.engine.crossfadeTo(nextItem.track, {
        style: this.config.mixStyle,
        durationSec: mixDuration,
        tempoMatchEnabled: this.config.tempoMatchEnabled,
        tempoMatchMaxPct: this.config.tempoMatchMaxPct,
        startOffsetSec: introOffset
      })

      if (seq !== this.actionSeq || this.disposed) return

      if (!ok) {
        // Drop unplayable track and keep going
        this.queue = this.queue.filter((q) => q.track.id !== nextItem.track.id)
        this.regenerateQueue(true, [nextItem.track.id])
        return
      }

      this.activeTrack = nextItem.track
      this.activeSource = 'autodj'
      this.activePlayedSec = 0
      this.lastTickTimestampMs = Date.now()
      this.emitActiveTrack()

      this.shiftTopAndRegenerate(nextItem.track, true)
    } finally {
      if (seq === this.actionSeq) {
        this.transitionInFlight = false
      }
    }
  }

  private async handleNaturalTrackEnd(endedTrack: TrackRecord): Promise<void> {
    if (this.transitionInFlight || this.disposed) return
    const playedSec = Math.max(this.getCurrentPlayedSeconds(), endedTrack.duration || 0)
    this.logPlayHistory(endedTrack, playedSec, false, this.activeSource)

    if (this.repeatMode === 'one') {
      const seq = ++this.actionSeq
      this.transitionInFlight = true
      try {
        this.preloadedTrackId = null
        const ok = await this.engine.playTrackImmediate(endedTrack, 0)
        if (seq !== this.actionSeq || this.disposed || !ok) return
        this.activeTrack = endedTrack
        this.activePlayedSec = 0
        this.lastTickTimestampMs = Date.now()
        this.emitActiveTrack()
      } finally {
        if (seq === this.actionSeq) {
          this.transitionInFlight = false
        }
      }
      return
    }

    let nextTrack: TrackRecord | null = null
    if (this.config.enabled) {
      nextTrack = this.pickNextFallbackTrack(true)
    } else {
      const resolved = resolveNormalNextTrack({
        orderedTracks: this.getActivePlaybackList(),
        shuffleOrderIds: this.shuffleOrderIds,
        currentTrackId: endedTrack.id,
        shuffle: this.shuffle,
        repeatMode: this.repeatMode,
        reason: 'natural-end'
      })
      if (resolved.nextShuffleOrderIds) {
        this.shuffleOrderIds = resolved.nextShuffleOrderIds
      }
      nextTrack = resolved.nextTrack
    }

    if (!nextTrack) {
      this.activePlayedSec = 0
      this.lastTickTimestampMs = 0
      this.emitActiveTrack()
      return
    }

    this.historyStack = [endedTrack, ...this.historyStack].slice(0, 50)

    const seq = ++this.actionSeq
    this.transitionInFlight = true
    try {
      this.preloadedTrackId = null
      const ok = await this.engine.playTrackImmediate(nextTrack, 0)
      if (seq !== this.actionSeq || this.disposed || !ok) return

      this.activeTrack = nextTrack
      this.activeSource = this.config.enabled ? 'autodj' : 'manual'
      this.activePlayedSec = 0
      this.lastTickTimestampMs = Date.now()
      this.emitActiveTrack()

      this.shiftTopAndRegenerate(nextTrack, true)
    } finally {
      if (seq === this.actionSeq) {
        this.transitionInFlight = false
      }
    }
  }

  private tick(): void {
    if (this.disposed || this.transitionInFlight) return

    const telemetry = this.engine.getTelemetry()
    const activeDeck = telemetry.decks[telemetry.activeDeckId]
    const nowMs = Date.now()

    if (activeDeck.status === 'playing' || activeDeck.status === 'fading-in') {
      if (this.lastTickTimestampMs > 0) {
        this.activePlayedSec += Math.max(0, (nowMs - this.lastTickTimestampMs) / 1000)
      }
      this.lastTickTimestampMs = nowMs
    } else {
      this.lastTickTimestampMs = 0
    }

    if (
      !this.config.enabled ||
      this.repeatMode === 'one' ||
      !activeDeck.track ||
      activeDeck.status !== 'playing' ||
      telemetry.transition.active ||
      this.queue.length === 0
    ) {
      return
    }

    const nextItem = this.queue[0]
    const trackDuration = activeDeck.duration > 0 ? activeDeck.duration : activeDeck.track.duration
    if (trackDuration <= 1) return

    const rawOutro = activeDeck.track.outroCueSec
    const outroCue =
      rawOutro !== null && rawOutro > 1 ? Math.min(trackDuration, rawOutro) : trackDuration

    const mixDuration = this.computeMixDuration(activeDeck.track, nextItem.track)
    const minPlayBeforeMix = Math.min(trackDuration * 0.45, 2)
    const triggerSec = Math.max(minPlayBeforeMix, outroCue - mixDuration)
    const preloadSec = Math.max(0, triggerSec - PRELOAD_LEAD_SEC)

    if (
      activeDeck.currentTime >= preloadSec &&
      this.preloadedTrackId !== nextItem.track.id
    ) {
      this.preloadedTrackId = nextItem.track.id
      void this.engine.preloadStandby(nextItem.track)
    }

    if (activeDeck.currentTime >= triggerSec) {
      void this.executeScheduledAutoTransition(nextItem)
    }
  }

  dispose(): void {
    this.disposed = true
    if (this.tickTimer) {
      clearInterval(this.tickTimer)
      this.tickTimer = null
    }
    this.unsubTrackEnded?.()
    this.unsubTrackEnded = null
    this.unsubEngineError?.()
    this.unsubEngineError = null
    this.queueListeners.clear()
    this.configListeners.clear()
    this.activeTrackListeners.clear()
  }
}
