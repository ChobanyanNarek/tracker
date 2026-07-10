import { useEffect, useRef, useState, useCallback } from 'react'
import { useStore } from '../../store'
import { clearToken, getUserInfo } from '../../utils/auth'
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
  onGithubConfig: () => void
  onFeedback: (msg: string) => void
  onDevPanel: () => void
  devPanelOpen: boolean
  onProjPanel: () => void
  onAdminOpen?: () => void
  projPanelOpen: boolean
}

export default function TopBar({ urgentCount, onJiraConfig, onGitlabConfig, onGithubConfig, onFeedback, onDevPanel, devPanelOpen, onProjPanel, projPanelOpen, onAdminOpen }: TopBarProps) {
  const { setNotifsEnabled, syncJira, syncGitlab, syncGithub, notifsEnabled, setView, setSelectedDate } = useStore()
  const [profileOpen, setProfileOpen] = useState(false)
  const profileRef = useRef<HTMLDivElement>(null)
  const user = getUserInfo()

  useEffect(() => {
    if (!profileOpen) return
    const handler = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) setProfileOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [profileOpen])

  const handleSignOut = () => {
    clearToken()
    window.location.reload()
  }

  const initials = user
    ? `${(user.firstName ?? '?')[0]}${(user.lastName ?? '')[0] ?? ''}`.toUpperCase()
    : '?'
  const displayName = user ? [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email : null
  const jiraConnections = useStore((s) => s.jiraConnections)
  const jiraEnabled = jiraConnections.some((c) => c.enabled && c.token)
  const gitlabConnections = useStore((s) => s.gitlabConnections)
  const gitlabEnabled = gitlabConnections.some((c) => c.enabled && c.token)
  const githubConnections = useStore((s) => s.githubConnections)
  const githubEnabled = githubConnections.some((c) => c.enabled && c.token)
  const [jiraSyncing, setJiraSyncing] = useState(false)
  const [glSyncing, setGlSyncing] = useState(false)
  const [ghSyncing, setGhSyncing] = useState(false)

  const toggleNotifs = async () => {
    if (!('Notification' in window)) {
      onFeedback('Notifications not supported by your browser.')
      return
    }
    if (Notification.permission === 'denied') {
      onFeedback('Notifications blocked — open browser Site Settings → Notifications and allow this site.')
      return
    }
    if (Notification.permission === 'granted' && notifsEnabled) {
      try {
        const reg = await navigator.serviceWorker.ready
        await reg.showNotification('🔔 ProgressOr — test', {
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
        const reg = await navigator.serviceWorker.ready
        await reg.showNotification('🔔 ProgressOr notifications ON', {
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
    if (!jiraEnabled) { onJiraConfig(); return }
    setJiraSyncing(true)
    try { await syncJira() } catch {}
    setJiraSyncing(false)
  }, [jiraEnabled, syncJira, onJiraConfig])

  const handleGitlabSync = useCallback(async () => {
    if (!gitlabEnabled) { onGitlabConfig(); return }
    setGlSyncing(true)
    try {
      const { linked, updated } = await syncGitlab()
      onFeedback(`GitLab synced — ${linked} MR${linked !== 1 ? 's' : ''} linked, ${updated} already tracked`)
    } catch (err) {
      onFeedback(`GitLab sync failed: ${(err as Error).message}`)
    }
    setGlSyncing(false)
  }, [gitlabEnabled, syncGitlab, onGitlabConfig, onFeedback])

  const handleGithubSync = useCallback(async () => {
    if (!githubEnabled) { onGithubConfig(); return }
    setGhSyncing(true)
    try {
      const { linked, updated } = await syncGithub()
      onFeedback(`GitHub synced — ${linked} PR${linked !== 1 ? 's' : ''} linked, ${updated} already tracked`)
    } catch (err) {
      onFeedback(`GitHub sync failed: ${(err as Error).message}`)
    }
    setGhSyncing(false)
  }, [githubEnabled, syncGithub, onGithubConfig, onFeedback])

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
          <svg width="26" height="26" viewBox="0 0 48 48" style={{ flexShrink: 0, animation: 'spin 2s linear infinite' }}>
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
          jiraEnabled={jiraEnabled}
          gitlabEnabled={gitlabEnabled}
          githubEnabled={githubEnabled}
          jiraSyncing={jiraSyncing}
          glSyncing={glSyncing}
          ghSyncing={ghSyncing}
          onJiraConfig={onJiraConfig}
          onGitlabConfig={onGitlabConfig}
          onGithubConfig={onGithubConfig}
          onJiraSync={handleJiraSync}
          onGitlabSync={handleGitlabSync}
          onGithubSync={handleGithubSync}
        />

        {/* Profile avatar + dropdown */}
        <div ref={profileRef} style={{ position: 'relative' }}>
          <button
            onClick={() => setProfileOpen((o) => !o)}
            title={displayName ?? 'Profile'}
            style={{
              width: 30, height: 30, borderRadius: '50%', border: '1.5px solid var(--border)',
              background: 'var(--accent)', color: '#fff',
              fontFamily: 'var(--sans)', fontSize: 11, fontWeight: 700,
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'opacity .15s', flexShrink: 0,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.8')}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
          >
            {initials}
          </button>

          {profileOpen && (
            <div style={{
              position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 200,
              background: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: 10, boxShadow: 'var(--shadow-xl)',
              minWidth: 200, padding: '4px 0', overflow: 'hidden',
            }}>
              <div style={{ padding: '12px 14px 10px', borderBottom: '1px solid var(--border)' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', fontFamily: 'var(--sans)' }}>
                  {displayName ?? 'User'}
                </div>
                {user?.email && (
                  <div style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--mono)', marginTop: 2, wordBreak: 'break-all' }}>
                    {user.email}
                  </div>
                )}
              </div>
              {onAdminOpen && (
                <button
                  onClick={() => { setProfileOpen(false); onAdminOpen() }}
                  style={{
                    width: '100%', padding: '9px 14px', background: 'none', border: 'none',
                    textAlign: 'left', cursor: 'pointer', color: 'var(--text)',
                    fontFamily: 'var(--sans)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8,
                    transition: 'background .12s',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface2)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                >
                  <span style={{ fontSize: 14 }}>⚙</span> Admin Panel
                </button>
              )}
              <button
                onClick={handleSignOut}
                style={{
                  width: '100%', padding: '9px 14px', background: 'none', border: 'none',
                  textAlign: 'left', cursor: 'pointer', color: 'var(--red)',
                  fontFamily: 'var(--sans)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8,
                  transition: 'background .12s',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface2)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
              >
                <span style={{ fontSize: 14 }}>↪</span> Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
