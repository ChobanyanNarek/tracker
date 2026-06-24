import { useEffect, useState, useCallback, useRef } from 'react'
import { useStore, countUrgentDeadlines } from './store'
import { jiraDedupeKey } from './utils/format'
import TopBar from './components/layout/TopBar'
import Sidebar from './components/layout/Sidebar'
import Calendar from './components/calendar/Calendar'
import DailyView from './components/views/DailyView'
import DeadlinesView from './components/views/DeadlinesView'
import SearchView from './components/views/SearchView'
import PerformanceView from './components/views/PerformanceView'
import ScheduleView from './components/views/ScheduleView'
import StandupModal from './components/modals/StandupModal'
import JiraConfigModal from './components/modals/JiraConfigModal'
import GitLabConfigModal from './components/modals/GitLabConfigModal'

const VIEW_LABELS: Record<string, string> = {
  daily: '📅 Daily',
  deadlines: '⏰ Deadlines',
  search: '🔍 Search',
  performance: '📊 Performance',
  schedule: '🗓 Schedule',
}


const NOTIF_KEY = 'pmtracker_notified'
function loadNotified(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(NOTIF_KEY) || '{}') } catch { return {} }
}
function saveNotified(o: Record<string, number>) {
  try { localStorage.setItem(NOTIF_KEY, JSON.stringify(o)) } catch {}
}

export default function App() {
  const { view, setView, selectedDate, selectedProject, projects, tasks, developers, autoCarryOverdue, migrateIssueIds, deduplicateJiras, syncJira, syncGitlab, notifsEnabled, setNotifsEnabled } = useStore()
  const jiraConfig = useStore((s) => s.jiraConfig)
  const gitlabConfig = useStore((s) => s.gitlabConfig)
  const [toast, setToast] = useState<string | null>(null)
  const [standupOpen, setStandupOpen] = useState(false)
  const [jiraConfigOpen, setJiraConfigOpen] = useState(false)
  const [gitlabConfigOpen, setGitlabConfigOpen] = useState(false)
  const tasksRef = useRef(tasks)
  const developersRef = useRef(developers)
  useEffect(() => { tasksRef.current = tasks }, [tasks])
  useEffect(() => { developersRef.current = developers }, [developers])

  const urgentCount = countUrgentDeadlines(tasks, developers)

  const showToast = useCallback((msg: string) => { setToast(msg) }, [])

  const notifsEnabledRef = useRef(notifsEnabled)
  useEffect(() => { notifsEnabledRef.current = notifsEnabled }, [notifsEnabled])

  const checkDeadlineNotifications = useCallback(() => {
    if (!notifsEnabledRef.current) return
    if (!('Notification' in window) || Notification.permission !== 'granted') return

    const nowMs = Date.now()
    const notified = loadNotified()
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
        if (!j.deadline || j.status === 'done') return
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
        if (diffMin > 14 && diffMin <= 16) {
          const dev = developersRef.current.find((dv) => dv.id === task.devId)
          const label = j.name || j.url || 'Issue'
          try {
            new Notification('⏰ 15 min until deadline!', {
              body: `${label} · ${dev?.name ?? ''}${j.deadlineTime ? ` · due at ${j.deadlineTime}` : ''}`,
              tag: nk,
              requireInteraction: true,
            })
          } catch {}
          notified[nk] = nowMs
          changed = true
        }
      })

      // Task-level deadline: old-format (jira string, no jiras array) or tasks without jiras
      if (!realJiras.length && task.deadline && task.status !== 'done') {
        const stableKey = `${task.devId}:task:${task.title}`
        if (!seen.has(stableKey)) {
          seen.add(stableKey)
          const nk = `${stableKey}:${task.deadline}:${task.deadlineTime || '23:59'}:15min`
          if (!notified[nk]) {
            const [y, mo, d] = task.deadline.split('-').map(Number)
            const [hh, mm] = (task.deadlineTime || '23:59').split(':').map(Number)
            const diffMin = (new Date(y, mo - 1, d, hh, mm).getTime() - nowMs) / 60000
            if (diffMin > 14 && diffMin <= 16) {
              const dev = developersRef.current.find((dv) => dv.id === task.devId)
              try {
                new Notification('⏰ 15 min until deadline!', {
                  body: `${task.title || 'Checkpoint'} · ${dev?.name ?? ''}${task.deadlineTime ? ` · due at ${task.deadlineTime}` : ''}`,
                  tag: nk,
                  requireInteraction: true,
                })
              } catch {}
              notified[nk] = nowMs
              changed = true
            }
          }
        }
      }
    })
    if (changed) saveNotified(notified)
  }, [])

  // migrate existing jiras to have stable issueIds, then carry overdue
  useEffect(() => {
    // If browser already has notification permission granted, keep the store flag in sync
    if ('Notification' in window && Notification.permission === 'granted') {
      setNotifsEnabled(true)
    }
    migrateIssueIds()
    deduplicateJiras()
    autoCarryOverdue()
  }, [])

  // Escape closes modals
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setStandupOpen(false) }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // Notification check interval
  useEffect(() => {
    checkDeadlineNotifications()
    const id = setInterval(checkDeadlineNotifications, 30000)
    return () => clearInterval(id)
  }, [checkDeadlineNotifications])

  // auto carry every minute in case day rolls over; deduplicate after each carry
  useEffect(() => {
    const id = setInterval(() => {
      deduplicateJiras()
      autoCarryOverdue()
    }, 60000)
    return () => clearInterval(id)
  }, [])

  // Jira auto-poll
  useEffect(() => {
    if (!jiraConfig.enabled || !jiraConfig.syncInterval || !jiraConfig.token) return
    const ms = jiraConfig.syncInterval * 60 * 1000
    const id = setInterval(async () => {
      try {
        const { added, updated } = await syncJira()
        if (added || updated) showToast(`Jira synced — ${added} added, ${updated} updated`)
      } catch {}
    }, ms)
    return () => clearInterval(id)
  }, [jiraConfig.enabled, jiraConfig.syncInterval, jiraConfig.token])

  // GitLab auto-poll
  useEffect(() => {
    if (!gitlabConfig.enabled || !gitlabConfig.syncInterval || !gitlabConfig.token) return
    const ms = gitlabConfig.syncInterval * 60 * 1000
    const id = setInterval(async () => {
      try {
        const { linked } = await syncGitlab()
        if (linked) showToast(`GitLab synced — ${linked} MR${linked !== 1 ? 's' : ''} linked`)
      } catch {}
    }, ms)
    return () => clearInterval(id)
  }, [gitlabConfig.enabled, gitlabConfig.syncInterval, gitlabConfig.token])

  const proj = projects.find((p) => p.id === selectedProject)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', background: 'var(--bg)' }}>
      <TopBar onStandup={() => setStandupOpen(true)} urgentCount={urgentCount} onJiraConfig={() => setJiraConfigOpen(true)} onGitlabConfig={() => setGitlabConfigOpen(true)} onFeedback={showToast} />

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* sidebar */}
        <Sidebar />

        {/* main area */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* view tabs */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '8px 14px 0', background: 'var(--surface)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
            {(Object.keys(VIEW_LABELS) as Array<keyof typeof VIEW_LABELS>).map((v) => (
              <button
                key={v}
                onClick={() => setView(v as Parameters<typeof setView>[0])}
                style={{ position: 'relative', fontFamily: 'var(--mono)', fontSize: 11, padding: '6px 14px', border: 'none', borderRadius: '6px 6px 0 0', background: view === v ? 'var(--bg)' : 'transparent', color: view === v ? 'var(--accent)' : 'var(--text3)', cursor: 'pointer', fontWeight: view === v ? 600 : 400, borderBottom: view === v ? '2px solid var(--accent)' : '2px solid transparent', transition: 'all .15s' }}
              >
                {VIEW_LABELS[v]}
                {v === 'deadlines' && urgentCount > 0 && (
                  <span style={{ position: 'absolute', top: 2, right: 2, background: 'var(--red)', color: '#fff', borderRadius: 8, fontSize: 8, fontWeight: 700, padding: '1px 4px', lineHeight: 1.4 }}>{urgentCount}</span>
                )}
              </button>
            ))}

            {/* date / project context chips */}
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 6 }}>
              {view === 'daily' && (
                <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', padding: '2px 8px', borderRadius: 8, background: 'var(--surface2)', border: '1px solid var(--border)' }}>
                  {selectedDate}
                </span>
              )}
              {proj && (
                <span style={{ fontFamily: 'var(--mono)', fontSize: 10, padding: '2px 8px', borderRadius: 8, background: proj.color + '18', color: proj.color, border: `1px solid ${proj.color}40` }}>
                  {proj.name}
                </span>
              )}
            </div>
          </div>

          {/* calendar strip (only on daily view) */}
          {view === 'daily' && (
            <div style={{ flexShrink: 0, borderBottom: '1px solid var(--border)' }}>
              <Calendar />
            </div>
          )}

          {/* view content */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {view === 'daily' && <DailyView onToast={showToast} />}
            {view === 'deadlines' && <DeadlinesView />}
            {view === 'search' && <SearchView />}
            {view === 'performance' && <PerformanceView />}
            {view === 'schedule' && <ScheduleView />}
          </div>
        </div>
      </div>

      {/* toast */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: 'var(--text)', color: 'var(--bg)', fontFamily: 'var(--mono)', fontSize: 12, padding: '9px 16px 9px 20px', borderRadius: 24, boxShadow: '0 4px 20px rgba(0,0,0,.3)', zIndex: 2000, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span>{toast}</span>
          <button onClick={() => setToast(null)} style={{ background: 'none', border: 'none', color: 'var(--bg)', opacity: 0.6, cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0, display: 'flex', alignItems: 'center' }}>✕</button>
        </div>
      )}

      {/* standup modal */}
      {standupOpen && <StandupModal onClose={() => setStandupOpen(false)} />}

      {/* jira config modal */}
      {jiraConfigOpen && <JiraConfigModal onClose={() => setJiraConfigOpen(false)} />}

      {/* gitlab config modal */}
      {gitlabConfigOpen && <GitLabConfigModal onClose={() => setGitlabConfigOpen(false)} />}
    </div>
  )
}
