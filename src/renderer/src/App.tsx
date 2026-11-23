import { useEffect } from 'react'
import { AlertCircle, Info, X } from 'lucide-react'
import { MiniPlayer } from '@/components/layout/MiniPlayer'
import { Sidebar } from '@/components/layout/Sidebar'
import { TitleBar } from '@/components/layout/TitleBar'
import { AlbumGrid } from '@/components/library/AlbumGrid'
import { ArtistView } from '@/components/library/ArtistView'
import { FilterBar } from '@/components/library/FilterBar'
import { FolderManager } from '@/components/library/FolderManager'
import { PlaylistView } from '@/components/library/PlaylistView'
import { TrackInfoModal } from '@/components/library/TrackInfoModal'
import { TrackTable } from '@/components/library/TrackTable'
import { AutoDjQueuePanel } from '@/components/player/AutoDjQueuePanel'
import { DualDeckView } from '@/components/player/DualDeckView'
import { NowPlayingOverlay } from '@/components/player/NowPlayingOverlay'
import { PlayerBar } from '@/components/player/PlayerBar'
import { SettingsView } from '@/components/settings/SettingsView'
import { useDynamicTheme } from '@/hooks/useDynamicTheme'
import { useMediaKeys } from '@/hooks/useMediaKeys'
import { useLibraryStore } from '@/store/useLibraryStore'
import { usePlayerStore } from '@/store/usePlayerStore'

export function App() {
  const activeView = useLibraryStore((s) => s.activeView)
  const allTracks = useLibraryStore((s) => s.allTracks)
  const playlists = useLibraryStore((s) => s.playlists)
  const isInitialized = useLibraryStore((s) => s.isInitialized)
  const libraryError = useLibraryStore((s) => s.errorMessage)
  const clearLibraryError = useLibraryStore((s) => s.clearError)
  const initLibrary = useLibraryStore((s) => s.init)

  const isMiniPlayer = usePlayerStore((s) => s.isMiniPlayer)
  const toasts = usePlayerStore((s) => s.toasts)
  const dismissToast = usePlayerStore((s) => s.dismissToast)
  const initPlayer = usePlayerStore((s) => s.init)
  const syncLibraryTracks = usePlayerStore((s) => s.syncLibraryTracks)

  useDynamicTheme()
  useMediaKeys()

  useEffect(() => {
    let cleanupLibrary: (() => void) | undefined
    let cleanupPlayer: (() => void) | undefined
    let cancelled = false

    void initPlayer().then((fn) => {
      if (cancelled) fn()
      else cleanupPlayer = fn
    })

    void initLibrary().then((fn) => {
      if (cancelled) fn()
      else cleanupLibrary = fn
    })

    return () => {
      cancelled = true
      cleanupLibrary?.()
      cleanupPlayer?.()
    }
  }, [initLibrary, initPlayer])

  useEffect(() => {
    if (!isInitialized) return
    syncLibraryTracks(allTracks)
  }, [isInitialized, allTracks, playlists, syncLibraryTracks])

  if (isMiniPlayer) {
    return <MiniPlayer />
  }

  const renderMainView = () => {
    switch (activeView) {
      case 'albums':
        return <AlbumGrid />
      case 'artists':
        return <ArtistView />
      case 'folders':
        return <FolderManager />
      case 'playlist':
      case 'smart':
        return <PlaylistView />
      case 'autodj':
        return (
          <div className="flex h-full flex-col overflow-hidden lg:flex-row">
            <div className="min-w-0 flex-1 overflow-y-auto border-b border-white/[0.07] p-5 lg:border-r lg:border-b-0">
              <DualDeckView />
            </div>
            <div className="h-[45%] w-full shrink-0 overflow-hidden bg-surface/35 lg:h-full lg:w-[420px] xl:w-[440px]">
              <AutoDjQueuePanel />
            </div>
          </div>
        )
      case 'settings':
        return <SettingsView />
      case 'tracks':
      default:
        return (
          <div className="flex h-full flex-col overflow-hidden">
            <FilterBar />
            <TrackTable />
          </div>
        )
    }
  }

  return (
    <div className="accent-ambient-bg flex h-screen w-screen flex-col overflow-hidden bg-obsidian text-slate-100">
      <TitleBar />

      <div className="flex flex-1 overflow-hidden">
        <Sidebar />

        <main className="relative flex flex-1 flex-col overflow-hidden bg-obsidian/45">
          {renderMainView()}
        </main>
      </div>

      <PlayerBar />
      <NowPlayingOverlay />
      <TrackInfoModal />

      {/* Non-blocking Toasts */}
      {(toasts.length > 0 || libraryError) && (
        <div className="pointer-events-none fixed right-4 bottom-24 z-50 flex w-80 flex-col gap-2">
          {libraryError && (
            <div className="pointer-events-auto flex items-start gap-2.5 rounded-xl glass-elevated border border-rose-500/40 p-3 text-xs shadow-2xl">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-white">Library Notice</p>
                <p className="mt-0.5 text-slate-300">{libraryError}</p>
              </div>
              <button
                type="button"
                onClick={clearLibraryError}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {toasts.map((toast) => (
            <div
              key={toast.id}
              className={`pointer-events-auto flex items-start gap-2.5 rounded-xl glass-elevated p-3 text-xs shadow-2xl ${
                toast.type === 'error' ? 'border-rose-500/40' : 'border-accent/40'
              }`}
            >
              {toast.type === 'error' ? (
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
              ) : (
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-accentGlow" />
              )}
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-white">{toast.title}</p>
                <p className="mt-0.5 text-slate-300">{toast.message}</p>
              </div>
              <button
                type="button"
                onClick={() => dismissToast(toast.id)}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default App
