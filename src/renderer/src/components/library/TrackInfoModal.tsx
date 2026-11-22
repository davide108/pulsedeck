import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode
} from 'react'
import {
  AlertTriangle,
  Check,
  Copy,
  Disc3,
  FolderOpen,
  ImagePlus,
  Info,
  Loader2,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
  X
} from 'lucide-react'
import { parseKeyToCamelot } from '@shared/camelot'
import type {
  TrackMetadataUpdateInput,
  TrackRecord,
  TrackTechnicalInfo
} from '@shared/types'
import { ArtworkCover } from '@/components/common/ArtworkCover'
import { EnergyMeter } from '@/components/common/EnergyMeter'
import { KeyBadge } from '@/components/common/KeyBadge'
import { useLibraryStore } from '@/store/useLibraryStore'
import { usePlayerStore } from '@/store/usePlayerStore'
import { formatDuration, formatReplayGain } from '@/utils/format'

interface MetadataDraft {
  title: string
  artist: string
  album: string
  albumArtist: string
  genre: string
  year: string
  trackNumber: string
  bpm: string
  key: string
}

const EMPTY_DRAFT: MetadataDraft = {
  title: '',
  artist: '',
  album: '',
  albumArtist: '',
  genre: '',
  year: '',
  trackNumber: '',
  bpm: '',
  key: ''
}

const INPUT_CLASS =
  'h-9 w-full rounded-xl border border-white/10 bg-black/35 px-3 text-xs text-white placeholder:text-slate-500 focus:border-accent/60 focus:bg-black/50 focus:outline-none transition-colors'
const LABEL_CLASS =
  'mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-300'

function draftFromTrack(track: TrackRecord): MetadataDraft {
  return {
    title: track.title ?? '',
    artist: track.artist ?? '',
    album: track.album ?? '',
    albumArtist: track.albumArtist ?? '',
    genre: track.genre ?? '',
    year: track.year != null ? String(track.year) : '',
    trackNumber: track.trackNumber != null ? String(track.trackNumber) : '',
    bpm: track.bpm != null ? String(track.bpm) : '',
    key: track.musicalKey ?? track.camelotKey ?? ''
  }
}

function metadataFieldsEqual(a: TrackRecord, b: TrackRecord): boolean {
  return (
    a.title === b.title &&
    a.artist === b.artist &&
    a.album === b.album &&
    a.albumArtist === b.albumArtist &&
    a.genre === b.genre &&
    a.year === b.year &&
    a.trackNumber === b.trackNumber &&
    a.bpm === b.bpm &&
    a.musicalKey === b.musicalKey &&
    a.camelotKey === b.camelotKey
  )
}

function formatBitrate(bitrate: number | null | undefined): string {
  if (bitrate == null || !Number.isFinite(bitrate) || bitrate <= 0) return '—'
  return `${Math.round(bitrate / 1000)} kbps`
}

function formatSampleRate(sampleRate: number | null | undefined): string {
  if (sampleRate == null || !Number.isFinite(sampleRate) || sampleRate <= 0) return '—'
  const khz = sampleRate / 1000
  return `${Number.isInteger(khz) ? khz : Number(khz.toFixed(1))} kHz`
}

function formatChannels(channels: number | null | undefined): string {
  if (channels == null || !Number.isFinite(channels) || channels <= 0) return '—'
  if (channels === 1) return '1 (Mono)'
  if (channels === 2) return '2 (Stereo)'
  return `${channels} ch`
}

function formatFileSizeMb(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return '—'
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function formatAddedDate(timestampMs: number | null | undefined): string {
  if (!timestampMs || !Number.isFinite(timestampMs)) return '—'
  return new Date(timestampMs).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  })
}

function notify(type: 'info' | 'error', title: string, message: string): void {
  usePlayerStore.getState().pushToast({ type, title, message })
}

export function TrackInfoModal() {
  const editingTrack = useLibraryStore((s) => s.editingTrack)
  const closeTrackInfo = useLibraryStore((s) => s.closeTrackInfo)
  const updateTrackMetadata = useLibraryStore((s) => s.updateTrackMetadata)
  const reloadTrackMetadataFromFile = useLibraryStore((s) => s.reloadTrackMetadataFromFile)
  const pickTrackArtwork = useLibraryStore((s) => s.pickTrackArtwork)
  const inspectTrackFile = useLibraryStore((s) => s.inspectTrackFile)
  const revealTrackInFolder = useLibraryStore((s) => s.revealTrackInFolder)

  const [draft, setDraft] = useState<MetadataDraft>(EMPTY_DRAFT)
  const [techInfo, setTechInfo] = useState<TrackTechnicalInfo | null>(null)
  const [isInspecting, setIsInspecting] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isReloading, setIsReloading] = useState(false)
  const [isUpdatingCover, setIsUpdatingCover] = useState(false)
  const [copiedPath, setCopiedPath] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)

  const prevTrackRef = useRef<TrackRecord | null>(null)
  const inspectSeqRef = useRef(0)
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isOpen = editingTrack !== null

  const loadTechInfo = useCallback(
    async (trackId: number) => {
      const seq = ++inspectSeqRef.current
      setIsInspecting(true)
      try {
        const info = await inspectTrackFile(trackId)
        if (seq === inspectSeqRef.current) {
          setTechInfo(info)
        }
      } catch {
        if (seq === inspectSeqRef.current) {
          setTechInfo(null)
        }
      } finally {
        if (seq === inspectSeqRef.current) {
          setIsInspecting(false)
        }
      }
    },
    [inspectTrackFile]
  )

  useEffect(() => {
    if (!editingTrack) {
      prevTrackRef.current = null
      inspectSeqRef.current++
      setTechInfo(null)
      setIsInspecting(false)
      setIsSaving(false)
      setIsReloading(false)
      setIsUpdatingCover(false)
      setCopiedPath(false)
      setValidationError(null)
      return
    }

    const prev = prevTrackRef.current
    const isNewTrack = !prev || prev.id !== editingTrack.id

    if (isNewTrack) {
      setDraft(draftFromTrack(editingTrack))
      setValidationError(null)
      setCopiedPath(false)
      setTechInfo(null)
      void loadTechInfo(editingTrack.id)
    } else if (
      !metadataFieldsEqual(prev, editingTrack) ||
      (prev.metadataEditedAt != null && editingTrack.metadataEditedAt == null)
    ) {
      setDraft(draftFromTrack(editingTrack))
      setValidationError(null)
    }

    prevTrackRef.current = editingTrack
  }, [editingTrack, loadTechInfo])

  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        closeTrackInfo()
      }
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [isOpen, closeTrackInfo])

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) {
        clearTimeout(copyTimerRef.current)
      }
    }
  }, [])

  if (!editingTrack) return null

  const isBusy = isSaving || isReloading || isUpdatingCover
  const previewCamelot = parseKeyToCamelot(draft.key)
  const displayPath = techInfo?.filePath ?? editingTrack.filePath
  const isFileMissing = techInfo ? !techInfo.fileExists : editingTrack.isMissing
  const codecSummary = [techInfo?.codec, techInfo?.codecProfile].filter(Boolean).join(' · ')

  const techRows: Array<{ label: string; value: ReactNode; span?: number }> = [
    {
      label: 'Format',
      value: <span className="font-mono font-medium uppercase">{editingTrack.format}</span>
    },
    {
      label: 'Container',
      value: <span className="font-mono">{techInfo?.container ?? '—'}</span>
    },
    {
      label: 'Codec',
      value: <span className="font-mono">{codecSummary || '—'}</span>,
      span: 2
    },
    {
      label: 'Bitrate',
      value: <span className="font-mono tabular-nums">{formatBitrate(techInfo?.bitrate)}</span>
    },
    {
      label: 'Sample Rate',
      value: (
        <span className="font-mono tabular-nums">{formatSampleRate(techInfo?.sampleRate)}</span>
      )
    },
    {
      label: 'Channels',
      value: <span className="font-mono">{formatChannels(techInfo?.numberOfChannels)}</span>
    },
    {
      label: 'Bit Depth',
      value: (
        <span className="font-mono tabular-nums">
          {techInfo?.bitsPerSample != null ? `${techInfo.bitsPerSample}-bit` : '—'}
        </span>
      )
    },
    {
      label: 'File Size',
      value: (
        <span className="font-mono tabular-nums">
          {formatFileSizeMb(techInfo?.fileSize ?? editingTrack.fileSize)}
        </span>
      )
    },
    {
      label: 'Duration',
      value: (
        <span className="font-mono tabular-nums">
          {formatDuration(techInfo?.duration ?? editingTrack.duration)}
        </span>
      )
    },
    {
      label: 'Energy',
      value: <EnergyMeter energy={editingTrack.energy} size="sm" />
    },
    {
      label: 'ReplayGain',
      value: (
        <span className="font-mono tabular-nums">
          {formatReplayGain(editingTrack.replaygainDb)}
        </span>
      )
    },
    {
      label: 'Play Count',
      value: <span className="font-mono tabular-nums">{editingTrack.playCount}</span>
    },
    {
      label: 'Added Date',
      value: <span>{formatAddedDate(editingTrack.addedAt)}</span>
    }
  ]

  const updateDraftField = (field: keyof MetadataDraft, value: string) => {
    setDraft((prev) => ({ ...prev, [field]: value }))
    if (validationError) setValidationError(null)
  }

  const handleCopyPath = async () => {
    try {
      if (!navigator.clipboard) throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(displayPath)
      setCopiedPath(true)
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
      copyTimerRef.current = setTimeout(() => setCopiedPath(false), 1800)
    } catch {
      notify('error', 'Copy Failed', 'Unable to copy file path to clipboard.')
    }
  }

  const handlePickCover = async () => {
    if (isBusy) return
    const prevErr = useLibraryStore.getState().errorMessage
    setIsUpdatingCover(true)
    try {
      const updated = await pickTrackArtwork(editingTrack.id)
      if (updated) {
        notify('info', 'Cover Updated', `Updated artwork for "${updated.title}".`)
      } else {
        const nextErr = useLibraryStore.getState().errorMessage
        if (nextErr && nextErr !== prevErr) {
          notify('error', 'Cover Update Failed', nextErr)
        }
      }
    } catch (err) {
      notify(
        'error',
        'Cover Update Failed',
        err instanceof Error ? err.message : 'Could not update cover artwork.'
      )
    } finally {
      setIsUpdatingCover(false)
    }
  }

  const handleRemoveCover = async () => {
    if (isBusy || !editingTrack.artworkPath) return
    setIsUpdatingCover(true)
    try {
      const updated = await updateTrackMetadata(editingTrack.id, { artworkPath: null })
      if (updated) {
        notify('info', 'Cover Removed', `Removed artwork for "${updated.title}".`)
      } else {
        notify(
          'error',
          'Remove Cover Failed',
          useLibraryStore.getState().errorMessage ?? 'Could not remove track artwork.'
        )
      }
    } catch (err) {
      notify(
        'error',
        'Remove Cover Failed',
        err instanceof Error ? err.message : 'Could not remove track artwork.'
      )
    } finally {
      setIsUpdatingCover(false)
    }
  }

  const handleReloadTags = async () => {
    if (isBusy) return
    setIsReloading(true)
    setValidationError(null)
    try {
      const updated = await reloadTrackMetadataFromFile(editingTrack.id)
      if (updated) {
        setDraft(draftFromTrack(updated))
        void loadTechInfo(updated.id)
        notify(
          'info',
          'File Tags Reloaded',
          `Restored embedded tags from disk for "${updated.title}".`
        )
      } else {
        notify(
          'error',
          'Reload Failed',
          useLibraryStore.getState().errorMessage ??
            'Could not reload metadata from the audio file.'
        )
      }
    } catch (err) {
      notify(
        'error',
        'Reload Failed',
        err instanceof Error ? err.message : 'Could not reload metadata from the audio file.'
      )
    } finally {
      setIsReloading(false)
    }
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (isBusy) return

    const trimmedTitle = draft.title.trim()
    if (!trimmedTitle) {
      setValidationError('Title is required.')
      return
    }

    const trimmedArtist = draft.artist.trim() || 'Unknown Artist'
    const trimmedAlbum = draft.album.trim() || 'Unknown Album'
    const nextAlbumArtist = draft.albumArtist.trim() || null
    const nextGenre = draft.genre.trim() || null

    let nextYear: number | null = null
    if (draft.year.trim() !== '') {
      const parsedYear = Number(draft.year.trim())
      if (!Number.isInteger(parsedYear) || parsedYear < 1 || parsedYear > 9999) {
        setValidationError('Year must be a valid whole number (e.g. 2024).')
        return
      }
      nextYear = parsedYear
    }

    let nextTrackNumber: number | null = null
    if (draft.trackNumber.trim() !== '') {
      const parsedNum = Number(draft.trackNumber.trim())
      if (!Number.isInteger(parsedNum) || parsedNum < 1 || parsedNum > 999) {
        setValidationError('Track # must be a positive whole number.')
        return
      }
      nextTrackNumber = parsedNum
    }

    let nextBpm: number | null = null
    if (draft.bpm.trim() !== '') {
      const parsedBpm = Number(draft.bpm.trim())
      if (!Number.isFinite(parsedBpm) || parsedBpm < 30 || parsedBpm > 300) {
        setValidationError('BPM must be between 30 and 300.')
        return
      }
      nextBpm = Math.round(parsedBpm * 10) / 10
    }

    const trimmedKey = draft.key.trim()
    if (trimmedKey && !previewCamelot) {
      setValidationError(
        'Unrecognized key. Use Musical (e.g. Am, F#m, Eb) or Camelot (e.g. 8A, 12B) notation.'
      )
      return
    }

    setValidationError(null)

    const patch: TrackMetadataUpdateInput = {}
    if (trimmedTitle !== editingTrack.title) patch.title = trimmedTitle
    if (trimmedArtist !== editingTrack.artist) patch.artist = trimmedArtist
    if (trimmedAlbum !== editingTrack.album) patch.album = trimmedAlbum
    if (nextAlbumArtist !== (editingTrack.albumArtist ?? null)) patch.albumArtist = nextAlbumArtist
    if (nextGenre !== (editingTrack.genre ?? null)) patch.genre = nextGenre
    if (nextYear !== (editingTrack.year ?? null)) patch.year = nextYear
    if (nextTrackNumber !== (editingTrack.trackNumber ?? null)) patch.trackNumber = nextTrackNumber
    if (nextBpm !== (editingTrack.bpm ?? null)) patch.bpm = nextBpm

    const initialKey = (editingTrack.musicalKey ?? editingTrack.camelotKey ?? '').trim()
    if (trimmedKey !== initialKey) {
      patch.musicalKey = trimmedKey || null
      patch.camelotKey = trimmedKey ? previewCamelot : null
    }

    if (Object.keys(patch).length === 0) {
      closeTrackInfo()
      return
    }

    setIsSaving(true)
    try {
      const updated = await updateTrackMetadata(editingTrack.id, patch)
      if (updated) {
        notify('info', 'Metadata Saved', `Saved metadata edits for "${updated.title}".`)
        closeTrackInfo()
      } else {
        notify(
          'error',
          'Save Failed',
          useLibraryStore.getState().errorMessage ?? 'Could not save metadata changes.'
        )
      }
    } catch (err) {
      notify(
        'error',
        'Save Failed',
        err instanceof Error ? err.message : 'Could not save metadata changes.'
      )
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-md"
      onClick={closeTrackInfo}
      role="dialog"
      aria-modal="true"
      aria-labelledby="track-info-modal-title"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="glass-elevated flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-white/10 shadow-2xl"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between gap-4 border-b border-white/[0.08] bg-surface/60 px-6 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-accent/35 bg-accent/20 text-accentGlow shadow-glow">
              <Disc3 className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2
                  id="track-info-modal-title"
                  className="truncate text-sm font-bold tracking-tight text-white"
                >
                  Track Info &amp; Metadata Editor
                </h2>
                {editingTrack.metadataEditedAt != null && (
                  <span
                    title={`Edited ${new Date(editingTrack.metadataEditedAt).toLocaleString()}`}
                    className="inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent/20 px-2 py-0.5 text-[10px] font-semibold text-accentGlow"
                  >
                    <Sparkles className="h-2.5 w-2.5" />
                    <span>Custom Edits Saved</span>
                  </span>
                )}
                {isFileMissing && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/40 bg-rose-500/15 px-2 py-0.5 text-[10px] font-semibold text-rose-300">
                    <AlertTriangle className="h-2.5 w-2.5" />
                    <span>Missing File</span>
                  </span>
                )}
              </div>
              <p className="truncate text-[11px] text-slate-400">
                {editingTrack.artist} — {editingTrack.title}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={closeTrackInfo}
            aria-label="Close Track Info"
            title="Close (Esc)"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-slate-400 hover:bg-white/10 hover:text-white transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable Two-Column Content */}
        <form
          noValidate
          onSubmit={(e) => void handleSubmit(e)}
          className="flex flex-1 flex-col overflow-hidden"
        >
          <div className="grid flex-1 grid-cols-1 gap-6 overflow-y-auto p-6 lg:grid-cols-[320px_1fr]">
            {/* Left Column: Cover & Technical File Inspection */}
            <div className="space-y-4">
              {/* Cover Artwork Card */}
              <div className="glass-panel flex flex-col items-center rounded-2xl p-4">
                <div className="relative">
                  <div
                    className="absolute -inset-2 rounded-2xl opacity-35 blur-xl"
                    style={{
                      background:
                        'radial-gradient(circle, rgb(var(--accent-rgb) / 0.65), rgb(var(--accent-glow-rgb) / 0.3), transparent 70%)'
                    }}
                  />
                  <ArtworkCover
                    artworkPath={editingTrack.artworkPath}
                    alt={editingTrack.album}
                    className="relative h-44 w-44 shadow-2xl"
                    iconClassName="h-14 w-14"
                    roundedClassName="rounded-2xl"
                  />
                </div>

                <div className="mt-4 flex w-full items-center gap-2">
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => void handlePickCover()}
                    className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-xl border border-accent/40 bg-accent/20 px-3 text-xs font-semibold text-white hover:bg-accent/30 disabled:opacity-50 transition-colors"
                  >
                    {isUpdatingCover ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ImagePlus className="h-3.5 w-3.5 text-accentGlow" />
                    )}
                    <span>Change Cover</span>
                  </button>

                  <button
                    type="button"
                    disabled={isBusy || !editingTrack.artworkPath}
                    onClick={() => void handleRemoveCover()}
                    className="inline-flex h-8 items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-xs font-medium text-slate-300 hover:border-rose-500/40 hover:bg-rose-500/15 hover:text-rose-200 disabled:cursor-not-allowed disabled:opacity-40 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>Remove</span>
                  </button>
                </div>

                <div className="mt-2.5 grid w-full grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => void handleReloadTags()}
                    title="Discard custom overrides and reload tags from the audio file"
                    className="inline-flex h-8 items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.04] px-2.5 text-[11px] font-medium text-slate-200 hover:bg-white/10 hover:text-white disabled:opacity-50 transition-colors"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${isReloading ? 'animate-spin' : ''}`} />
                    <span>Reload File Tags</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => void revealTrackInFolder(editingTrack.id)}
                    className="inline-flex h-8 items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.04] px-2.5 text-[11px] font-medium text-slate-200 hover:bg-white/10 hover:text-white transition-colors"
                  >
                    <FolderOpen className="h-3.5 w-3.5" />
                    <span>Reveal in Explorer</span>
                  </button>
                </div>
              </div>

              {/* File Path Card */}
              <div className="glass-panel rounded-2xl p-3.5 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    File Path
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleCopyPath()}
                    className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-medium text-slate-300 hover:bg-white/10 hover:text-white transition-colors"
                  >
                    {copiedPath ? (
                      <>
                        <Check className="h-3 w-3 text-emerald-400" />
                        <span className="text-emerald-300">Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3" />
                        <span>Copy</span>
                      </>
                    )}
                  </button>
                </div>
                <p className="break-all select-all rounded-lg border border-white/[0.06] bg-black/30 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-slate-300">
                  {displayPath}
                </p>
              </div>

              {/* Technical Inspection Card */}
              <div className="glass-panel rounded-2xl p-3.5 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                      Technical File Details
                    </span>
                    {isInspecting && <Loader2 className="h-3 w-3 animate-spin text-accentGlow" />}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {techInfo?.lossless === true && (
                      <span className="rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                        Lossless
                      </span>
                    )}
                    {techInfo?.hasEmbeddedLyrics && (
                      <span className="rounded-full border border-white/15 bg-white/[0.06] px-2 py-0.5 text-[10px] font-medium text-slate-300">
                        Embedded Lyrics
                      </span>
                    )}
                  </div>
                </div>

                <dl className="grid grid-cols-2 gap-x-3 gap-y-2.5 text-xs">
                  {techRows.map((row) => (
                    <div key={row.label} className={row.span === 2 ? 'col-span-2' : undefined}>
                      <dt className="text-[10px] uppercase tracking-wider text-slate-500">
                        {row.label}
                      </dt>
                      <dd className="mt-0.5 truncate text-xs text-slate-200">{row.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>

            {/* Right Column: Editable Metadata Form */}
            <div className="flex flex-col justify-between space-y-5">
              <div className="space-y-4">
                <div>
                  <label htmlFor="track-meta-title" className={LABEL_CLASS}>
                    Title <span className="text-rose-400">*</span>
                  </label>
                  <input
                    id="track-meta-title"
                    type="text"
                    required
                    value={draft.title}
                    onChange={(e) => updateDraftField('title', e.target.value)}
                    placeholder="Track title"
                    className={`${INPUT_CLASS} font-medium`}
                  />
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="track-meta-artist" className={LABEL_CLASS}>
                      Artist
                    </label>
                    <input
                      id="track-meta-artist"
                      type="text"
                      value={draft.artist}
                      onChange={(e) => updateDraftField('artist', e.target.value)}
                      placeholder="Unknown Artist"
                      className={INPUT_CLASS}
                    />
                  </div>

                  <div>
                    <label htmlFor="track-meta-album" className={LABEL_CLASS}>
                      Album
                    </label>
                    <input
                      id="track-meta-album"
                      type="text"
                      value={draft.album}
                      onChange={(e) => updateDraftField('album', e.target.value)}
                      placeholder="Unknown Album"
                      className={INPUT_CLASS}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="track-meta-album-artist" className={LABEL_CLASS}>
                      Album Artist
                    </label>
                    <input
                      id="track-meta-album-artist"
                      type="text"
                      value={draft.albumArtist}
                      onChange={(e) => updateDraftField('albumArtist', e.target.value)}
                      placeholder="Optional"
                      className={INPUT_CLASS}
                    />
                  </div>

                  <div>
                    <label htmlFor="track-meta-genre" className={LABEL_CLASS}>
                      Genre
                    </label>
                    <input
                      id="track-meta-genre"
                      type="text"
                      value={draft.genre}
                      onChange={(e) => updateDraftField('genre', e.target.value)}
                      placeholder="e.g. Melodic Techno, Synthwave"
                      className={INPUT_CLASS}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div>
                    <label htmlFor="track-meta-year" className={LABEL_CLASS}>
                      Year
                    </label>
                    <input
                      id="track-meta-year"
                      type="number"
                      min={1}
                      max={9999}
                      step={1}
                      value={draft.year}
                      onChange={(e) => updateDraftField('year', e.target.value)}
                      placeholder="2024"
                      className={`${INPUT_CLASS} font-mono tabular-nums`}
                    />
                  </div>

                  <div>
                    <label htmlFor="track-meta-track-num" className={LABEL_CLASS}>
                      Track #
                    </label>
                    <input
                      id="track-meta-track-num"
                      type="number"
                      min={1}
                      max={999}
                      step={1}
                      value={draft.trackNumber}
                      onChange={(e) => updateDraftField('trackNumber', e.target.value)}
                      placeholder="1"
                      className={`${INPUT_CLASS} font-mono tabular-nums`}
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="track-meta-bpm"
                      className="mb-1.5 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-slate-300"
                    >
                      <span>BPM (30–300)</span>
                      {editingTrack.bpmSource && (
                        <span className="text-[9px] font-normal text-slate-500">
                          {editingTrack.bpmSource}
                        </span>
                      )}
                    </label>
                    <input
                      id="track-meta-bpm"
                      type="number"
                      min={30}
                      max={300}
                      step="0.1"
                      value={draft.bpm}
                      onChange={(e) => updateDraftField('bpm', e.target.value)}
                      placeholder="124"
                      className={`${INPUT_CLASS} font-mono tabular-nums`}
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="track-meta-key"
                    className="mb-1.5 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-slate-300"
                  >
                    <span>Musical / Camelot Key</span>
                    {editingTrack.keySource && (
                      <span className="text-[9px] font-normal text-slate-500">
                        source: {editingTrack.keySource}
                      </span>
                    )}
                  </label>
                  <div className="flex items-center gap-3">
                    <input
                      id="track-meta-key"
                      type="text"
                      value={draft.key}
                      onChange={(e) => updateDraftField('key', e.target.value)}
                      placeholder="e.g. Am, F#m, 8A, or 1m"
                      className={`${INPUT_CLASS} flex-1 font-mono`}
                    />
                    <div className="flex shrink-0 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-2.5 py-1.5">
                      <span className="text-[10px] uppercase tracking-wider text-slate-500">
                        Camelot
                      </span>
                      <KeyBadge
                        camelotKey={previewCamelot}
                        musicalKey={draft.key.trim() || null}
                        showMusicalName
                        size="md"
                      />
                    </div>
                  </div>
                  <p className="mt-1.5 text-[11px] text-slate-500">
                    {draft.key.trim() && !previewCamelot ? (
                      <span className="text-amber-300">
                        Unrecognized key format — try Musical (Am, C#m, Eb), Camelot (8A, 12B), or
                        Open Key (1m, 5d).
                      </span>
                    ) : (
                      'Supports Musical (Am, C#m, Eb), Camelot (8A–12B), and Traktor Open Key (1m–12d).'
                    )}
                  </p>
                </div>

                {validationError && (
                  <div className="flex items-center gap-2 rounded-xl border border-rose-500/40 bg-rose-500/15 px-3.5 py-2.5 text-xs text-rose-200">
                    <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />
                    <span>{validationError}</span>
                  </div>
                )}
              </div>

              <div className="flex items-start gap-2.5 rounded-xl border border-accent/25 bg-accent/10 px-3.5 py-3 text-[11px] leading-relaxed text-slate-300">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-accentGlow" />
                <span>
                  Metadata edits are saved to your PulseDeck library and preserved across folder
                  rescans.
                </span>
              </div>
            </div>
          </div>

          {/* Modal Footer */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.08] bg-surface/60 px-6 py-3.5">
            <span className="text-[11px] text-slate-400">
              {editingTrack.metadataEditedAt != null
                ? `Last edited ${new Date(editingTrack.metadataEditedAt).toLocaleString()}`
                : 'Using embedded file tags'}
            </span>

            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={closeTrackInfo}
                disabled={isSaving}
                className="inline-flex h-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] px-4 text-xs font-medium text-slate-200 hover:bg-white/10 hover:text-white disabled:opacity-50 transition-colors"
              >
                Cancel
              </button>

              <button
                type="submit"
                disabled={isBusy}
                className="inline-flex h-9 items-center justify-center gap-2 rounded-xl bg-accent px-4 text-xs font-semibold text-white shadow-glow hover:brightness-110 disabled:opacity-60 transition-all"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Saving...</span>
                  </>
                ) : (
                  <>
                    <Save className="h-3.5 w-3.5" />
                    <span>Save Changes</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
