import { describe, expect, it } from 'vitest'
import {
  ALL_CAMELOT_KEYS,
  camelotToMusicalName,
  getCamelotColor,
  getCamelotCompatibility,
  isValidCamelotKey,
  parseKeyToCamelot
} from '@shared/camelot'

describe('camelot utilities', () => {
  describe('parseKeyToCamelot', () => {
    it('normalizes direct Camelot keys regardless of case or leading zeros', () => {
      expect(parseKeyToCamelot('8A')).toBe('8A')
      expect(parseKeyToCamelot('08a')).toBe('8A')
      expect(parseKeyToCamelot('12B')).toBe('12B')
      expect(parseKeyToCamelot(' 01b ')).toBe('1B')
      expect(parseKeyToCamelot('10a')).toBe('10A')
    })

    it('normalizes standard musical notations including sharps, flats, minors, and majors', () => {
      expect(parseKeyToCamelot('Am')).toBe('8A')
      expect(parseKeyToCamelot('A minor')).toBe('8A')
      expect(parseKeyToCamelot('A min')).toBe('8A')
      expect(parseKeyToCamelot('A-minor')).toBe('8A')
      expect(parseKeyToCamelot('C')).toBe('8B')
      expect(parseKeyToCamelot('C maj')).toBe('8B')
      expect(parseKeyToCamelot('C major')).toBe('8B')
      expect(parseKeyToCamelot('CM')).toBe('8B')

      expect(parseKeyToCamelot('F#m')).toBe('11A')
      expect(parseKeyToCamelot('F♯m')).toBe('11A')
      expect(parseKeyToCamelot('F sharp minor')).toBe('11A')
      expect(parseKeyToCamelot('Gbm')).toBe('11A')
      expect(parseKeyToCamelot('Gb minor')).toBe('11A')
      expect(parseKeyToCamelot('F#')).toBe('2B')
      expect(parseKeyToCamelot('Gb major')).toBe('2B')

      expect(parseKeyToCamelot('Eb')).toBe('5B')
      expect(parseKeyToCamelot('E flat')).toBe('5B')
      expect(parseKeyToCamelot('Bbm')).toBe('3A')
      expect(parseKeyToCamelot('B♭m')).toBe('3A')
      expect(parseKeyToCamelot('D#m')).toBe('2A')
      expect(parseKeyToCamelot('Ebm')).toBe('2A')
      expect(parseKeyToCamelot('C#m')).toBe('12A')
      expect(parseKeyToCamelot('Db')).toBe('3B')
      expect(parseKeyToCamelot('Abm')).toBe('1A')
      expect(parseKeyToCamelot('G#m')).toBe('1A')
    })

    it('normalizes all Open Key 1m..12m and 1d..12d keys accurately', () => {
      const expectedOpenKeyMap: Array<[string, string]> = [
        ['1m', '8A'],
        ['2m', '9A'],
        ['3m', '10A'],
        ['4m', '11A'],
        ['5m', '12A'],
        ['6m', '1A'],
        ['7m', '2A'],
        ['8m', '3A'],
        ['9m', '4A'],
        ['10m', '5A'],
        ['11m', '6A'],
        ['12m', '7A'],
        ['1d', '8B'],
        ['2d', '9B'],
        ['3d', '10B'],
        ['4d', '11B'],
        ['5d', '12B'],
        ['6d', '1B'],
        ['7d', '2B'],
        ['8d', '3B'],
        ['9d', '4B'],
        ['10d', '5B'],
        ['11d', '6B'],
        ['12d', '7B']
      ]

      for (const [openKey, camelot] of expectedOpenKeyMap) {
        expect(parseKeyToCamelot(openKey)).toBe(camelot)
        expect(parseKeyToCamelot(openKey.toUpperCase())).toBe(camelot)
      }
      expect(parseKeyToCamelot('01m')).toBe('8A')
      expect(parseKeyToCamelot('06D')).toBe('1B')
    })

    it('returns null for empty, malformed, or out-of-range inputs', () => {
      expect(parseKeyToCamelot(null)).toBeNull()
      expect(parseKeyToCamelot(undefined)).toBeNull()
      expect(parseKeyToCamelot('')).toBeNull()
      expect(parseKeyToCamelot('   ')).toBeNull()
      expect(parseKeyToCamelot('0A')).toBeNull()
      expect(parseKeyToCamelot('13A')).toBeNull()
      expect(parseKeyToCamelot('8C')).toBeNull()
      expect(parseKeyToCamelot('0m')).toBeNull()
      expect(parseKeyToCamelot('13d')).toBeNull()
      expect(parseKeyToCamelot('H minor')).toBeNull()
      expect(parseKeyToCamelot('Am7')).toBeNull()
      expect(parseKeyToCamelot('Cdim')).toBeNull()
      expect(parseKeyToCamelot('Unknown')).toBeNull()
    })
  })

  describe('camelotToMusicalName & helpers', () => {
    it('maps all 24 Camelot keys to canonical musical names and valid colors', () => {
      expect(ALL_CAMELOT_KEYS).toHaveLength(24)

      for (const key of ALL_CAMELOT_KEYS) {
        expect(isValidCamelotKey(key)).toBe(true)
        const musicalName = camelotToMusicalName(key)
        expect(musicalName.length).toBeGreaterThan(0)
        expect(parseKeyToCamelot(musicalName)).toBe(key)
        expect(getCamelotColor(key)).toMatch(/^#[0-9a-f]{6}$/i)
      }

      expect(camelotToMusicalName('8A')).toBe('Am')
      expect(camelotToMusicalName('08a')).toBe('Am')
      expect(camelotToMusicalName('8B')).toBe('C')
      expect(camelotToMusicalName('1A')).toBe('Abm')
      expect(camelotToMusicalName('12A')).toBe('C#m')
      expect(camelotToMusicalName('2B')).toBe('F#')
      expect(camelotToMusicalName('invalid')).toBe('')
      expect(isValidCamelotKey('13A')).toBe(false)
      expect(isValidCamelotKey(null)).toBe(false)
    })
  })

  describe('getCamelotCompatibility', () => {
    it('scores exact matches as 1.0', () => {
      const res = getCamelotCompatibility('8A', '8A')
      expect(res).toEqual({ score: 1.0, relation: 'Exact Match', compatible: true })
    })

    it('handles circular ±1 wrap-around between 12A and 1A', () => {
      const forward = getCamelotCompatibility('12A', '1A')
      expect(forward).toEqual({ score: 0.92, relation: 'Adjacent (+1)', compatible: true })

      const backward = getCamelotCompatibility('1A', '12A')
      expect(backward).toEqual({ score: 0.92, relation: 'Adjacent (-1)', compatible: true })

      const majorWrap = getCamelotCompatibility('12B', '1B')
      expect(majorWrap).toEqual({ score: 0.92, relation: 'Adjacent (+1)', compatible: true })
    })

    it('handles relative major/minor transitions (8A <-> 8B)', () => {
      const minorToMajor = getCamelotCompatibility('8A', '8B')
      expect(minorToMajor).toEqual({
        score: 0.88,
        relation: 'Relative Major/Minor',
        compatible: true
      })

      const majorToMinor = getCamelotCompatibility('8B', '8A')
      expect(majorToMinor).toEqual({
        score: 0.88,
        relation: 'Relative Major/Minor',
        compatible: true
      })

      // Accepts raw musical / Open Key forms too
      expect(getCamelotCompatibility('Am', '1d')).toEqual({
        score: 0.88,
        relation: 'Relative Major/Minor',
        compatible: true
      })
    })

    it('handles diagonal (±1 across A/B) and energy boost (+2) / drop (-2)', () => {
      const boost = getCamelotCompatibility('8A', '10A')
      expect(boost).toEqual({ score: 0.65, relation: 'Energy Boost (+2)', compatible: true })

      const drop = getCamelotCompatibility('8A', '6A')
      expect(drop).toEqual({ score: 0.5, relation: 'Energy Drop (-2)', compatible: false })

      const diagPlus = getCamelotCompatibility('8A', '9B')
      expect(diagPlus).toEqual({ score: 0.65, relation: 'Diagonal (+1)', compatible: true })

      const diagMinus = getCamelotCompatibility('1A', '12B')
      expect(diagMinus).toEqual({ score: 0.65, relation: 'Diagonal (-1)', compatible: true })
    })

    it('detects harmonic clashes and missing/invalid keys', () => {
      const tritoneClash = getCamelotCompatibility('8A', '2A')
      expect(tritoneClash.compatible).toBe(false)
      expect(tritoneClash.relation).toBe('Harmonic Clash')
      expect(tritoneClash.score).toBeLessThanOrEqual(0.25)
      expect(tritoneClash.score).toBeGreaterThanOrEqual(0.1)

      const crossModeClash = getCamelotCompatibility('8A', '10B')
      expect(crossModeClash.compatible).toBe(false)
      expect(crossModeClash.relation).toBe('Harmonic Clash')
      expect(crossModeClash.score).toBeLessThanOrEqual(0.25)

      expect(getCamelotCompatibility(null, '8A')).toEqual({
        score: 0.5,
        relation: 'Unknown Key',
        compatible: false
      })
      expect(getCamelotCompatibility('8A', null)).toEqual({
        score: 0.5,
        relation: 'Unknown Key',
        compatible: false
      })
      expect(getCamelotCompatibility('invalid', '8A')).toEqual({
        score: 0.5,
        relation: 'Unknown Key',
        compatible: false
      })
    })
  })
})
