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

const GearLogo = ({ size = 26 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 48 48" style={{ flexShrink: 0, animation: 'spin 2s linear infinite' }}>
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
)

const BellOn = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
    <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
  </svg>
)

const BellOff = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
    <path d="M18.63 13A17.89 17.89 0 0 1 18 8"/>
    <path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14"/>
    <path d="M18 8a6 6 0 0 0-9.33-5"/>
    <line x1="1" y1="1" x2="23" y2="23"/>
  </svg>
)

export default function TopBar({ urgentCount, onJiraConfig, onGitlabConfig, onGithubConfig, onFeedback, onDevPanel, devPanelOpen, onProjPanel, projPanelOpen, onAdminOpen }: TopBarProps) {
  const { setNotifsEnabled, syncJira, syncGitlab, syncGithub, notifsEnabled, setView, setSelectedDate } = useStore()
  const [profileOpen, setProfileOpen] = useState(false)
  const profileRef = useRef<HTMLDivElement>(null)
  const user = getUserInfo()
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' ? window.innerWidth < 640 : false)

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640)
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

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

  const iconBtn: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: 30, height: 30, borderRadius: 8, cursor: 'pointer',
    transition: 'all .15s', flexShrink: 0,
  }

  const profileDropdown = profileOpen ? (
    <div style={{
      position: 'absolute', right: 0, top: 'calc(100% + 8px)', zIndex: 400,
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 14, boxShadow: 'var(--shadow-xl)',
      minWidth: 210, overflow: 'hidden',
    }}>
      <div style={{ padding: '14px 16px 12px', borderBottom: '1px solid var(--border)', background: 'var(--surface2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--sans)', fontSize: 13, fontWeight: 700, letterSpacing: '-.2px', flexShrink: 0 }}>
            {initials}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', fontFamily: 'var(--sans)', letterSpacing: '-.1px' }}>
              {displayName ?? 'User'}
            </div>
            {user?.email && (
              <div style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--mono)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {user.email}
              </div>
            )}
          </div>
        </div>
      </div>
      <div style={{ padding: '4px 0' }}>
        {onAdminOpen && (
          <button
            onClick={() => { setProfileOpen(false); onAdminOpen() }}
            style={{ width: '100%', padding: '9px 16px', background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer', color: 'var(--text)', fontFamily: 'var(--sans)', fontSize: 13, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 10, transition: 'background .12s' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface2)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
          >
            <div style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--surface3)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: 'var(--text2)' }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M4.93 4.93a10 10 0 0 0 0 14.14"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2"/></svg>
            </div>
            Admin Panel
          </button>
        )}
        <div style={{ height: 1, background: 'var(--border)', margin: '3px 0' }} />
        <button
          onClick={handleSignOut}
          style={{ width: '100%', padding: '9px 16px', background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer', color: 'var(--red)', fontFamily: 'var(--sans)', fontSize: 13, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 10, transition: 'background .12s' }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--red-dim)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
        >
          <div style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--red-dim)', border: '1px solid var(--red-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: 'var(--red)' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          </div>
          Sign out
        </button>
      </div>
    </div>
  ) : null

  const boxShadow = '0 1px 0 var(--border), 0 2px 12px rgba(25,35,90,.06)'

  /* ── Mobile: 2-row layout ── */
  if (isMobile) {
    return (
      <div style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, zIndex: 300, boxShadow }}>
        {/* Row 1: Logo + app name + bell + profile */}
        <div style={{ display: 'flex', alignItems: 'center', padding: '0 14px', height: 50, gap: 10 }}>
          <button
            onClick={() => { setView('daily'); setSelectedDate(todayStr()) }}
            title="Go to today's Daily dashboard"
            style={{ display: 'flex', alignItems: 'center', background: 'none', border: 'none', cursor: 'pointer', borderRadius: 8, padding: 0, flexShrink: 0 }}
          >
            <GearLogo size={24} />
          </button>
          <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', letterSpacing: '-.4px', fontFamily: 'var(--sans)', flexShrink: 0 }}>
            ProgressOr
          </span>
          <div style={{ flex: 1 }} />
          {urgentCount > 0 && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, background: 'var(--red)', color: '#fff', fontFamily: 'var(--sans)', fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 10, animation: 'pulse 2s infinite', flexShrink: 0 }}>
              {urgentCount}!
            </span>
          )}
          <button
            onClick={toggleNotifs}
            title={notifOn ? 'Notifications ON' : 'Enable notifications'}
            style={{ ...iconBtn, border: `1.5px solid ${notifOn ? 'var(--accent)' : 'var(--border)'}`, background: notifOn ? 'var(--accent-dim)' : 'var(--surface)', color: notifOn ? 'var(--accent)' : 'var(--text4)' }}
          >
            {notifOn ? <BellOn /> : <BellOff />}
          </button>
          <div ref={profileRef} style={{ position: 'relative' }}>
            <button
              onClick={() => setProfileOpen((o) => !o)}
              title={displayName ?? 'Profile'}
              style={{ width: 32, height: 32, borderRadius: '50%', border: '2px solid var(--accent-border)', background: 'var(--accent)', color: '#fff', fontFamily: 'var(--sans)', fontSize: 11, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all .15s', flexShrink: 0, letterSpacing: '-.2px', boxShadow: '0 2px 8px rgba(59,91,219,.25)' }}
            >
              {initials}
            </button>
            {profileDropdown}
          </div>
        </div>
        {/* Row 2: Project + Dev selectors */}
        <div style={{ display: 'flex', alignItems: 'stretch', borderTop: '1px solid var(--border)', height: 40 }}>
          <ProjectSelector open={projPanelOpen} onToggle={onProjPanel} fill />
          <DevSelector open={devPanelOpen} onToggle={onDevPanel} fill />
        </div>
      </div>
    )
  }

  /* ── Desktop: single-row layout ── */
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', borderBottom: '1px solid var(--border)', background: 'var(--surface)', position: 'sticky', top: 0, zIndex: 300, height: 54, boxShadow }}>
      <div style={{ display: 'flex', alignItems: 'center', height: '100%', gap: 0 }}>
        <button
          onClick={() => { setView('daily'); setSelectedDate(todayStr()) }}
          title="Go to today's Daily dashboard"
          style={{ display: 'flex', alignItems: 'center', padding: '5px 8px', marginRight: 8, background: 'none', border: 'none', cursor: 'pointer', borderRadius: 8, transition: 'background .15s' }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface2)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
        >
          <GearLogo size={26} />
        </button>
        <ProjectSelector open={projPanelOpen} onToggle={onProjPanel} />
        <DevSelector open={devPanelOpen} onToggle={onDevPanel} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Clock />

        {urgentCount > 0 && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'var(--red)', color: '#fff', fontFamily: 'var(--sans)', fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 10, animation: 'pulse 2s infinite' }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            {urgentCount} urgent
          </span>
        )}

        <button
          onClick={toggleNotifs}
          title={notifOn ? 'Notifications ON — click to send a test notification' : 'Click to enable notifications'}
          style={{ ...iconBtn, border: `1.5px solid ${notifOn ? 'var(--accent)' : 'var(--border)'}`, background: notifOn ? 'var(--accent-dim)' : 'var(--surface)', color: notifOn ? 'var(--accent)' : 'var(--text4)' }}
        >
          {notifOn ? <BellOn /> : <BellOff />}
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

        <div ref={profileRef} style={{ position: 'relative' }}>
          <button
            onClick={() => setProfileOpen((o) => !o)}
            title={displayName ?? 'Profile'}
            style={{ width: 32, height: 32, borderRadius: '50%', border: '2px solid var(--accent-border)', background: 'var(--accent)', color: '#fff', fontFamily: 'var(--sans)', fontSize: 11, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all .15s', flexShrink: 0, letterSpacing: '-.2px', boxShadow: '0 2px 8px rgba(59,91,219,.25)' }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 4px 14px rgba(59,91,219,.4)' }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 2px 8px rgba(59,91,219,.25)' }}
          >
            {initials}
          </button>
          {profileDropdown}
        </div>
      </div>
    </div>
  )
}
