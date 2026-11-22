import { describe, expect, it } from 'vitest'
import {
  SUPPORTED_AUDIO_EXTENSIONS,
  parseFilenameFallback
} from '../src/main/scanner/metadata'

describe('metadata fallback & supported audio extensions', () => {
  it('supports all 7 required audio formats', () => {
    expect([...SUPPORTED_AUDIO_EXTENSIONS].sort()).toEqual([
      '.aac',
      '.flac',
      '.m4a',
      '.mp3',
      '.ogg',
      '.opus',
      '.wav'
    ])
  })

  it('parses numbered dash-separated filenames like "01 - Daft Punk - Around The World.mp3"', () => {
    expect(parseFilenameFallback('01 - Daft Punk - Around The World.mp3')).toEqual({
      trackNumber: 1,
      artist: 'Daft Punk',
      title: 'Around The World'
    })
  })

  it('parses dot-numbered filenames like "02. Radiohead - Reckoner.flac"', () => {
    expect(parseFilenameFallback('02. Radiohead - Reckoner.flac')).toEqual({
      trackNumber: 2,
      artist: 'Radiohead',
      title: 'Reckoner'
    })
  })

  it('parses artist and title with parenthetical mix names like "Artist - Title (Extended Mix).opus"', () => {
    expect(parseFilenameFallback('Artist - Title (Extended Mix).opus')).toEqual({
      trackNumber: null,
      artist: 'Artist',
      title: 'Title (Extended Mix)'
    })
  })

  it('falls back to Unknown Artist and replaces underscores in "Just_A_Title.wav"', () => {
    expect(parseFilenameFallback('Just_A_Title.wav')).toEqual({
      trackNumber: null,
      artist: 'Unknown Artist',
      title: 'Just A Title'
    })
  })

  it('handles full Windows/POSIX directory paths, multi-hyphen titles, and space/paren prefixes', () => {
    expect(
      parseFilenameFallback('C:\\Users\\david\\Music\\Discovery\\12 - Daft Punk - Too Long - Steam Machine.m4a')
    ).toEqual({
      trackNumber: 12,
      artist: 'Daft Punk',
      title: 'Too Long - Steam Machine'
    })

    expect(parseFilenameFallback('/home/user/music/03 Bicep - Atlas.ogg')).toEqual({
      trackNumber: 3,
      artist: 'Bicep',
      title: 'Atlas'
    })

    expect(parseFilenameFallback('04) Four Tet - Loved.aac')).toEqual({
      trackNumber: 4,
      artist: 'Four Tet',
      title: 'Loved'
    })
  })
})
