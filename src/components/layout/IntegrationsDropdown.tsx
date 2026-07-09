import { useState, type CSSProperties } from 'react'
import { useClickOutside } from '../../hooks/useClickOutside'

interface Props {
  jiraEnabled: boolean
  gitlabEnabled: boolean
  jiraSyncing: boolean
  glSyncing: boolean
  onJiraConfig: () => void
  onGitlabConfig: () => void
  onJiraSync: () => void
  onGitlabSync: () => void
}

export default function IntegrationsDropdown({ jiraEnabled, gitlabEnabled, jiraSyncing, glSyncing, onJiraConfig, onGitlabConfig, onJiraSync, onGitlabSync }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useClickOutside<HTMLDivElement>(() => setOpen(false))

  const anyEnabled = jiraEnabled || gitlabEnabled

  const rowStyle: CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
    borderBottom: '1px solid var(--border)',
  }
  const iconBtnStyle: CSSProperties = {
    background: 'none', border: '1px solid var(--border)', borderRadius: 5,
    color: 'var(--text3)', fontSize: 11, padding: '3px 7px', cursor: 'pointer',
    fontFamily: 'var(--mono)', transition: 'all .15s',
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        title="Integrations (Jira, GitLab)"
        style={{
          display: 'flex', alignItems: 'center', gap: 5,
          border: `1px solid ${anyEnabled ? 'var(--accent)' : 'var(--border)'}`,
          background: 'var(--surface)', color: anyEnabled ? 'var(--accent)' : 'var(--text3)',
          fontFamily: 'var(--mono)', fontSize: 11, padding: '5px 11px',
          borderRadius: 6, cursor: 'pointer', transition: 'all .15s', whiteSpace: 'nowrap',
        }}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></svg>
        Services
        {anyEnabled && (
          <span style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
            {jiraEnabled && <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#60a5fa' }} />}
            {gitlabEnabled && <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#fb923c' }} />}
          </span>
        )}
      </button>

      {open && (
        <div className="menu" style={{ top: 'calc(100% + 6px)', right: 0, width: 220, zIndex: 500 }}>
          <div style={{ padding: '8px 12px 6px', borderBottom: '1px solid var(--border)' }}>
            <span className="section-label">Integrations</span>
          </div>

          {/* Jira */}
          <div style={rowStyle}>
            <span style={{ fontSize: 13 }}>🔗</span>
            <span style={{ flex: 1, fontSize: 12, fontWeight: 500, color: jiraEnabled ? '#60a5fa' : 'var(--text3)' }}>Jira</span>
            {jiraEnabled && <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: '#60a5fa', padding: '1px 5px', border: '1px solid #60a5fa40', borderRadius: 8 }}>on</span>}
            <button style={iconBtnStyle} title="Jira settings" onClick={() => { setOpen(false); onJiraConfig() }}>⚙</button>
            <button
              style={{ ...iconBtnStyle, opacity: jiraSyncing ? 0.5 : 1, color: jiraEnabled ? '#60a5fa' : 'var(--text3)', borderColor: jiraEnabled ? '#60a5fa50' : 'var(--border)' }}
              title="Sync from Jira"
              disabled={jiraSyncing}
              onClick={() => { setOpen(false); onJiraSync() }}
            >{jiraSyncing ? '⟳' : '↻'}</button>
          </div>

          {/* GitLab */}
          <div style={{ ...rowStyle, borderBottom: 'none' }}>
            <span style={{ fontSize: 13 }}>🦊</span>
            <span style={{ flex: 1, fontSize: 12, fontWeight: 500, color: gitlabEnabled ? '#fb923c' : 'var(--text3)' }}>GitLab</span>
            {gitlabEnabled && <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: '#fb923c', padding: '1px 5px', border: '1px solid #fb923c40', borderRadius: 8 }}>on</span>}
            <button style={iconBtnStyle} title="GitLab settings" onClick={() => { setOpen(false); onGitlabConfig() }}>⚙</button>
            <button
              style={{ ...iconBtnStyle, opacity: glSyncing ? 0.5 : 1, color: gitlabEnabled ? '#fb923c' : 'var(--text3)', borderColor: gitlabEnabled ? '#fb923c50' : 'var(--border)' }}
              title="Sync MRs from GitLab"
              disabled={glSyncing}
              onClick={() => { setOpen(false); onGitlabSync() }}
            >{glSyncing ? '⟳' : '↻'}</button>
          </div>
        </div>
      )}
    </div>
  )
}
