import { useCallback, useEffect, useRef } from 'react'
import { useStore } from '../store'

/** Fires a browser notification when a note's reminder time arrives, while the app
 *  is open. Uses the note's persisted `reminderFired` flag as a one-shot guard (so it
 *  won't re-fire across refreshes/devices), and a "<= now && !fired" trigger rather than
 *  a narrow window so a throttled background tab still catches it on the next 30s check.
 *  Clicking the notification routes to the Notes view and opens the note. */
export function useNoteReminders() {
  const notes = useStore((s) => s.notes)
  const notesRef = useRef(notes)
  useEffect(() => { notesRef.current = notes }, [notes])

  const check = useCallback(() => {
    if (!('Notification' in window) || Notification.permission !== 'granted') return
    const now = Date.now()
    for (const n of notesRef.current ?? []) {
      if (!n.reminderAt || n.reminderFired || n.archivedAt) continue
      const due = new Date(n.reminderAt).getTime()
      if (isNaN(due) || due > now) continue
      // Don't fire for reminders that are stale by more than a day (e.g. imported old data).
      if (now - due > 86_400_000) { useStore.getState().updateNote(n.id, { reminderFired: true }); continue }

      const title = n.title || 'Untitled note'
      const fire = (reg?: ServiceWorkerRegistration) => {
        const opts = {
          body: title,
          tag: `note-${n.id}`,
          requireInteraction: true,
          data: { noteId: n.id },
        } as NotificationOptions
        if (reg) reg.showNotification('🔔 Note reminder', opts)
        else new Notification('🔔 Note reminder', opts)
      }
      if (navigator.serviceWorker?.ready) {
        navigator.serviceWorker.ready.then(fire).catch(() => fire())
      } else {
        try { fire() } catch { /* ignore */ }
      }
      useStore.getState().updateNote(n.id, { reminderFired: true })
    }
  }, [])

  useEffect(() => {
    check()
    const id = setInterval(check, 30000)
    return () => clearInterval(id)
  }, [check])
}
