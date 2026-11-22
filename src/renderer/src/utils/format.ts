export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) {
    return '0:00'
  }
  const totalSec = Math.floor(seconds)
  const hrs = Math.floor(totalSec / 3600)
  const mins = Math.floor((totalSec % 3600) / 60)
  const secs = totalSec % 60
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  }
  return `${mins}:${String(secs).padStart(2, '0')}`
}

export function getArtworkUrl(artworkPath: string | null | undefined): string | null {
  if (!artworkPath) return null
  return `media://artwork/${encodeURIComponent(artworkPath)}`
}

export function formatBpm(bpm: number | null | undefined): string {
  if (bpm === null || bpm === undefined || !Number.isFinite(bpm) || bpm <= 0) {
    return '—'
  }
  return String(Math.round(bpm))
}

export function formatReplayGain(db: number | null | undefined): string {
  if (db === null || db === undefined || !Number.isFinite(db)) {
    return '—'
  }
  const sign = db > 0 ? '+' : ''
  return `${sign}${db.toFixed(1)} dB`
}

export function formatPitchShift(rate: number): string {
  if (!Number.isFinite(rate) || Math.abs(rate - 1) < 0.001) {
    return '0.0%'
  }
  const pct = (rate - 1) * 100
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`
}

export function formatRelativeDate(timestampMs: number | null | undefined): string {
  if (!timestampMs) return 'Never'
  const diffSec = Math.max(0, Math.floor((Date.now() - timestampMs) / 1000))
  if (diffSec < 60) return 'Just now'
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`
  return new Date(timestampMs).toLocaleDateString()
}

export function isMacPlatform(): boolean {
  return typeof window !== 'undefined' && window.api?.platform === 'darwin'
}

export function getModKeyLabel(): string {
  return isMacPlatform() ? '⌘' : 'Ctrl'
}

export function getFileManagerLabel(): string {
  if (isMacPlatform()) return 'Finder'
  if (typeof window !== 'undefined' && window.api?.platform === 'linux') {
    return 'File Manager'
  }
  return 'Explorer'
}
