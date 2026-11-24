import { useState, type ReactNode } from 'react'
import {
  Activity,
  AlertCircle,
  Check,
  CheckCircle2,
  Download,
  ExternalLink,
  FolderCog,
  Keyboard,
  Loader2,
  Palette,
  Play,
  Pause,
  Radio,
  RefreshCw,
  Repeat,
  Repeat1,
  RotateCcw,
  Settings,
  Shuffle,
  Sliders,
  Sparkles,
  Volume2,
  VolumeX
} from 'lucide-react'
import { useLibraryStore } from '@/store/useLibraryStore'
import { usePlayerStore } from '@/store/usePlayerStore'
import { getModKeyLabel } from '@/utils/format'
import {
  ACCENT_PRESETS,
  type AutoDjScope,
  type MixStyle,
  type RepeatMode
} from '@shared/types'

const SEEK_STEPS = [3, 5, 10, 15] as const
const EARLY_SKIP_OPTIONS = [10, 15, 20, 30] as const
const BAR_OPTIONS: Array<4 | 8 | 16> = [4, 8, 16]
const MIX_STYLES: Array<{ id: MixStyle; label: string; hint: string }> = [
  { id: 'equal-power', label: 'Equal-Power', hint: 'Smooth cosine/sine crossfade' },
  { id: 'bass-swap', label: 'Bass-Swap', hint: 'EQ low-end swap at 40–60%' },
  { id: 'quick-cut', label: 'Quick Cut', hint: 'Crisp 0.5s DJ transition' }
]

function getShortcutsList(): Array<{ keys: string; desc: string }> {
  const mod = getModKeyLabel()
  return [
    { keys: 'Space', desc: 'Play / Pause' },
    { keys: 'S', desc: 'Toggle Shuffle (Random)' },
    { keys: 'R', desc: 'Cycle Repeat (Off / All / One)' },
    { keys: 'D', desc: 'Toggle Auto-Mix' },
    { keys: 'L', desc: 'Toggle Lyrics view' },
    { keys: 'I', desc: 'Track Info & Edit Metadata' },
    { keys: 'M', desc: 'Mute / Unmute audio' },
    { keys: '← / →', desc: 'Seek backward / forward (Shift = 3x)' },
    { keys: '↑ / ↓', desc: 'Volume up / down (±5%)' },
    { keys: `F / ${mod}+F`, desc: 'Focus library search' },
    { keys: `${mod} + ,`, desc: 'Open Settings' },
    { keys: 'Esc', desc: 'Close Now Playing overlay' },
    { keys: 'Media Keys', desc: 'OS Play/Pause, Next, Previous, Stop' }
  ]
}

function ToggleSwitch({
  checked,
  onChange,
  label
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border transition-colors ${
        checked
          ? 'border-accent/60 bg-accent shadow-glow'
          : 'border-white/15 bg-white/10'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  )
}

function SettingsSection({
  icon,
  title,
  subtitle,
  children
}: {
  icon: ReactNode
  title: string
  subtitle: string
  children: ReactNode
}) {
  return (
    <section className="rounded-2xl glass-panel p-5 space-y-4">
      <div className="flex items-start gap-3 border-b border-white/[0.07] pb-3.5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-accent/30 bg-accent/15 text-accentGlow">
          {icon}
        </div>
        <div>
          <h2 className="text-sm font-bold text-white">{title}</h2>
          <p className="text-xs text-slate-400">{subtitle}</p>
        </div>
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  )
}

function SettingRow({
  title,
  description,
  control
}: {
  title: string
  description?: string
  control: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-slate-100">{title}</p>
        {description && <p className="mt-0.5 text-[11px] text-slate-400">{description}</p>}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  )
}

export function SettingsView() {
  const folders = useLibraryStore((s) => s.folders)
  const playlists = useLibraryStore((s) => s.playlists)
  const facets = useLibraryStore((s) => s.facets)
  const setView = useLibraryStore((s) => s.setView)
  const rescanFolder = useLibraryStore((s) => s.rescanFolder)

  const shuffle = usePlayerStore((s) => s.shuffle)
  const repeatMode = usePlayerStore((s) => s.repeatMode)
  const volume = usePlayerStore((s) => s.volume)
  const muted = usePlayerStore((s) => s.muted)
  const sidebarCollapsed = usePlayerStore((s) => s.sidebarCollapsed)
  const autoCheckUpdates = usePlayerStore((s) => s.autoCheckUpdates)
  const updateState = usePlayerStore((s) => s.updateState)
  const autoDjConfig = usePlayerStore((s) => s.autoDjConfig)
  const audioSettings = usePlayerStore((s) => s.audioSettings)
  const appearanceSettings = usePlayerStore((s) => s.appearanceSettings)
  const librarySettings = usePlayerStore((s) => s.librarySettings)
  const analysisProgress = usePlayerStore((s) => s.analysisProgress)

  const setShuffle = usePlayerStore((s) => s.setShuffle)
  const setRepeatMode = usePlayerStore((s) => s.setRepeatMode)
  const setVolume = usePlayerStore((s) => s.setVolume)
  const toggleMute = usePlayerStore((s) => s.toggleMute)
  const setSidebarCollapsed = usePlayerStore((s) => s.setSidebarCollapsed)
  const setAutoCheckUpdates = usePlayerStore((s) => s.setAutoCheckUpdates)
  const checkForUpdates = usePlayerStore((s) => s.checkForUpdates)
  const downloadUpdate = usePlayerStore((s) => s.downloadUpdate)
  const installUpdate = usePlayerStore((s) => s.installUpdate)
  const openUpdateReleasePage = usePlayerStore((s) => s.openUpdateReleasePage)
  const updateAutoDjConfig = usePlayerStore((s) => s.updateAutoDjConfig)
  const updateAudioSettings = usePlayerStore((s) => s.updateAudioSettings)
  const updateAppearanceSettings = usePlayerStore((s) => s.updateAppearanceSettings)
  const updateLibrarySettings = usePlayerStore((s) => s.updateLibrarySettings)
  const pauseAnalysis = usePlayerStore((s) => s.pauseAnalysis)
  const resumeAnalysis = usePlayerStore((s) => s.resumeAnalysis)
  const resetAllDeckEq = usePlayerStore((s) => s.resetAllDeckEq)
  const resetAllSettings = usePlayerStore((s) => s.resetAllSettings)
  const pushToast = usePlayerStore((s) => s.pushToast)

  const [confirmReset, setConfirmReset] = useState(false)
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

  const handleResetDefaults = async () => {
    await resetAllSettings()
    setConfirmReset(false)
    pushToast({
      type: 'info',
      title: 'Settings Reset',
      message: 'All playback, Auto-Mix, audio, and appearance settings restored to defaults.'
    })
  }

  const repeatOptions: Array<{ id: RepeatMode; label: string; icon: ReactNode }> = [
    { id: 'off', label: 'Off', icon: <Repeat className="h-3.5 w-3.5 opacity-60" /> },
    { id: 'all', label: 'Repeat All', icon: <Repeat className="h-3.5 w-3.5" /> },
    { id: 'one', label: 'Repeat One', icon: <Repeat1 className="h-3.5 w-3.5" /> }
  ]

  const formatBytes = (bytes: number): string => {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`
    return `${Math.round(bytes)} B`
  }

  const updateStatus = updateState?.status ?? 'idle'
  const isCheckingUpdate = updateStatus === 'checking'
  const isDownloadingUpdate = updateStatus === 'downloading'
  const currentVersion = updateState?.currentVersion ?? '1.3.0'

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6">
      <div className="mx-auto max-w-4xl space-y-5 pb-8">
        {/* Page Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/[0.07] pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-accent/35 bg-accent/20 text-accentGlow shadow-glow">
              <Settings className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-white">Settings</h1>
              <p className="text-xs text-slate-400">
                Configure software updates, playback behavior, Auto-Mix DJ transitions, audio DSP, and appearance.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 font-mono text-[11px] font-semibold text-slate-300">
              v{currentVersion}
            </span>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-semibold ${
                autoDjConfig.enabled
                  ? 'border-accent/45 bg-accent/20 text-accentGlow'
                  : 'border-white/10 bg-white/[0.04] text-slate-300'
              }`}
            >
              <Radio className={`h-3.5 w-3.5 ${autoDjConfig.enabled ? 'animate-pulse' : ''}`} />
              <span>{autoDjConfig.enabled ? 'Auto-Mix Enabled' : 'Normal Sequential Mode'}</span>
            </span>
          </div>
        </div>

        {/* Software Updates */}
        <SettingsSection
          icon={<Download className="h-4 w-4" />}
          title="Software Updates"
          subtitle="Check GitHub Releases for new versions of PulseDeck and install updates automatically."
        >
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-white/[0.07] bg-white/[0.025] px-4 py-3">
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-white">
                  PulseDeck v{currentVersion}
                </span>

                {updateStatus === 'not-available' && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/35 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                    <CheckCircle2 className="h-3 w-3" />
                    Up to date
                  </span>
                )}
                {updateStatus === 'available' && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-accent/45 bg-accent/20 px-2 py-0.5 text-[10px] font-semibold text-accentGlow">
                    <Sparkles className="h-3 w-3" />
                    v{updateState?.latestVersion} available
                  </span>
                )}
                {updateStatus === 'downloaded' && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/45 bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                    <CheckCircle2 className="h-3 w-3" />
                    Ready to install
                  </span>
                )}
                {updateStatus === 'error' && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/40 bg-rose-500/15 px-2 py-0.5 text-[10px] font-semibold text-rose-300">
                    <AlertCircle className="h-3 w-3" />
                    Check failed
                  </span>
                )}
              </div>

              <p className="text-[11px] text-slate-400">
                {updateStatus === 'checking' && 'Checking GitHub Releases for a newer version…'}
                {updateStatus === 'idle' &&
                  'Checks github.com/davide108/pulsedeck for the latest release.'}
                {updateStatus === 'not-available' &&
                  `You are running the latest release${updateState?.checkedAt ? ` (checked ${new Date(updateState.checkedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})` : ''}.`}
                {updateStatus === 'available' &&
                  (updateState?.canAutoInstall
                    ? `${updateState.releaseName || `PulseDeck v${updateState.latestVersion}`} is ready to download and install automatically.`
                    : `${updateState?.releaseName || `PulseDeck v${updateState?.latestVersion}`} is available on GitHub Releases.`)}
                {updateStatus === 'downloading' &&
                  `Downloading v${updateState?.latestVersion ?? ''}… ${Math.round(updateState?.downloadPercent ?? 0)}% (${formatBytes(updateState?.transferredBytes ?? 0)} / ${formatBytes(updateState?.totalBytes ?? 0)}${updateState?.bytesPerSecond ? ` · ${formatBytes(updateState.bytesPerSecond)}/s` : ''})`}
                {updateStatus === 'downloaded' &&
                  `PulseDeck v${updateState?.latestVersion ?? ''} has been downloaded. Restart now to finish installing.`}
                {updateStatus === 'error' && (updateState?.error || 'Could not reach GitHub Releases.')}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {updateStatus === 'downloaded' ? (
                <button
                  type="button"
                  onClick={() => void installUpdate()}
                  className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-accent px-3.5 text-xs font-semibold text-white shadow-glow transition hover:brightness-110"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span>Restart &amp; Install</span>
                </button>
              ) : updateStatus === 'available' ? (
                <button
                  type="button"
                  onClick={() => void downloadUpdate()}
                  className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-accent px-3.5 text-xs font-semibold text-white shadow-glow transition hover:brightness-110"
                >
                  {updateState?.canAutoInstall ? (
                    <>
                      <Download className="h-3.5 w-3.5" />
                      <span>Download &amp; Install</span>
                    </>
                  ) : (
                    <>
                      <ExternalLink className="h-3.5 w-3.5" />
                      <span>Download Update</span>
                    </>
                  )}
                </button>
              ) : null}

              <button
                type="button"
                disabled={isCheckingUpdate || isDownloadingUpdate}
                onClick={() => void checkForUpdates()}
                className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.06] px-3 text-xs font-semibold text-slate-100 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isCheckingUpdate ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-accentGlow" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5 text-accentGlow" />
                )}
                <span>{isCheckingUpdate ? 'Checking…' : 'Check for Updates'}</span>
              </button>

              <button
                type="button"
                onClick={() => void openUpdateReleasePage()}
                title="Open GitHub Releases page"
                className="inline-flex h-8 items-center gap-1 rounded-xl border border-white/10 bg-white/[0.04] px-2.5 text-xs text-slate-300 transition hover:bg-white/10 hover:text-white"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {isDownloadingUpdate && (
            <div className="space-y-1.5">
              <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-accent to-accentGlow transition-all duration-200"
                  style={{ width: `${Math.max(2, Math.min(100, updateState?.downloadPercent ?? 0))}%` }}
                />
              </div>
            </div>
          )}

          {updateState?.releaseNotes && (updateStatus === 'available' || updateStatus === 'downloaded') && (
            <div className="max-h-28 overflow-y-auto rounded-xl border border-white/[0.06] bg-black/25 px-3.5 py-2.5 text-[11px] leading-relaxed text-slate-300 whitespace-pre-wrap">
              {updateState.releaseNotes}
            </div>
          )}

          <SettingRow
            title="Check for Updates Automatically on Startup"
            description="Quietly check GitHub Releases in the background when PulseDeck launches."
            control={
              <ToggleSwitch
                checked={autoCheckUpdates}
                onChange={setAutoCheckUpdates}
                label="Toggle automatic startup update checks"
              />
            }
          />
        </SettingsSection>

        {/* 1. Playback & Transport */}
        <SettingsSection
          icon={<Play className="h-4 w-4" />}
          title="Playback & Transport"
          subtitle="Normal one-after-another playback controls, shuffle order, repeat behavior, and seek increments."
        >
          <div className="rounded-xl border border-white/[0.07] bg-white/[0.025] px-3.5 py-2.5 text-[11px] text-slate-300">
            By default, PulseDeck plays tracks sequentially one after another without crossfading. Toggle{' '}
            <strong className="text-white">Auto-Mix</strong> whenever you want automatic DJ transitions.
          </div>

          <SettingRow
            title="Shuffle (Random Order)"
            description="Play tracks in randomized order using Previous / Next and at track end (when Auto-Mix is off)."
            control={
              <div className="flex items-center gap-2.5">
                <Shuffle
                  className={`h-4 w-4 ${shuffle ? 'text-accentGlow' : 'text-slate-500'}`}
                />
                <ToggleSwitch checked={shuffle} onChange={setShuffle} label="Toggle shuffle" />
              </div>
            }
          />

          <SettingRow
            title="Repeat Mode"
            description="Stop at the end of the list, replay all songs in a loop, or repeat the current song."
            control={
              <div className="inline-flex rounded-xl border border-white/10 bg-black/30 p-1">
                {repeatOptions.map((opt) => {
                  const active = repeatMode === opt.id
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setRepeatMode(opt.id)}
                      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                        active
                          ? 'bg-accent text-white shadow-glow'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {opt.icon}
                      <span>{opt.label}</span>
                    </button>
                  )
                })}
              </div>
            }
          />

          <SettingRow
            title="Keyboard Seek Step"
            description="Seconds jumped when pressing Left / Right arrow keys (hold Shift for 3x)."
            control={
              <div className="inline-flex rounded-xl border border-white/10 bg-black/30 p-1">
                {SEEK_STEPS.map((sec) => (
                  <button
                    key={sec}
                    type="button"
                    onClick={() => updateAudioSettings({ seekStepSec: sec })}
                    className={`rounded-lg px-3 py-1 font-mono text-xs font-semibold transition-all ${
                      audioSettings.seekStepSec === sec
                        ? 'bg-accent text-white shadow-glow'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {sec}s
                  </button>
                ))}
              </div>
            }
          />
        </SettingsSection>

        {/* 2. Auto-Mix / DJ Engine */}
        <SettingsSection
          icon={<Radio className="h-4 w-4" />}
          title="Auto-Mix & DJ Engine"
          subtitle="Optional harmonic mixing, transition curve style, BPM tempo sync, and adaptive queue selection."
        >
          <SettingRow
            title="Enable Auto-Mix (Shortcut: D)"
            description="Automatically mix tracks at outro cues using BPM proximity, Camelot key harmony, and energy flow."
            control={
              <ToggleSwitch
                checked={autoDjConfig.enabled}
                onChange={(enabled) => updateAutoDjConfig({ enabled })}
                label="Enable Auto-Mix"
              />
            }
          />

          <SettingRow
            title="Transition Style"
            description="Choose how Deck A and Deck B blend during automatic and manual Mix Next transitions."
            control={
              <div className="inline-flex rounded-xl border border-white/10 bg-black/30 p-1">
                {MIX_STYLES.map((style) => {
                  const active = autoDjConfig.mixStyle === style.id
                  return (
                    <button
                      key={style.id}
                      type="button"
                      title={style.hint}
                      onClick={() => updateAutoDjConfig({ mixStyle: style.id })}
                      className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                        active
                          ? 'bg-accent text-white shadow-glow'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {style.label}
                    </button>
                  )
                })}
              </div>
            }
          />

          <SettingRow
            title="Mix Length"
            description="Set crossfade overlap in fixed seconds (4–16s) or beat-aligned bars from track BPM."
            control={
              <div className="flex flex-wrap items-center gap-3">
                <div className="inline-flex rounded-lg border border-white/10 bg-black/30 p-0.5 text-[11px]">
                  <button
                    type="button"
                    onClick={() => updateAutoDjConfig({ durationMode: 'fixed' })}
                    className={`rounded-md px-2.5 py-1 font-semibold ${
                      autoDjConfig.durationMode === 'fixed'
                        ? 'bg-white/15 text-white'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Seconds
                  </button>
                  <button
                    type="button"
                    onClick={() => updateAutoDjConfig({ durationMode: 'bars' })}
                    className={`rounded-md px-2.5 py-1 font-semibold ${
                      autoDjConfig.durationMode === 'bars'
                        ? 'bg-white/15 text-white'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Bars (BPM)
                  </button>
                </div>

                {autoDjConfig.durationMode === 'fixed' ? (
                  <div className="flex items-center gap-2.5">
                    <input
                      type="range"
                      min={4}
                      max={16}
                      step={1}
                      disabled={autoDjConfig.mixStyle === 'quick-cut'}
                      value={autoDjConfig.durationSec}
                      onChange={(e) =>
                        updateAutoDjConfig({ durationSec: Number(e.target.value) })
                      }
                      aria-label="Auto-Mix duration in seconds"
                      className="h-1.5 w-28 accent-indigo-400 disabled:opacity-40"
                    />
                    <span className="w-9 font-mono text-xs tabular-nums text-white">
                      {autoDjConfig.mixStyle === 'quick-cut'
                        ? '0.5s'
                        : `${autoDjConfig.durationSec}s`}
                    </span>
                  </div>
                ) : (
                  <div className="inline-flex rounded-xl border border-white/10 bg-black/30 p-1">
                    {BAR_OPTIONS.map((bars) => (
                      <button
                        key={bars}
                        type="button"
                        disabled={autoDjConfig.mixStyle === 'quick-cut'}
                        onClick={() => updateAutoDjConfig({ durationBars: bars })}
                        className={`rounded-lg px-2.5 py-1 font-mono text-xs font-semibold transition-colors disabled:opacity-40 ${
                          autoDjConfig.durationBars === bars
                            ? 'bg-accent/30 text-accentGlow'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        {bars} Bars
                      </button>
                    ))}
                  </div>
                )}
              </div>
            }
          />

          <SettingRow
            title="Tempo Matching"
            description="Smoothly match incoming playback rate during overlaps when track BPM delta is within threshold."
            control={
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={2}
                    max={8}
                    step={1}
                    disabled={!autoDjConfig.tempoMatchEnabled}
                    value={autoDjConfig.tempoMatchMaxPct}
                    onChange={(e) =>
                      updateAutoDjConfig({ tempoMatchMaxPct: Number(e.target.value) })
                    }
                    aria-label="Max tempo match percent"
                    className="h-1.5 w-24 accent-indigo-400 disabled:opacity-40"
                  />
                  <span className="w-10 font-mono text-xs tabular-nums text-slate-200">
                    ±{autoDjConfig.tempoMatchMaxPct}%
                  </span>
                </div>
                <ToggleSwitch
                  checked={autoDjConfig.tempoMatchEnabled}
                  onChange={(tempoMatchEnabled) => updateAutoDjConfig({ tempoMatchEnabled })}
                  label="Enable tempo matching"
                />
              </div>
            }
          />

          <SettingRow
            title="Auto-Mix Source Scope"
            description="Restrict Auto-Mix queue picks to your entire library, a specific folder, or a playlist."
            control={
              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex rounded-xl border border-white/10 bg-black/30 p-1">
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
                        className={`rounded-lg px-2.5 py-1 text-xs font-semibold capitalize transition-colors ${
                          active
                            ? 'bg-accent text-white shadow-glow'
                            : 'text-slate-400 hover:text-white disabled:opacity-35'
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
                    aria-label="Auto-Mix folder scope"
                    className="h-8 max-w-[180px] rounded-xl border border-white/10 bg-[#121520] px-2.5 text-xs text-slate-200 focus:border-accent/60 focus:outline-none"
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
                    aria-label="Auto-Mix playlist scope"
                    className="h-8 max-w-[180px] rounded-xl border border-white/10 bg-[#121520] px-2.5 text-xs text-slate-200 focus:border-accent/60 focus:outline-none"
                  >
                    {playlists.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            }
          />

          <SettingRow
            title="Manual Override Crossfade Speed"
            description="Transition fade duration when clicking another track in Auto-Mix mode or using Crossfade Now."
            control={
              <div className="flex items-center gap-2.5">
                <input
                  type="range"
                  min={0.5}
                  max={4}
                  step={0.25}
                  value={audioSettings.manualCrossfadeSec}
                  onChange={(e) =>
                    updateAudioSettings({ manualCrossfadeSec: Number(e.target.value) })
                  }
                  aria-label="Manual override crossfade duration"
                  className="h-1.5 w-28 accent-indigo-400"
                />
                <span className="w-11 font-mono text-xs tabular-nums text-white">
                  {audioSettings.manualCrossfadeSec.toFixed(2)}s
                </span>
              </div>
            }
          />

          <SettingRow
            title="Early Skip Learning Threshold"
            description="Skipping an Auto-Mix pick earlier than this lowers its session affinity."
            control={
              <div className="inline-flex rounded-xl border border-white/10 bg-black/30 p-1">
                {EARLY_SKIP_OPTIONS.map((sec) => (
                  <button
                    key={sec}
                    type="button"
                    onClick={() => updateLibrarySettings({ earlySkipThresholdSec: sec })}
                    className={`rounded-lg px-2.5 py-1 font-mono text-xs font-semibold transition-all ${
                      librarySettings.earlySkipThresholdSec === sec
                        ? 'bg-accent text-white shadow-glow'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {sec}s
                  </button>
                ))}
              </div>
            }
          />
        </SettingsSection>

        {/* 3. Audio Output & DSP */}
        <SettingsSection
          icon={<Sliders className="h-4 w-4" />}
          title="Audio Output & DSP"
          subtitle="Master output level, loudness normalization, peak limiting, and Dual-Deck EQ reset."
        >
          <SettingRow
            title="ReplayGain Loudness Normalization"
            description="Automatically balance perceived track loudness using DSP-measured RMS gain offsets."
            control={
              <ToggleSwitch
                checked={audioSettings.replayGainEnabled}
                onChange={(replayGainEnabled) => updateAudioSettings({ replayGainEnabled })}
                label="Toggle ReplayGain normalization"
              />
            }
          />

          <SettingRow
            title="Master Safety Limiter"
            description="Keep DynamicsCompressorNode active at -1 dB to prevent clipping during overlapping transitions."
            control={
              <ToggleSwitch
                checked={audioSettings.limiterEnabled}
                onChange={(limiterEnabled) => updateAudioSettings({ limiterEnabled })}
                label="Toggle master limiter"
              />
            }
          />

          <SettingRow
            title="Master Volume"
            description="Control overall playback gain (persisted across restarts)."
            control={
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={toggleMute}
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-slate-300 hover:text-white transition-colors"
                  title={muted ? 'Unmute' : 'Mute'}
                >
                  {muted || volume === 0 ? (
                    <VolumeX className="h-4 w-4" />
                  ) : (
                    <Volume2 className="h-4 w-4" />
                  )}
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={muted ? 0 : volume}
                  onChange={(e) => setVolume(Number(e.target.value))}
                  aria-label="Master volume"
                  className="h-1.5 w-32 accent-indigo-400"
                />
                <span className="w-10 text-right font-mono text-xs tabular-nums text-white">
                  {muted ? 'Mute' : `${Math.round(volume * 100)}%`}
                </span>
              </div>
            }
          />

          <SettingRow
            title="Deck 3-Band Equalizer"
            description="Reset Low (250Hz), Mid (1kHz), and High (4kHz) EQ bands on both Deck A & B to flat 0 dB."
            control={
              <button
                type="button"
                onClick={resetAllDeckEq}
                className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.05] px-3 text-xs font-medium text-slate-200 hover:bg-white/10 hover:text-white transition-colors"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Reset Deck A &amp; B EQ</span>
              </button>
            }
          />
        </SettingsSection>

        {/* 4. Library & Background Analyzer */}
        <SettingsSection
          icon={<Activity className="h-4 w-4" />}
          title="Library & Background DSP Analyzer"
          subtitle="Manage background Web Worker BPM, Camelot Key, waveform peak, and silence cue indexing."
        >
          <SettingRow
            title="Automatically Analyze New Tracks"
            description="Run non-blocking audio feature extraction whenever new tracks are indexed."
            control={
              <ToggleSwitch
                checked={librarySettings.autoAnalyzeEnabled}
                onChange={(autoAnalyzeEnabled) =>
                  updateLibrarySettings({ autoAnalyzeEnabled })
                }
                label="Toggle automatic track analysis"
              />
            }
          />

          <SettingRow
            title="Auto-Fetch Lyrics Online (LRCLIB)"
            description="Automatically search LRCLIB for synced or static lyrics when playing tracks without cached or local lyrics."
            control={
              <ToggleSwitch
                checked={librarySettings.autoFetchLyrics}
                onChange={(autoFetchLyrics) =>
                  updateLibrarySettings({ autoFetchLyrics })
                }
                label="Toggle automatic online lyrics fetching"
              />
            }
          />

          <SettingRow
            title="Analyzer & Folder Actions"
            description={`${facets.analyzedTracks} of ${facets.totalTracks} tracks analyzed${
              analysisProgress.running && analysisProgress.currentTitle
                ? ` · Currently analyzing: ${analysisProgress.currentTitle}`
                : ''
            }`}
            control={
              <div className="flex flex-wrap items-center gap-2">
                {analysisProgress.running ? (
                  <button
                    type="button"
                    onClick={pauseAnalysis}
                    className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-amber-500/35 bg-amber-500/15 px-3 text-xs font-semibold text-amber-200 hover:bg-amber-500/25 transition-colors"
                  >
                    <Pause className="h-3.5 w-3.5" />
                    <span>Pause DSP</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={resumeAnalysis}
                    className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-accent/40 bg-accent/15 px-3 text-xs font-semibold text-white hover:bg-accent/25 transition-colors"
                  >
                    <Activity className="h-3.5 w-3.5 text-accentGlow" />
                    <span>Run Pending Analysis</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => void rescanFolder()}
                  className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.05] px-3 text-xs font-medium text-slate-200 hover:bg-white/10 hover:text-white transition-colors"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  <span>Rescan Folders</span>
                </button>

                <button
                  type="button"
                  onClick={() => setView('folders')}
                  className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.05] px-3 text-xs font-medium text-slate-200 hover:bg-white/10 hover:text-white transition-colors"
                >
                  <FolderCog className="h-3.5 w-3.5" />
                  <span>Manage Folders</span>
                </button>
              </div>
            }
          />
        </SettingsSection>

        {/* 5. Appearance & Interface */}
        <SettingsSection
          icon={<Palette className="h-4 w-4" />}
          title="Appearance & Interface"
          subtitle="Album-art dynamic color theming, fallback accent palette, and waveform display options."
        >
          <SettingRow
            title="Dynamic Album-Art Accent Colors"
            description="Adapt theme accent and ambient glow to the active track's cover art."
            control={
              <ToggleSwitch
                checked={appearanceSettings.dynamicThemeEnabled}
                onChange={(dynamicThemeEnabled) =>
                  updateAppearanceSettings({ dynamicThemeEnabled })
                }
                label="Toggle dynamic album-art theme"
              />
            }
          />

          <SettingRow
            title="Accent Color Preset"
            description="Used when Dynamic Accent Colors is turned off or when a track has no cover art."
            control={
              <div className="flex flex-wrap items-center gap-2">
                {ACCENT_PRESETS.map((preset) => {
                  const selected =
                    appearanceSettings.customAccentRgb === preset.accentRgb &&
                    appearanceSettings.customAccentGlowRgb === preset.accentGlowRgb
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      title={preset.name}
                      onClick={() =>
                        updateAppearanceSettings({
                          customAccentRgb: preset.accentRgb,
                          customAccentGlowRgb: preset.accentGlowRgb
                        })
                      }
                      className={`relative flex h-8 w-8 items-center justify-center rounded-xl border transition-all ${
                        selected
                          ? 'scale-105 border-white shadow-glow'
                          : 'border-white/15 opacity-80 hover:opacity-100'
                      }`}
                      style={{
                        background: `linear-gradient(135deg, rgb(${preset.accentRgb}), rgb(${preset.accentGlowRgb}))`
                      }}
                    >
                      {selected && <Check className="h-4 w-4 text-white drop-shadow" />}
                    </button>
                  )
                })}
              </div>
            }
          />

          <SettingRow
            title="Show Intro / Outro Cue Markers on Waveforms"
            description="Display subtle vertical silence threshold markers on player and deck waveforms."
            control={
              <ToggleSwitch
                checked={appearanceSettings.showWaveformCues}
                onChange={(showWaveformCues) =>
                  updateAppearanceSettings({ showWaveformCues })
                }
                label="Toggle waveform cue markers"
              />
            }
          />

          <SettingRow
            title="Compact Sidebar"
            description="Collapse the left navigation sidebar to icon-only mode."
            control={
              <ToggleSwitch
                checked={sidebarCollapsed}
                onChange={setSidebarCollapsed}
                label="Toggle compact sidebar"
              />
            }
          />
        </SettingsSection>

        {/* 6. Shortcuts & Reset */}
        <SettingsSection
          icon={<Keyboard className="h-4 w-4" />}
          title="Keyboard Shortcuts & Reset"
          subtitle="Quick reference for global media keys and keyboard controls."
        >
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {getShortcutsList().map((item) => (
              <div
                key={item.keys}
                className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.025] px-3 py-2 text-xs"
              >
                <span className="text-slate-300">{item.desc}</span>
                <kbd className="rounded-md border border-white/15 bg-black/40 px-2 py-0.5 font-mono text-[10px] font-semibold text-accentGlow">
                  {item.keys}
                </kbd>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between border-t border-white/[0.07] pt-3">
            <div>
              <p className="text-xs font-semibold text-slate-200">Reset Preferences</p>
              <p className="text-[11px] text-slate-400">
                Restore all playback, Auto-Mix, DSP, and visual preferences to defaults (keeps your library &amp; playlists).
              </p>
            </div>

            {confirmReset ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleResetDefaults()}
                  className="h-8 rounded-xl bg-rose-500 px-3 text-xs font-semibold text-white hover:bg-rose-400 transition-colors"
                >
                  Confirm Reset
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmReset(false)}
                  className="h-8 rounded-xl border border-white/10 bg-white/[0.05] px-3 text-xs text-slate-300 hover:bg-white/10"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmReset(true)}
                className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-rose-500/35 bg-rose-500/10 px-3 text-xs font-semibold text-rose-200 hover:bg-rose-500/20 transition-colors"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Reset All Settings</span>
              </button>
            )}
          </div>
        </SettingsSection>
      </div>
    </div>
  )
}
