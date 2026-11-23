import type { DragEvent as ReactDragEvent } from 'react'

export const DECK_TRACK_DRAG_MIME = 'application/x-pulsedeck-track-id'
export const DECK_TRACK_TEXT_PREFIX = 'pulsedeck-track:'

export type TrackDragEventLike =
  | Pick<ReactDragEvent<HTMLElement>, 'dataTransfer'>
  | Pick<DragEvent, 'dataTransfer'>

/**
 * Populates a drag event's DataTransfer with the dragged PulseDeck track ID.
 * Writes both the custom PulseDeck MIME type and a prefixed `text/plain` fallback
 * for broad Chromium / Electron drag-and-drop compatibility.
 */
export function setTrackDragData(e: TrackDragEventLike, trackId: number): void {
  const dt = e.dataTransfer
  if (!dt) return

  const serialized = String(trackId)
  dt.setData(DECK_TRACK_DRAG_MIME, serialized)
  dt.setData('text/plain', `${DECK_TRACK_TEXT_PREFIX}${serialized}`)
  dt.effectAllowed = 'copy'
}

/**
 * Checks whether a drag event carries a PulseDeck track payload.
 * Inspects `dataTransfer.types` so it works reliably during `dragenter` and `dragover`
 * when Chromium restricts reading `getData()`.
 */
export function hasTrackDragData(e: TrackDragEventLike): boolean {
  const dt = e.dataTransfer
  if (!dt) return false

  const types = Array.from(dt.types ?? [])
  if (types.includes(DECK_TRACK_DRAG_MIME)) {
    return true
  }

  // Fallback for environments or synthetic drag events that only populate text/plain
  if (types.includes('text/plain')) {
    try {
      const plain = dt.getData('text/plain')
      if (plain && plain.startsWith(DECK_TRACK_TEXT_PREFIX)) {
        return true
      }
    } catch {
      // Accessing getData during dragover can throw in strict environments
    }
  }

  return false
}

/**
 * Extracts and validates the numeric track ID from a drop event.
 * Returns `null` if no valid PulseDeck track ID is present.
 */
export function getDraggedTrackId(e: TrackDragEventLike): number | null {
  const dt = e.dataTransfer
  if (!dt) return null

  const rawCustom = dt.getData(DECK_TRACK_DRAG_MIME)?.trim()
  if (rawCustom) {
    const parsed = Number(rawCustom)
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed
    }
  }

  const rawPlain = dt.getData('text/plain')?.trim()
  if (rawPlain && rawPlain.startsWith(DECK_TRACK_TEXT_PREFIX)) {
    const idPart = rawPlain.slice(DECK_TRACK_TEXT_PREFIX.length).trim()
    const parsed = Number(idPart)
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed
    }
  }

  return null
}
