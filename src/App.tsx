import { useEffect, useState, useCallback, useRef } from 'react'
import { useStore, countUrgentDeadlines } from './store'
import { useDeadlineNotifications } from './hooks/useDeadlineNotifications'
import { useAutoSync } from './hooks/useAutoSync'
import TopBar from './components/layout/TopBar'
import DevPanel from './components/layout/DevPanel'
import ProjectPanel from './components/layout/ProjectPanel'
import Calendar from './components/calendar/Calendar'
import DailyView from './components/views/DailyView'
import DeadlinesView from './components/views/DeadlinesView'
import SearchView from './components/views/SearchView'
import PerformanceView from './components/views/PerformanceView'
import ScheduleView from './components/views/ScheduleView'
import StandupModal from './components/modals/StandupModal'
import GanttModal from './components/modals/GanttModal'
import JiraConfigModal from './components/modals/JiraConfigModal'
import GitLabConfigModal from './components/modals/GitLabConfigModal'

const VIEW_LABELS: Record<string, string> = {
  daily: '📅 Daily',
  deadlines: '⏰ Deadlines',
  search: '🔍 Search',
  performance: '📊 Performance',
  schedule: '🗓 Schedule',
}

export default function App() {
  const { view, setView, setSelectedDate, setHighlightedTaskId, selectedProject, projects, tasks, developers, autoCarryOverdue, migrateIssueIds, deduplicateJiras, mergeSameDayTasks, setNotifsEnabled } = useStore()
  const [toast, setToast] = useState<string | null>(null)
  const [standupOpen, setStandupOpen] = useState(false)
  const [ganttOpen, setGanttOpen] = useState(false)
  const [jiraConfigOpen, setJiraConfigOpen] = useState(false)
  const [gitlabConfigOpen, setGitlabConfigOpen] = useState(false)
  // Right-side drawers — only one open at a time
  const [openPanel, setOpenPanel] = useState<'dev' | 'proj' | null>(null)
  const togglePanel = (which: 'dev' | 'proj') => setOpenPanel((p) => (p === which ? null : which))

  const urgentCount = countUrgentDeadlines(tasks, developers)

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showToast = useCallback((msg: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast(msg)
    toastTimer.current = setTimeout(() => setToast(null), 5000)
  }, [])

  useDeadlineNotifications()
  useAutoSync(showToast)

  // Startup: sync notif permission, migrate legacy jira formats, dedupe, carry overdue
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'granted') {
      setNotifsEnabled(true)
    }
    migrateIssueIds()
    deduplicateJiras()
    autoCarryOverdue()
    mergeSameDayTasks()
  }, [])

  // Service-worker → page bridge: notification clicks when the tab is backgrounded
  useEffect(() => {
    if (!navigator.serviceWorker) return
    const handler = (e: MessageEvent) => {
      if (e.data?.type !== 'PM_NOTIF_CLICK') return
      setView('daily')
      if (e.data.date) setSelectedDate(e.data.date as string)
      if (e.data.taskId) setHighlightedTaskId(e.data.taskId as string)
    }
    navigator.serviceWorker.addEventListener('message', handler)
    return () => navigator.serviceWorker.removeEventListener('message', handler)
  }, [setView, setSelectedDate, setHighlightedTaskId])

  // Console helper: run __gitlabDebug() to see how MRs map to tracked issues.
  useEffect(() => {
    ;(window as Window & { __gitlabDebug?: () => void }).__gitlabDebug = () => { void useStore.getState().debugGitlab() }
    console.info(`[pm-tracker] build ${__BUILD_ID__}`)
  }, [])

  // Auto carry every minute in case day rolls over; deduplicate and merge after each carry
  useEffect(() => {
    const id = setInterval(() => {
      deduplicateJiras()
      autoCarryOverdue()
      mergeSameDayTasks()
    }, 60000)
    return () => clearInterval(id)
  }, [])

  const proj = projects.find((p) => p.id === selectedProject)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', background: 'var(--bg)' }}>
      <TopBar
        urgentCount={urgentCount}
        onJiraConfig={() => setJiraConfigOpen(true)}
        onGitlabConfig={() => setGitlabConfigOpen(true)}
        onFeedback={showToast}
        onDevPanel={() => togglePanel('dev')}
        devPanelOpen={openPanel === 'dev'}
        onProjPanel={() => togglePanel('proj')}
        projPanelOpen={openPanel === 'proj'}
      />

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
        {/* main area — full width */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* view tabs */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '8px 14px 0', background: 'var(--surface)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
            {(Object.keys(VIEW_LABELS) as Array<keyof typeof VIEW_LABELS>).map((v) => (
              <button
                key={v}
                onClick={() => setView(v as Parameters<typeof setView>[0])}
                className={`view-tab${view === v ? ' active' : ''}`}
              >
                {VIEW_LABELS[v]}
                {v === 'deadlines' && urgentCount > 0 && (
                  <span style={{ position: 'absolute', top: 2, right: 2, background: 'var(--red)', color: '#fff', borderRadius: 8, fontSize: 8, fontWeight: 700, padding: '1px 4px', lineHeight: 1.4 }}>{urgentCount}</span>
                )}
              </button>
            ))}

            {/* project context chip */}
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 6 }}>
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
            {view === 'daily' && <DailyView onToast={showToast} onStandup={() => setStandupOpen(true)} onGantt={() => setGanttOpen(true)} />}
            {view === 'deadlines' && <DeadlinesView />}
            {view === 'search' && <SearchView />}
            {view === 'performance' && <PerformanceView />}
            {view === 'schedule' && <ScheduleView />}
          </div>
        </div>

        {/* right-side panels */}
        <DevPanel open={openPanel === 'dev'} onClose={() => setOpenPanel(null)} topOffset={54} />
        <ProjectPanel open={openPanel === 'proj'} onClose={() => setOpenPanel(null)} topOffset={54} />
      </div>

      {/* toast */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: 'var(--text)', color: 'var(--bg)', fontFamily: 'var(--mono)', fontSize: 12, padding: '9px 16px 9px 20px', borderRadius: 24, boxShadow: '0 4px 20px rgba(0,0,0,.3)', zIndex: 2000, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span>{toast}</span>
          <button onClick={() => setToast(null)} style={{ background: 'none', border: 'none', color: 'var(--bg)', opacity: 0.6, cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0, display: 'flex', alignItems: 'center' }}>✕</button>
        </div>
      )}

      {standupOpen && <StandupModal onClose={() => setStandupOpen(false)} />}
      {ganttOpen && <GanttModal onClose={() => setGanttOpen(false)} />}
      {jiraConfigOpen && <JiraConfigModal onClose={() => setJiraConfigOpen(false)} />}
      {gitlabConfigOpen && <GitLabConfigModal onClose={() => setGitlabConfigOpen(false)} />}
    </div>
  )
}
