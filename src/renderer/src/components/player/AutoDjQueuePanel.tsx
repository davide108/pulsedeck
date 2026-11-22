import {
  ArrowDown,
  ArrowUp,
  Lock,
  Play,
  Radio,
  RefreshCw,
  Trash2,
  Unlock,
  Wand2
} from 'lucide-react'
import { ArtworkCover } from '@/components/common/ArtworkCover'
import { KeyBadge } from '@/components/common/KeyBadge'
import { useLibraryStore } from '@/store/useLibraryStore'
import { usePlayerStore } from '@/store/usePlayerStore'
import type { AutoDjScope } from '@shared/types'
import { formatBpm, formatDuration } from '@/utils/format'

interface AutoDjQueuePanelProps {
  compact?: boolean
  className?: string
}

export function AutoDjQueuePanel({ compact = false, className = '' }: AutoDjQueuePanelProps) {
  const folders = useLibraryStore((s) => s.folders)
  const playlists = useLibraryStore((s) => s.playlists)

  const activeTrack = usePlayerStore((s) => s.activeTrack)
  const autoDjQueue = usePlayerStore((s) => s.autoDjQueue)
  const autoDjConfig = usePlayerStore((s) => s.autoDjConfig)
  const toggleAutoDj = usePlayerStore((s) => s.toggleAutoDj)
  const updateAutoDjConfig = usePlayerStore((s) => s.updateAutoDjConfig)
  const toggleQueueLock = usePlayerStore((s) => s.toggleQueueLock)
  const reorderQueue = usePlayerStore((s) => s.reorderQueue)
  const removeFromQueue = usePlayerStore((s) => s.removeFromQueue)
  const rerollQueue = usePlayerStore((s) => s.rerollQueue)
  const playTrack = usePlayerStore((s) => s.playTrack)
  const triggerManualCrossfade = usePlayerStore((s) => s.triggerManualCrossfade)

  const activeFolders = folders.filter((f) => f.isActive)

  const handleScopeTypeChange = (nextType: AutoDjScope['type']) => {
    if (nextType === 'library') {
      updateAutoDjConfig({ scope: { type: 'library' } })
      return
    }
    if (nextType === 'folder') {
      const targetId =
        autoDjConfig.scope.type === 'folder'
          ? autoDjConfig.scope.folderId
          : activeFolders[0]?.id
      if (targetId != null) {
        updateAutoDjConfig({ scope: { type: 'folder', folderId: targetId } })
      }
      return
    }
    if (nextType === 'playlist') {
      const targetId =
        autoDjConfig.scope.type === 'playlist'
          ? autoDjConfig.scope.playlistId
          : playlists[0]?.id
      if (targetId != null) {
        updateAutoDjConfig({ scope: { type: 'playlist', playlistId: targetId } })
      }
    }
  }

  return (
    <div className={`flex h-full flex-col overflow-hidden ${className}`}>
      {/* Header */}
      <div className="border-b border-white/[0.07] px-4 py-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Radio
              className={`h-4 w-4 ${
                autoDjConfig.enabled ? 'text-accentGlow animate-pulse' : 'text-slate-500'
              }`}
            />
            <h2 className="text-sm font-semibold text-white">Up Next (Auto-Mix)</h2>
            <span className="rounded-full bg-white/[0.08] px-2 py-0.5 font-mono text-[10px] tabular-nums text-slate-300">
              {autoDjQueue.length}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={toggleAutoDj}
              className={`rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-all ${
                autoDjConfig.enabled
                  ? 'border-accent/50 bg-accent/20 text-white shadow-glow'
                  : 'border-white/10 bg-white/[0.04] text-slate-400 hover:text-white'
              }`}
            >
              {autoDjConfig.enabled ? 'ON' : 'OFF'}
            </button>

            <button
              type="button"
              onClick={rerollQueue}
              title="Reroll unlocked upcoming tracks"
              className="inline-flex h-7 items-center gap-1 rounded-lg border border-white/10 bg-white/[0.05] px-2.5 text-[11px] font-medium text-slate-200 hover:bg-white/10 hover:text-white transition-colors"
            >
              <RefreshCw className="h-3 w-3" />
              <span>Reroll</span>
            </button>

            {autoDjQueue.length > 0 && (
              <button
                type="button"
                onClick={() => void triggerManualCrossfade()}
                title="Mix into next queued track now"
                className="inline-flex h-7 items-center gap-1 rounded-lg bg-accent px-2.5 text-[11px] font-semibold text-white shadow-glow hover:brightness-110 transition-all"
              >
                <Wand2 className="h-3 w-3" />
                <span>Mix Next</span>
              </button>
            )}
          </div>
        </div>

        {!autoDjConfig.enabled && (
          <div className="mt-2.5 flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[11px] text-slate-300">
            <span>Normal playback is active. Enable Auto-Mix to mix this queue automatically.</span>
            <button
              type="button"
              onClick={toggleAutoDj}
              className="shrink-0 rounded-lg bg-accent/25 border border-accent/40 px-2.5 py-1 text-[10px] font-semibold text-white hover:bg-accent/40 transition-colors"
            >
              Enable Auto-Mix
            </button>
          </div>
        )}

        {/* Scope Selector */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Source
          </span>
          <div className="inline-flex rounded-lg border border-white/10 bg-black/25 p-0.5">
            {(['library', 'folder', 'playlist'] as const).map((scopeType) => {
              const disabled =
                (scopeType === 'folder' && activeFolders.length === 0) ||
                (scopeType === 'playlist' && playlists.length === 0)
              const active = autoDjConfig.scope.type === scopeType
              return (
                <button
                  key={scopeType}
                  type="button"
                  disabled={disabled}
                  onClick={() => handleScopeTypeChange(scopeType)}
                  className={`rounded-md px-2.5 py-1 text-[11px] font-medium capitalize transition-colors ${
                    active
                      ? 'bg-accent/25 text-white'
                      : 'text-slate-400 hover:text-slate-200 disabled:opacity-35'
                  }`}
                >
                  {scopeType}
                </button>
              )
            })}
          </div>

          {autoDjConfig.scope.type === 'folder' && activeFolders.length > 0 && (
            <select
              value={autoDjConfig.scope.folderId}
              onChange={(e) =>
                updateAutoDjConfig({
                  scope: { type: 'folder', folderId: Number(e.target.value) }
                })
              }
              aria-label="Select Auto-DJ folder scope"
              className="h-7 max-w-[170px] rounded-lg border border-white/10 bg-[#121520] px-2 text-xs text-slate-200 focus:border-accent/60 focus:outline-none"
            >
              {activeFolders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          )}

          {autoDjConfig.scope.type === 'playlist' && playlists.length > 0 && (
            <select
              value={autoDjConfig.scope.playlistId}
              onChange={(e) =>
                updateAutoDjConfig({
                  scope: { type: 'playlist', playlistId: Number(e.target.value) }
                })
              }
              aria-label="Select Auto-DJ playlist scope"
              className="h-7 max-w-[170px] rounded-lg border border-white/10 bg-[#121520] px-2 text-xs text-slate-200 focus:border-accent/60 focus:outline-none"
            >
              {playlists.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Current Anchor Summary */}
        {activeTrack && !compact && (
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-2 text-xs">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-accentGlow">
              Anchor
            </span>
            <span className="truncate font-medium text-white">{activeTrack.title}</span>
            <span className="text-slate-500">·</span>
            <span className="font-mono text-[11px] text-slate-300">
              {formatBpm(activeTrack.bpm)} BPM
            </span>
            <KeyBadge camelotKey={activeTrack.camelotKey} size="xs" />
          </div>
        )}
      </div>

      {/* Queue Items */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {autoDjQueue.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 p-6 text-center">
            <Radio className="mb-2.5 h-8 w-8 text-slate-600" />
            <p className="text-xs font-semibold text-slate-300">Auto-DJ Queue Empty</p>
            <p className="mt-1 max-w-xs text-[11px] text-slate-500">
              Add at least two tracks in your selected scope to generate harmonic transitions.
            </p>
          </div>
        ) : (
          autoDjQueue.map((item, idx) => {
            const { track } = item
            const matchPct = Math.round(Math.max(0, Math.min(1, item.score)) * 100)
            return (
              <div
                key={`${track.id}-${idx}`}
                className={`group rounded-xl border p-2.5 transition-all ${
                  item.locked
                    ? 'border-accent/40 bg-accent/10'
                    : idx === 0
                      ? 'border-accentGlow/30 bg-white/[0.05]'
                      : 'border-white/[0.07] bg-white/[0.03] hover:bg-white/[0.055]'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <span className="w-4 shrink-0 text-center font-mono text-[11px] font-semibold text-slate-500">
                    {idx + 1}
                  </span>

                  <div className="relative shrink-0">
                    <ArtworkCover
                      artworkPath={track.artworkPath}
                      alt={track.album}
                      className={compact ? 'h-9 w-9' : 'h-10 w-10'}
                      iconClassName="h-4 w-4"
                    />
                    <button
                      type="button"
                      onClick={() => void playTrack(track)}
                      title={`Play ${track.title} now`}
                      className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Play className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className="truncate text-xs font-semibold text-white">{track.title}</p>
                      {idx === 0 && (
                        <span className="shrink-0 rounded bg-accentGlow/20 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-accentGlow">
                          Next
                        </span>
                      )}
                    </div>
                    <p className="truncate text-[11px] text-slate-400">
                      {track.artist} · {formatDuration(track.duration)}
                    </p>

                    {/* Match Pills */}
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <span className="rounded bg-white/[0.07] px-1.5 py-0.5 font-mono text-[10px] text-slate-200">
                        {formatBpm(track.bpm)} BPM
                      </span>
                      <KeyBadge camelotKey={track.camelotKey} size="xs" />
                      {track.genre && (
                        <span className="max-w-[110px] truncate rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-slate-300">
                          {track.genre}
                        </span>
                      )}
                      <span
                        className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium text-accentGlow"
                        title={`BPM ${Math.round(item.bpmScore * 100)}% · Key ${Math.round(item.harmonicScore * 100)}% · Flow ${Math.round(item.flowScore * 100)}%`}
                      >
                        {item.harmonicRelation !== 'Unknown Key'
                          ? item.harmonicRelation
                          : item.matchReason}{' '}
                        · {matchPct}%
                      </span>
                    </div>
                  </div>

                  {/* Queue Controls */}
                  <div className="flex shrink-0 items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => toggleQueueLock(idx)}
                      title={item.locked ? 'Unlock slot' : 'Lock track in this slot'}
                      className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors ${
                        item.locked
                          ? 'bg-accent/25 text-accentGlow'
                          : 'text-slate-400 hover:bg-white/10 hover:text-white'
                      }`}
                    >
                      {item.locked ? (
                        <Lock className="h-3.5 w-3.5" />
                      ) : (
                        <Unlock className="h-3.5 w-3.5" />
                      )}
                    </button>

                    <button
                      type="button"
                      disabled={idx === 0}
                      onClick={() => reorderQueue(idx, idx - 1)}
                      title="Move up"
                      className="flex h-7 w-6 items-center justify-center rounded-lg text-slate-400 hover:bg-white/10 hover:text-white disabled:opacity-25"
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </button>

                    <button
                      type="button"
                      disabled={idx === autoDjQueue.length - 1}
                      onClick={() => reorderQueue(idx, idx + 1)}
                      title="Move down"
                      className="flex h-7 w-6 items-center justify-center rounded-lg text-slate-400 hover:bg-white/10 hover:text-white disabled:opacity-25"
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </button>

                    <button
                      type="button"
                      onClick={() => removeFromQueue(idx)}
                      title="Remove from queue"
                      className="flex h-7 w-6 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-500/20 hover:text-rose-300"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
