import { useEffect, useRef } from 'react'
import { extractThemeFromArtworkUrl } from '@/theme/colorExtractor'
import { DEFAULT_THEME_PALETTE } from '@shared/types'
import { usePlayerStore } from '@/store/usePlayerStore'
import { getArtworkUrl } from '@/utils/format'

function parseRgbTuple(raw: string, fallback: [number, number, number]): [number, number, number] {
  const parts = raw
    .trim()
    .split(/\s+/)
    .map((n) => Number.parseInt(n, 10))
  if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) {
    return [parts[0], parts[1], parts[2]]
  }
  return fallback
}

function lerpTuple(
  from: [number, number, number],
  to: [number, number, number],
  t: number
): [number, number, number] {
  return [
    Math.round(from[0] + (to[0] - from[0]) * t),
    Math.round(from[1] + (to[1] - from[1]) * t),
    Math.round(from[2] + (to[2] - from[2]) * t)
  ]
}

export function useDynamicTheme(): void {
  const artworkPath = usePlayerStore((s) => s.activeTrack?.artworkPath ?? null)
  const dynamicThemeEnabled = usePlayerStore(
    (s) => s.appearanceSettings.dynamicThemeEnabled
  )
  const customAccentRgb = usePlayerStore((s) => s.appearanceSettings.customAccentRgb)
  const customAccentGlowRgb = usePlayerStore(
    (s) => s.appearanceSettings.customAccentGlowRgb
  )
  const currentAccentRef = useRef<[number, number, number]>([99, 102, 241])
  const currentGlowRef = useRef<[number, number, number]>([56, 189, 248])

  useEffect(() => {
    let cancelled = false
    let animId: number | null = null

    const animateToPalette = (targetAccentStr: string, targetGlowStr: string) => {
      const startAccent = [...currentAccentRef.current] as [number, number, number]
      const startGlow = [...currentGlowRef.current] as [number, number, number]
      const endAccent = parseRgbTuple(targetAccentStr, [99, 102, 241])
      const endGlow = parseRgbTuple(targetGlowStr, [56, 189, 248])

      const durationMs = 340
      const startTime = performance.now()

      const step = (now: number) => {
        if (cancelled) return
        const rawT = Math.min(1, (now - startTime) / durationMs)
        const eased = 1 - Math.pow(1 - rawT, 3)

        const nextAccent = lerpTuple(startAccent, endAccent, eased)
        const nextGlow = lerpTuple(startGlow, endGlow, eased)
        currentAccentRef.current = nextAccent
        currentGlowRef.current = nextGlow

        const root = document.documentElement
        root.style.setProperty('--accent-rgb', `${nextAccent[0]} ${nextAccent[1]} ${nextAccent[2]}`)
        root.style.setProperty('--accent-glow-rgb', `${nextGlow[0]} ${nextGlow[1]} ${nextGlow[2]}`)

        if (rawT < 1) {
          animId = requestAnimationFrame(step)
        }
      }

      animId = requestAnimationFrame(step)
    }

    if (!dynamicThemeEnabled) {
      animateToPalette(
        customAccentRgb || DEFAULT_THEME_PALETTE.accentRgb,
        customAccentGlowRgb || DEFAULT_THEME_PALETTE.accentGlowRgb
      )
      return () => {
        cancelled = true
        if (animId !== null) cancelAnimationFrame(animId)
      }
    }

    const artworkUrl = getArtworkUrl(artworkPath)
    void extractThemeFromArtworkUrl(artworkUrl).then((palette) => {
      if (cancelled) return
      if (!palette || palette.isDefault) {
        animateToPalette(
          customAccentRgb || DEFAULT_THEME_PALETTE.accentRgb,
          customAccentGlowRgb || DEFAULT_THEME_PALETTE.accentGlowRgb
        )
        return
      }
      animateToPalette(palette.accentRgb, palette.accentGlowRgb)
    })

    return () => {
      cancelled = true
      if (animId !== null) {
        cancelAnimationFrame(animId)
      }
    }
  }, [artworkPath, dynamicThemeEnabled, customAccentRgb, customAccentGlowRgb])
}
