import { useEffect, useRef, useState } from 'react'
import { usePlayerStore } from '@/store/usePlayerStore'

interface SpectrumVisualizerProps {
  height?: number
  barCount?: number
  className?: string
}

function readCssRgb(varName: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback.replace(/\s+/g, ', ')
  const val = getComputedStyle(document.documentElement).getPropertyValue(varName).trim()
  return (val || fallback).replace(/\s+/g, ', ')
}

function createSpectrumGradient(
  ctx: CanvasRenderingContext2D,
  height: number,
  accentRgb: string,
  glowRgb: string
): CanvasGradient {
  const gradient = ctx.createLinearGradient(0, height, 0, 0)
  gradient.addColorStop(0, `rgba(${accentRgb}, 0.85)`)
  gradient.addColorStop(0.65, `rgba(${glowRgb}, 0.92)`)
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0.95)')
  return gradient
}

export function SpectrumVisualizer({
  height = 112,
  barCount = 56,
  className = ''
}: SpectrumVisualizerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [width, setWidth] = useState(0)

  const getFrequencyData = usePlayerStore((s) => s.getFrequencyData)
  const isPlaying = usePlayerStore((s) => s.isPlaying)
  const reducedEffects = usePlayerStore((s) => s.appearanceSettings.reducedEffects)

  const reducedEffectsRef = useRef(reducedEffects)
  reducedEffectsRef.current = reducedEffects

  const themeColorsRef = useRef({
    accentRgb: readCssRgb('--accent-rgb', '99 102 241'),
    glowRgb: readCssRgb('--accent-glow-rgb', '56 189 248')
  })
  const gradientRef = useRef<CanvasGradient | null>(null)
  const canvasMetricsRef = useRef({ pixelWidth: 0, pixelHeight: 0, dpr: 1 })

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const update = () => setWidth(el.clientWidth)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Cache CSS theme colors and rebuild CanvasGradient only on theme or height change
  useEffect(() => {
    const refreshGradient = () => {
      const canvas = canvasRef.current
      const ctx = canvas?.getContext('2d')
      if (ctx && height > 0) {
        gradientRef.current = createSpectrumGradient(
          ctx,
          height,
          themeColorsRef.current.accentRgb,
          themeColorsRef.current.glowRgb
        )
      }
    }

    const syncThemeColors = () => {
      const nextAccent = readCssRgb('--accent-rgb', '99 102 241')
      const nextGlow = readCssRgb('--accent-glow-rgb', '56 189 248')
      if (
        themeColorsRef.current.accentRgb !== nextAccent ||
        themeColorsRef.current.glowRgb !== nextGlow ||
        !gradientRef.current
      ) {
        themeColorsRef.current = { accentRgb: nextAccent, glowRgb: nextGlow }
        refreshGradient()
      }
    }

    syncThemeColors()
    const observer = new MutationObserver(syncThemeColors)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style', 'class']
    })
    return () => observer.disconnect()
  }, [height, width])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || width <= 0 || height <= 0) return

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const pixelWidth = Math.floor(width * dpr)
    const pixelHeight = Math.floor(height * dpr)
    const prevMetrics = canvasMetricsRef.current

    if (
      prevMetrics.pixelWidth !== pixelWidth ||
      prevMetrics.pixelHeight !== pixelHeight ||
      prevMetrics.dpr !== dpr
    ) {
      canvas.width = pixelWidth
      canvas.height = pixelHeight
      canvasMetricsRef.current = { pixelWidth, pixelHeight, dpr }
    }

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    if (!gradientRef.current) {
      gradientRef.current = createSpectrumGradient(
        ctx,
        height,
        themeColorsRef.current.accentRgb,
        themeColorsRef.current.glowRgb
      )
    }

    const freqBuffer = new Uint8Array(1024)
    const smoothed = new Float32Array(barCount)
    const peaks = new Float32Array(barCount)

    // Precompute logarithmic bin index mapping when barCount or binCount changes
    let cachedBinCount = -1
    const binStarts = new Int32Array(barCount)
    const binEnds = new Int32Array(barCount)

    const ensureBinMapping = (binCount: number) => {
      if (binCount === cachedBinCount) return
      cachedBinCount = binCount
      const usableBins = Math.min(binCount, 620)
      for (let i = 0; i < barCount; i++) {
        const t0 = Math.pow(i / barCount, 1.55)
        const t1 = Math.pow((i + 1) / barCount, 1.55)
        const binStart = Math.max(1, Math.floor(t0 * usableBins))
        const binEnd = Math.max(binStart + 1, Math.floor(t1 * usableBins))
        binStarts[i] = binStart
        binEnds[i] = binEnd
      }
    }

    ensureBinMapping(freqBuffer.length)

    let animId = 0
    let lastDrawTime = 0
    let hasEnergy = false
    let isHidden = typeof document !== 'undefined' && document.hidden

    const step = width / barCount
    const barWidth = Math.max(2, step * 0.62)
    const barRadius = Math.min(barWidth / 2, 3)

    const draw = (now: number) => {
      animId = 0
      if (isHidden) return

      const isReduced = reducedEffectsRef.current
      if (isReduced && lastDrawTime > 0 && now - lastDrawTime < 32) {
        animId = requestAnimationFrame(draw)
        return
      }
      lastDrawTime = now

      ctx.clearRect(0, 0, width, height)

      const data = getFrequencyData(freqBuffer)
      ensureBinMapping(data.length)

      const gradient =
        gradientRef.current ??
        createSpectrumGradient(
          ctx,
          height,
          themeColorsRef.current.accentRgb,
          themeColorsRef.current.glowRgb
        )
      const glowRgb = themeColorsRef.current.glowRgb

      hasEnergy = false

      for (let i = 0; i < barCount; i++) {
        const binStart = binStarts[i]
        const binEnd = binEnds[i]

        let maxVal = 0
        if (isPlaying) {
          for (let b = binStart; b < binEnd && b < data.length; b++) {
            if (data[b] > maxVal) maxVal = data[b]
          }
        }

        const norm = maxVal / 255
        if (norm > smoothed[i]) {
          smoothed[i] = smoothed[i] * 0.45 + norm * 0.55
        } else {
          smoothed[i] = Math.max(0, smoothed[i] * 0.88 - 0.005)
        }

        if (smoothed[i] > peaks[i]) {
          peaks[i] = smoothed[i]
        } else {
          peaks[i] = Math.max(0, peaks[i] - 0.0075)
        }

        if (smoothed[i] > 0.004 || peaks[i] > 0.004) {
          hasEnergy = true
        }

        const barH = Math.max(2, smoothed[i] * (height - 10))
        const x = i * step + (step - barWidth) / 2
        const y = height - barH

        ctx.fillStyle = smoothed[i] > 0.01 ? gradient : 'rgba(255, 255, 255, 0.08)'
        if (isReduced) {
          ctx.fillRect(x, y, barWidth, barH)
        } else {
          ctx.beginPath()
          ctx.roundRect(x, y, barWidth, barH, barRadius)
          ctx.fill()
        }

        if (peaks[i] > 0.04) {
          const peakY = Math.max(2, height - peaks[i] * (height - 10) - 3)
          ctx.fillStyle = `rgba(${glowRgb}, 0.9)`
          ctx.fillRect(x, peakY, barWidth, 2)
        }
      }

      if (!isHidden && (isPlaying || hasEnergy)) {
        animId = requestAnimationFrame(draw)
      }
    }

    const handleVisibilityChange = () => {
      isHidden = document.hidden
      if (isHidden) {
        if (animId !== 0) {
          cancelAnimationFrame(animId)
          animId = 0
        }
      } else if ((isPlaying || hasEnergy) && animId === 0) {
        lastDrawTime = 0
        animId = requestAnimationFrame(draw)
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    if (!isHidden) {
      animId = requestAnimationFrame(draw)
    }

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      if (animId !== 0) {
        cancelAnimationFrame(animId)
      }
    }
  }, [width, height, barCount, getFrequencyData, isPlaying])

  return (
    <div ref={containerRef} style={{ height }} className={`w-full select-none ${className}`}>
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  )
}
