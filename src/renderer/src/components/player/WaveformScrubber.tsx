import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { formatDuration } from '@/utils/format'

interface WaveformScrubberProps {
  peaks: number[] | null | undefined
  duration: number
  currentTime: number
  introCueSec?: number | null
  outroCueSec?: number | null
  onSeek?: (timeSec: number) => void
  height?: number
  interactive?: boolean
  accentColorRgb?: string
  showCueMarkers?: boolean
  showHoverTooltip?: boolean
  className?: string
}

const TARGET_BAR_COUNT = 200

function resamplePeaks(peaks: number[] | null | undefined, barCount: number): number[] {
  if (!peaks || peaks.length === 0) {
    // Subtle neutral baseline bars while awaiting DSP analysis
    return Array.from({ length: barCount }, (_, idx) => {
      const wave = 0.22 + 0.12 * Math.sin(idx * 0.27) + 0.06 * Math.cos(idx * 0.71)
      return Math.max(0.1, Math.min(0.45, wave))
    })
  }
  if (peaks.length === barCount) {
    return peaks.map((v) => Math.max(0.06, Math.min(1, Number.isFinite(v) ? v : 0.1)))
  }
  const out = new Array<number>(barCount)
  for (let i = 0; i < barCount; i++) {
    const start = Math.floor((i * peaks.length) / barCount)
    const end = Math.max(start + 1, Math.floor(((i + 1) * peaks.length) / barCount))
    let maxVal = 0
    for (let j = start; j < end && j < peaks.length; j++) {
      if (peaks[j] > maxVal) maxVal = peaks[j]
    }
    out[i] = Math.max(0.06, Math.min(1, maxVal))
  }
  return out
}

function readCssRgbVar(varName: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim()
  return raw || fallback
}

export function WaveformScrubber({
  peaks,
  duration,
  currentTime,
  introCueSec,
  outroCueSec,
  onSeek,
  height = 42,
  interactive = true,
  accentColorRgb,
  showCueMarkers = true,
  showHoverTooltip = true,
  className = ''
}: WaveformScrubberProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [width, setWidth] = useState(0)
  const [hoverRatio, setHoverRatio] = useState<number | null>(null)
  const [dragRatio, setDragRatio] = useState<number | null>(null)
  const isDraggingRef = useRef(false)

  const bars = useMemo(() => resamplePeaks(peaks, TARGET_BAR_COUNT), [peaks])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const updateSize = () => {
      setWidth(el.clientWidth)
    }
    updateSize()
    const observer = new ResizeObserver(updateSize)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const effectiveProgress =
    dragRatio !== null
      ? dragRatio
      : duration > 0
        ? Math.max(0, Math.min(1, currentTime / duration))
        : 0

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || width <= 0 || height <= 0) return

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.floor(width * dpr)
    canvas.height = Math.floor(height * dpr)

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)

    const accentRgb = (accentColorRgb || readCssRgbVar('--accent-rgb', '99 102 241')).replace(
      /\s+/g,
      ', '
    )
    const glowRgb = readCssRgbVar('--accent-glow-rgb', '56 189 248').replace(/\s+/g, ', ')

    const hasRealPeaks = Boolean(peaks && peaks.length > 0)
    const playheadX = effectiveProgress * width
    const hoverX = hoverRatio !== null ? hoverRatio * width : null

    // Intro / Outro cue shading & lines
    const introX =
      showCueMarkers && duration > 0 && introCueSec != null && introCueSec > 0.5
        ? Math.max(0, Math.min(width, (introCueSec / duration) * width))
        : null
    const outroX =
      showCueMarkers && duration > 0 && outroCueSec != null && outroCueSec < duration - 0.5
        ? Math.max(0, Math.min(width, (outroCueSec / duration) * width))
        : null

    if (introX !== null) {
      ctx.fillStyle = 'rgba(56, 189, 248, 0.08)'
      ctx.fillRect(0, 0, introX, height)
    }
    if (outroX !== null) {
      ctx.fillStyle = 'rgba(251, 113, 133, 0.08)'
      ctx.fillRect(outroX, 0, width - outroX, height)
    }

    const step = width / bars.length
    const barWidth = Math.max(1.2, step * 0.64)
    const maxBarHeight = Math.max(8, height - 10)
    const centerY = height / 2

    for (let i = 0; i < bars.length; i++) {
      const x = i * step + (step - barWidth) / 2
      const barCenter = x + barWidth / 2
      const barH = Math.max(3, bars[i] * maxBarHeight)
      const y = centerY - barH / 2

      if (barCenter <= playheadX) {
        ctx.fillStyle = `rgba(${accentRgb}, 0.95)`
      } else if (hoverX !== null && barCenter <= hoverX) {
        ctx.fillStyle = `rgba(${glowRgb}, 0.52)`
      } else {
        ctx.fillStyle = hasRealPeaks ? 'rgba(148, 163, 184, 0.30)' : 'rgba(148, 163, 184, 0.18)'
      }

      const radius = Math.min(barWidth / 2, 2)
      ctx.beginPath()
      ctx.roundRect(x, y, barWidth, barH, radius)
      ctx.fill()
    }

    // Draw cue marker ticks
    if (introX !== null) {
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.78)'
      ctx.lineWidth = 1.25
      ctx.setLineDash([2, 2])
      ctx.beginPath()
      ctx.moveTo(introX, 2)
      ctx.lineTo(introX, height - 2)
      ctx.stroke()
      ctx.setLineDash([])
      if (height >= 44) {
        ctx.font = '600 9px monospace'
        ctx.fillStyle = 'rgba(56, 189, 248, 0.9)'
        ctx.fillText('IN', Math.min(width - 16, introX + 3), 10)
      }
    }

    if (outroX !== null) {
      ctx.strokeStyle = 'rgba(251, 113, 133, 0.78)'
      ctx.lineWidth = 1.25
      ctx.setLineDash([2, 2])
      ctx.beginPath()
      ctx.moveTo(outroX, 2)
      ctx.lineTo(outroX, height - 2)
      ctx.stroke()
      ctx.setLineDash([])
      if (height >= 44) {
        ctx.font = '600 9px monospace'
        ctx.fillStyle = 'rgba(251, 113, 133, 0.9)'
        ctx.fillText('OUT', Math.max(2, outroX - 22), 10)
      }
    }

    // Playhead needle
    if (duration > 0) {
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(Math.max(0, Math.min(width - 1.5, playheadX - 0.75)), 1, 1.5, height - 2)
    }
  }, [
    width,
    height,
    bars,
    peaks,
    effectiveProgress,
    hoverRatio,
    duration,
    introCueSec,
    outroCueSec,
    accentColorRgb,
    showCueMarkers
  ])

  const getRatioFromClientX = useCallback((clientX: number): number => {
    const el = containerRef.current
    if (!el) return 0
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0) return 0
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
  }, [])

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!interactive || !onSeek || duration <= 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    isDraggingRef.current = true
    const ratio = getRatioFromClientX(e.clientX)
    setDragRatio(ratio)
    setHoverRatio(ratio)
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!interactive || duration <= 0) return
    const ratio = getRatioFromClientX(e.clientX)
    setHoverRatio(ratio)
    if (isDraggingRef.current) {
      setDragRatio(ratio)
    }
  }

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return
    isDraggingRef.current = false
    const ratio = getRatioFromClientX(e.clientX)
    setDragRatio(null)
    if (onSeek && duration > 0) {
      onSeek(ratio * duration)
    }
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }

  const activeTooltipRatio = dragRatio ?? hoverRatio
  const tooltipTime = activeTooltipRatio !== null ? activeTooltipRatio * duration : null

  return (
    <div
      ref={containerRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => {
        isDraggingRef.current = false
        setDragRatio(null)
      }}
      onPointerLeave={() => {
        if (!isDraggingRef.current) {
          setHoverRatio(null)
        }
      }}
      style={{ height }}
      className={`relative w-full select-none ${
        interactive && duration > 0 ? 'cursor-pointer' : 'cursor-default'
      } ${className}`}
      role={interactive ? 'slider' : undefined}
      aria-label={interactive ? 'Playback waveform position' : undefined}
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(currentTime)}
    >
      <canvas ref={canvasRef} className="block h-full w-full" />

      {showHoverTooltip &&
        interactive &&
        activeTooltipRatio !== null &&
        tooltipTime !== null &&
        duration > 0 && (
          <div
            style={{
              left: `${Math.max(6, Math.min(94, activeTooltipRatio * 100))}%`
            }}
            className="pointer-events-none absolute -top-7 -translate-x-1/2 rounded-md border border-white/15 bg-obsidian/95 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-white shadow-lg"
          >
            {formatDuration(tooltipTime)}
          </div>
        )}
    </div>
  )
}
