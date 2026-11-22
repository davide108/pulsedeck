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
  type LibrarySettings,
  type RepeatMode,
  type TrackRecord
} from '@shared/types'

export type NowPlayingTab = 'visualizer' | 'lyrics' | 'decks'

export interface ToastMessage {
  id: string
  type: 'error' | 'info'
  title: string
  message: string
}

const EMPTY_TELEMETRY: EngineTelemetrySnapshot = {
  activeDeckId: 'A',
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
      eq: { low: 0, mid: 0, high: 0 }
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
      eq: { low: 0, mid: 0, high: 0 }
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
  setDeckEq: (deckId: DeckId, band: keyof DeckEqState, gainDb: number) => void

  setSidebarCollapsed: (collapsed: boolean) => void
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
  const stopTelemetryLoop = () => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
  }

  const syncTelemetryOnce = (): boolean => {
    if (!engine) return false
    const snap = engine.getTelemetry()
    const activeDeck = snap.decks[snap.activeDeckId]
    const activeRunning =
      activeDeck.status === 'playing' ||
      activeDeck.status === 'fading-in' ||
      activeDeck.status === 'fading-out' ||
      activeDeck.status === 'loading' ||
      snap.transition.active

    const nextIsPlaying =
      activeDeck.status === 'idle' || activeDeck.status === 'paused'
        ? false
        : get().isPlaying

    set({ telemetry: snap, isPlaying: nextIsPlaying })
    return activeRunning && (nextIsPlaying || activeDeck.status === 'loading')
  }

  const ensureTelemetryLoop = () => {
    if (rafId !== null) return
    const tick = () => {
      rafId = null
      const keepGoing = syncTelemetryOnce()
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
        sidebarCollapsed: settings.sidebarCollapsed
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

      return () => {
        stopTelemetryLoop()
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
      set((state) => {
        const hasTrack = state.libraryTracks.some((t) => t.id === track.id)
        const nextLibraryTracks = hasTrack
          ? state.libraryTracks.map((t) => (t.id === track.id ? track : t))
          : state.libraryTracks
        const nextActiveTrack =
          state.activeTrack?.id === track.id ? track : state.activeTrack
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
      set({ isPlaying: true })
      const ok = await scheduler.onManualTrackSelect(track, contextTracks)
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
      set({ isPlaying: true })
      const ok = await scheduler.crossfadeToManualTrack(track, contextTracks)
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
        set({ isPlaying: false })
        syncTelemetryOnce()
        stopTelemetryLoop()
        return
      }

      if (activeDeck.track && (activeDeck.status === 'paused' || snap.transition.active)) {
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
      set({ isPlaying: false })
      syncTelemetryOnce()
      stopTelemetryLoop()
    },

    stopPlayback: async () => {
      if (!engine) return
      await engine.pause()
      engine.seek(0)
      set({ isPlaying: false })
      syncTelemetryOnce()
      stopTelemetryLoop()
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
        sidebarCollapsed: defaults.sidebarCollapsed
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
        window.api.settings.set('sidebarCollapsed', defaults.sidebarCollapsed)
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

    setDeckEq: (deckId, band, gainDb) => {
      engine?.setDeckEq(deckId, band, gainDb)
      syncTelemetryOnce()
    },

    setSidebarCollapsed: (collapsed) => {
      set({ sidebarCollapsed: collapsed })
      void window.api.settings.set('sidebarCollapsed', collapsed).catch(() => {})
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
