import { useState } from 'react'
import { useStore } from '../../store'
import type { JiraConfig } from '../../types'
import { fetchJiraIssues } from '../../utils/jira-api'

interface Props {
  onClose: () => void
}

const inputStyle: React.CSSProperties = {
  background: 'var(--surface3)',
  border: '1px solid var(--border)',
  color: 'var(--text)',
  padding: '6px 10px',
  borderRadius: 6,
  outline: 'none',
  width: '100%',
  fontSize: 12,
  fontFamily: 'var(--mono)',
}

const labelStyle: React.CSSProperties = {
  fontSize: 10,
  color: 'var(--text3)',
  textTransform: 'uppercase',
  letterSpacing: '.7px',
  marginBottom: 4,
  display: 'block',
}

export default function JiraConfigModal({ onClose }: Props) {
  const { jiraConfig, developers, setJiraConfig, updateDeveloperPeriods, syncJira } = useStore()
  const devList = useStore((s) => s.developers)

  const [cfg, setCfg] = useState<JiraConfig>({ ...jiraConfig })
  const [projectKeysRaw, setProjectKeysRaw] = useState(jiraConfig.projectKeys.join(', '))
  const [jiraEmails, setJiraEmails] = useState<Record<string, string>>(
    Object.fromEntries(developers.map((d) => [d.id, d.jiraEmail ?? ''])),
  )
  const [showToken, setShowToken] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<string | null>(null)

  function patch(key: keyof JiraConfig, value: unknown) {
    setCfg((c) => ({ ...c, [key]: value }))
  }

  async function testConnection() {
    setTesting(true)
    setTestResult(null)
    const testCfg: JiraConfig = {
      ...cfg,
      projectKeys: projectKeysRaw.split(',').map((k) => k.trim()).filter(Boolean),
    }
    try {
      await fetchJiraIssues(testCfg, 'assignee is not EMPTY AND statusCategory != Done ORDER BY updated DESC')
      setTestResult({ ok: true, msg: 'Connection successful ✓' })
    } catch (err) {
      const msg = (err as Error).message
      const isNetwork = msg.toLowerCase().includes('failed to fetch') || msg.toLowerCase().includes('network error')
      setTestResult({
        ok: false,
        msg: !testCfg.proxyUrl && isNetwork ? 'CORS error — set a Proxy URL below.' : msg,
      })
    }
    setTesting(false)
  }

  function save() {
    const saved: JiraConfig = {
      ...cfg,
      projectKeys: projectKeysRaw.split(',').map((k) => k.trim()).filter(Boolean),
    }
    setJiraConfig(saved)
    // Save jiraEmail on each developer
    devList.forEach((d) => {
      const email = jiraEmails[d.id] ?? ''
      if (email !== (d.jiraEmail ?? '')) {
        updateDeveloperPeriods(d.id, d.periods ?? [])
        useStore.setState((s) => ({
          developers: s.developers.map((dev) => dev.id === d.id ? { ...dev, jiraEmail: email || undefined } : dev),
        }))
      }
    })
    onClose()
  }

  async function handleSyncNow() {
    setSyncing(true)
    setSyncResult(null)
    try {
      const { added, updated } = await syncJira()
      setSyncResult(`✓ Synced — ${added} added, ${updated} updated`)
    } catch (err) {
      setSyncResult(`✗ ${(err as Error).message}`)
    }
    setSyncing(false)
  }

  const lastSync = cfg.lastSync
    ? new Date(cfg.lastSync).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : 'Never'

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--rl)', width: '100%', maxWidth: 560, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,.35)' }}>
        {/* header */}
        <div style={{ display: 'flex', alignItems: 'center', padding: '14px 18px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', flex: 1 }}>🔗 Jira Integration</span>
          <button onClick={onClose} className="icon-btn" style={{ fontSize: 16 }}>✕</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 18 }}>

          {/* enable toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: cfg.enabled ? 'var(--accent-dim)' : 'var(--surface2)', borderRadius: 8, border: `1px solid ${cfg.enabled ? 'var(--accent)' : 'var(--border)'}` }}>
            <input type="checkbox" id="jira-enabled" checked={cfg.enabled} onChange={(e) => patch('enabled', e.target.checked)} style={{ width: 16, height: 16, cursor: 'pointer' }} />
            <label htmlFor="jira-enabled" style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', cursor: 'pointer' }}>
              Enable Jira auto-import
            </label>
            {cfg.lastSync && (
              <span style={{ marginLeft: 'auto', fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)' }}>
                Last sync: {lastSync}
              </span>
            )}
          </div>

          {/* connection */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text2)', marginBottom: 10, paddingBottom: 5, borderBottom: '1px solid var(--border)' }}>
              Connection
            </div>
            {cfg.proxyUrl && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: '#7c3aed18', border: '1px solid #7c3aed60', borderRadius: 7, marginBottom: 10 }}>
                <span style={{ fontSize: 12, color: '#a78bfa', flex: 1 }}>
                  ⚠ Proxy URL is set — this overrides direct Jira calls. Clear it if you are using the Chrome extension.
                </span>
                <button
                  onClick={() => patch('proxyUrl', '')}
                  style={{ padding: '3px 10px', borderRadius: 5, border: '1px solid #7c3aed', background: '#7c3aed30', color: '#a78bfa', cursor: 'pointer', fontSize: 11, fontFamily: 'var(--mono)', flexShrink: 0 }}
                >Clear</button>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div>
                <span style={labelStyle}>Jira Base URL</span>
                <input
                  style={inputStyle}
                  placeholder="https://yourcompany.atlassian.net"
                  value={cfg.baseUrl}
                  onChange={(e) => patch('baseUrl', e.target.value)}
                />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <span style={labelStyle}>Email</span>
                  <input style={inputStyle} placeholder="you@company.com" value={cfg.email} onChange={(e) => patch('email', e.target.value)} />
                </div>
                <div style={{ flex: 1 }}>
                  <span style={labelStyle}>API Token <a href="https://id.atlassian.com/manage-profile/security/api-tokens" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', textDecoration: 'none', marginLeft: 4 }}>↗ create</a></span>
                  <div style={{ position: 'relative' }}>
                    <input
                      style={{ ...inputStyle, paddingRight: 32 }}
                      type={showToken ? 'text' : 'password'}
                      placeholder="API token"
                      value={cfg.token}
                      onChange={(e) => patch('token', e.target.value)}
                    />
                    <button
                      onClick={() => setShowToken((s) => !s)}
                      style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--text3)' }}
                    >
                      {showToken ? '🙈' : '👁'}
                    </button>
                  </div>
                </div>
              </div>

              {testResult && (
                <div style={{ fontSize: 11, padding: '6px 10px', borderRadius: 6, background: testResult.ok ? '#dcfce7' : '#fee2e2', color: testResult.ok ? '#15803d' : '#b91c1c', border: `1px solid ${testResult.ok ? '#86efac' : '#fca5a5'}`, fontFamily: 'var(--mono)' }}>
                  {testResult.msg}
                </div>
              )}

              <button
                onClick={testConnection}
                disabled={testing || !cfg.baseUrl || !cfg.token}
                style={{ alignSelf: 'flex-start', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text2)', fontFamily: 'var(--mono)', fontSize: 11, padding: '5px 12px', borderRadius: 6, cursor: 'pointer', opacity: !cfg.baseUrl || !cfg.token ? 0.5 : 1 }}
              >
                {testing ? '…' : 'Test connection'}
              </button>
            </div>
          </div>

          {/* sync settings */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text2)', marginBottom: 10, paddingBottom: 5, borderBottom: '1px solid var(--border)' }}>
              Sync settings
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div>
                <span style={labelStyle}>Project keys (comma-separated, leave empty for all)</span>
                <input style={inputStyle} placeholder="PROJ, MOBILE, API" value={projectKeysRaw} onChange={(e) => setProjectKeysRaw(e.target.value)} />
              </div>
              <div>
                <span style={labelStyle}>Auto-sync interval</span>
                <select
                  value={cfg.syncInterval}
                  onChange={(e) => patch('syncInterval', Number(e.target.value))}
                  style={{ ...inputStyle, cursor: 'pointer' }}
                >
                  <option value={0}>Manual only</option>
                  <option value={5}>Every 5 minutes</option>
                  <option value={10}>Every 10 minutes</option>
                  <option value={15}>Every 15 minutes</option>
                  <option value={30}>Every 30 minutes</option>
                </select>
              </div>
              <div>
                <span style={labelStyle}>
                  CORS Proxy URL
                  <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--green)', fontWeight: 400 }}>leave empty if using the Chrome extension</span>
                </span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    style={{ ...inputStyle, flex: 1 }}
                    placeholder="https://your-worker.workers.dev/?url="
                    value={cfg.proxyUrl}
                    onChange={(e) => patch('proxyUrl', e.target.value)}
                  />
                  {cfg.proxyUrl && (
                    <button
                      onClick={() => patch('proxyUrl', '')}
                      style={{ padding: '0 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text3)', cursor: 'pointer', fontSize: 11, flexShrink: 0 }}
                    >Clear</button>
                  )}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 4 }}>
                  Only needed without the Jira Bridge Chrome extension.
                </div>
              </div>
            </div>
          </div>

          {/* developer mapping */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text2)', marginBottom: 10, paddingBottom: 5, borderBottom: '1px solid var(--border)' }}>
              Developer → Jira email mapping
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {devList.map((d) => (
                <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: d.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: 'var(--text)', width: 130, flexShrink: 0 }}>{d.name}</span>
                  <input
                    style={{ ...inputStyle, flex: 1 }}
                    placeholder="jira-email@company.com"
                    value={jiraEmails[d.id] ?? ''}
                    onChange={(e) => setJiraEmails((m) => ({ ...m, [d.id]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* manual sync */}
          {cfg.lastSyncResult && (
            <div style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--mono)' }}>
              Last result: {cfg.lastSyncResult}
            </div>
          )}
          {syncResult && (
            <div style={{ fontSize: 11, padding: '6px 10px', borderRadius: 6, background: syncResult.startsWith('✓') ? '#dcfce7' : '#fee2e2', color: syncResult.startsWith('✓') ? '#15803d' : '#b91c1c', fontFamily: 'var(--mono)' }}>
              {syncResult}
            </div>
          )}
        </div>

        {/* footer */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '12px 18px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
          <button
            onClick={handleSyncNow}
            disabled={syncing || !jiraConfig.enabled || !jiraConfig.baseUrl || !jiraConfig.token}
            style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text2)', fontFamily: 'var(--mono)', fontSize: 11, padding: '6px 14px', borderRadius: 6, cursor: 'pointer', opacity: !jiraConfig.enabled ? 0.4 : 1 }}
          >
            {syncing ? '⟳ Syncing…' : '⟳ Sync now'}
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text2)', fontFamily: 'var(--mono)', fontSize: 12, padding: '6px 16px', borderRadius: 7, cursor: 'pointer' }}>
              Cancel
            </button>
            <button
              onClick={save}
              style={{ background: 'var(--accent)', border: '1px solid var(--accent)', color: '#fff', fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 600, padding: '6px 18px', borderRadius: 7, cursor: 'pointer' }}
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
