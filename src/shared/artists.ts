const PROTECTED_COMMA_ARTISTS = [
  'Crosby, Stills, Nash & Young',
  'Crosby, Stills & Nash',
  'Emerson, Lake & Palmer',
  'Earth, Wind & Fire',
  'Earth, Wind and Fire',
  'Blood, Sweat & Tears',
  'Tyler, The Creator',
  '10,000 Maniacs'
] as const

const PROTECTED_ARTIST_PATTERNS = [
  ...PROTECTED_COMMA_ARTISTS.map((name) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/,\s+/g, ',\\s*')
    return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'giu')
  }),
  // Protect thousands-grouped numbers like "10,000" or "2,000" without blocking "D12, 50 Cent" or "D12,112"
  /(?<![\p{L}\p{N}])\d{1,3}(?:,\d{3})+(?![\p{L}\p{N}])/gu
]

/**
 * Normalizes an artist display name into a whitespace-collapsed, case-folded lookup key.
 */
export function normalizeArtistKey(name: string): string {
  return name.replace(/\s+/g, ' ').trim().toLocaleLowerCase()
}

/**
 * Prefers a display name containing uppercase characters when the existing name is all-lowercase.
 */
export function pickPreferredArtistDisplayName(existing: string, candidate: string): string {
  if (
    existing === existing.toLocaleLowerCase() &&
    existing !== existing.toLocaleUpperCase() &&
    candidate !== candidate.toLocaleLowerCase()
  ) {
    return candidate
  }
  return existing
}

/**
 * Splits a raw artist tag string into deduplicated individual artist names while preserving
 * well-known comma-containing artist names and numeric commas (e.g., "10,000").
 */
export function parseArtistList(raw: string | null | undefined): string[] {
  if (!raw) return ['Unknown Artist']

  let working = raw.replace(/\s+/g, ' ').trim()
  if (!working) return ['Unknown Artist']

  const protectedMatches: string[] = []
  for (const pattern of PROTECTED_ARTIST_PATTERNS) {
    pattern.lastIndex = 0
    working = working.replace(pattern, (matched) => {
      const token = `\u0000PROTECTED_ARTIST_${protectedMatches.length}\u0000`
      protectedMatches.push(matched)
      return token
    })
  }

  const pieces = working.split(',')
  const deduped = new Map<string, string>()

  for (const piece of pieces) {
    const restored = piece
      .replace(/\u0000PROTECTED_ARTIST_(\d+)\u0000/g, (_full, idx: string) => {
        return protectedMatches[Number.parseInt(idx, 10)] ?? ''
      })
      .replace(/\s+/g, ' ')
      .trim()

    if (!restored) continue

    const key = normalizeArtistKey(restored)
    if (!key) continue

    const existing = deduped.get(key)
    if (existing === undefined) {
      deduped.set(key, restored)
    } else {
      deduped.set(key, pickPreferredArtistDisplayName(existing, restored))
    }
  }

  if (deduped.size === 0) {
    return ['Unknown Artist']
  }

  return Array.from(deduped.values())
}

/**
 * Returns the primary (first) artist parsed from a raw artist tag string.
 */
export function getPrimaryArtist(raw: string | null | undefined): string {
  return parseArtistList(raw)[0]
}
