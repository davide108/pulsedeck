export type CamelotMode = 'A' | 'B'

export type CamelotKey =
  | '1A'
  | '2A'
  | '3A'
  | '4A'
  | '5A'
  | '6A'
  | '7A'
  | '8A'
  | '9A'
  | '10A'
  | '11A'
  | '12A'
  | '1B'
  | '2B'
  | '3B'
  | '4B'
  | '5B'
  | '6B'
  | '7B'
  | '8B'
  | '9B'
  | '10B'
  | '11B'
  | '12B'

export interface CamelotCompatibility {
  score: number
  relation: string
  compatible: boolean
}

export const ALL_CAMELOT_KEYS: readonly CamelotKey[] = [
  '1A',
  '2A',
  '3A',
  '4A',
  '5A',
  '6A',
  '7A',
  '8A',
  '9A',
  '10A',
  '11A',
  '12A',
  '1B',
  '2B',
  '3B',
  '4B',
  '5B',
  '6B',
  '7B',
  '8B',
  '9B',
  '10B',
  '11B',
  '12B'
] as const

const CAMELOT_SET = new Set<string>(ALL_CAMELOT_KEYS)

// Pitch class (C=0 .. B=11) -> canonical Camelot key for Major ('B') and Minor ('A')
const MAJOR_PC_TO_CAMELOT: readonly CamelotKey[] = [
  '8B', // 0: C / B#
  '3B', // 1: Db / C#
  '10B', // 2: D
  '5B', // 3: Eb / D#
  '12B', // 4: E / Fb
  '7B', // 5: F / E#
  '2B', // 6: F# / Gb
  '9B', // 7: G
  '4B', // 8: Ab / G#
  '11B', // 9: A
  '6B', // 10: Bb / A#
  '1B' // 11: B / Cb
]

const MINOR_PC_TO_CAMELOT: readonly CamelotKey[] = [
  '5A', // 0: Cm / B#m
  '12A', // 1: C#m / Dbm
  '7A', // 2: Dm
  '2A', // 3: Ebm / D#m
  '9A', // 4: Em / Fbm
  '4A', // 5: Fm / E#m
  '11A', // 6: F#m / Gbm
  '6A', // 7: Gm
  '1A', // 8: Abm / G#m
  '8A', // 9: Am
  '3A', // 10: Bbm / A#m
  '10A' // 11: Bm / Cbm
]

const CAMELOT_TO_MUSICAL: Record<CamelotKey, string> = {
  '1A': 'Abm',
  '2A': 'Ebm',
  '3A': 'Bbm',
  '4A': 'Fm',
  '5A': 'Cm',
  '6A': 'Gm',
  '7A': 'Dm',
  '8A': 'Am',
  '9A': 'Em',
  '10A': 'Bm',
  '11A': 'F#m',
  '12A': 'C#m',
  '1B': 'B',
  '2B': 'F#',
  '3B': 'Db',
  '4B': 'Ab',
  '5B': 'Eb',
  '6B': 'Bb',
  '7B': 'F',
  '8B': 'C',
  '9B': 'G',
  '10B': 'D',
  '11B': 'A',
  '12B': 'E'
}

const CAMELOT_COLORS: Record<number, { A: string; B: string }> = {
  1: { A: '#2dd4bf', B: '#5eead4' },
  2: { A: '#22d3ee', B: '#67e8f9' },
  3: { A: '#34d399', B: '#6ee7b7' },
  4: { A: '#a3e635', B: '#bef264' },
  5: { A: '#facc15', B: '#fde047' },
  6: { A: '#fb923c', B: '#fdba74' },
  7: { A: '#f87171', B: '#fca5a5' },
  8: { A: '#fb7185', B: '#fda4af' },
  9: { A: '#e879f9', B: '#f0abfc' },
  10: { A: '#c084fc', B: '#d8b4fe' },
  11: { A: '#818cf8', B: '#a5b4fc' },
  12: { A: '#60a5fa', B: '#93c5fd' }
}

const NOTE_BASE_PC: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11
}

export function isValidCamelotKey(key?: string | null): boolean {
  if (!key) return false
  return CAMELOT_SET.has(key.trim().toUpperCase())
}

export function parseKeyToCamelot(raw?: string | null): CamelotKey | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (!trimmed) return null

  // 1. Direct Camelot format: '8A', '08a', '12B'
  const camelotMatch = /^(0?[1-9]|1[0-2])\s*([ABab])$/.exec(trimmed)
  if (camelotMatch) {
    const num = Number.parseInt(camelotMatch[1], 10)
    const letter = camelotMatch[2].toUpperCase() as CamelotMode
    return `${num}${letter}` as CamelotKey
  }

  // 2. Open Key format (Traktor): '1m'..'12m', '1d'..'12d'
  // 1m = 8A (Am), 1d = 8B (C) -> camelotNumber = ((n + 6) % 12) + 1
  const openKeyMatch = /^(0?[1-9]|1[0-2])\s*([mdMD])$/.exec(trimmed)
  if (openKeyMatch) {
    const openNum = Number.parseInt(openKeyMatch[1], 10)
    const suffix = openKeyMatch[2].toLowerCase()
    const camelotNum = ((openNum + 6) % 12) + 1
    const letter: CamelotMode = suffix === 'm' ? 'A' : 'B'
    return `${camelotNum}${letter}` as CamelotKey
  }

  // 3. Standard musical key notation: 'Am', 'A minor', 'C', 'C maj', 'F#m', 'Gb minor', 'Eb', 'Bbm', 'D#m'
  const normalized = trimmed
    .replace(/\u266f/g, '#')
    .replace(/\u266d/g, 'b')
    .replace(/\s*-\s*/g, ' ')
    .replace(/\bsharp\b/gi, '#')
    .replace(/\bflat\b/gi, 'b')
    .replace(/\s+/g, ' ')
    .trim()

  const musicalMatch = /^([A-Ga-g])\s*(#|b)?\s*(.*)$/.exec(normalized)
  if (!musicalMatch) return null

  const letter = musicalMatch[1].toUpperCase()
  const accidental = musicalMatch[2] ?? ''
  const qualityRaw = musicalMatch[3].trim()

  const basePc = NOTE_BASE_PC[letter]
  if (basePc === undefined) return null

  let pc = basePc
  if (accidental === '#') pc = (pc + 1) % 12
  else if (accidental === 'b') pc = (pc + 11) % 12

  let isMinor: boolean
  if (qualityRaw === '') {
    isMinor = false
  } else {
    const qLower = qualityRaw.toLowerCase()
    if (
      qualityRaw === 'm' ||
      qLower === 'min' ||
      qLower === 'minor' ||
      qLower === 'mi' ||
      qLower === 'moll'
    ) {
      isMinor = true
    } else if (
      qualityRaw === 'M' ||
      qLower === 'maj' ||
      qLower === 'major' ||
      qLower === 'ma' ||
      qLower === 'dur'
    ) {
      isMinor = false
    } else {
      return null
    }
  }

  return isMinor ? MINOR_PC_TO_CAMELOT[pc] : MAJOR_PC_TO_CAMELOT[pc]
}

export function camelotToMusicalName(camelot: string): string {
  const normalized = parseKeyToCamelot(camelot)
  if (!normalized) return ''
  return CAMELOT_TO_MUSICAL[normalized]
}

function parseCamelotParts(key: string): { num: number; mode: CamelotMode } | null {
  const normalized = parseKeyToCamelot(key)
  if (!normalized) return null
  const mode = normalized.slice(-1) as CamelotMode
  const num = Number.parseInt(normalized.slice(0, -1), 10)
  return { num, mode }
}

export function getCamelotCompatibility(
  fromKey: string | null,
  toKey: string | null
): CamelotCompatibility {
  if (!fromKey || !toKey) {
    return { score: 0.5, relation: 'Unknown Key', compatible: false }
  }

  const from = parseCamelotParts(fromKey)
  const to = parseCamelotParts(toKey)
  if (!from || !to) {
    return { score: 0.5, relation: 'Unknown Key', compatible: false }
  }

  const cw = (to.num - from.num + 12) % 12

  if (from.mode === to.mode) {
    if (cw === 0) {
      return { score: 1.0, relation: 'Exact Match', compatible: true }
    }
    if (cw === 1) {
      return { score: 0.92, relation: 'Adjacent (+1)', compatible: true }
    }
    if (cw === 11) {
      return { score: 0.92, relation: 'Adjacent (-1)', compatible: true }
    }
    if (cw === 2) {
      return { score: 0.65, relation: 'Energy Boost (+2)', compatible: true }
    }
    if (cw === 10) {
      return { score: 0.5, relation: 'Energy Drop (-2)', compatible: false }
    }

    const dist = Math.min(cw, 12 - cw) // 3..6
    const clashScore = Number(Math.max(0.1, 0.25 - ((dist - 3) / 3) * 0.15).toFixed(2))
    return { score: clashScore, relation: 'Harmonic Clash', compatible: false }
  }

  // Different mode: A <-> B
  if (cw === 0) {
    return { score: 0.88, relation: 'Relative Major/Minor', compatible: true }
  }
  if (cw === 1 || cw === 11) {
    return {
      score: 0.65,
      relation: cw === 1 ? 'Diagonal (+1)' : 'Diagonal (-1)',
      compatible: true
    }
  }

  const dist = Math.min(cw, 12 - cw) // 2..6
  const clashScore = Number(Math.max(0.1, 0.25 - ((dist - 2) / 4) * 0.15).toFixed(2))
  return { score: clashScore, relation: 'Harmonic Clash', compatible: false }
}

export function getCamelotColor(camelot: string | null): string {
  if (!camelot) return '#64748b'
  const parts = parseCamelotParts(camelot)
  if (!parts) return '#64748b'
  return CAMELOT_COLORS[parts.num][parts.mode]
}
