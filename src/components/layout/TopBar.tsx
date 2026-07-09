import { useState, useCallback } from 'react'
import { useStore } from '../../store'
import { NOTIFICATION_ICON } from '../../constants'
import { todayStr } from '../../utils/dates'
import Clock from './Clock'
import ProjectSelector from './ProjectSelector'
import DevSelector from './DevSelector'
import IntegrationsDropdown from './IntegrationsDropdown'
import DataDropdown from './DataDropdown'

interface TopBarProps {
  urgentCount: number
  onJiraConfig: () => void
  onGitlabConfig: () => void
  onFeedback: (msg: string) => void
  onDevPanel: () => void
  devPanelOpen: boolean
  onProjPanel: () => void
  projPanelOpen: boolean
}

export default function TopBar({ urgentCount, onJiraConfig, onGitlabConfig, onFeedback, onDevPanel, devPanelOpen, onProjPanel, projPanelOpen }: TopBarProps) {
  const { setNotifsEnabled, syncJira, syncGitlab, notifsEnabled, setView, setSelectedDate } = useStore()
  const jiraConfig = useStore((s) => s.jiraConfig)
  const gitlabConfig = useStore((s) => s.gitlabConfig)
  const [jiraSyncing, setJiraSyncing] = useState(false)
  const [glSyncing, setGlSyncing] = useState(false)

  const toggleNotifs = async () => {
    if (!('Notification' in window)) {
      onFeedback('Notifications not supported by your browser.')
      return
    }
    if (Notification.permission === 'denied') {
      onFeedback('Notifications blocked — open browser Site Settings → Notifications and allow this site.')
      return
    }
    // Already enabled: clicking again fires a test notification so the user can verify visibility
    if (Notification.permission === 'granted' && notifsEnabled) {
      try {
        new Notification('🔔 ProgressOr — test', {
          body: 'Notifications are working! You will see this 15 min before any deadline.',
          icon: NOTIFICATION_ICON,
          requireInteraction: true,
        })
        onFeedback('Test notification sent — it should stay visible until you dismiss it.')
      } catch {
        onFeedback('Notification API failed — check macOS System Settings → Notifications → allow your browser.')
      }
      return
    }
    const r = await Notification.requestPermission().catch(() => 'denied' as const)
    if (r === 'granted') {
      setNotifsEnabled(true)
      try {
        new Notification('🔔 ProgressOr notifications ON', {
          body: 'You will be notified 15 min before any deadline. Click the bell again to test.',
          icon: NOTIFICATION_ICON,
          requireInteraction: true,
        })
      } catch {}
      onFeedback('🔔 Enabled — click the bell again to send a test notification.')
    } else {
      setNotifsEnabled(false)
      onFeedback('Notifications denied — enable them in your browser site settings.')
    }
  }

  const handleJiraSync = useCallback(async () => {
    if (!jiraConfig.enabled || !jiraConfig.token) { onJiraConfig(); return }
    setJiraSyncing(true)
    try { await syncJira() } catch {}
    setJiraSyncing(false)
  }, [jiraConfig.enabled, jiraConfig.token, syncJira, onJiraConfig])

  const handleGitlabSync = useCallback(async () => {
    if (!gitlabConfig.enabled || !gitlabConfig.token) { onGitlabConfig(); return }
    setGlSyncing(true)
    try {
      const { linked, updated } = await syncGitlab()
      onFeedback(`GitLab synced — ${linked} MR${linked !== 1 ? 's' : ''} linked, ${updated} already tracked`)
    } catch (err) {
      onFeedback(`GitLab sync failed: ${(err as Error).message}`)
    }
    setGlSyncing(false)
  }, [gitlabConfig.enabled, gitlabConfig.token, syncGitlab, onGitlabConfig, onFeedback])

  const notifPerm = typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported'
  const notifOn = notifPerm === 'granted' && notifsEnabled

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px', borderBottom: '1px solid var(--border)', background: 'var(--surface)', position: 'sticky', top: 0, zIndex: 300, height: 54, boxShadow: '0 1px 0 var(--border), 0 2px 12px rgba(25,35,90,.06)' }}>
      <div style={{ display: 'flex', alignItems: 'center', height: '100%', gap: 0 }}>
        <button
          onClick={() => { setView('daily'); setSelectedDate(todayStr()) }}
          title="Go to today's Daily dashboard"
          style={{ display: 'flex', alignItems: 'center', padding: '6px 10px', marginRight: 6, background: 'none', border: 'none', cursor: 'pointer', borderRadius: 8, transition: 'background .15s' }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface2)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
        >
          <svg width="26" height="26" viewBox="0 0 48 48" style={{ flexShrink: 0 }}>
            <path fillRule="evenodd" fill="#171a2d" d="M24,3 A21,21 0 1,0 24,45 A21,21 0 1,0 24,3 Z M24,9 A15,15 0 1,0 24,39 A15,15 0 1,0 24,9 Z"/>
            <g stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round">
              <line x1="21" y1="7" x2="27" y2="5"/>
              <line x1="21" y1="7" x2="27" y2="5" transform="rotate(60 24 24)"/>
              <line x1="21" y1="7" x2="27" y2="5" transform="rotate(120 24 24)"/>
              <line x1="21" y1="7" x2="27" y2="5" transform="rotate(180 24 24)"/>
              <line x1="21" y1="7" x2="27" y2="5" transform="rotate(240 24 24)"/>
              <line x1="21" y1="7" x2="27" y2="5" transform="rotate(300 24 24)"/>
            </g>
          </svg>
        </button>
        <ProjectSelector open={projPanelOpen} onToggle={onProjPanel} />
        <DevSelector open={devPanelOpen} onToggle={onDevPanel} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <Clock />

        {/* deadline alert badge */}
        {urgentCount > 0 && (
          <span style={{ background: 'var(--red)', color: '#fff', fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 10, animation: 'pulse 2s infinite' }}>
            ⏰ {urgentCount} urgent
          </span>
        )}

        <button
          onClick={toggleNotifs}
          title={notifOn ? 'Notifications ON — click to send a test notification' : 'Click to enable notifications'}
          style={{ display: 'flex', alignItems: 'center', border: `1px solid ${notifOn ? 'var(--accent)' : 'var(--border)'}`, background: 'var(--surface)', opacity: notifOn ? 1 : 0.45, fontSize: 12, padding: '4px 8px', borderRadius: 6, cursor: 'pointer', transition: 'all .15s' }}
        >
          {notifOn ? '🔔' : '🔕'}
        </button>
        <DataDropdown onFeedback={onFeedback} />
        <IntegrationsDropdown
          jiraEnabled={jiraConfig.enabled}
          gitlabEnabled={gitlabConfig.enabled}
          jiraSyncing={jiraSyncing}
          glSyncing={glSyncing}
          onJiraConfig={onJiraConfig}
          onGitlabConfig={onGitlabConfig}
          onJiraSync={handleJiraSync}
          onGitlabSync={handleGitlabSync}
        />
      </div>
    </div>
  )
}
