import { useState } from 'react'
import { useStore } from '../../store'
import type { GitLabConfig } from '../../types'
import { fetchGroupMRs, normalizeGroupPath } from '../../utils/gitlab-api'
import { jiraDedupeKey } from '../../utils/format'
import Modal from '../ui/Modal'

interface Props { onClose: () => void }

const inputStyle: React.CSSProperties = {
  background: 'var(--surface3)', border: '1px solid var(--border)', color: 'var(--text)',
  padding: '6px 10px', borderRadius: 6, outline: 'none', width: '100%', fontSize: 12,
  fontFamily: 'var(--mono)',
}
const labelStyle: React.CSSProperties = {
  fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.7px',
  marginBottom: 4, display: 'block',
}

export default function GitLabConfigModal({ onClose }: Props) {
  const { gitlabConfig, developers, setGitlabConfig, syncGitlab } = useStore()

  const [cfg, setCfg] = useState<GitLabConfig>({ ...gitlabConfig })
  const [showToken, setShowToken] = useState(false)
  const [gitlabUsernames, setGitlabUsernames] = useState<Record<string, string>>(
    Object.fromEntries(developers.map((d) => [d.id, d.gitlabUsername ?? ''])),
  )
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<string | null>(null)

  function patch(key: keyof GitLabConfig, value: unknown) {
    setCfg((c) => ({ ...c, [key]: value }))
  }

  function formatGitlabError(msg: string): string {
    if (msg.includes('401')) return 'Token expired or invalid — create a new one at gitlab.com/-/user_settings/personal_access_tokens with read_api scope, then paste it here and save.'
    if (msg.includes('403')) return 'Access denied (403) — your GitLab role (e.g. Planner) cannot list group MRs. Sync will automatically fall back to per-developer fetch if GitLab usernames are configured in settings.'
    if (msg.includes('404')) return 'Not found (404) — check the group/project path.'
    return msg
  }

  async function testConnection() {
    setTesting(true)
    setTestResult(null)
    try {
      const testCfg: GitLabConfig = { ...cfg, token: cfg.token.trim(), groupPath: cfg.groupPath.trim() }
      const mrs = await fetchGroupMRs(testCfg)
      setTestResult({ ok: true, msg: `Connection successful ✓ — ${mrs.length} MR${mrs.length !== 1 ? 's' : ''} found` })
    } catch (err) {
      setTestResult({ ok: false, msg: formatGitlabError((err as Error).message) })
    }
    setTesting(false)
  }

  function persist() {
    setGitlabConfig({ ...cfg, token: cfg.token.trim(), groupPath: cfg.groupPath.trim() })
    useStore.setState((s) => ({
      developers: s.developers.map((d) => ({
        ...d,
        gitlabUsername: gitlabUsernames[d.id]?.trim() || undefined,
      })),
    }))
  }

  function save() {
    persist()
    onClose()
  }

  async function handleSyncNow() {
    // Persist (so the sync uses the freshly entered config) but keep the modal
    // open so the result message is visible.
    persist()
    setSyncing(true)
    setSyncResult(null)
    try {
      const r = await syncGitlab()

      // Extract individual Jira keys from the "!iid [KEY1,KEY2]" format in noIssueList
      const untrackedKeys = new Set<string>()
      r.noIssueList.forEach((entry) => {
        const m = entry.match(/\[([^\]]+)\]/)
        if (m) m[1].split(',').forEach((k) => untrackedKeys.add(k.trim()))
      })

      // Collect which keys are currently in the tracker (have a Jira-formatted URL or name)
      const trackedKeys = new Set<string>()
      useStore.getState().tasks.flatMap((t) => t.jiras ?? []).forEach((j) => {
        const k = jiraDedupeKey(j.url, j.name)
        if (k && k !== 'name:' && /^[A-Z][A-Z0-9]+-\d+$/.test(k)) trackedKeys.add(k)
      })

      let msg = `✓ Synced — ${r.linked} linked, ${r.updated} already tracked`
      if (r.noKey) msg += `\n${r.noKey} MR${r.noKey !== 1 ? 's' : ''} had no Jira key in branch/title`
      if (r.noIssue > 0) {
        const keyList = [...untrackedKeys].slice(0, 8).join(', ')
        msg += `\n⚠ ${r.noIssue} MR${r.noIssue !== 1 ? 's' : ''} reference keys not in tracker: ${keyList}${untrackedKeys.size > 8 ? '…' : ''}`
        if (trackedKeys.size > 0) {
          const tracked = [...trackedKeys].slice(0, 6).join(', ')
          msg += `\n   Tracker has: ${tracked}${trackedKeys.size > 6 ? '…' : ''}`
          msg += `\n   → The two lists must overlap for auto-linking to work`
        } else {
          msg += `\n   No Jira keys found in tracker — add a Jira URL (e.g. https://…/browse/MONE-957) to each issue`
        }
      }
      setSyncResult(msg)
    } catch (err) {
      setSyncResult(`✗ ${formatGitlabError((err as Error).message)}`)
    }
    setSyncing(false)
  }

  const lastSync = cfg.lastSync
    ? new Date(cfg.lastSync).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : 'Never'

  return (
    <Modal
      title="🦊 GitLab Integration"
      width={520}
      zIndex={1000}
      onClose={onClose}
      bodyStyle={{ display: 'flex', flexDirection: 'column', gap: 18 }}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save}>Save</button>
        </>
      }
    >
      <>

          {/* enable */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: cfg.enabled ? 'var(--accent-dim)' : 'var(--surface2)', borderRadius: 8, border: `1px solid ${cfg.enabled ? 'var(--accent)' : 'var(--border)'}` }}>
            <input type="checkbox" id="gl-enabled" checked={cfg.enabled} onChange={(e) => patch('enabled', e.target.checked)} style={{ width: 16, height: 16, cursor: 'pointer' }} />
            <label htmlFor="gl-enabled" style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', cursor: 'pointer' }}>Enable GitLab MR sync</label>
            {cfg.lastSync && (
              <span style={{ marginLeft: 'auto', fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)' }}>Last sync: {lastSync}</span>
            )}
          </div>

          {/* connection */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text2)', marginBottom: 10, paddingBottom: 5, borderBottom: '1px solid var(--border)' }}>Connection</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div>
                <span style={labelStyle}>Group / Subgroup path</span>
                <input style={inputStyle} placeholder="mycompany or mycompany/subgroup" value={cfg.groupPath} onChange={(e) => patch('groupPath', e.target.value)} />
                {(() => {
                  const norm = normalizeGroupPath(cfg.groupPath)
                  if (!norm) return <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 3 }}>The path in the GitLab URL: gitlab.com/<b>mycompany</b></div>
                  return <div style={{ fontSize: 10, marginTop: 3, fontFamily: 'var(--mono)', color: norm !== cfg.groupPath.trim() ? '#f97316' : 'var(--text3)' }}>Will use: <b>{norm}</b></div>
                })()}
              </div>
              <div>
                <span style={labelStyle}>
                  Personal Access Token
                  <a href="https://gitlab.com/-/user_settings/personal_access_tokens" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', textDecoration: 'none', marginLeft: 4 }}>↗ create</a>
                </span>
                <div style={{ position: 'relative' }}>
                  <input
                    style={{ ...inputStyle, paddingRight: 32 }}
                    type={showToken ? 'text' : 'password'}
                    placeholder="glpat-xxxxxxxxxxxxxxxxxxxx"
                    value={cfg.token}
                    onChange={(e) => patch('token', e.target.value)}
                  />
                  <button onClick={() => setShowToken((s) => !s)} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', fontSize: 13 }}>
                    {showToken ? '🙈' : '👁'}
                  </button>
                </div>
                <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 3 }}>Needs <code>read_api</code> scope · tokens expire after 1 year — if you get 401, create a new one</div>
              </div>

              {/* test result */}
              {testResult && (
                <div style={{ padding: '8px 12px', borderRadius: 6, background: testResult.ok ? '#16a34a18' : '#dc262618', border: `1px solid ${testResult.ok ? '#16a34a50' : '#dc262650'}`, fontSize: 12, color: testResult.ok ? 'var(--green)' : 'var(--red)', fontFamily: 'var(--mono)' }}>
                  {testResult.msg}
                </div>
              )}

              <button
                onClick={testConnection}
                disabled={testing || !cfg.token || !cfg.groupPath}
                style={{ alignSelf: 'flex-start', padding: '6px 14px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text2)', fontSize: 12, cursor: 'pointer', fontFamily: 'var(--mono)' }}
              >
                {testing ? 'Testing…' : 'Test connection'}
              </button>
            </div>
          </div>

          {/* sync settings */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text2)', marginBottom: 10, paddingBottom: 5, borderBottom: '1px solid var(--border)' }}>Sync settings</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div>
                <span style={labelStyle}>Auto-sync interval</span>
                <select value={cfg.syncInterval} onChange={(e) => patch('syncInterval', Number(e.target.value))} style={{ ...inputStyle, cursor: 'pointer' }}>
                  <option value={0}>Manual only</option>
                  <option value={2}>Every 2 minutes</option>
                  <option value={5}>Every 5 minutes</option>
                  <option value={10}>Every 10 minutes</option>
                  <option value={15}>Every 15 minutes</option>
                  <option value={30}>Every 30 minutes</option>
                </select>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  onClick={handleSyncNow}
                  disabled={syncing || !cfg.token || !cfg.groupPath}
                  style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid var(--accent)', background: 'var(--accent-dim)', color: 'var(--accent)', fontSize: 12, cursor: 'pointer', fontFamily: 'var(--mono)', fontWeight: 600 }}
                >
                  {syncing ? 'Syncing…' : 'Sync now'}
                </button>
                {syncResult && <span style={{ fontSize: 11, fontFamily: 'var(--mono)', whiteSpace: 'pre-line', color: syncResult.startsWith('✓') ? 'var(--green)' : 'var(--red)' }}>{syncResult}</span>}
              </div>
              {cfg.lastSyncResult && !syncResult && (
                <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--text3)' }}>Last result: {cfg.lastSyncResult}</div>
              )}
            </div>
          </div>

          {/* developer mapping */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text2)', marginBottom: 10, paddingBottom: 5, borderBottom: '1px solid var(--border)' }}>
              Developer → GitLab username
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {developers.filter((d) => !d.archivedAt).map((d) => (
                <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: d.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: 'var(--text2)', width: 130, flexShrink: 0 }}>{d.name}</span>
                  <input
                    style={{ ...inputStyle, flex: 1 }}
                    placeholder="gitlab-username"
                    value={gitlabUsernames[d.id] ?? ''}
                    onChange={(e) => setGitlabUsernames((prev) => ({ ...prev, [d.id]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
          </div>
      </>
    </Modal>
  )
}
