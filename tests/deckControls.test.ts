import { describe, expect, it } from 'vitest'
import {
  computeEqualPowerCrossfadeGains,
  computeLoopWindow,
  computeSyncRate,
  mapFilterValueToBiquad
} from '@shared/types'

describe('computeSyncRate', () => {
  it('computes direct 1x sync rate to match target BPM', () => {
    expect(computeSyncRate(120, 126)).toBeCloseTo(1.05, 4)
    expect(computeSyncRate(128, 121.6)).toBeCloseTo(0.95, 4)
    expect(computeSyncRate(124, 124)).toBe(1)
  })

  it('handles half-time (2x) and double-time (0.5x) BPM relationships', () => {
    // 120 BPM deck syncing to a 63 BPM half-time track -> targets 126 BPM (1.05x)
    expect(computeSyncRate(120, 63)).toBeCloseTo(1.05, 4)
    // 70 BPM deck syncing to a 136 BPM double-time track -> targets 68 BPM (~0.9714x)
    expect(computeSyncRate(70, 136)).toBeCloseTo(68 / 70, 4)
    // Exact 2x / 0.5x multiples resolve cleanly to 1.0
    expect(computeSyncRate(140, 70)).toBe(1)
    expect(computeSyncRate(70, 140)).toBe(1)
  })

  it('clamps sync rate within default ±12% and custom maxShiftPct bounds', () => {
    expect(computeSyncRate(100, 130)).toBe(1.12)
    expect(computeSyncRate(130, 100)).toBe(0.88)
    expect(computeSyncRate(100, 120, 6)).toBe(1.06)
    expect(computeSyncRate(120, 100, 6)).toBe(0.94)
    expect(computeSyncRate(100, 110, 0)).toBe(1)
  })

  it('returns 1 for missing, zero, negative, or non-finite BPM inputs', () => {
    expect(computeSyncRate(null, 128)).toBe(1)
    expect(computeSyncRate(128, null)).toBe(1)
    expect(computeSyncRate(0, 128)).toBe(1)
    expect(computeSyncRate(128, -120)).toBe(1)
    expect(computeSyncRate(Number.NaN, 128)).toBe(1)
    expect(computeSyncRate(128, Number.POSITIVE_INFINITY)).toBe(1)
  })
})

describe('computeLoopWindow', () => {
  it('computes BPM-synced loop windows for 4, 8, and 16 beats', () => {
    // 120 BPM -> 0.5s per beat
    expect(computeLoopWindow(30, 120, 4, 240)).toEqual({ startSec: 30, endSec: 32 })
    expect(computeLoopWindow(30, 120, 8, 240)).toEqual({ startSec: 30, endSec: 34 })
    expect(computeLoopWindow(30, 120, 16, 240)).toEqual({ startSec: 30, endSec: 38 })

    // 125 BPM -> 0.48s per beat -> 8 beats = 3.84s
    const win = computeLoopWindow(10, 125, 8, 180)
    expect(win.startSec).toBeCloseTo(10, 4)
    expect(win.endSec).toBeCloseTo(13.84, 4)
  })

  it('falls back to beats * 0.5 seconds when BPM is missing or invalid', () => {
    expect(computeLoopWindow(12, null, 8, 180)).toEqual({ startSec: 12, endSec: 16 })
    expect(computeLoopWindow(12, 0, 4, 180)).toEqual({ startSec: 12, endSec: 14 })
    expect(computeLoopWindow(12, -100, 16, 180)).toEqual({ startSec: 12, endSec: 20 })
  })

  it('clamps safely inside track duration boundaries', () => {
    // Anchor near track end shifts start back so full loop fits inside duration
    expect(computeLoopWindow(198, 120, 8, 200)).toEqual({ startSec: 196, endSec: 200 })
    // Negative anchor clamps to 0
    expect(computeLoopWindow(-5, 120, 4, 200)).toEqual({ startSec: 0, endSec: 2 })
    // Loop longer than entire track clamps to [0, duration]
    expect(computeLoopWindow(1, 120, 16, 3)).toEqual({ startSec: 0, endSec: 3 })
    // Zero or negative duration returns {0, 0}
    expect(computeLoopWindow(10, 120, 8, 0)).toEqual({ startSec: 0, endSec: 0 })
    expect(computeLoopWindow(10, 120, 8, -10)).toEqual({ startSec: 0, endSec: 0 })
  })
})

describe('mapFilterValueToBiquad', () => {
  it('bypasses with allpass near 0', () => {
    expect(mapFilterValueToBiquad(0).type).toBe('allpass')
    expect(mapFilterValueToBiquad(0.01).type).toBe('allpass')
    expect(mapFilterValueToBiquad(-0.01).type).toBe('allpass')
    expect(mapFilterValueToBiquad(Number.NaN).type).toBe('allpass')
  })

  it('maps negative values to a smooth log-scale lowpass sweep (120Hz..18000Hz)', () => {
    const fullLpf = mapFilterValueToBiquad(-1)
    const midLpf = mapFilterValueToBiquad(-0.5)
    const subtleLpf = mapFilterValueToBiquad(-0.05)

    expect(fullLpf.type).toBe('lowpass')
    expect(midLpf.type).toBe('lowpass')
    expect(subtleLpf.type).toBe('lowpass')

    expect(fullLpf.frequency).toBeCloseTo(120, 1)
    // Geometric midpoint of 120 and 18000 is sqrt(2160000) ≈ 1469.7 Hz
    expect(midLpf.frequency).toBeCloseTo(Math.sqrt(120 * 18000), 0)
    expect(fullLpf.frequency).toBeLessThan(midLpf.frequency)
    expect(midLpf.frequency).toBeLessThan(subtleLpf.frequency)
    expect(subtleLpf.frequency).toBeLessThanOrEqual(18000)
    expect(fullLpf.q).toBeGreaterThan(subtleLpf.q)
  })

  it('maps positive values to a smooth log-scale highpass sweep (60Hz..8000Hz)', () => {
    const subtleHpf = mapFilterValueToBiquad(0.05)
    const midHpf = mapFilterValueToBiquad(0.5)
    const fullHpf = mapFilterValueToBiquad(1)

    expect(subtleHpf.type).toBe('highpass')
    expect(midHpf.type).toBe('highpass')
    expect(fullHpf.type).toBe('highpass')

    expect(fullHpf.frequency).toBeCloseTo(8000, 1)
    // Geometric midpoint of 60 and 8000 is sqrt(480000) ≈ 692.8 Hz
    expect(midHpf.frequency).toBeCloseTo(Math.sqrt(60 * 8000), 0)
    expect(subtleHpf.frequency).toBeGreaterThanOrEqual(60)
    expect(subtleHpf.frequency).toBeLessThan(midHpf.frequency)
    expect(midHpf.frequency).toBeLessThan(fullHpf.frequency)
    expect(fullHpf.q).toBeGreaterThan(subtleHpf.q)
  })

  it('clamps out-of-range values beyond [-1, 1]', () => {
    expect(mapFilterValueToBiquad(-5)).toEqual(mapFilterValueToBiquad(-1))
    expect(mapFilterValueToBiquad(5)).toEqual(mapFilterValueToBiquad(1))
  })
})

describe('computeEqualPowerCrossfadeGains', () => {
  it('returns exact endpoints at 0 (full A) and 1 (full B)', () => {
    expect(computeEqualPowerCrossfadeGains(0)).toEqual({ gainA: 1, gainB: 0 })
    expect(computeEqualPowerCrossfadeGains(1)).toEqual({ gainA: 0, gainB: 1 })
  })

  it('returns symmetric equal-power gain (~0.7071) at center 0.5', () => {
    const center = computeEqualPowerCrossfadeGains(0.5)
    expect(center.gainA).toBeCloseTo(Math.SQRT1_2, 4)
    expect(center.gainB).toBeCloseTo(Math.SQRT1_2, 4)
  })

  it('preserves constant power (gainA^2 + gainB^2 === 1) across the entire sweep', () => {
    for (let i = 0; i <= 20; i++) {
      const pos = i / 20
      const { gainA, gainB } = computeEqualPowerCrossfadeGains(pos)
      expect(gainA).toBeGreaterThanOrEqual(0)
      expect(gainB).toBeGreaterThanOrEqual(0)
      expect(gainA * gainA + gainB * gainB).toBeCloseTo(1, 4)
    }
  })

  it('clamps positions outside [0, 1] and defaults NaN to center', () => {
    expect(computeEqualPowerCrossfadeGains(-0.5)).toEqual({ gainA: 1, gainB: 0 })
    expect(computeEqualPowerCrossfadeGains(1.8)).toEqual({ gainA: 0, gainB: 1 })
    const nanGains = computeEqualPowerCrossfadeGains(Number.NaN)
    expect(nanGains.gainA).toBeCloseTo(Math.SQRT1_2, 4)
    expect(nanGains.gainB).toBeCloseTo(Math.SQRT1_2, 4)
  })
})
