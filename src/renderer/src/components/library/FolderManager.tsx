import { useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  FolderOpen,
  FolderPlus,
  Loader2,
  RefreshCw,
  Trash2
} from 'lucide-react'
import { useLibraryStore } from '@/store/useLibraryStore'
import { formatRelativeDate } from '@/utils/format'

export function FolderManager() {
  const folders = useLibraryStore((s) => s.folders)
  const scanProgress = useLibraryStore((s) => s.scanProgress)
  const addFolder = useLibraryStore((s) => s.addFolder)
  const removeFolder = useLibraryStore((s) => s.removeFolder)
  const toggleFolderActive = useLibraryStore((s) => s.toggleFolderActive)
  const rescanFolder = useLibraryStore((s) => s.rescanFolder)

  const [confirmRemoveId, setConfirmRemoveId] = useState<number | null>(null)

  const activeCount = folders.filter((f) => f.isActive).length
  const totalFolderTracks = folders.reduce((sum, f) => sum + (f.trackCount ?? 0), 0)
  const anyScanning = Object.values(scanProgress).some(
    (ev) => ev.phase === 'discovering' || ev.phase === 'indexing'
  )

  return (
    <div className="flex h-full flex-col overflow-y-auto px-6 py-6">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-white">
            Watched Music Folders
          </h1>
          <p className="mt-1 text-xs text-slate-400">
            {folders.length === 0
              ? 'Add local music directories to scan metadata, BPM, key, and waveform peaks.'
              : `${activeCount} active of ${folders.length} ${folders.length === 1 ? 'folder' : 'folders'} · ${totalFolderTracks} indexed tracks`}
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          {folders.length > 0 && (
            <button
              type="button"
              disabled={anyScanning}
              onClick={() => void rescanFolder()}
              className="inline-flex h-9 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] px-3.5 text-xs font-medium text-slate-200 hover:bg-white/10 hover:text-white disabled:opacity-50 transition-colors"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${anyScanning ? 'animate-spin text-accent' : ''}`} />
              <span>Rescan All</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => void addFolder()}
            className="inline-flex h-9 items-center gap-2 rounded-xl bg-accent px-4 text-xs font-semibold text-white shadow-glow hover:brightness-110 transition-all"
          >
            <FolderPlus className="h-4 w-4" />
            <span>Add Folder</span>
          </button>
        </div>
      </div>

      {/* Empty State */}
      {folders.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center rounded-2xl glass-panel border-dashed p-10 text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-accent/15 text-accent border border-accent/30 shadow-glow">
            <FolderOpen className="h-8 w-8" />
          </div>
          <h2 className="text-base font-semibold text-white">No Music Folders Connected</h2>
          <p className="mt-2 max-w-md text-xs leading-relaxed text-slate-400">
            Select one or more local folders containing MP3, FLAC, WAV, OGG, M4A, AAC, or OPUS
            files. PulseDeck extracts embedded tags, watches for file changes, and analyzes BPM,
            Camelot keys, and waveforms in the background.
          </p>
          <button
            type="button"
            onClick={() => void addFolder()}
            className="mt-5 inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-xs font-semibold text-white shadow-glow hover:brightness-110 transition-all"
          >
            <FolderPlus className="h-4 w-4" />
            <span>Choose Music Folder</span>
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {folders.map((folder) => {
            const progress = scanProgress[folder.id]
            const isScanning =
              progress?.phase === 'discovering' || progress?.phase === 'indexing'
            const pct =
              progress && progress.total > 0
                ? Math.min(100, Math.round((progress.scanned / progress.total) * 100))
                : 0

            return (
              <div
                key={folder.id}
                className={`rounded-2xl glass-panel p-4 transition-all ${
                  folder.isActive ? 'opacity-100' : 'opacity-65'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex min-w-0 flex-1 items-start gap-3.5">
                    <div
                      className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${
                        folder.isActive
                          ? 'border-accent/30 bg-accent/15 text-accent'
                          : 'border-white/10 bg-white/[0.04] text-slate-400'
                      }`}
                    >
                      <FolderOpen className="h-5 w-5" />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="truncate text-sm font-semibold text-white">
                          {folder.name}
                        </h3>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                            folder.isActive
                              ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                              : 'bg-slate-500/15 text-slate-400 border border-slate-500/30'
                          }`}
                        >
                          {folder.isActive ? 'Active' : 'Disabled'}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate font-mono text-[11px] text-slate-400">
                        {folder.path}
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
                        <span className="tabular-nums font-medium text-slate-300">
                          {folder.trackCount ?? 0}{' '}
                          {(folder.trackCount ?? 0) === 1 ? 'track' : 'tracks'}
                        </span>
                        <span>·</span>
                        <span>Last scanned: {formatRelativeDate(folder.lastScannedAt)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Controls */}
                  <div className="flex items-center gap-2.5">
                    {/* Active / Inactive Switch */}
                    <button
                      type="button"
                      role="switch"
                      aria-checked={folder.isActive}
                      onClick={() => void toggleFolderActive(folder.id, !folder.isActive)}
                      title={folder.isActive ? 'Disable folder from library' : 'Enable folder'}
                      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border transition-colors ${
                        folder.isActive
                          ? 'border-accent/50 bg-accent/80'
                          : 'border-white/15 bg-white/10'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                          folder.isActive ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>

                    <button
                      type="button"
                      disabled={isScanning || !folder.isActive}
                      onClick={() => void rescanFolder(folder.id)}
                      title="Rescan this folder"
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 text-xs font-medium text-slate-200 hover:bg-white/10 hover:text-white disabled:opacity-40 transition-colors"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${isScanning ? 'animate-spin text-accent' : ''}`} />
                      <span>Rescan</span>
                    </button>

                    {confirmRemoveId === folder.id ? (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            setConfirmRemoveId(null)
                            void removeFolder(folder.id)
                          }}
                          className="h-8 rounded-lg bg-rose-500/80 px-2.5 text-xs font-semibold text-white hover:bg-rose-500 transition-colors"
                        >
                          Remove
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmRemoveId(null)}
                          className="h-8 rounded-lg border border-white/10 bg-white/[0.05] px-2 text-xs text-slate-300 hover:text-white"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmRemoveId(folder.id)}
                        title="Remove folder from library"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-slate-400 hover:border-rose-500/40 hover:bg-rose-500/15 hover:text-rose-300 transition-colors"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Live Scan Progress Bar */}
                {progress && (
                  <div className="mt-3.5 rounded-xl border border-white/10 bg-black/30 p-3">
                    <div className="mb-1.5 flex items-center justify-between text-[11px]">
                      <span className="flex items-center gap-1.5 font-medium text-slate-200">
                        {progress.phase === 'error' ? (
                          <AlertTriangle className="h-3.5 w-3.5 text-rose-400" />
                        ) : progress.phase === 'done' ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                        ) : (
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
                        )}
                        <span>
                          {progress.phase === 'discovering' && 'Discovering audio files...'}
                          {progress.phase === 'indexing' &&
                            `Indexing ${progress.scanned} / ${progress.total} files`}
                          {progress.phase === 'done' && 'Scan complete'}
                          {progress.phase === 'error' && (progress.message || 'Scan failed')}
                        </span>
                      </span>

                      <span className="font-mono tabular-nums text-slate-400">
                        +{progress.added} added · ~{progress.updated} updated · {progress.missing}{' '}
                        missing
                      </span>
                    </div>

                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                      <div
                        className={`h-full rounded-full transition-all duration-200 ${
                          progress.phase === 'error'
                            ? 'bg-rose-500'
                            : progress.phase === 'done'
                              ? 'bg-emerald-400'
                              : progress.phase === 'discovering'
                                ? 'w-1/3 animate-pulse bg-accent'
                                : 'bg-accent'
                        }`}
                        style={
                          progress.phase === 'discovering'
                            ? undefined
                            : { width: `${progress.phase === 'done' ? 100 : pct}%` }
                        }
                      />
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
