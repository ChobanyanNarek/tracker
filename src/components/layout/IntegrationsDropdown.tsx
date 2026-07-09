import { useState, type CSSProperties } from 'react'
import { useClickOutside } from '../../hooks/useClickOutside'

const GitLabIcon = ({ size = 14, color = 'currentColor' }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={color} aria-hidden="true">
    <path d="M4.845.904c-.435 0-.82.28-.955.692L.31 13.16a1.352 1.352 0 0 0 .477 1.492L12 23.25l11.213-8.598a1.352 1.352 0 0 0 .477-1.492L20.11 1.596A.999.999 0 0 0 19.155.904h-.002a.998.998 0 0 0-.952.69l-2.49 7.647H8.29L5.8 1.594A.999.999 0 0 0 4.845.904z" />
  </svg>
)

const GitHubIcon = ({ size = 14, color = 'currentColor' }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={color} aria-hidden="true">
    <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
  </svg>
)

interface Props {
  jiraEnabled: boolean
  gitlabEnabled: boolean
  githubEnabled: boolean
  jiraSyncing: boolean
  glSyncing: boolean
  ghSyncing: boolean
  onJiraConfig: () => void
  onGitlabConfig: () => void
  onGithubConfig: () => void
  onJiraSync: () => void
  onGitlabSync: () => void
  onGithubSync: () => void
}

export default function IntegrationsDropdown({ jiraEnabled, gitlabEnabled, githubEnabled, jiraSyncing, glSyncing, ghSyncing, onJiraConfig, onGitlabConfig, onGithubConfig, onJiraSync, onGitlabSync, onGithubSync }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useClickOutside<HTMLDivElement>(() => setOpen(false))

  const anyEnabled = jiraEnabled || gitlabEnabled || githubEnabled

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
        title="Integrations (Jira, GitLab, GitHub)"
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
            {gitlabEnabled && <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#fc6d26' }} />}
            {githubEnabled && <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#6e40c9' }} />}
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
          <div style={rowStyle}>
            <GitLabIcon size={14} color={gitlabEnabled ? '#fc6d26' : 'var(--text3)'} />
            <span style={{ flex: 1, fontSize: 12, fontWeight: 500, color: gitlabEnabled ? '#fc6d26' : 'var(--text3)' }}>GitLab</span>
            {gitlabEnabled && <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: '#fc6d26', padding: '1px 5px', border: '1px solid #fc6d2640', borderRadius: 8 }}>on</span>}
            <button style={iconBtnStyle} title="GitLab settings" onClick={() => { setOpen(false); onGitlabConfig() }}>⚙</button>
            <button
              style={{ ...iconBtnStyle, opacity: glSyncing ? 0.5 : 1, color: gitlabEnabled ? '#fc6d26' : 'var(--text3)', borderColor: gitlabEnabled ? '#fc6d2650' : 'var(--border)' }}
              title="Sync MRs from GitLab"
              disabled={glSyncing}
              onClick={() => { setOpen(false); onGitlabSync() }}
            >{glSyncing ? '⟳' : '↻'}</button>
          </div>

          {/* GitHub */}
          <div style={{ ...rowStyle, borderBottom: 'none' }}>
            <GitHubIcon size={14} color={githubEnabled ? '#6e40c9' : 'var(--text3)'} />
            <span style={{ flex: 1, fontSize: 12, fontWeight: 500, color: githubEnabled ? '#6e40c9' : 'var(--text3)' }}>GitHub</span>
            {githubEnabled && <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: '#6e40c9', padding: '1px 5px', border: '1px solid #6e40c940', borderRadius: 8 }}>on</span>}
            <button style={iconBtnStyle} title="GitHub settings" onClick={() => { setOpen(false); onGithubConfig() }}>⚙</button>
            <button
              style={{ ...iconBtnStyle, opacity: ghSyncing ? 0.5 : 1, color: githubEnabled ? '#6e40c9' : 'var(--text3)', borderColor: githubEnabled ? '#6e40c950' : 'var(--border)' }}
              title="Sync PRs from GitHub"
              disabled={ghSyncing}
              onClick={() => { setOpen(false); onGithubSync() }}
            >{ghSyncing ? '⟳' : '↻'}</button>
          </div>
        </div>
      )}
    </div>
  )
}
