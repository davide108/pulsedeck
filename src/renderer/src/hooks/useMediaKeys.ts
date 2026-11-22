import { useEffect } from 'react'
import { useLibraryStore } from '@/store/useLibraryStore'
import { usePlayerStore } from '@/store/usePlayerStore'
import { getArtworkUrl } from '@/utils/format'

function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return target.isContentEditable
}

export function useMediaKeys(): void {
  const activeTrack = usePlayerStore((s) => s.activeTrack)
  const isPlaying = usePlayerStore((s) => s.isPlaying)

  // Electron globalShortcut IPC media commands
  useEffect(() => {
    const unsub = window.api.events.onMediaCommand((command) => {
      const store = usePlayerStore.getState()
      switch (command) {
        case 'play-pause':
          void store.togglePlayPause()
          break
        case 'next':
          void store.skipNext()
          break
        case 'previous':
          void store.previousTrack()
          break
        case 'stop':
          void store.stopPlayback()
          break
      }
    })
    return unsub
  }, [])

  // Browser / OS MediaSession metadata & transport handlers
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return

    const artUrl = getArtworkUrl(activeTrack?.artworkPath)
    try {
      if (activeTrack) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: activeTrack.title,
          artist: activeTrack.artist,
          album: activeTrack.album,
          artwork: artUrl ? [{ src: artUrl }] : []
        })
      } else {
        navigator.mediaSession.metadata = null
      }
      navigator.mediaSession.playbackState = isPlaying
        ? 'playing'
        : activeTrack
          ? 'paused'
          : 'none'
    } catch {
      // Ignore MediaMetadata failures in environments without full mediaSession support
    }
  }, [activeTrack, isPlaying])

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return

    const safeSetHandler = (
      action: MediaSessionAction,
      handler: MediaSessionActionHandler | null
    ) => {
      try {
        navigator.mediaSession.setActionHandler(action, handler)
      } catch {
        // Unsupported MediaSessionAction in this runtime
      }
    }

    safeSetHandler('play', () => {
      const store = usePlayerStore.getState()
      if (!store.isPlaying) {
        void store.togglePlayPause()
      }
    })
    safeSetHandler('pause', () => {
      void usePlayerStore.getState().pausePlayback()
    })
    safeSetHandler('previoustrack', () => {
      void usePlayerStore.getState().previousTrack()
    })
    safeSetHandler('nexttrack', () => {
      void usePlayerStore.getState().skipNext()
    })
    safeSetHandler('stop', () => {
      void usePlayerStore.getState().stopPlayback()
    })
    safeSetHandler('seekto', (details) => {
      if (typeof details.seekTime === 'number') {
        usePlayerStore.getState().seek(details.seekTime)
      }
    })

    return () => {
      safeSetHandler('play', null)
      safeSetHandler('pause', null)
      safeSetHandler('previoustrack', null)
      safeSetHandler('nexttrack', null)
      safeSetHandler('stop', null)
      safeSetHandler('seekto', null)
    }
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const editable = isEditableElement(e.target)
      const player = usePlayerStore.getState()

      if (e.key === 'Escape') {
        if (editable && e.target instanceof HTMLElement) {
          e.target.blur()
          return
        }
        const library = useLibraryStore.getState()
        if (library.editingTrack) {
          e.preventDefault()
          library.closeTrackInfo()
          return
        }
        if (player.nowPlayingOpen) {
          e.preventDefault()
          player.setNowPlayingOpen(false)
        }
        return
      }

      if (editable) return

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        useLibraryStore.getState().triggerFocusSearch()
        return
      }

      if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault()
        player.setNowPlayingOpen(false)
        useLibraryStore.getState().setView('settings')
        return
      }

      if (e.ctrlKey || e.metaKey || e.altKey) return

      const activeDeck = player.telemetry.decks[player.telemetry.activeDeckId]
      const duration = activeDeck.duration || player.activeTrack?.duration || 0
      const stepSec = Math.max(1, player.audioSettings.seekStepSec || 5)
      const seekDelta = e.shiftKey ? stepSec * 3 : stepSec

      switch (e.code) {
        case 'Space': {
          e.preventDefault()
          void player.togglePlayPause()
          break
        }
        case 'ArrowLeft': {
          e.preventDefault()
          if (duration > 0) {
            player.seek(Math.max(0, activeDeck.currentTime - seekDelta))
          }
          break
        }
        case 'ArrowRight': {
          e.preventDefault()
          if (duration > 0) {
            player.seek(Math.min(duration, activeDeck.currentTime + seekDelta))
          }
          break
        }
        case 'ArrowUp': {
          e.preventDefault()
          player.setVolume(Math.min(1, player.volume + 0.05))
          break
        }
        case 'ArrowDown': {
          e.preventDefault()
          player.setVolume(Math.max(0, player.volume - 0.05))
          break
        }
        default: {
          const lower = e.key.toLowerCase()
          if (lower === 'm') {
            e.preventDefault()
            player.toggleMute()
          } else if (lower === 's') {
            e.preventDefault()
            player.toggleShuffle()
          } else if (lower === 'r') {
            e.preventDefault()
            player.cycleRepeatMode()
          } else if (lower === 'd') {
            e.preventDefault()
            player.toggleAutoDj()
          } else if (lower === 'l') {
            e.preventDefault()
            if (player.nowPlayingOpen && player.nowPlayingTab === 'lyrics') {
              player.setNowPlayingOpen(false)
            } else {
              player.setNowPlayingOpen(true, 'lyrics')
            }
          } else if (lower === 'i') {
            e.preventDefault()
            if (player.activeTrack) {
              useLibraryStore.getState().openTrackInfo(player.activeTrack)
            }
          } else if (lower === 'f') {
            e.preventDefault()
            useLibraryStore.getState().triggerFocusSearch()
          }
          break
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])
}
