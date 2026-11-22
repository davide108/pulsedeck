import { describe, expect, it } from 'vitest'
import {
  cleanQueryText,
  findActiveLyricIndex,
  formatTimestampLrc,
  isSyncedLrc,
  parseLrc,
  stripLrcTimestamps
} from '@shared/lrcParser'

describe('lrcParser utilities', () => {
  describe('parseLrc', () => {
    it('parses single and multi-timestamp lines with 2-digit, 3-digit, colon, and integer seconds', () => {
      const lrc = [
        '[00:05.25] Two-digit centiseconds',
        '[00:08.125] Three-digit milliseconds',
        '[00:10:50] Colon separator',
        '[00:15] No fractional part',
        '[00:12.50][01:05.00] Chorus'
      ].join('\n')

      expect(parseLrc(lrc)).toEqual([
        { timeSec: 5.25, text: 'Two-digit centiseconds' },
        { timeSec: 8.125, text: 'Three-digit milliseconds' },
        { timeSec: 10.5, text: 'Colon separator' },
        { timeSec: 12.5, text: 'Chorus' },
        { timeSec: 15, text: 'No fractional part' },
        { timeSec: 65, text: 'Chorus' }
      ])
    })

    it('applies [offset:±ms] header adjustment and clamps timestamps to >= 0', () => {
      const positiveOffset = ['[offset:500]', '[00:01.00] First', '[00:05.25] Second'].join('\n')
      expect(parseLrc(positiveOffset)).toEqual([
        { timeSec: 1.5, text: 'First' },
        { timeSec: 5.75, text: 'Second' }
      ])

      const negativeOffset = ['[offset:-500]', '[00:00.20] Clamped', '[00:02.00] Shifted'].join(
        '\n'
      )
      expect(parseLrc(negativeOffset)).toEqual([
        { timeSec: 0, text: 'Clamped' },
        { timeSec: 1.5, text: 'Shifted' }
      ])
    })

    it('ignores metadata tags, blank lines, and sorts chronologically', () => {
      const raw = [
        '\uFEFF[ar:Bicep]',
        '[ti:Glue]',
        '[al:Bicep]',
        '[by:PulseDeck]',
        '[length:04:29]',
        '[01:10.00] Later verse',
        '[00:20.00]   ',
        '[00:05.00] Opening line',
        'Plain line without timestamp'
      ].join('\n')

      expect(parseLrc(raw)).toEqual([
        { timeSec: 5, text: 'Opening line' },
        { timeSec: 70, text: 'Later verse' }
      ])
    })

    it('returns empty array for empty or untimed input', () => {
      expect(parseLrc('')).toEqual([])
      expect(parseLrc('Just plain lyrics\nWithout timestamps')).toEqual([])
      expect(parseLrc('[ar:Artist]\n[ti:Title]')).toEqual([])
    })
  })

  describe('isSyncedLrc', () => {
    it('detects synced LRC vs plain text, metadata-only, and nullish values', () => {
      expect(isSyncedLrc('[00:12.50] Hello world')).toBe(true)
      expect(isSyncedLrc('[01:02.345] Three digits')).toBe(true)
      expect(isSyncedLrc('Hello world\nSecond line')).toBe(false)
      expect(isSyncedLrc('[ar:Artist]\n[ti:Title]')).toBe(false)
      expect(isSyncedLrc('[00:10.00]   ')).toBe(false)
      expect(isSyncedLrc('')).toBe(false)
      expect(isSyncedLrc(null)).toBe(false)
      expect(isSyncedLrc(undefined)).toBe(false)
    })
  })

  describe('stripLrcTimestamps', () => {
    it('removes timestamps and metadata tags while keeping clean lyric lines', () => {
      const raw = [
        '\uFEFF[ar:Artist Name]',
        '[ti:Song Title]',
        '[al:Album Name]',
        '[offset:500]',
        '[00:05.00] Line one',
        '[00:10.00]   ',
        '[00:12.50][01:05.00] Chorus line',
        'Plain bonus line'
      ].join('\n')

      expect(stripLrcTimestamps(raw)).toBe('Line one\nChorus line\nPlain bonus line')
      expect(stripLrcTimestamps('')).toBe('')
    })
  })

  describe('formatTimestampLrc', () => {
    it('formats seconds as [mm:ss.xx] and guards negative or non-finite values', () => {
      expect(formatTimestampLrc(0)).toBe('[00:00.00]')
      expect(formatTimestampLrc(12.5)).toBe('[00:12.50]')
      expect(formatTimestampLrc(65.05)).toBe('[01:05.05]')
      expect(formatTimestampLrc(600)).toBe('[10:00.00]')
      expect(formatTimestampLrc(-3.5)).toBe('[00:00.00]')
      expect(formatTimestampLrc(Number.NaN)).toBe('[00:00.00]')
    })
  })

  describe('findActiveLyricIndex', () => {
    const lines = [
      { timeSec: 10, text: 'First' },
      { timeSec: 20, text: 'Second' },
      { timeSec: 30, text: 'Third' }
    ]

    it('returns -1 when empty or before the first timestamp', () => {
      expect(findActiveLyricIndex([], 15)).toBe(-1)
      expect(findActiveLyricIndex(lines, 0)).toBe(-1)
      expect(findActiveLyricIndex(lines, 9.99)).toBe(-1)
      expect(findActiveLyricIndex(lines, Number.NaN)).toBe(-1)
    })

    it('returns the matching or active line index and handles positive/negative offsetMs', () => {
      expect(findActiveLyricIndex(lines, 10)).toBe(0)
      expect(findActiveLyricIndex(lines, 19.9)).toBe(0)
      expect(findActiveLyricIndex(lines, 20)).toBe(1)
      expect(findActiveLyricIndex(lines, 45)).toBe(2)

      // Positive offsetMs shifts effective playback time forward (shows lines earlier)
      expect(findActiveLyricIndex(lines, 9.6, 500)).toBe(0)
      expect(findActiveLyricIndex(lines, 19.6, 500)).toBe(1)

      // Negative offsetMs delays effective playback time (shows lines later)
      expect(findActiveLyricIndex(lines, 10.2, -500)).toBe(-1)
      expect(findActiveLyricIndex(lines, 20.4, -500)).toBe(0)
      expect(findActiveLyricIndex(lines, 20.5, -500)).toBe(1)
    })
  })

  describe('cleanQueryText', () => {
    it('strips noisy video, audio, remaster, quality, and feature suffixes', () => {
      expect(cleanQueryText('Midnight City (Official Video)')).toBe('Midnight City')
      expect(cleanQueryText('Starlight (Official Music Video) [HD]')).toBe('Starlight')
      expect(cleanQueryText('Track Name [Official Audio] (Lyrics)')).toBe('Track Name')
      expect(cleanQueryText('Echoes (Official Lyric Video)')).toBe('Echoes')
      expect(cleanQueryText('Time [2011 Remastered Version]')).toBe('Time')
      expect(cleanQueryText('Dreams (2004 Remaster) (HQ)')).toBe('Dreams')
      expect(cleanQueryText('Glue (Audio) [4K]')).toBe('Glue')
      expect(cleanQueryText('Solaris (feat. Guest Artist)')).toBe('Solaris')
      expect(cleanQueryText('Pulse [ft. MC]   (Official Video)  ')).toBe('Pulse')
      expect(cleanQueryText('')).toBe('')
    })
  })
})
