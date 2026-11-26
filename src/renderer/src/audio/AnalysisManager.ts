import type { TrackAnalysisPayload, TrackRecord } from '../../../shared/types'
import type { AnalyzerWorkerRequest, AnalyzerWorkerResponse } from './analyzer.worker'

export interface AnalysisProgress {
  running: boolean
  completed: number
  total: number
  failed: number
  currentTrackId: number | null
  currentTitle: string | null
}

type ProgressListener = (progress: AnalysisProgress) => void
type AnalyzedListener = (payload: TrackAnalysisPayload) => void

const TARGET_SAMPLE_RATE = 22050
const FETCH_BATCH_LIMIT = 50
const WORKER_TIMEOUT_MS = 45_000
const IDLE_DISPOSE_MS = 20_000

/**
 * Mixes multi-channel AudioBuffer down to mono and resamples to 22050 Hz,
 * applying a simple box-averaging pre-filter when downsampling to limit aliasing.
 */
function mixdownAndResample(buffer: AudioBuffer, targetRate: number): Float32Array {
  const numChannels = Math.max(1, buffer.numberOfChannels)
  const srcRate = buffer.sampleRate
  const srcLength = buffer.length

  if (srcLength === 0 || srcRate <= 0) {
    return new Float32Array(0)
  }

  const channels: Float32Array[] = []
  for (let c = 0; c < numChannels; c++) {
    channels.push(buffer.getChannelData(c))
  }

  const ratio = srcRate / targetRate
  const targetLength = Math.max(1, Math.floor(srcLength / ratio))
  const mono = new Float32Array(targetLength)
  const invChannels = 1 / numChannels

  if (Math.abs(ratio - 1) < 0.001) {
    for (let i = 0; i < targetLength; i++) {
      let sum = 0
      for (let c = 0; c < numChannels; c++) {
        sum += channels[c][i]
      }
      mono[i] = sum * invChannels
    }
    return mono
  }

  if (ratio > 1) {
    // Downsampling: average samples inside each destination bin to suppress high-frequency aliasing
    for (let i = 0; i < targetLength; i++) {
      const start = Math.floor(i * ratio)
      const end = Math.min(srcLength, Math.max(start + 1, Math.floor((i + 1) * ratio)))
      let sum = 0
      const span = end - start
      for (let s = start; s < end; s++) {
        let chSum = 0
        for (let c = 0; c < numChannels; c++) {
          chSum += channels[c][s]
        }
        sum += chSum * invChannels
      }
      mono[i] = sum / span
    }
    return mono
  }

  // Upsampling (e.g. 16kHz / 11kHz -> 22050Hz): linear interpolation
  for (let i = 0; i < targetLength; i++) {
    const srcPos = i * ratio
    const idx0 = Math.floor(srcPos)
    const idx1 = Math.min(srcLength - 1, idx0 + 1)
    const frac = srcPos - idx0
    let s0 = 0
    let s1 = 0
    for (let c = 0; c < numChannels; c++) {
      s0 += channels[c][idx0]
      s1 += channels[c][idx1]
    }
    mono[i] = (s0 + (s1 - s0) * frac) * invChannels
  }
  return mono
}

export class AnalysisManager {
  private worker: Worker | null = null
  private decodeCtx: AudioContext | null = null
  private abortController: AbortController | null = null

  private queue: TrackRecord[] = []
  private queuedIds = new Set<number>()
  private failedIds = new Set<number>()
  private running = false
  private disposed = false
  private paused = false
  private kickTimer: ReturnType<typeof setTimeout> | null = null
  private idleDisposeTimer: ReturnType<typeof setTimeout> | null = null

  private progress: AnalysisProgress = {
    running: false,
    completed: 0,
    total: 0,
    failed: 0,
    currentTrackId: null,
    currentTitle: null
  }

  private progressListeners = new Set<ProgressListener>()
  private analyzedListeners = new Set<AnalyzedListener>()

  onProgress(listener: ProgressListener): () => void {
    this.progressListeners.add(listener)
    listener({ ...this.progress })
    return () => {
      this.progressListeners.delete(listener)
    }
  }

  onTrackAnalyzed(listener: AnalyzedListener): () => void {
    this.analyzedListeners.add(listener)
    return () => {
      this.analyzedListeners.delete(listener)
    }
  }

  getProgress(): AnalysisProgress {
    return { ...this.progress }
  }

  private emitProgress(): void {
    const snapshot = { ...this.progress }
    for (const listener of this.progressListeners) {
      try {
        listener(snapshot)
      } catch {
        // Ignore subscriber errors
      }
    }
  }

  private clearIdleDisposeTimer(): void {
    if (this.idleDisposeTimer) {
      clearTimeout(this.idleDisposeTimer)
      this.idleDisposeTimer = null
    }
  }

  private scheduleIdleDispose(): void {
    this.clearIdleDisposeTimer()
    if (this.disposed) return
    this.idleDisposeTimer = setTimeout(() => {
      this.idleDisposeTimer = null
      if (this.disposed || this.running || this.queue.length > 0) return
      if (this.worker) {
        this.worker.terminate()
        this.worker = null
      }
      if (this.decodeCtx) {
        void this.decodeCtx.close().catch(() => {})
        this.decodeCtx = null
      }
    }, IDLE_DISPOSE_MS)
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker
    this.worker = new Worker(new URL('./analyzer.worker.ts', import.meta.url), {
      type: 'module'
    })
    return this.worker
  }

  private ensureDecodeContext(): AudioContext {
    if (!this.decodeCtx || this.decodeCtx.state === 'closed') {
      this.decodeCtx = new AudioContext()
      void this.decodeCtx.suspend().catch(() => {})
    }
    return this.decodeCtx
  }

  /**
   * Schedules a debounced fetch of pending tracks and starts background analysis.
   */
  scheduleCheck(delayMs = 350): void {
    if (this.disposed) return
    if (this.kickTimer) {
      clearTimeout(this.kickTimer)
    }
    this.kickTimer = setTimeout(() => {
      this.kickTimer = null
      void this.start()
    }, delayMs)
  }

  enqueueTracks(tracks: TrackRecord[]): void {
    if (this.disposed) return
    let added = 0
    for (const track of tracks) {
      if (track.isMissing || track.analysisStatus !== 'pending') continue
      if (this.queuedIds.has(track.id) || this.failedIds.has(track.id)) continue
      this.queuedIds.add(track.id)
      this.queue.push(track)
      added++
    }
    if (added > 0) {
      this.clearIdleDisposeTimer()
      this.progress.total += added
      this.emitProgress()
      if (!this.running && !this.paused) {
        void this.processQueue()
      }
    }
  }

  async start(): Promise<void> {
    if (this.disposed || this.paused) return
    if (this.running) return

    // Reset session counters when starting a fresh pass if previous queue finished
    if (this.queue.length === 0) {
      this.progress.completed = 0
      this.progress.failed = 0
      this.progress.total = 0
    }

    await this.refillQueueFromDb()
    if (this.queue.length > 0 && !this.running && !this.paused && !this.disposed) {
      void this.processQueue()
    }
  }

  pause(): void {
    this.paused = true
    this.abortController?.abort()
    this.progress.running = false
    this.emitProgress()
  }

  resume(): void {
    if (this.disposed) return
    this.clearIdleDisposeTimer()
    this.paused = false
    void this.start()
  }

  dispose(): void {
    this.disposed = true
    this.paused = true
    this.clearIdleDisposeTimer()
    if (this.kickTimer) {
      clearTimeout(this.kickTimer)
      this.kickTimer = null
    }
    this.abortController?.abort()
    this.abortController = null
    this.queue = []
    this.queuedIds.clear()
    this.failedIds.clear()
    if (this.worker) {
      this.worker.terminate()
      this.worker = null
    }
    if (this.decodeCtx) {
      void this.decodeCtx.close().catch(() => {})
      this.decodeCtx = null
    }
    this.progressListeners.clear()
    this.analyzedListeners.clear()
  }

  private async refillQueueFromDb(): Promise<number> {
    if (this.disposed || typeof window === 'undefined' || !window.api?.tracks) return 0
    try {
      const pending = await window.api.tracks.getPendingAnalysis(FETCH_BATCH_LIMIT)
      let added = 0
      for (const track of pending) {
        if (track.isMissing || this.queuedIds.has(track.id) || this.failedIds.has(track.id)) continue
        this.queuedIds.add(track.id)
        this.queue.push(track)
        added++
      }
      if (added > 0) {
        this.progress.total += added
        this.emitProgress()
      }
      return added
    } catch {
      return 0
    }
  }

  private async processQueue(): Promise<void> {
    if (this.running || this.disposed || this.paused) return
    this.clearIdleDisposeTimer()
    this.running = true
    this.progress.running = true
    this.emitProgress()

    try {
      while (!this.disposed && !this.paused) {
        if (this.queue.length === 0) {
          const added = await this.refillQueueFromDb()
          if (added === 0) break
        }

        const track = this.queue.shift()
        if (!track) break

        this.progress.currentTrackId = track.id
        this.progress.currentTitle = track.title
        this.emitProgress()

        await this.analyzeSingleTrack(track)

        // Yield briefly to keep UI responsive
        await new Promise((resolve) => setTimeout(resolve, 16))
      }
    } finally {
      this.running = false
      this.progress.running = false
      this.progress.currentTrackId = null
      this.progress.currentTitle = null
      this.emitProgress()
      if (!this.disposed && this.queue.length === 0) {
        this.scheduleIdleDispose()
      }
    }
  }

  private async decodeTrackToMono22k(
    trackId: number,
    signal: AbortSignal
  ): Promise<{ pcm: Float32Array; duration: number } | { missing: true } | { failed: true }> {
    const response = await fetch(`media://track/${trackId}`, { signal })
    if (response.status === 404) {
      return { missing: true }
    }
    if (!response.ok) {
      return { failed: true }
    }

    const compressed = await response.arrayBuffer()
    if (signal.aborted) return { failed: true }

    const ctx = this.ensureDecodeContext()
    let decoded: AudioBuffer | null = await ctx.decodeAudioData(compressed)
    const duration = decoded.duration
    const pcm = mixdownAndResample(decoded, TARGET_SAMPLE_RATE)
    // Drop decoded AudioBuffer reference immediately to keep renderer memory bounded
    decoded = null

    return { pcm, duration }
  }

  private runWorkerAnalysis(request: AnalyzerWorkerRequest): Promise<AnalyzerWorkerResponse> {
    return new Promise((resolve, reject) => {
      const worker = this.ensureWorker()
      let settled = false

      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        worker.onmessage = null
        worker.onerror = null
        // Recycle hung worker so queue keeps moving
        worker.terminate()
        this.worker = null
        reject(new Error('Analyzer worker timed out'))
      }, WORKER_TIMEOUT_MS)

      worker.onmessage = (event: MessageEvent<AnalyzerWorkerResponse>) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        worker.onmessage = null
        worker.onerror = null
        resolve(event.data)
      }

      worker.onerror = (err) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        worker.onmessage = null
        worker.onerror = null
        worker.terminate()
        this.worker = null
        reject(new Error(err.message || 'Analyzer worker error'))
      }

      worker.postMessage(request, [request.pcm.buffer])
    })
  }

  private async analyzeSingleTrack(track: TrackRecord): Promise<void> {
    const controller = new AbortController()
    this.abortController = controller

    try {
      const decodedResult = await this.decodeTrackToMono22k(track.id, controller.signal)

      if ('missing' in decodedResult) {
        this.failedIds.add(track.id)
        await window.api.tracks.markMissing(track.id, true)
        this.progress.failed++
        this.progress.completed++
        this.emitProgress()
        return
      }

      if ('failed' in decodedResult || decodedResult.pcm.length === 0) {
        this.failedIds.add(track.id)
        await this.persistFailure(track)
        return
      }

      const payload = await this.runWorkerAnalysis({
        trackId: track.id,
        pcm: decodedResult.pcm,
        sampleRate: TARGET_SAMPLE_RATE,
        duration: decodedResult.duration || track.duration,
        existingBpm: track.bpm,
        existingCamelotKey: track.camelotKey
      })

      const savePayload: TrackAnalysisPayload = {
        trackId: track.id,
        bpm: payload.bpm,
        bpmSource: payload.bpmSource,
        musicalKey: payload.musicalKey,
        camelotKey: payload.camelotKey,
        keySource: payload.keySource,
        replaygainDb: payload.replaygainDb,
        energy: payload.energy,
        waveformPeaks: payload.waveformPeaks,
        introCueSec: payload.introCueSec,
        outroCueSec: payload.outroCueSec,
        status: payload.status
      }

      await window.api.tracks.saveAnalysis(savePayload)

      if (savePayload.status === 'failed') {
        this.failedIds.add(track.id)
        this.progress.failed++
      }
      this.progress.completed++
      this.emitProgress()

      for (const listener of this.analyzedListeners) {
        try {
          listener(savePayload)
        } catch {
          // Ignore subscriber errors
        }
      }
    } catch {
      if (this.paused || this.disposed) {
        return
      }
      this.failedIds.add(track.id)
      await this.persistFailure(track)
    } finally {
      this.queuedIds.delete(track.id)
      if (this.abortController === controller) {
        this.abortController = null
      }
    }
  }

  private async persistFailure(track: TrackRecord): Promise<void> {
    const failedPayload: TrackAnalysisPayload = {
      trackId: track.id,
      bpm: track.bpm,
      bpmSource: track.bpmSource,
      musicalKey: track.musicalKey,
      camelotKey: track.camelotKey,
      keySource: track.keySource,
      replaygainDb: 0,
      energy: 0,
      waveformPeaks: [],
      introCueSec: 0,
      outroCueSec: track.duration || 0,
      status: 'failed'
    }
    try {
      await window.api.tracks.saveAnalysis(failedPayload)
    } catch {
      // Ignore DB save failure to keep queue alive
    }
    this.progress.failed++
    this.progress.completed++
    this.emitProgress()
  }
}
