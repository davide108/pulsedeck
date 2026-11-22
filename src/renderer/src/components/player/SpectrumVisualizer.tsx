import { useEffect, useRef, useState } from 'react'
import { usePlayerStore } from '@/store/usePlayerStore'

interface SpectrumVisualizerProps {
  height?: number
  barCount?: number
  className?: string
}

function readCssRgb(varName: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  const val = getComputedStyle(document.documentElement).getPropertyValue(varName).trim()
  return (val || fallback).replace(/\s+/g, ', ')
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

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const update = () => setWidth(el.clientWidth)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || width <= 0 || height <= 0) return

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.floor(width * dpr)
    canvas.height = Math.floor(height * dpr)
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const freqBuffer = new Uint8Array(1024)
    const smoothed = new Float32Array(barCount)
    const peaks = new Float32Array(barCount)
    let animId = 0

    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, width, height)

      const data = getFrequencyData(freqBuffer)
      const accentRgb = readCssRgb('--accent-rgb', '99 102 241')
      const glowRgb = readCssRgb('--accent-glow-rgb', '56 189 248')

      const gradient = ctx.createLinearGradient(0, height, 0, 0)
      gradient.addColorStop(0, `rgba(${accentRgb}, 0.85)`)
      gradient.addColorStop(0.65, `rgba(${glowRgb}, 0.92)`)
      gradient.addColorStop(1, 'rgba(255, 255, 255, 0.95)')

      const usableBins = Math.min(data.length, 620)
      const step = width / barCount
      const barWidth = Math.max(2, step * 0.62)
      let hasEnergy = false

      for (let i = 0; i < barCount; i++) {
        // Perceptual logarithmic frequency band mapping
        const t0 = Math.pow(i / barCount, 1.55)
        const t1 = Math.pow((i + 1) / barCount, 1.55)
        const binStart = Math.max(1, Math.floor(t0 * usableBins))
        const binEnd = Math.max(binStart + 1, Math.floor(t1 * usableBins))

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
        ctx.beginPath()
        ctx.roundRect(x, y, barWidth, barH, Math.min(barWidth / 2, 3))
        ctx.fill()

        if (peaks[i] > 0.04) {
          const peakY = Math.max(2, height - peaks[i] * (height - 10) - 3)
          ctx.fillStyle = `rgba(${glowRgb}, 0.9)`
          ctx.fillRect(x, peakY, barWidth, 2)
        }
      }

      if (isPlaying || hasEnergy) {
        animId = requestAnimationFrame(draw)
      }
    }

    animId = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(animId)
  }, [width, height, barCount, getFrequencyData, isPlaying])

  return (
    <div ref={containerRef} style={{ height }} className={`w-full select-none ${className}`}>
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  )
}
