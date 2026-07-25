import { useState, type CSSProperties } from 'react'
import { useClickOutside } from '../../hooks/useClickOutside'
import Icon, { BrandIcon, BRAND } from '../ui/Icon'

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
  compact?: boolean
}

export default function IntegrationsDropdown({ jiraEnabled, gitlabEnabled, githubEnabled, jiraSyncing, glSyncing, ghSyncing, onJiraConfig, onGitlabConfig, onGithubConfig, onJiraSync, onGitlabSync, onGithubSync, compact }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useClickOutside<HTMLDivElement>(() => setOpen(false))

  const anyEnabled = jiraEnabled || gitlabEnabled || githubEnabled

  const JiraLogo = ({ color }: { color: string }) => (
    <svg width={14} height={14} viewBox="0 0 24 24" fill={color} style={{ flexShrink: 0 }} aria-hidden="true">
      <path d="M11.53 2 6.77 6.76a1 1 0 0 0 0 1.42l4.76 4.76 4.77-4.76a1 1 0 0 0 0-1.42L11.53 2zM6.76 6.77 2 11.53l4.76 4.76 4.77-4.76-4.77-4.76zM16.29 6.77l-4.76 4.76 4.76 4.76L21.05 11.53l-4.76-4.76z"/>
    </svg>
  )
  const badge = (color: string): CSSProperties => ({ fontFamily: 'var(--mono)', fontSize: 9, fontWeight: 700, color, padding: '2px 6px', border: `1px solid ${color}40`, borderRadius: 8, background: `${color}14` })

  const rowStyle: CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 10, padding: '9px 13px',
    borderBottom: '1px solid var(--border)',
  }
  const iconBtnStyle: CSSProperties = {
    background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--r)',
    color: 'var(--text3)', width: 26, height: 26,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer', transition: 'all .15s', flexShrink: 0,
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        title="Integrations (Jira, GitLab, GitHub)"
        style={{
          display: 'flex', alignItems: 'center', gap: 5,
          border: `1.5px solid ${anyEnabled ? 'var(--accent-border)' : 'var(--border)'}`,
          background: anyEnabled ? 'var(--accent-dim)' : 'var(--surface)',
          color: anyEnabled ? 'var(--accent)' : 'var(--text3)',
          fontFamily: 'var(--sans)', fontSize: 12, fontWeight: anyEnabled ? 600 : 500,
          padding: '5px 11px', borderRadius: 8, cursor: 'pointer', transition: 'all .15s', whiteSpace: 'nowrap',
        }}
      >
        <Icon name="chart" size={12} />
        {!compact && 'Services'}
        {anyEnabled && (
          <span style={{ display: 'flex', gap: 2, alignItems: 'center', marginLeft: 1 }}>
            {jiraEnabled && <span style={{ width: 6, height: 6, borderRadius: '50%', background: BRAND.jira }} />}
            {gitlabEnabled && <span style={{ width: 6, height: 6, borderRadius: '50%', background: BRAND.gitlab }} />}
            {githubEnabled && <span style={{ width: 6, height: 6, borderRadius: '50%', background: BRAND.github }} />}
          </span>
        )}
      </button>

      {open && (
        <div className="menu" style={{ top: 'calc(100% + 6px)', right: 0, width: 230, zIndex: 500 }}>
          <div style={{ padding: '9px 13px 7px', borderBottom: '1px solid var(--border)' }}>
            <span className="section-label">Services</span>
          </div>

          {/* Jira */}
          <div style={rowStyle}>
            <JiraLogo color={jiraEnabled ? BRAND.jira : 'var(--text3)'} />
            <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: jiraEnabled ? BRAND.jira : 'var(--text2)' }}>Jira</span>
            {jiraEnabled && <span style={badge(BRAND.jira)}>on</span>}
            <button style={iconBtnStyle} title="Jira settings" onClick={() => { setOpen(false); onJiraConfig() }}><Icon name="gear" size={12} /></button>
            <button
              style={{ ...iconBtnStyle, color: jiraEnabled ? BRAND.jira : 'var(--text3)', borderColor: jiraEnabled ? `${BRAND.jira}50` : 'var(--border)', opacity: jiraSyncing ? 0.5 : 1 }}
              title="Sync from Jira" disabled={jiraSyncing}
              onClick={() => { setOpen(false); onJiraSync() }}
            ><Icon name="sync" size={12} spinning={jiraSyncing} /></button>
          </div>

          {/* GitLab */}
          <div style={rowStyle}>
            <BrandIcon brand="gitlab" size={14} color={gitlabEnabled ? BRAND.gitlab : 'var(--text3)'} />
            <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: gitlabEnabled ? BRAND.gitlab : 'var(--text2)' }}>GitLab</span>
            {gitlabEnabled && <span style={badge(BRAND.gitlab)}>on</span>}
            <button style={iconBtnStyle} title="GitLab settings" onClick={() => { setOpen(false); onGitlabConfig() }}><Icon name="gear" size={12} /></button>
            <button
              style={{ ...iconBtnStyle, color: gitlabEnabled ? BRAND.gitlab : 'var(--text3)', borderColor: gitlabEnabled ? `${BRAND.gitlab}50` : 'var(--border)', opacity: glSyncing ? 0.5 : 1 }}
              title="Sync MRs from GitLab" disabled={glSyncing}
              onClick={() => { setOpen(false); onGitlabSync() }}
            ><Icon name="sync" size={12} spinning={glSyncing} /></button>
          </div>

          {/* GitHub */}
          <div style={{ ...rowStyle, borderBottom: 'none' }}>
            <BrandIcon brand="github" size={14} color={githubEnabled ? BRAND.github : 'var(--text3)'} />
            <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: githubEnabled ? BRAND.github : 'var(--text2)' }}>GitHub</span>
            {githubEnabled && <span style={badge(BRAND.github)}>on</span>}
            <button style={iconBtnStyle} title="GitHub settings" onClick={() => { setOpen(false); onGithubConfig() }}><Icon name="gear" size={12} /></button>
            <button
              style={{ ...iconBtnStyle, color: githubEnabled ? BRAND.github : 'var(--text3)', borderColor: githubEnabled ? `${BRAND.github}50` : 'var(--border)', opacity: ghSyncing ? 0.5 : 1 }}
              title="Sync PRs from GitHub" disabled={ghSyncing}
              onClick={() => { setOpen(false); onGithubSync() }}
            ><Icon name="sync" size={12} spinning={ghSyncing} /></button>
          </div>
        </div>
      )}
    </div>
  )
}
