import { useEffect, useState, useCallback, useRef, type ReactNode } from 'react'
import { isAuthenticated, getUserInfo } from './utils/auth'
import LoginPage from './components/auth/LoginPage'
import AdminPage from './components/admin/AdminPage'
import { useStore, countUrgentDeadlines, syncCloudToStore, sprintMatchesBoard, getBoardScope } from './store'
import { useDeadlineNotifications } from './hooks/useDeadlineNotifications'
import { useAutoSync } from './hooks/useAutoSync'
import TopBar from './components/layout/TopBar'
import Icon from './components/ui/Icon'

import ProjectPanel from './components/layout/ProjectPanel'
import Calendar from './components/calendar/Calendar'
import DailyView from './components/views/DailyView'
import DeadlinesView from './components/views/DeadlinesView'
import SearchView from './components/views/SearchView'
import PerformanceView from './components/views/PerformanceView'
import ScheduleView from './components/views/ScheduleView'
import SprintView from './components/views/SprintView'
import TimelineView from './components/views/TimelineView'
import SprintBand from './components/sprint/SprintBand'
import ReportView from './components/views/ReportView'

const VIEW_LABELS: Record<string, string> = {
  daily: 'Daily',
  deadlines: 'Deadlines',
  performance: 'Performance',
  schedule: 'Schedule',
  timeline: 'Timeline',
  report: 'Report',
}

const VIEW_ICONS: Record<string, ReactNode> = {
  daily: <Icon name="daily" size={14} />,
  deadlines: <Icon name="deadlines" size={14} />,
  performance: <Icon name="performance" size={14} />,
  schedule: <Icon name="schedule" size={14} />,
  sprint: <Icon name="sprint" size={14} />,
  timeline: <Icon name="timeline" size={14} />,
  report: <Icon name="chart" size={14} />,
}

export default function App() {
  const [authed, setAuthed] = useState(isAuthenticated)
  const [adminOpen, setAdminOpen] = useState(false)

  useEffect(() => {
    if (authed) {
      if (localStorage.getItem('pm_open_admin')) {
        localStorage.removeItem('pm_open_admin')
        setAdminOpen(true)
      } else if (window.location.pathname === '/admin') {
        setAdminOpen(true)
      }
    }
  }, [authed])

  const handleAuth = useCallback(async () => {
    await syncCloudToStore()
    setAuthed(true)
  }, [])

  if (!authed) {
    return <LoginPage onAuth={() => { void handleAuth() }} />
  }

  if (adminOpen) {
    return <AdminPage onBack={() => setAdminOpen(false)} />
  }

  const user = getUserInfo()
  const isAdmin = user?.role === 'ADMIN'

  return <AuthedApp onAdminOpen={isAdmin ? () => setAdminOpen(true) : undefined} />
}

function AuthedApp({ onAdminOpen }: { onAdminOpen?: () => void }) {
  const { view, setView, setSelectedDate, setHighlightedTaskId, selectedProject, projects, sprints, tasks, developers, autoCarryOverdue, migrateIssueIds, deduplicateJiras, mergeSameDayTasks, setNotifsEnabled, cloudSyncing, refreshBoardIssueKeys } = useStore()

  // When a scrum board is selected, resolve its exact issue set from Jira so board-scoped
  // views fill in immediately (no hard refresh needed after switching boards).
  const selProj = projects.find((p) => p.id === selectedProject)
  const selBoardId = selProj?.mode === 'scrum' ? selProj.jiraBoardId : undefined
  useEffect(() => {
    if (!cloudSyncing && selectedProject !== 'ALL' && selBoardId) void refreshBoardIssueKeys(selectedProject)
  }, [cloudSyncing, selectedProject, selBoardId, refreshBoardIssueKeys])
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' ? window.innerWidth < 640 : false)
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640)
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])
  const [toast, setToast] = useState<string | null>(null)
  const [openPanel, setOpenPanel] = useState<'proj' | null>(null)
  const togglePanel = (which: 'proj') => setOpenPanel((p) => (p === which ? null : which))

  const urgentProj = selectedProject !== 'ALL' ? projects.find((p) => p.id === selectedProject) : null
  const filteredTasks = urgentProj ? tasks.filter((t) => t.projectId === selectedProject) : tasks
  const filteredDevs = urgentProj ? developers.filter((d) => urgentProj.members.includes(d.id)) : developers
  const urgentState = useStore.getState()
  const urgentCount = countUrgentDeadlines(filteredTasks, filteredDevs, getBoardScope(urgentState))

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showToast = useCallback((msg: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast(msg)
    toastTimer.current = setTimeout(() => setToast(null), 5000)
  }, [])

  useDeadlineNotifications()
  useAutoSync(showToast)

  const isSyncingRef = useRef(cloudSyncing)
  useEffect(() => {
    if (isSyncingRef.current && !cloudSyncing) {
      showToast('✓ Data loaded from cloud')
      migrateIssueIds()
      deduplicateJiras()
      autoCarryOverdue()
      mergeSameDayTasks()
    }
    isSyncingRef.current = cloudSyncing
  }, [cloudSyncing, showToast])

  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'granted') {
      setNotifsEnabled(true)
    }
    migrateIssueIds()
    deduplicateJiras()
    autoCarryOverdue()
    mergeSameDayTasks()
  }, [])

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

  useEffect(() => {
    console.info(`[progressor] build ${__BUILD_ID__}`)
  }, [])

  useEffect(() => {
    const id = setInterval(() => {
      deduplicateJiras()
      autoCarryOverdue()
      mergeSameDayTasks()
    }, 60000)
    return () => clearInterval(id)
  }, [])

  const proj = projects.find((p) => p.id === selectedProject)
  const isScrumProject = proj?.mode === 'scrum'

  // If sprint tab is active but project is no longer scrum, go back to daily
  if (view === 'sprint' && !isScrumProject) {
    setView('daily')
  }
  const activeSprint = isScrumProject
    ? (() => {
        const today = new Date().toISOString().slice(0, 10)
        const boardId = proj?.jiraBoardId
        const projectSprints = sprints.filter((s) => sprintMatchesBoard(s, selectedProject, boardId))
        return projectSprints.find((s) => today >= s.startDate && today <= s.endDate) ?? projectSprints.slice(-1)[0]
      })()
    : undefined

  if (cloudSyncing) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: 12, background: 'var(--bg)', color: 'var(--text3)', fontFamily: 'var(--mono)', fontSize: 13 }}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ animation: 'spin 1s linear infinite' }}>
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
        <span>Loading your data…</span>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', background: 'var(--bg)' }}>
      <TopBar
        urgentCount={urgentCount}
        onFeedback={showToast}
        onProjPanel={() => togglePanel('proj')}
        projPanelOpen={openPanel === 'proj'}
        onAdminOpen={onAdminOpen}
      />

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div className="tabs-bar" style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '8px 14px 0', background: 'var(--surface)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
            {(Object.keys(VIEW_LABELS) as Array<keyof typeof VIEW_LABELS>).map((v) => (
              <button
                key={v}
                onClick={() => setView(v as Parameters<typeof setView>[0])}
                className={`view-tab${view === v ? ' active' : ''}`}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
              >
                {VIEW_ICONS[v]}
                {VIEW_LABELS[v]}
                {v === 'deadlines' && urgentCount > 0 && (
                  <span style={{ position: 'absolute', top: 2, right: 2, background: 'var(--red)', color: '#fff', borderRadius: 8, fontSize: 8, fontWeight: 700, padding: '1px 4px', lineHeight: 1.4 }}>{urgentCount}</span>
                )}
              </button>
            ))}
            {isScrumProject && (
              <button
                onClick={() => setView('sprint')}
                className={`view-tab${view === 'sprint' ? ' active' : ''}`}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
              >
                {VIEW_ICONS.sprint}
                Sprint
              </button>
            )}

            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 6 }}>
              {cloudSyncing && (
                <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', opacity: 0.7 }}>
                  ↻ syncing…
                </span>
              )}
              {proj && (
                <span style={{ fontFamily: 'var(--mono)', fontSize: 10, padding: '2px 8px', borderRadius: 8, background: proj.color + '18', color: proj.color, border: `1px solid ${proj.color}40` }}>
                  {proj.name}
                </span>
              )}
            </div>
          </div>

          {view === 'daily' && isScrumProject && activeSprint && (
            <SprintBand sprint={activeSprint} />
          )}
          {view === 'daily' && (
            <div style={{ flexShrink: 0, borderBottom: '1px solid var(--border)' }}>
              <Calendar />
            </div>
          )}

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {view === 'daily' && <DailyView onToast={showToast} />}
            {view === 'deadlines' && <DeadlinesView />}
            {view === 'search' && <SearchView />}
            {view === 'performance' && <PerformanceView />}
            {view === 'schedule' && <ScheduleView />}
            {view === 'sprint' && <SprintView />}
            {view === 'timeline' && <TimelineView />}
            {view === 'report' && <ReportView />}
          </div>
        </div>

        <ProjectPanel open={openPanel === 'proj'} onClose={() => setOpenPanel(null)} topOffset={isMobile ? 90 : 54} onToast={showToast} />
      </div>

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: 'var(--text)', color: 'var(--bg)', fontFamily: 'var(--mono)', fontSize: 12, padding: '9px 16px 9px 20px', borderRadius: 24, boxShadow: '0 4px 20px rgba(0,0,0,.3)', zIndex: 2000, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span>{toast}</span>
          <button onClick={() => setToast(null)} style={{ background: 'none', border: 'none', color: 'var(--bg)', opacity: 0.6, cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0, display: 'flex', alignItems: 'center' }}>✕</button>
        </div>
      )}

    </div>
  )
}
