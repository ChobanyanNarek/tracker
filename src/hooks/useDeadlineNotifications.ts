import { useCallback, useEffect, useRef } from 'react'
import { useStore } from '../store'
import { jiraDedupeKey } from '../utils/format'
import { NOTIFICATION_ICON } from '../constants'


/** Fires a browser notification once an in-progress issue/task has 15 minutes
 *  or less left before its deadline. Todo/review/blocked/done issues are
 *  skipped — a reminder only makes sense for work someone is actively doing.
 *  Checks every 30s; deduplicates across carry-over copies via stable issue keys.
 *  The trigger is a "≤15 min and not yet passed" one-shot rather than a narrow
 *  minute-wide window, so a backgrounded tab that gets throttled by the browser
 *  still fires on the next check instead of sliding past the window unnoticed. */
export function useDeadlineNotifications() {
  const { tasks, developers, notifsEnabled } = useStore()

  const tasksRef = useRef(tasks)
  const developersRef = useRef(developers)
  const notifsEnabledRef = useRef(notifsEnabled)
  const notifiedRef = useRef<Record<string, number>>({})
  useEffect(() => { tasksRef.current = tasks }, [tasks])
  useEffect(() => { developersRef.current = developers }, [developers])
  useEffect(() => { notifsEnabledRef.current = notifsEnabled }, [notifsEnabled])

  const check = useCallback(() => {
    if (!notifsEnabledRef.current) return
    if (!('Notification' in window) || Notification.permission !== 'granted') return

    const nowMs = Date.now()
    const notified = notifiedRef.current
    let changed = false

    // Prune entries older than 2 days so a re-scheduled deadline can re-fire
    const twoDaysAgo = nowMs - 172_800_000
    for (const k of Object.keys(notified)) {
      if (notified[k] < twoDaysAgo) { delete notified[k]; changed = true }
    }

    // Deduplicate across carry-over copies: one notification per unique issue
    const seen = new Set<string>()

    tasksRef.current.forEach((task) => {
      // Use task.jiras directly — getJiras() returns a synthetic fallback for old-format
      // tasks which has an empty deadline and length=1, blocking the task-level check below.
      const realJiras = Array.isArray(task.jiras) && task.jiras.length > 0 ? task.jiras : []

      realJiras.forEach((j) => {
        if (!j.deadline || j.status !== 'inprogress') return
        const stableKey = j.issueId
          ? `${task.devId}:${j.issueId}`
          : `${task.devId}:${jiraDedupeKey(j.url, j.name)}`
        if (seen.has(stableKey)) return
        seen.add(stableKey)
        // Include deadline in key: carry-over that changes the deadline date fires a fresh notif
        const nk = `${stableKey}:${j.deadline}:${j.deadlineTime || '23:59'}:15min`
        if (notified[nk]) return
        const [y, mo, d] = j.deadline.split('-').map(Number)
        const [hh, mm] = (j.deadlineTime || '23:59').split(':').map(Number)
        const diffMin = (new Date(y, mo - 1, d, hh, mm).getTime() - nowMs) / 60000
        if (diffMin > 0 && diffMin <= 15) {
          const dev = developersRef.current.find((dv) => dv.id === task.devId)
          const label = j.name || j.url || 'Issue'
          try {
            const notif = new Notification('⏰ 15 min until deadline!', {
              body: `${label} · ${dev?.name ?? ''}${j.deadlineTime ? ` · due at ${j.deadlineTime}` : ''}`,
              icon: NOTIFICATION_ICON,
              tag: nk,
              requireInteraction: true,
              data: { taskId: task.id, date: task.date },
            })
            notif.onclick = () => {
              window.focus()
              const store = useStore.getState()
              store.setView('daily')
              store.setSelectedDate(task.date)
              store.setHighlightedTaskId(task.id)
            }
          } catch {}
          notified[nk] = nowMs
          changed = true
        }
      })

      // Task-level deadline: old-format (jira string, no jiras array) or tasks without jiras
      if (!realJiras.length && task.deadline && task.status === 'inprogress') {
        const stableKey = `${task.devId}:task:${task.title}`
        if (!seen.has(stableKey)) {
          seen.add(stableKey)
          const nk = `${stableKey}:${task.deadline}:${task.deadlineTime || '23:59'}:15min`
          if (!notified[nk]) {
            const [y, mo, d] = task.deadline.split('-').map(Number)
            const [hh, mm] = (task.deadlineTime || '23:59').split(':').map(Number)
            const diffMin = (new Date(y, mo - 1, d, hh, mm).getTime() - nowMs) / 60000
            if (diffMin > 0 && diffMin <= 15) {
              const dev = developersRef.current.find((dv) => dv.id === task.devId)
              try {
                const notif = new Notification('⏰ 15 min until deadline!', {
                  body: `${task.title || 'Checkpoint'} · ${dev?.name ?? ''}${task.deadlineTime ? ` · due at ${task.deadlineTime}` : ''}`,
                  icon: NOTIFICATION_ICON,
                  tag: nk,
                  requireInteraction: true,
                  data: { taskId: task.id, date: task.date },
                })
                notif.onclick = () => {
                  window.focus()
                  const store = useStore.getState()
                  store.setView('daily')
                  store.setSelectedDate(task.date)
                  store.setHighlightedTaskId(task.id)
                }
              } catch {}
              notified[nk] = nowMs
              changed = true
            }
          }
        }
      }
    })
    if (changed) notifiedRef.current = { ...notified }
  }, [])

  useEffect(() => {
    check()
    const id = setInterval(check, 30000)
    return () => clearInterval(id)
  }, [check])
}
