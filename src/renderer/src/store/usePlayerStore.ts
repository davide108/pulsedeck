import { create } from 'zustand'
import { AnalysisManager, type AnalysisProgress } from '@/audio/AnalysisManager'
import {
  DualDeckEngine,
  type EngineTelemetrySnapshot
} from '@/audio/DualDeckEngine'
import { TransitionScheduler } from '@/audio/TransitionScheduler'
import {
  DEFAULT_APPEARANCE_SETTINGS,
  DEFAULT_APP_SETTINGS,
  DEFAULT_AUDIO_SETTINGS,
  DEFAULT_AUTO_DJ_CONFIG,
  DEFAULT_LIBRARY_SETTINGS,
  type AppearanceSettings,
  type AudioSettings,
  type AutoDjConfig,
  type AutoDjQueueItem,
  type DeckEqState,
  type DeckId,
  type DeckTelemetry,
  type LibrarySettings,
  type LoopBeats,
  type RepeatMode,
  type TrackRecord,
  type UpdateState
} from '@shared/types'

export type NowPlayingTab = 'visualizer' | 'lyrics'

export interface ToastMessage {
  id: string
  type: 'error' | 'info'
  title: string
  message: string
}

const EMPTY_TELEMETRY: EngineTelemetrySnapshot = {
  activeDeckId: 'A',
  crossfader: 0,
  decks: {
    A: {
      deckId: 'A',
      track: null,
      status: 'idle',
      currentTime: 0,
      duration: 0,
      playbackRate: 1,
      crossfadeGain: 1,
      normalizationGain: 1,
      channelGain: 1,
      eq: { low: 0, mid: 0, high: 0 },
      eqKill: { low: false, mid: false, high: false },
      filterValue: 0,
      cuePointSec: 0,
      loopEnabled: false,
      loopBeats: 8,
      loopStartSec: null,
      loopEndSec: null
    },
    B: {
      deckId: 'B',
      track: null,
      status: 'idle',
      currentTime: 0,
      duration: 0,
      playbackRate: 1,
      crossfadeGain: 0,
      normalizationGain: 1,
      channelGain: 1,
      eq: { low: 0, mid: 0, high: 0 },
      eqKill: { low: false, mid: false, high: false },
      filterValue: 0,
      cuePointSec: 0,
      loopEnabled: false,
      loopBeats: 8,
      loopStartSec: null,
      loopEndSec: null
    }
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

const EMPTY_ANALYSIS: AnalysisProgress = {
  running: false,
  completed: 0,
  total: 0,
  failed: 0,
  currentTrackId: null,
  currentTitle: null
}

let engine: DualDeckEngine | null = null
let scheduler: TransitionScheduler | null = null
let analysisManager: AnalysisManager | null = null
let rafId: number | null = null
let volumePersistTimer: ReturnType<typeof setTimeout> | null = null
let lastTelemetryCommitMs = 0
let wasTelemetryHidden = false

const MAX_WAVEFORM_PEAKS_CACHE = 24
const waveformPeaksCache = new Map<number, number[]>()
const waveformPeaksInFlight = new Map<number, Promise<number[] | null>>()

function getCachedWaveformPeaks(trackId: number): number[] | undefined {
  const hit = waveformPeaksCache.get(trackId)
  if (hit !== undefined) {
    waveformPeaksCache.delete(trackId)
    waveformPeaksCache.set(trackId, hit)
  }
  return hit
}

function setCachedWaveformPeaks(trackId: number, peaks: number[]): void {
  if (waveformPeaksCache.has(trackId)) {
    waveformPeaksCache.delete(trackId)
  } else if (waveformPeaksCache.size >= MAX_WAVEFORM_PEAKS_CACHE) {
    const oldestKey = waveformPeaksCache.keys().next().value
    if (oldestKey !== undefined) {
      waveformPeaksCache.delete(oldestKey)
    }
  }
  waveformPeaksCache.set(trackId, peaks)
}

interface PlayerState {
  activeTrack: TrackRecord | null
  activeSource: 'manual' | 'autodj'
  isPlaying: boolean
  telemetry: EngineTelemetrySnapshot
  autoDjQueue: AutoDjQueueItem[]
  autoDjConfig: AutoDjConfig
  analysisProgress: AnalysisProgress
  volume: number
  muted: boolean
  shuffle: boolean
  repeatMode: RepeatMode
  audioSettings: AudioSettings
  appearanceSettings: AppearanceSettings
  librarySettings: LibrarySettings
  sidebarCollapsed: boolean
  autoCheckUpdates: boolean
  updateState: UpdateState | null
  isMaximized: boolean
  isMiniPlayer: boolean
  nowPlayingOpen: boolean
  nowPlayingTab: NowPlayingTab
  toasts: ToastMessage[]
  libraryTracks: TrackRecord[]

  init: () => Promise<() => void>
  syncLibraryTracks: (tracks: TrackRecord[]) => void
  refreshActiveTrack: (track: TrackRecord) => void
  scheduleAnalysisCheck: (delayMs?: number) => void

  playTrack: (track: TrackRecord, contextTracks?: TrackRecord[]) => Promise<void>
  crossfadeToTrack: (track: TrackRecord, contextTracks?: TrackRecord[]) => Promise<void>
  togglePlayPause: () => Promise<void>
  pausePlayback: () => Promise<void>
  stopPlayback: () => Promise<void>
  skipNext: () => Promise<void>
  previousTrack: () => Promise<void>
  seek: (positionSec: number) => void
  triggerManualCrossfade: () => Promise<void>

  setVolume: (volume: number) => void
  toggleMute: () => void
  setShuffle: (enabled: boolean) => void
  toggleShuffle: () => void
  setRepeatMode: (mode: RepeatMode) => void
  cycleRepeatMode: () => void
  toggleAutoDj: () => void
  updateAutoDjConfig: (partial: Partial<AutoDjConfig>) => void
  updateAudioSettings: (partial: Partial<AudioSettings>) => void
  updateAppearanceSettings: (partial: Partial<AppearanceSettings>) => void
  updateLibrarySettings: (partial: Partial<LibrarySettings>) => void
  pauseAnalysis: () => void
  resumeAnalysis: () => void
  resetAllDeckEq: () => void
  resetAllSettings: () => Promise<void>
  toggleQueueLock: (index: number) => void
  reorderQueue: (fromIndex: number, toIndex: number) => void
  removeFromQueue: (index: number) => void
  rerollQueue: () => void
  addTrackToAutoDjQueue: (track: TrackRecord) => void
  setDeckEq: (deckId: DeckId, band: keyof DeckEqState, gainDb: number) => void
  loadTrackToDeck: (
    deckId: DeckId,
    track: TrackRecord,
    options?: { autoplay?: boolean }
  ) => Promise<void>
  unloadDeck: (deckId: DeckId) => void
  toggleDeckPlayPause: (deckId: DeckId) => Promise<void>
  seekDeck: (deckId: DeckId, timeSec: number) => void
  setDeckPlaybackRate: (deckId: DeckId, rate: number) => void
  nudgeDeckPlaybackRate: (deckId: DeckId, delta: number) => void
  syncDeckBpm: (deckId: DeckId) => void
  setDeckCuePoint: (deckId: DeckId, sec?: number) => void
  jumpToDeckCue: (deckId: DeckId) => void
  toggleDeckLoop: (deckId: DeckId, beats?: LoopBeats) => void
  setDeckLoopBeats: (deckId: DeckId, beats: LoopBeats) => void
  setDeckChannelGain: (deckId: DeckId, gain: number) => void
  setDeckFilter: (deckId: DeckId, value: number) => void
  toggleDeckEqKill: (deckId: DeckId, band: keyof DeckEqState) => void
  resetDeckEq: (deckId: DeckId) => void
  setCrossfader: (position: number) => void

  setSidebarCollapsed: (collapsed: boolean) => void
  setAutoCheckUpdates: (enabled: boolean) => void
  checkForUpdates: () => Promise<void>
  downloadUpdate: () => Promise<void>
  installUpdate: () => Promise<void>
  openUpdateReleasePage: () => Promise<void>
  setNowPlayingOpen: (open: boolean, tab?: NowPlayingTab) => void
  setNowPlayingTab: (tab: NowPlayingTab) => void
  setMiniPlayer: (enabled: boolean) => Promise<void>
  minimizeWindow: () => void
  toggleMaximizeWindow: () => void
  closeWindow: () => void

  pushToast: (toast: Omit<ToastMessage, 'id'>) => void
  dismissToast: (id: string) => void
  getFrequencyData: (target?: Uint8Array) => Uint8Array
}

export const usePlayerStore = create<PlayerState>((set, get) => {
  const applyHydratedPeaksToState = (trackId: number, peaks: number[]) => {
    set((state) => {
      let changed = false
      let nextActive = state.activeTrack
      if (nextActive && nextActive.id === trackId && nextActive.waveformPeaks === null) {
        nextActive = { ...nextActive, waveformPeaks: peaks }
        changed = true
      }

      let nextDeckA = state.telemetry.decks.A
      if (
        nextDeckA.track &&
        nextDeckA.track.id === trackId &&
        nextDeckA.track.waveformPeaks === null
      ) {
        nextDeckA = { ...nextDeckA, track: { ...nextDeckA.track, waveformPeaks: peaks } }
        changed = true
      }

      let nextDeckB = state.telemetry.decks.B
      if (
        nextDeckB.track &&
        nextDeckB.track.id === trackId &&
        nextDeckB.track.waveformPeaks === null
      ) {
        nextDeckB = { ...nextDeckB, track: { ...nextDeckB.track, waveformPeaks: peaks } }
        changed = true
      }

      if (!changed) return state
      return {
        activeTrack: nextActive,
        telemetry: {
          ...state.telemetry,
          decks: {
            A: nextDeckA,
            B: nextDeckB
          }
        }
      }
    })
  }

  const requestWaveformPeaks = (trackId: number): Promise<number[] | null> => {
    const cached = getCachedWaveformPeaks(trackId)
    if (cached !== undefined) {
      return Promise.resolve(cached)
    }

    const existing = waveformPeaksInFlight.get(trackId)
    if (existing) return existing

    if (typeof window === 'undefined' || !window.api?.tracks?.getById) {
      return Promise.resolve(null)
    }

    const req = window.api.tracks
      .getById(trackId)
      .then((fullTrack) => {
        const peaks = fullTrack?.waveformPeaks ?? null
        if (peaks !== null) {
          setCachedWaveformPeaks(trackId, peaks)
          applyHydratedPeaksToState(trackId, peaks)
        }
        return peaks
      })
      .catch(() => null)
      .finally(() => {
        waveformPeaksInFlight.delete(trackId)
      })

    waveformPeaksInFlight.set(trackId, req)
    return req
  }

  const hydrateTrackPeaks = (track: TrackRecord | null): TrackRecord | null => {
    if (!track) return null
    if (track.waveformPeaks !== null) {
      setCachedWaveformPeaks(track.id, track.waveformPeaks)
      return track
    }
    const cached = getCachedWaveformPeaks(track.id)
    if (cached !== undefined) {
      return { ...track, waveformPeaks: cached }
    }
    if (track.analysisStatus === 'done') {
      void requestWaveformPeaks(track.id)
    }
    return track
  }

  const stopTelemetryLoop = () => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
    lastTelemetryCommitMs = 0
  }

  const syncTelemetryOnce = (force = true): boolean => {
    if (!engine) return false
    const snap = engine.getTelemetry()
    const isRunningStatus = (status: DeckTelemetry['status']): boolean =>
      status === 'playing' ||
      status === 'fading-in' ||
      status === 'fading-out' ||
      status === 'loading'
    const isPlayingStatus = (status: DeckTelemetry['status']): boolean =>
      status === 'playing' || status === 'fading-in' || status === 'fading-out'

    const deckA = snap.decks.A
    const deckB = snap.decks.B
    const anyDeckRunning =
      isRunningStatus(deckA.status) || isRunningStatus(deckB.status) || snap.transition.active
    const anyDeckPlaying = isPlayingStatus(deckA.status) || isPlayingStatus(deckB.status)
    const anyDeckLoading = deckA.status === 'loading' || deckB.status === 'loading'

    const prevState = get()
    const nextIsPlaying = anyDeckPlaying
      ? true
      : anyDeckLoading
        ? prevState.isPlaying
        : false

    const hydratedDeckATrack = hydrateTrackPeaks(deckA.track)
    const hydratedDeckBTrack = hydrateTrackPeaks(deckB.track)
    const hydratedActiveDeckTrack =
      snap.activeDeckId === 'A' ? hydratedDeckATrack : hydratedDeckBTrack
    const nextActiveTrack =
      hydratedActiveDeckTrack !== null
        ? hydratedActiveDeckTrack
        : deckA.track === null && deckB.track === null
          ? null
          : hydrateTrackPeaks(prevState.activeTrack)

    const isHidden = typeof document !== 'undefined' && document.hidden
    const returnedFromHidden = wasTelemetryHidden && !isHidden
    wasTelemetryHidden = isHidden

    const prevSnap = prevState.telemetry
    const importantChanged =
      force ||
      returnedFromHidden ||
      nextIsPlaying !== prevState.isPlaying ||
      snap.activeDeckId !== prevSnap.activeDeckId ||
      snap.transition.active !== prevSnap.transition.active ||
      deckA.status !== prevSnap.decks.A.status ||
      deckB.status !== prevSnap.decks.B.status ||
      (hydratedDeckATrack?.id ?? null) !== (prevSnap.decks.A.track?.id ?? null) ||
      (hydratedDeckBTrack?.id ?? null) !== (prevSnap.decks.B.track?.id ?? null) ||
      (nextActiveTrack?.id ?? null) !== (prevState.activeTrack?.id ?? null) ||
      (hydratedDeckATrack?.waveformPeaks !== null) !==
        (prevSnap.decks.A.track?.waveformPeaks !== null) ||
      (hydratedDeckBTrack?.waveformPeaks !== null) !==
        (prevSnap.decks.B.track?.waveformPeaks !== null)

    const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now()
    const minIntervalMs =
      isHidden && !snap.transition.active ? 500 : snap.transition.active ? 40 : 66

    if (importantChanged || nowMs - lastTelemetryCommitMs >= minIntervalMs) {
      lastTelemetryCommitMs = nowMs
      const hydratedSnap: EngineTelemetrySnapshot = {
        ...snap,
        decks: {
          A:
            hydratedDeckATrack === deckA.track
              ? deckA
              : { ...deckA, track: hydratedDeckATrack },
          B:
            hydratedDeckBTrack === deckB.track
              ? deckB
              : { ...deckB, track: hydratedDeckBTrack }
        }
      }
      set({
        telemetry: hydratedSnap,
        isPlaying: nextIsPlaying,
        activeTrack: nextActiveTrack
      })
    }

    return anyDeckRunning
  }

  const ensureTelemetryLoop = () => {
    if (rafId !== null) return
    const tick = () => {
      rafId = null
      const keepGoing = syncTelemetryOnce(false)
      if (keepGoing) {
        rafId = requestAnimationFrame(tick)
      }
    }
    rafId = requestAnimationFrame(tick)
  }

  return {
    activeTrack: null,
    activeSource: 'manual',
    isPlaying: false,
    telemetry: EMPTY_TELEMETRY,
    autoDjQueue: [],
    autoDjConfig: { ...DEFAULT_AUTO_DJ_CONFIG },
    analysisProgress: { ...EMPTY_ANALYSIS },
    volume: DEFAULT_APP_SETTINGS.volume,
    muted: DEFAULT_APP_SETTINGS.muted,
    shuffle: DEFAULT_APP_SETTINGS.shuffle,
    repeatMode: DEFAULT_APP_SETTINGS.repeatMode,
    audioSettings: { ...DEFAULT_AUDIO_SETTINGS },
    appearanceSettings: { ...DEFAULT_APPEARANCE_SETTINGS },
    librarySettings: { ...DEFAULT_LIBRARY_SETTINGS },
    sidebarCollapsed: DEFAULT_APP_SETTINGS.sidebarCollapsed,
    autoCheckUpdates: DEFAULT_APP_SETTINGS.autoCheckUpdates,
    updateState: null,
    isMaximized: false,
    isMiniPlayer: false,
    nowPlayingOpen: false,
    nowPlayingTab: 'visualizer',
    toasts: [],
    libraryTracks: [],

    init: async () => {
      // Tear down any stale instances (handles React StrictMode cleanly)
      stopTelemetryLoop()
      scheduler?.dispose()
      analysisManager?.dispose()
      engine?.dispose()

      let settings = DEFAULT_APP_SETTINGS
      try {
        settings = await window.api.settings.getAll()
      } catch {
        // Fallback to defaults if settings cannot be loaded
      }

      const nextEngine = new DualDeckEngine()
      nextEngine.setMasterVolume(settings.volume)
      nextEngine.setMuted(settings.muted)
      nextEngine.setReplayGainEnabled(settings.audio.replayGainEnabled)
      nextEngine.setLimiterEnabled(settings.audio.limiterEnabled)

      const nextScheduler = new TransitionScheduler(nextEngine, settings.autoDj)
      nextScheduler.setShuffle(settings.shuffle)
      nextScheduler.setRepeatMode(settings.repeatMode)
      nextScheduler.setAudioOptions({
        manualCrossfadeSec: settings.audio.manualCrossfadeSec,
        earlySkipThresholdSec: settings.library.earlySkipThresholdSec
      })

      const nextAnalyzer = new AnalysisManager()

      engine = nextEngine
      scheduler = nextScheduler
      analysisManager = nextAnalyzer

      set({
        volume: settings.volume,
        muted: settings.muted,
        shuffle: settings.shuffle,
        repeatMode: settings.repeatMode,
        autoDjConfig: settings.autoDj,
        audioSettings: settings.audio,
        appearanceSettings: settings.appearance,
        librarySettings: settings.library,
        sidebarCollapsed: settings.sidebarCollapsed,
        autoCheckUpdates: settings.autoCheckUpdates
      })

      const cachedTracks = get().libraryTracks
      if (cachedTracks.length > 0) {
        nextScheduler.setCandidates(cachedTracks)
      }
      if (settings.library.autoAnalyzeEnabled) {
        nextAnalyzer.scheduleCheck(300)
      } else {
        nextAnalyzer.pause()
      }

      const unsubErr = nextEngine.onError((err) => {
        get().pushToast({
          type: 'error',
          title: err.code === 'MISSING_FILE' ? 'Track Unavailable' : 'Playback Error',
          message: err.message
        })
        syncTelemetryOnce()
      })

      const unsubEnded = nextEngine.onTrackEnded(() => {
        setTimeout(() => {
          syncTelemetryOnce()
          if (get().isPlaying) {
            ensureTelemetryLoop()
          }
        }, 40)
      })

      const unsubTransition = nextEngine.onTransitionEnded(() => {
        syncTelemetryOnce()
      })

      const unsubQueue = nextScheduler.onQueueChange((autoDjQueue) => {
        set({ autoDjQueue })
      })

      const unsubConfig = nextScheduler.onConfigChange((autoDjConfig) => {
        set({ autoDjConfig })
      })

      const unsubActive = nextScheduler.onActiveTrackChange((activeTrack, activeSource) => {
        set({ activeTrack, activeSource })
        syncTelemetryOnce()
        ensureTelemetryLoop()
      })

      const unsubAnalysis = nextAnalyzer.onProgress((analysisProgress) => {
        set({ analysisProgress })
      })

      window.api.window
        .isMaximized()
        .then((isMaximized) => set({ isMaximized }))
        .catch(() => {})

      const unsubWin = window.api.events.onWindowStateChanged((winState) => {
        set({
          isMaximized: winState.isMaximized,
          isMiniPlayer: winState.isMiniPlayer
        })
      })

      window.api.updater
        .getState()
        .then((updateState) => set({ updateState }))
        .catch(() => {})

      const unsubUpdater = window.api.events.onUpdateState((nextUpdate) => {
        const prevStatus = get().updateState?.status
        set({ updateState: nextUpdate })

        if (nextUpdate.status === 'available' && prevStatus !== 'available') {
          get().pushToast({
            type: 'info',
            title: `Update Available (v${nextUpdate.latestVersion ?? ''})`,
            message: 'Open Settings to download and install the latest PulseDeck release.'
          })
        } else if (nextUpdate.status === 'downloaded' && prevStatus !== 'downloaded') {
          get().pushToast({
            type: 'info',
            title: 'Update Ready to Install',
            message: `PulseDeck v${nextUpdate.latestVersion ?? ''} downloaded. Restart from Settings to install.`
          })
        }
      })

      return () => {
        stopTelemetryLoop()
        waveformPeaksInFlight.clear()
        wasTelemetryHidden = false
        if (volumePersistTimer) {
          clearTimeout(volumePersistTimer)
          volumePersistTimer = null
        }
        unsubErr()
        unsubEnded()
        unsubTransition()
        unsubQueue()
        unsubConfig()
        unsubActive()
        unsubAnalysis()
        unsubWin()
        unsubUpdater()
        if (scheduler === nextScheduler) {
          nextScheduler.dispose()
          scheduler = null
        }
        if (analysisManager === nextAnalyzer) {
          nextAnalyzer.dispose()
          analysisManager = null
        }
        if (engine === nextEngine) {
          nextEngine.dispose()
          engine = null
        }
      }
    },

    syncLibraryTracks: (tracks) => {
      set({ libraryTracks: tracks })
      scheduler?.setCandidates(tracks)
      const currentActive = get().activeTrack
      if (currentActive) {
        const refreshed = tracks.find((t) => t.id === currentActive.id)
        if (refreshed) {
          set({ activeTrack: refreshed })
        }
      }
      if (get().librarySettings.autoAnalyzeEnabled) {
        analysisManager?.scheduleCheck(250)
      }
    },

    refreshActiveTrack: (track) => {
      if (track.waveformPeaks !== null) {
        setCachedWaveformPeaks(track.id, track.waveformPeaks)
      }
      const hydrated = hydrateTrackPeaks(track) ?? track
      set((state) => {
        const hasTrack = state.libraryTracks.some((t) => t.id === track.id)
        const nextLibraryTracks = hasTrack
          ? state.libraryTracks.map((t) => (t.id === track.id ? track : t))
          : state.libraryTracks
        const nextActiveTrack =
          state.activeTrack?.id === hydrated.id ? hydrated : state.activeTrack
        return {
          libraryTracks: nextLibraryTracks,
          activeTrack: nextActiveTrack
        }
      })
      scheduler?.setCandidates(get().libraryTracks)
    },

    scheduleAnalysisCheck: (delayMs = 250) => {
      if (get().librarySettings.autoAnalyzeEnabled) {
        analysisManager?.scheduleCheck(delayMs)
      }
    },

    playTrack: async (track, contextTracks) => {
      if (!scheduler) return
      const hydratedTrack = hydrateTrackPeaks(track) ?? track
      set({ isPlaying: true })
      const ok = await scheduler.onManualTrackSelect(hydratedTrack, contextTracks)
      if (!ok) {
        syncTelemetryOnce()
        return
      }
      set({ isPlaying: true })
      syncTelemetryOnce()
      ensureTelemetryLoop()
    },

    crossfadeToTrack: async (track, contextTracks) => {
      if (!scheduler) return
      const hydratedTrack = hydrateTrackPeaks(track) ?? track
      set({ isPlaying: true })
      const ok = await scheduler.crossfadeToManualTrack(hydratedTrack, contextTracks)
      if (!ok) {
        syncTelemetryOnce()
        return
      }
      set({ isPlaying: true })
      syncTelemetryOnce()
      ensureTelemetryLoop()
    },

    togglePlayPause: async () => {
      if (!engine || !scheduler) return
      const snap = engine.getTelemetry()
      const activeDeck = snap.decks[snap.activeDeckId]

      if (get().isPlaying && (activeDeck.status === 'playing' || activeDeck.status === 'fading-in')) {
        await engine.pause()
        const stillRunning = syncTelemetryOnce()
        if (!stillRunning) {
          set({ isPlaying: false })
          stopTelemetryLoop()
        }
        return
      }

      if (activeDeck.track && (activeDeck.status === 'paused' || activeDeck.status === 'idle' || snap.transition.active)) {
        await engine.resume()
        set({ isPlaying: true })
        syncTelemetryOnce()
        ensureTelemetryLoop()
        return
      }

      // Idle: start from active playback list or Auto-DJ queue depending on mode
      const target = scheduler.getInitialTrackForPlay() ?? get().libraryTracks[0]
      if (target) {
        await get().playTrack(target)
      }
    },

    pausePlayback: async () => {
      if (!engine) return
      await engine.pause()
      const stillRunning = syncTelemetryOnce()
      if (!stillRunning) {
        set({ isPlaying: false })
        stopTelemetryLoop()
      }
    },

    stopPlayback: async () => {
      if (!engine) return
      await engine.pause()
      engine.seek(0)
      const stillRunning = syncTelemetryOnce()
      if (!stillRunning) {
        set({ isPlaying: false })
        stopTelemetryLoop()
      }
    },

    skipNext: async () => {
      if (!scheduler) return
      const ok = await scheduler.onSkipNext()
      if (!ok) {
        syncTelemetryOnce()
        return
      }
      set({ isPlaying: true })
      syncTelemetryOnce()
      ensureTelemetryLoop()
    },

    previousTrack: async () => {
      if (!scheduler) return
      const ok = await scheduler.onPreviousTrack()
      syncTelemetryOnce()
      if (ok) {
        set({ isPlaying: true })
        ensureTelemetryLoop()
      }
    },

    seek: (positionSec) => {
      if (!engine) return
      engine.seek(positionSec)
      syncTelemetryOnce()
    },

    triggerManualCrossfade: async () => {
      if (!scheduler) return
      set({ isPlaying: true })
      const ok = await scheduler.triggerManualCrossfadeNow()
      if (!ok) {
        get().pushToast({
          type: 'info',
          title: 'No Next Track Available',
          message: 'Add more tracks or adjust your Auto-DJ scope to mix next.'
        })
        syncTelemetryOnce()
        return
      }
      set({ isPlaying: true })
      syncTelemetryOnce()
      ensureTelemetryLoop()
    },

    setVolume: (volume) => {
      const clamped = Math.max(0, Math.min(1, volume))
      engine?.setMasterVolume(clamped)
      set({ volume: clamped })

      if (volumePersistTimer) clearTimeout(volumePersistTimer)
      volumePersistTimer = setTimeout(() => {
        volumePersistTimer = null
        void window.api.settings.set('volume', clamped).catch(() => {})
      }, 200)
    },

    toggleMute: () => {
      const nextMuted = !get().muted
      engine?.setMuted(nextMuted)
      set({ muted: nextMuted })
      void window.api.settings.set('muted', nextMuted).catch(() => {})
    },

    setShuffle: (enabled) => {
      scheduler?.setShuffle(enabled)
      set({ shuffle: enabled })
      void window.api.settings.set('shuffle', enabled).catch(() => {})
    },

    toggleShuffle: () => {
      get().setShuffle(!get().shuffle)
    },

    setRepeatMode: (mode) => {
      scheduler?.setRepeatMode(mode)
      set({ repeatMode: mode })
      void window.api.settings.set('repeatMode', mode).catch(() => {})
    },

    cycleRepeatMode: () => {
      const current = get().repeatMode
      const next: RepeatMode =
        current === 'off' ? 'all' : current === 'all' ? 'one' : 'off'
      get().setRepeatMode(next)
    },

    toggleAutoDj: () => {
      const current = get().autoDjConfig
      get().updateAutoDjConfig({ enabled: !current.enabled })
    },

    updateAutoDjConfig: (partial) => {
      const nextConfig: AutoDjConfig = {
        ...get().autoDjConfig,
        ...partial
      }
      scheduler?.setConfig(partial)
      set({ autoDjConfig: nextConfig })
      void window.api.settings.set('autoDj', nextConfig).catch(() => {})
    },

    updateAudioSettings: (partial) => {
      const next: AudioSettings = {
        ...get().audioSettings,
        ...partial
      }
      if (partial.replayGainEnabled !== undefined) {
        engine?.setReplayGainEnabled(next.replayGainEnabled)
      }
      if (partial.limiterEnabled !== undefined) {
        engine?.setLimiterEnabled(next.limiterEnabled)
      }
      if (partial.manualCrossfadeSec !== undefined) {
        scheduler?.setAudioOptions({ manualCrossfadeSec: next.manualCrossfadeSec })
      }
      set({ audioSettings: next })
      syncTelemetryOnce()
      void window.api.settings.set('audio', next).catch(() => {})
    },

    updateAppearanceSettings: (partial) => {
      const next: AppearanceSettings = {
        ...get().appearanceSettings,
        ...partial
      }
      set({ appearanceSettings: next })
      void window.api.settings.set('appearance', next).catch(() => {})
    },

    updateLibrarySettings: (partial) => {
      const next: LibrarySettings = {
        ...get().librarySettings,
        ...partial
      }
      if (partial.autoAnalyzeEnabled !== undefined) {
        if (next.autoAnalyzeEnabled) {
          analysisManager?.resume()
        } else {
          analysisManager?.pause()
        }
      }
      if (partial.earlySkipThresholdSec !== undefined) {
        scheduler?.setAudioOptions({ earlySkipThresholdSec: next.earlySkipThresholdSec })
      }
      set({ librarySettings: next })
      void window.api.settings.set('library', next).catch(() => {})
    },

    pauseAnalysis: () => {
      analysisManager?.pause()
    },

    resumeAnalysis: () => {
      analysisManager?.resume()
    },

    resetAllDeckEq: () => {
      engine?.resetAllDeckEq()
      syncTelemetryOnce()
    },

    resetAllSettings: async () => {
      const defaults = DEFAULT_APP_SETTINGS
      engine?.setMasterVolume(defaults.volume)
      engine?.setMuted(defaults.muted)
      engine?.setReplayGainEnabled(defaults.audio.replayGainEnabled)
      engine?.setLimiterEnabled(defaults.audio.limiterEnabled)
      engine?.resetAllDeckEq()

      scheduler?.setShuffle(defaults.shuffle)
      scheduler?.setRepeatMode(defaults.repeatMode)
      scheduler?.setConfig(defaults.autoDj)
      scheduler?.setAudioOptions({
        manualCrossfadeSec: defaults.audio.manualCrossfadeSec,
        earlySkipThresholdSec: defaults.library.earlySkipThresholdSec
      })

      if (defaults.library.autoAnalyzeEnabled) {
        analysisManager?.resume()
      } else {
        analysisManager?.pause()
      }

      set({
        volume: defaults.volume,
        muted: defaults.muted,
        shuffle: defaults.shuffle,
        repeatMode: defaults.repeatMode,
        autoDjConfig: { ...defaults.autoDj },
        audioSettings: { ...defaults.audio },
        appearanceSettings: { ...defaults.appearance },
        librarySettings: { ...defaults.library },
        sidebarCollapsed: defaults.sidebarCollapsed,
        autoCheckUpdates: defaults.autoCheckUpdates
      })
      syncTelemetryOnce()

      await Promise.all([
        window.api.settings.set('volume', defaults.volume),
        window.api.settings.set('muted', defaults.muted),
        window.api.settings.set('shuffle', defaults.shuffle),
        window.api.settings.set('repeatMode', defaults.repeatMode),
        window.api.settings.set('autoDj', defaults.autoDj),
        window.api.settings.set('audio', defaults.audio),
        window.api.settings.set('appearance', defaults.appearance),
        window.api.settings.set('library', defaults.library),
        window.api.settings.set('sidebarCollapsed', defaults.sidebarCollapsed),
        window.api.settings.set('autoCheckUpdates', defaults.autoCheckUpdates)
      ]).catch(() => {})
    },

    toggleQueueLock: (index) => {
      scheduler?.toggleLock(index)
    },

    reorderQueue: (fromIndex, toIndex) => {
      scheduler?.reorderQueue(fromIndex, toIndex)
    },

    removeFromQueue: (index) => {
      scheduler?.removeFromQueue(index)
    },

    rerollQueue: () => {
      scheduler?.rerollQueue()
    },

    addTrackToAutoDjQueue: (track) => {
      scheduler?.addTrackToQueue(track)
    },

    setDeckEq: (deckId, band, gainDb) => {
      engine?.setDeckEq(deckId, band, gainDb)
      syncTelemetryOnce()
    },

    loadTrackToDeck: async (deckId, track, options) => {
      if (!engine) return
      const hydratedTrack = hydrateTrackPeaks(track) ?? track
      // Push immediate loading state into telemetry and start RAF loop if needed
      const ok = await engine.loadTrackToDeck(deckId, hydratedTrack, options)
      const keepRunning = syncTelemetryOnce()
      if (ok) {
        const snap = engine.getTelemetry()
        const activeDeckTrack = snap.decks[snap.activeDeckId].track
        if (activeDeckTrack) {
          scheduler?.syncManualActiveTrack(activeDeckTrack)
        }
      }
      if (keepRunning) {
        ensureTelemetryLoop()
      }
    },

    unloadDeck: (deckId) => {
      if (!engine) return
      engine.unloadDeck(deckId)
      const keepRunning = syncTelemetryOnce()
      const snap = engine.getTelemetry()
      scheduler?.syncManualActiveTrack(snap.decks[snap.activeDeckId].track)
      if (!keepRunning) {
        stopTelemetryLoop()
      }
    },

    toggleDeckPlayPause: async (deckId) => {
      if (!engine) return
      await engine.toggleDeckPlayPause(deckId)
      const keepRunning = syncTelemetryOnce()
      const snap = engine.getTelemetry()
      const activeDeckTrack = snap.decks[snap.activeDeckId].track
      if (activeDeckTrack) {
        scheduler?.syncManualActiveTrack(activeDeckTrack)
      }
      if (keepRunning) {
        ensureTelemetryLoop()
      } else {
        stopTelemetryLoop()
      }
    },

    seekDeck: (deckId, timeSec) => {
      if (!engine) return
      engine.seekDeck(deckId, timeSec)
      syncTelemetryOnce()
    },

    setDeckPlaybackRate: (deckId, rate) => {
      if (!engine) return
      engine.setDeckPlaybackRate(deckId, rate)
      syncTelemetryOnce()
    },

    nudgeDeckPlaybackRate: (deckId, delta) => {
      if (!engine) return
      engine.nudgeDeckPlaybackRate(deckId, delta)
      syncTelemetryOnce()
    },

    syncDeckBpm: (deckId) => {
      if (!engine) return
      engine.syncDeckBpm(deckId)
      syncTelemetryOnce()
    },

    setDeckCuePoint: (deckId, sec) => {
      if (!engine) return
      engine.setDeckCuePoint(deckId, sec)
      syncTelemetryOnce()
    },

    jumpToDeckCue: (deckId) => {
      if (!engine) return
      engine.jumpToDeckCue(deckId)
      syncTelemetryOnce()
    },

    toggleDeckLoop: (deckId, beats) => {
      if (!engine) return
      const current = engine.getTelemetry().decks[deckId]
      const nextEnabled =
        beats !== undefined && current.loopEnabled && current.loopBeats !== beats
          ? true
          : !current.loopEnabled
      engine.setDeckLoop(deckId, nextEnabled, beats)
      syncTelemetryOnce()
    },

    setDeckLoopBeats: (deckId, beats) => {
      if (!engine) return
      engine.setDeckLoopBeats(deckId, beats)
      syncTelemetryOnce()
    },

    setDeckChannelGain: (deckId, gain) => {
      if (!engine) return
      engine.setDeckChannelGain(deckId, gain)
      syncTelemetryOnce()
    },

    setDeckFilter: (deckId, value) => {
      if (!engine) return
      engine.setDeckFilter(deckId, value)
      syncTelemetryOnce()
    },

    toggleDeckEqKill: (deckId, band) => {
      if (!engine) return
      const current = engine.getTelemetry().decks[deckId]
      engine.setDeckEqKill(deckId, band, !current.eqKill[band])
      syncTelemetryOnce()
    },

    resetDeckEq: (deckId) => {
      if (!engine) return
      engine.resetDeckEq(deckId)
      syncTelemetryOnce()
    },

    setCrossfader: (position) => {
      if (!engine) return
      engine.setManualCrossfader(position)
      const keepRunning = syncTelemetryOnce()
      const snap = engine.getTelemetry()
      const activeDeckTrack = snap.decks[snap.activeDeckId].track
      if (activeDeckTrack) {
        scheduler?.syncManualActiveTrack(activeDeckTrack)
      }
      if (keepRunning) {
        ensureTelemetryLoop()
      }
    },

    setSidebarCollapsed: (collapsed) => {
      set({ sidebarCollapsed: collapsed })
      void window.api.settings.set('sidebarCollapsed', collapsed).catch(() => {})
    },

    setAutoCheckUpdates: (enabled) => {
      set({ autoCheckUpdates: enabled })
      void window.api.settings.set('autoCheckUpdates', enabled).catch(() => {})
    },

    checkForUpdates: async () => {
      try {
        const next = await window.api.updater.checkForUpdates()
        set({ updateState: next })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unable to check for updates.'
        get().pushToast({
          type: 'error',
          title: 'Update Check Failed',
          message
        })
      }
    },

    downloadUpdate: async () => {
      try {
        const next = await window.api.updater.downloadUpdate()
        set({ updateState: next })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unable to download update.'
        get().pushToast({
          type: 'error',
          title: 'Update Download Failed',
          message
        })
      }
    },

    installUpdate: async () => {
      try {
        await window.api.updater.quitAndInstall()
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unable to install update.'
        get().pushToast({
          type: 'error',
          title: 'Update Install Failed',
          message
        })
      }
    },

    openUpdateReleasePage: async () => {
      try {
        await window.api.updater.openReleasePage()
      } catch {
        // Ignore external browser errors
      }
    },

    setNowPlayingOpen: (open, tab) => {
      set((state) => ({
        nowPlayingOpen: open,
        nowPlayingTab: tab ?? state.nowPlayingTab
      }))
    },

    setNowPlayingTab: (tab) => {
      set({ nowPlayingTab: tab })
    },

    setMiniPlayer: async (enabled) => {
      set({ isMiniPlayer: enabled })
      try {
        await window.api.window.setMiniPlayer(enabled)
      } catch {
        // Ignore window IPC error
      }
    },

    minimizeWindow: () => {
      void window.api.window.minimize().catch(() => {})
    },

    toggleMaximizeWindow: () => {
      void window.api.window
        .maximizeToggle()
        .then((isMaximized) => set({ isMaximized }))
        .catch(() => {})
    },

    closeWindow: () => {
      void window.api.window.close().catch(() => {})
    },

    pushToast: (toast) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      set((state) => ({
        toasts: [...state.toasts.slice(-3), { ...toast, id }]
      }))
      setTimeout(() => {
        get().dismissToast(id)
      }, 4500)
    },

    dismissToast: (id) => {
      set((state) => ({
        toasts: state.toasts.filter((t) => t.id !== id)
      }))
    },

    getFrequencyData: (target) => {
      if (!engine) return target ?? new Uint8Array(1024)
      return engine.getFrequencyData(target)
    }
  }
})
