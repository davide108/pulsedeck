import { DEFAULT_THEME_PALETTE, type ThemePalette } from '../../../shared/types'

const SAMPLE_SIZE = 64
const CACHE_LIMIT = 200
const paletteCache = new Map<string, ThemePalette>()

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  const d = max - min

  if (d === 0) return [0, 0, l]

  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === rn) {
    h = (gn - bn) / d + (gn < bn ? 6 : 0)
  } else if (max === gn) {
    h = (bn - rn) / d + 2
  } else {
    h = (rn - gn) / d + 4
  }
  h /= 6
  return [h, s, l]
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hue = ((h % 1) + 1) % 1
  if (s === 0) {
    const v = Math.round(l * 255)
    return [v, v, v]
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const hue2rgb = (t: number): number => {
    let tt = t
    if (tt < 0) tt += 1
    if (tt > 1) tt -= 1
    if (tt < 1 / 6) return p + (q - p) * 6 * tt
    if (tt < 1 / 2) return q
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6
    return p
  }
  return [
    Math.round(clamp(hue2rgb(hue + 1 / 3) * 255, 0, 255)),
    Math.round(clamp(hue2rgb(hue) * 255, 0, 255)),
    Math.round(clamp(hue2rgb(hue - 1 / 3) * 255, 0, 255))
  ]
}

function ensureDarkModeReadable(
  r: number,
  g: number,
  b: number,
  minL: number,
  maxL: number
): [number, number, number] {
  const [h, s, l] = rgbToHsl(r, g, b)
  const targetS = clamp(s, 0.52, 0.94)
  const targetL = clamp(l, minL, maxL)
  return hslToRgb(h, targetS, targetL)
}

function hueDistanceDeg(h1: number, h2: number): number {
  const diff = Math.abs(h1 - h2) * 360
  return Math.min(diff, 360 - diff)
}

interface ColorBucket {
  count: number
  rSum: number
  gSum: number
  bSum: number
}

function quantizeImageData(data: Uint8ClampedArray): ThemePalette {
  const buckets = new Map<number, ColorBucket>()

  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]
    if (a < 128) continue

    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]

    // Skip extreme shadows and blown-out highlights
    const maxC = Math.max(r, g, b)
    const minC = Math.min(r, g, b)
    if (maxC < 28 || minC > 235) continue

    // 4-bit per channel quantization (4096 bins)
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
    const existing = buckets.get(key)
    if (existing) {
      existing.count++
      existing.rSum += r
      existing.gSum += g
      existing.bSum += b
    } else {
      buckets.set(key, { count: 1, rSum: r, gSum: g, bSum: b })
    }
  }

  if (buckets.size === 0) {
    return DEFAULT_THEME_PALETTE
  }

  const candidates: Array<{
    r: number
    g: number
    b: number
    h: number
    s: number
    l: number
    score: number
  }> = []

  for (const bucket of buckets.values()) {
    const r = bucket.rSum / bucket.count
    const g = bucket.gSum / bucket.count
    const b = bucket.bSum / bucket.count
    const [h, s, l] = rgbToHsl(r, g, b)

    // Favor saturated, mid-luminance swatches with meaningful pixel coverage
    if (s < 0.14) continue
    const luminanceFactor = 1 - Math.abs(l - 0.52) * 1.15
    const score =
      Math.pow(bucket.count, 0.55) * (0.25 + s * 1.45) * clamp(luminanceFactor, 0.25, 1.0)
    candidates.push({ r, g, b, h, s, l, score })
  }

  if (candidates.length === 0) {
    return DEFAULT_THEME_PALETTE
  }

  candidates.sort((a, b) => b.score - a.score)
  const primary = candidates[0]
  const [accentR, accentG, accentB] = ensureDarkModeReadable(primary.r, primary.g, primary.b, 0.56, 0.72)

  // Pick a secondary color with distinct hue for vibrant glow, or shift primary hue
  let glowRgb: [number, number, number] | null = null
  for (let i = 1; i < candidates.length; i++) {
    const cand = candidates[i]
    if (hueDistanceDeg(primary.h, cand.h) >= 28 && cand.score >= primary.score * 0.25) {
      glowRgb = ensureDarkModeReadable(cand.r, cand.g, cand.b, 0.6, 0.78)
      break
    }
  }

  if (!glowRgb) {
    glowRgb = hslToRgb(primary.h + 0.08, clamp(primary.s, 0.58, 0.94), 0.68)
  }

  return {
    accentRgb: `${accentR} ${accentG} ${accentB}`,
    accentGlowRgb: `${glowRgb[0]} ${glowRgb[1]} ${glowRgb[2]}`,
    isDefault: false
  }
}

function loadImage(url: string, timeoutMs = 4000): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'

    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      img.onload = null
      img.onerror = null
      reject(new Error('Image load timeout'))
    }, timeoutMs)

    img.onload = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(img)
    }

    img.onerror = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(new Error('Image load failed'))
    }

    img.src = url
  })
}

export async function extractThemeFromArtworkUrl(url: string | null): Promise<ThemePalette> {
  if (!url || typeof document === 'undefined') {
    return DEFAULT_THEME_PALETTE
  }

  const cached = paletteCache.get(url)
  if (cached) {
    return cached
  }

  try {
    const img = await loadImage(url)
    const canvas = document.createElement('canvas')
    canvas.width = SAMPLE_SIZE
    canvas.height = SAMPLE_SIZE
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) {
      return DEFAULT_THEME_PALETTE
    }

    ctx.drawImage(img, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE)
    const imageData = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE)
    const palette = quantizeImageData(imageData.data)

    if (paletteCache.size >= CACHE_LIMIT) {
      const oldestKey = paletteCache.keys().next().value
      if (oldestKey !== undefined) {
        paletteCache.delete(oldestKey)
      }
    }
    paletteCache.set(url, palette)
    return palette
  } catch {
    return DEFAULT_THEME_PALETTE
  }
}
