import { camelotToMusicalName, parseKeyToCamelot } from '../../../shared/camelot'
import type { TrackAnalysisPayload } from '../../../shared/types'

export interface AnalyzerWorkerRequest {
  trackId: number
  pcm: Float32Array
  sampleRate: number
  duration: number
  existingBpm: number | null
  existingCamelotKey: string | null
}

export type AnalyzerWorkerResponse = TrackAnalysisPayload & {
  error?: string
}

interface WorkerGlobalLike {
  onmessage: ((event: MessageEvent<AnalyzerWorkerRequest>) => void) | null
  postMessage: (message: AnalyzerWorkerResponse, transfer?: Transferable[]) => void
}

const workerScope = self as unknown as WorkerGlobalLike

const KS_MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
const KS_MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
const PC_NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'] as const

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val))
}

function createHannWindow(size: number): Float32Array {
  const win = new Float32Array(size)
  const denom = size - 1
  for (let i = 0; i < size; i++) {
    win[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / denom))
  }
  return win
}

/**
 * In-place iterative Cooley-Tukey Radix-2 FFT.
 * `n` must be a power of 2.
 */
function radix2Fft(re: Float32Array, im: Float32Array, n: number): void {
  // Bit-reversal permutation
  let j = 0
  for (let i = 0; i < n; i++) {
    if (i < j) {
      const tr = re[i]
      re[i] = re[j]
      re[j] = tr
      const ti = im[i]
      im[i] = im[j]
      im[j] = ti
    }
    let m = n >> 1
    while (m >= 1 && j >= m) {
      j -= m
      m >>= 1
    }
    j += m
  }

  // Butterfly stages
  for (let len = 2; len <= n; len <<= 1) {
    const halfLen = len >> 1
    const angle = (-2 * Math.PI) / len
    const wStepRe = Math.cos(angle)
    const wStepIm = Math.sin(angle)

    for (let start = 0; start < n; start += len) {
      let wRe = 1
      let wIm = 0
      for (let k = 0; k < halfLen; k++) {
        const evenIdx = start + k
        const oddIdx = evenIdx + halfLen
        const tRe = wRe * re[oddIdx] - wIm * im[oddIdx]
        const tIm = wRe * im[oddIdx] + wIm * re[oddIdx]

        re[oddIdx] = re[evenIdx] - tRe
        im[oddIdx] = im[evenIdx] - tIm
        re[evenIdx] += tRe
        im[evenIdx] += tIm

        const nextWRe = wRe * wStepRe - wIm * wStepIm
        wIm = wRe * wStepIm + wIm * wStepRe
        wRe = nextWRe
      }
    }
  }
}

function computeWaveformPeaks(pcm: Float32Array, numPeaks = 200): number[] {
  const peaks = new Array<number>(numPeaks).fill(0)
  if (pcm.length === 0) return peaks

  let maxPeak = 0
  for (let i = 0; i < numPeaks; i++) {
    const start = Math.floor((i * pcm.length) / numPeaks)
    const end = Math.max(start + 1, Math.floor(((i + 1) * pcm.length) / numPeaks))
    let bucketMax = 0
    for (let s = start; s < end && s < pcm.length; s++) {
      const abs = Math.abs(pcm[s])
      if (abs > bucketMax) bucketMax = abs
    }
    peaks[i] = bucketMax
    if (bucketMax > maxPeak) maxPeak = bucketMax
  }

  if (maxPeak > 1e-6) {
    for (let i = 0; i < numPeaks; i++) {
      peaks[i] = Number((peaks[i] / maxPeak).toFixed(3))
    }
  }
  return peaks
}

function computeSilenceCues(
  pcm: Float32Array,
  sampleRate: number,
  duration: number
): { introCueSec: number; outroCueSec: number } {
  const safeDuration = duration > 0 ? duration : pcm.length / Math.max(1, sampleRate)
  if (pcm.length === 0 || sampleRate <= 0) {
    return { introCueSec: 0, outroCueSec: safeDuration }
  }

  const winSamples = Math.max(64, Math.floor(sampleRate * 0.05))
  const introThresh = Math.pow(10, -42 / 20) // -42 dBFS
  const outroThresh = Math.pow(10, -38 / 20) // -38 dBFS

  let introCueSec = 0
  let foundIntro = false
  for (let start = 0; start < pcm.length; start += winSamples) {
    const end = Math.min(pcm.length, start + winSamples)
    let sumSq = 0
    for (let i = start; i < end; i++) {
      const v = pcm[i]
      sumSq += v * v
    }
    const rms = Math.sqrt(sumSq / (end - start))
    if (rms >= introThresh) {
      introCueSec = start / sampleRate
      foundIntro = true
      break
    }
  }

  if (!foundIntro) {
    return { introCueSec: 0, outroCueSec: Number(safeDuration.toFixed(3)) }
  }

  let outroCueSec = safeDuration
  for (let end = pcm.length; end > 0; end -= winSamples) {
    const start = Math.max(0, end - winSamples)
    let sumSq = 0
    for (let i = start; i < end; i++) {
      const v = pcm[i]
      sumSq += v * v
    }
    const rms = Math.sqrt(sumSq / (end - start))
    if (rms >= outroThresh) {
      outroCueSec = Math.min(safeDuration, end / sampleRate)
      break
    }
  }

  introCueSec = clamp(introCueSec, 0, Math.max(0, safeDuration * 0.45))
  outroCueSec = clamp(outroCueSec, Math.min(safeDuration, introCueSec + 0.5), safeDuration)

  return {
    introCueSec: Number(introCueSec.toFixed(3)),
    outroCueSec: Number(outroCueSec.toFixed(3))
  }
}

function computeGatedReplayGainAndEnergy(
  pcm: Float32Array,
  sampleRate: number
): { replaygainDb: number; energy: number; activeDbfs: number } {
  if (pcm.length === 0 || sampleRate <= 0) {
    return { replaygainDb: 0, energy: 0, activeDbfs: -60 }
  }

  const blockSamples = Math.max(256, Math.floor(sampleRate * 0.4))
  const hopSamples = Math.max(128, Math.floor(blockSamples * 0.5))
  const absGateSq = Math.pow(10, -60 / 10) // -60 dBFS power

  const blockPowers: number[] = []
  let sumAllAboveAbs = 0
  let countAboveAbs = 0

  for (let start = 0; start < pcm.length; start += hopSamples) {
    const end = Math.min(pcm.length, start + blockSamples)
    if (end - start < blockSamples / 4) break
    let sumSq = 0
    for (let i = start; i < end; i++) {
      const v = pcm[i]
      sumSq += v * v
    }
    const meanSq = sumSq / (end - start)
    if (meanSq >= absGateSq) {
      blockPowers.push(meanSq)
      sumAllAboveAbs += meanSq
      countAboveAbs++
    }
  }

  if (countAboveAbs === 0) {
    return { replaygainDb: 0, energy: 0.05, activeDbfs: -60 }
  }

  const avgAbsPower = sumAllAboveAbs / countAboveAbs
  const relGateSq = avgAbsPower * Math.pow(10, -10 / 10) // -10 dB relative gate

  let gatedSum = 0
  let gatedCount = 0
  for (let i = 0; i < blockPowers.length; i++) {
    if (blockPowers[i] >= relGateSq) {
      gatedSum += blockPowers[i]
      gatedCount++
    }
  }

  const finalPower = gatedCount > 0 ? gatedSum / gatedCount : avgAbsPower
  const activeDbfs = 10 * Math.log10(Math.max(finalPower, 1e-12))
  const replaygainDb = Number(clamp(-14 - activeDbfs, -12, 12).toFixed(2))

  // Loudness component mapped [-32 dBFS .. -6 dBFS] -> [0..1]
  const loudnessNorm = clamp((activeDbfs + 32) / 26, 0, 1)

  // Estimate rhythmic transient punch via 25ms RMS variance
  const shortWin = Math.max(64, Math.floor(sampleRate * 0.025))
  const step = Math.max(shortWin, Math.floor(pcm.length / 800))
  let shortMean = 0
  let shortSqMean = 0
  let shortCount = 0
  for (let start = 0; start + shortWin <= pcm.length; start += step) {
    let s = 0
    for (let i = start; i < start + shortWin; i++) {
      s += pcm[i] * pcm[i]
    }
    const rms = Math.sqrt(s / shortWin)
    shortMean += rms
    shortSqMean += rms * rms
    shortCount++
  }

  let dynamicPunch = 0.5
  if (shortCount > 1) {
    shortMean /= shortCount
    const variance = Math.max(0, shortSqMean / shortCount - shortMean * shortMean)
    const cv = shortMean > 1e-5 ? Math.sqrt(variance) / shortMean : 0
    dynamicPunch = clamp(cv / 1.1, 0, 1)
  }

  const energy = Number(clamp(0.72 * loudnessNorm + 0.28 * dynamicPunch, 0, 1).toFixed(3))
  return { replaygainDb, energy, activeDbfs }
}

function getSliceBounds(
  pcmLength: number,
  sampleRate: number,
  introCueSec: number,
  outroCueSec: number,
  maxSeconds: number
): { startSample: number; endSample: number } {
  const introIdx = Math.floor(introCueSec * sampleRate)
  const outroIdx = Math.min(pcmLength, Math.floor(outroCueSec * sampleRate))
  const activeLen = outroIdx - introIdx
  const maxSamples = Math.floor(maxSeconds * sampleRate)

  if (activeLen <= 0) {
    const end = Math.min(pcmLength, maxSamples)
    return { startSample: 0, endSample: end }
  }
  if (activeLen <= maxSamples) {
    return { startSample: introIdx, endSample: outroIdx }
  }
  const center = introIdx + Math.floor(activeLen / 2)
  const half = Math.floor(maxSamples / 2)
  const startSample = Math.max(introIdx, center - half)
  const endSample = Math.min(outroIdx, startSample + maxSamples)
  return { startSample, endSample }
}

function estimateBpm(
  pcm: Float32Array,
  sampleRate: number,
  introCueSec: number,
  outroCueSec: number
): number | null {
  const { startSample, endSample } = getSliceBounds(pcm.length, sampleRate, introCueSec, outroCueSec, 90)
  const sliceLen = endSample - startSample
  if (sliceLen < sampleRate * 5) return null

  const fftSize = 1024
  const hopSize = 256
  const numFrames = Math.floor((sliceLen - fftSize) / hopSize) + 1
  if (numFrames < 64) return null

  const win = createHannWindow(fftSize)
  const re = new Float32Array(fftSize)
  const im = new Float32Array(fftSize)
  const halfBins = fftSize / 2

  // 4 sub-bands in Hz mapped to FFT bins
  const hzPerBin = sampleRate / fftSize
  const b1 = Math.max(1, Math.floor(40 / hzPerBin))
  const b2 = Math.max(b1 + 1, Math.floor(160 / hzPerBin))
  const b3 = Math.max(b2 + 1, Math.floor(500 / hzPerBin))
  const b4 = Math.max(b3 + 1, Math.floor(2500 / hzPerBin))
  const b5 = Math.min(halfBins, Math.floor(8000 / hzPerBin))

  const prevBands = new Float32Array(4)
  const rawFlux = new Float32Array(numFrames)
  const weights = [1.6, 1.35, 1.0, 0.8]

  for (let f = 0; f < numFrames; f++) {
    const offset = startSample + f * hopSize
    for (let i = 0; i < fftSize; i++) {
      re[i] = pcm[offset + i] * win[i]
      im[i] = 0
    }
    radix2Fft(re, im, fftSize)

    const bands = [0, 0, 0, 0]
    for (let k = b1; k < b5; k++) {
      const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k])
      const logMag = Math.log1p(10 * mag)
      if (k < b2) bands[0] += logMag
      else if (k < b3) bands[1] += logMag
      else if (k < b4) bands[2] += logMag
      else bands[3] += logMag
    }

    bands[0] /= Math.max(1, b2 - b1)
    bands[1] /= Math.max(1, b3 - b2)
    bands[2] /= Math.max(1, b4 - b3)
    bands[3] /= Math.max(1, b5 - b4)

    if (f > 0) {
      let fluxSum = 0
      for (let b = 0; b < 4; b++) {
        const diff = bands[b] - prevBands[b]
        if (diff > 0) fluxSum += weights[b] * diff
      }
      rawFlux[f] = fluxSum
    }
    prevBands[0] = bands[0]
    prevBands[1] = bands[1]
    prevBands[2] = bands[2]
    prevBands[3] = bands[3]
  }

  // Adaptive local mean subtraction (~0.35s window)
  const fps = sampleRate / hopSize
  const meanRadius = Math.max(4, Math.round(0.18 * fps))
  const onset = new Float32Array(numFrames)
  let totalOnset = 0

  for (let f = 0; f < numFrames; f++) {
    const lo = Math.max(0, f - meanRadius)
    const hi = Math.min(numFrames - 1, f + meanRadius)
    let sum = 0
    for (let k = lo; k <= hi; k++) sum += rawFlux[k]
    const localMean = sum / (hi - lo + 1)
    const val = Math.max(0, rawFlux[f] - localMean * 1.05)
    onset[f] = val
    totalOnset += val
  }

  if (totalOnset <= 1e-6) return null

  const minBpm = 60
  const maxBpm = 185
  const lagMin = Math.max(2, Math.floor((60 * fps) / maxBpm))
  const lagMax = Math.min(numFrames - 2, Math.ceil((60 * fps) / minBpm))
  if (lagMax <= lagMin + 2) return null

  // Compute raw unbiased autocorrelation up to lagMax * 2 for harmonic reinforcement
  const maxHarmonicLag = Math.min(numFrames - 2, lagMax * 2 + 1)
  const rawAcf = new Float32Array(maxHarmonicLag + 1)
  for (let lag = lagMin; lag <= maxHarmonicLag; lag++) {
    let sum = 0
    const count = numFrames - lag
    for (let i = 0; i < count; i++) {
      sum += onset[i] * onset[i + lag]
    }
    rawAcf[lag] = sum / count
  }

  // Score lags with harmonic support (2*lag, 3*lag) and Gaussian 118 BPM prior
  const scores = new Float32Array(lagMax + 1)
  let bestLag = lagMin
  let bestScore = -1

  for (let lag = lagMin; lag <= lagMax; lag++) {
    const candBpm = (60 * fps) / lag
    const octDist = Math.log2(candBpm / 118)
    const prior = Math.exp(-0.5 * (octDist / 0.42) * (octDist / 0.42))

    let harmonicSupport = rawAcf[lag]
    if (lag * 2 <= maxHarmonicLag) {
      harmonicSupport += 0.35 * rawAcf[lag * 2]
    }
    const halfLag = Math.round(lag / 2)
    if (halfLag >= lagMin) {
      harmonicSupport += 0.15 * rawAcf[halfLag]
    }

    const score = harmonicSupport * (0.45 + 0.55 * prior)
    scores[lag] = score
    if (score > bestScore) {
      bestScore = score
      bestLag = lag
    }
  }

  if (bestScore <= 0) return null

  // Parabolic peak interpolation around bestLag
  let refinedLag = bestLag
  if (bestLag > lagMin && bestLag < lagMax) {
    const y1 = scores[bestLag - 1]
    const y2 = scores[bestLag]
    const y3 = scores[bestLag + 1]
    const denom = y1 - 2 * y2 + y3
    if (Math.abs(denom) > 1e-12) {
      const delta = clamp((0.5 * (y1 - y3)) / denom, -0.5, 0.5)
      refinedLag = bestLag + delta
    }
  }

  const bpm = clamp((60 * fps) / refinedLag, minBpm, maxBpm)
  return Number(bpm.toFixed(1))
}

function pearsonCorrelation(x: Float64Array, y: readonly number[], shift: number): number {
  const n = 12
  let sumX = 0
  let sumY = 0
  for (let i = 0; i < n; i++) {
    sumX += x[(i + shift) % n]
    sumY += y[i]
  }
  const meanX = sumX / n
  const meanY = sumY / n

  let num = 0
  let denX = 0
  let denY = 0
  for (let i = 0; i < n; i++) {
    const dx = x[(i + shift) % n] - meanX
    const dy = y[i] - meanY
    num += dx * dy
    denX += dx * dx
    denY += dy * dy
  }

  const den = Math.sqrt(denX * denY)
  return den > 1e-12 ? num / den : -1
}

function estimateCamelotKey(
  pcm: Float32Array,
  sampleRate: number,
  introCueSec: number,
  outroCueSec: number
): { camelotKey: string; musicalKey: string } | null {
  const { startSample, endSample } = getSliceBounds(pcm.length, sampleRate, introCueSec, outroCueSec, 60)
  const sliceLen = endSample - startSample
  const fftSize = 4096
  if (sliceLen < fftSize) return null

  const hopSize = 2048
  const win = createHannWindow(fftSize)
  const re = new Float32Array(fftSize)
  const im = new Float32Array(fftSize)

  const minFreq = 65 // ~C2
  const maxFreq = 2000 // ~B6
  const hzPerBin = sampleRate / fftSize
  const minBin = Math.max(1, Math.floor(minFreq / hzPerBin))
  const maxBin = Math.min(fftSize / 2 - 1, Math.ceil(maxFreq / hzPerBin))

  // Precompute bin -> fractional MIDI note mapping
  const binMidi = new Float64Array(maxBin + 1)
  for (let k = minBin; k <= maxBin; k++) {
    const freq = k * hzPerBin
    binMidi[k] = 69 + 12 * Math.log2(freq / 440)
  }

  const chroma = new Float64Array(12)
  let validFrames = 0

  for (let offset = startSample; offset + fftSize <= endSample; offset += hopSize) {
    let frameEnergy = 0
    for (let i = 0; i < fftSize; i++) {
      const sample = pcm[offset + i]
      frameEnergy += sample * sample
      re[i] = sample * win[i]
      im[i] = 0
    }
    if (frameEnergy / fftSize < 1e-7) continue

    radix2Fft(re, im, fftSize)
    validFrames++

    for (let k = minBin; k <= maxBin; k++) {
      const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k])
      if (mag <= 1e-6) continue

      const midi = binMidi[k]
      const nearest = Math.round(midi)
      const centsOffset = midi - nearest
      // Weight closely tuned frequencies higher to reduce spectral leakage
      const tuningWeight = Math.exp(-0.5 * (centsOffset / 0.35) * (centsOffset / 0.35))
      const pc = ((nearest % 12) + 12) % 12
      chroma[pc] += mag * tuningWeight
    }
  }

  if (validFrames === 0) return null

  let maxChroma = 0
  for (let i = 0; i < 12; i++) {
    if (chroma[i] > maxChroma) maxChroma = chroma[i]
  }
  if (maxChroma <= 1e-9) return null

  let bestCorr = -Infinity
  let bestTonic = 0
  let bestMinor = false

  for (let tonic = 0; tonic < 12; tonic++) {
    const majCorr = pearsonCorrelation(chroma, KS_MAJOR_PROFILE, tonic)
    if (majCorr > bestCorr) {
      bestCorr = majCorr
      bestTonic = tonic
      bestMinor = false
    }

    const minCorr = pearsonCorrelation(chroma, KS_MINOR_PROFILE, tonic)
    if (minCorr > bestCorr) {
      bestCorr = minCorr
      bestTonic = tonic
      bestMinor = true
    }
  }

  const rawKey = `${PC_NOTE_NAMES[bestTonic]}${bestMinor ? 'm' : ''}`
  const camelotKey = parseKeyToCamelot(rawKey)
  if (!camelotKey) return null

  return {
    camelotKey,
    musicalKey: camelotToMusicalName(camelotKey)
  }
}

function getValidTagBpm(existingBpm: number | null | undefined): number | null {
  if (
    existingBpm !== null &&
    existingBpm !== undefined &&
    Number.isFinite(existingBpm) &&
    existingBpm >= 50 &&
    existingBpm <= 210
  ) {
    return Number(existingBpm.toFixed(1))
  }
  return null
}

function analyzeTrackPcm(req: AnalyzerWorkerRequest): AnalyzerWorkerResponse {
  const { trackId, pcm, sampleRate, duration, existingBpm, existingCamelotKey } = req
  const safeDuration = duration > 0 ? duration : pcm.length / Math.max(1, sampleRate)
  const validTagBpm = getValidTagBpm(existingBpm)
  const parsedTagKey = parseKeyToCamelot(existingCamelotKey)

  if (!pcm || pcm.length === 0 || sampleRate <= 0) {
    return {
      trackId,
      bpm: validTagBpm,
      bpmSource: validTagBpm !== null ? 'tag' : null,
      musicalKey: parsedTagKey ? camelotToMusicalName(parsedTagKey) || null : null,
      camelotKey: parsedTagKey,
      keySource: parsedTagKey ? 'tag' : null,
      replaygainDb: 0,
      energy: 0,
      waveformPeaks: new Array<number>(200).fill(0),
      introCueSec: 0,
      outroCueSec: safeDuration,
      status: 'failed',
      error: 'Empty PCM buffer'
    }
  }

  const waveformPeaks = computeWaveformPeaks(pcm, 200)
  const { introCueSec, outroCueSec } = computeSilenceCues(pcm, sampleRate, safeDuration)
  const { replaygainDb, energy } = computeGatedReplayGainAndEnergy(pcm, sampleRate)

  let bpm: number | null = null
  let bpmSource: 'tag' | 'analyzed' | null = null
  if (validTagBpm !== null) {
    bpm = validTagBpm
    bpmSource = 'tag'
  } else {
    bpm = estimateBpm(pcm, sampleRate, introCueSec, outroCueSec)
    bpmSource = bpm !== null ? 'analyzed' : null
  }

  let camelotKey: string | null = null
  let musicalKey: string | null = null
  let keySource: 'tag' | 'analyzed' | null = null

  if (parsedTagKey) {
    camelotKey = parsedTagKey
    musicalKey = camelotToMusicalName(parsedTagKey)
    keySource = 'tag'
  } else {
    const estimated = estimateCamelotKey(pcm, sampleRate, introCueSec, outroCueSec)
    if (estimated) {
      camelotKey = estimated.camelotKey
      musicalKey = estimated.musicalKey
      keySource = 'analyzed'
    }
  }

  return {
    trackId,
    bpm,
    bpmSource,
    musicalKey,
    camelotKey,
    keySource,
    replaygainDb,
    energy,
    waveformPeaks,
    introCueSec,
    outroCueSec,
    status: 'done'
  }
}

workerScope.onmessage = (event: MessageEvent<AnalyzerWorkerRequest>) => {
  const req = event.data
  try {
    const result = analyzeTrackPcm(req)
    workerScope.postMessage(result)
  } catch (err) {
    const safeDuration = req?.duration > 0 ? req.duration : 0
    const validTagBpm = getValidTagBpm(req?.existingBpm)
    const parsedTagKey = parseKeyToCamelot(req?.existingCamelotKey)
    workerScope.postMessage({
      trackId: req?.trackId ?? -1,
      bpm: validTagBpm,
      bpmSource: validTagBpm !== null ? 'tag' : null,
      musicalKey: parsedTagKey ? camelotToMusicalName(parsedTagKey) || null : null,
      camelotKey: parsedTagKey,
      keySource: parsedTagKey ? 'tag' : null,
      replaygainDb: 0,
      energy: 0,
      waveformPeaks: new Array<number>(200).fill(0),
      introCueSec: 0,
      outroCueSec: safeDuration,
      status: 'failed',
      error: err instanceof Error ? err.message : String(err)
    })
  }
}
