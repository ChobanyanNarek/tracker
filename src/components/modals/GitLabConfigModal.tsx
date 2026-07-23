import { useState } from 'react'
import { useStore } from '../../store'
import type { GitLabConfig } from '../../types'
import { fetchGroupMRs, normalizeGroupPath } from '../../utils/gitlab-api'
import { jiraDedupeKey } from '../../utils/format'
import { formatDateTime } from '../../utils/dates'
import Modal from '../ui/Modal'

interface Props { onClose: () => void; projectId?: string }

const inputStyle: React.CSSProperties = {
  background: 'var(--surface3)', border: '1px solid var(--border)', color: 'var(--text)',
  padding: '6px 10px', borderRadius: 6, outline: 'none', width: '100%', fontSize: 12,
  fontFamily: 'var(--mono)',
}
const labelStyle: React.CSSProperties = {
  fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.7px',
  marginBottom: 4, display: 'block',
}

function makeEmptyConn(projectId?: string): GitLabConfig {
  return {
    id: 'gl_' + Date.now().toString(36),
    name: '',
    enabled: true,
    token: '',
    groupPath: '',
    syncInterval: 0,
    developerUsernames: {},
    ...(projectId ? { projectId } : {}),
  }
}

interface ConnFormProps {
  conn: GitLabConfig
  developers: import('../../types').Developer[]
  onChange: (c: GitLabConfig) => void
  onDelete: () => void
  isOnly: boolean
}

function ConnForm({ conn, developers, onChange, onDelete, isOnly }: ConnFormProps) {
  const [showToken, setShowToken] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)

  function patch<K extends keyof GitLabConfig>(key: K, value: GitLabConfig[K]) {
    onChange({ ...conn, [key]: value })
  }

  function addDev(devId: string) {
    onChange({ ...conn, developerUsernames: { ...(conn.developerUsernames ?? {}), [devId]: '' } })
  }

  function removeDev(devId: string) {
    const usernames = { ...(conn.developerUsernames ?? {}) }
    delete usernames[devId]
    onChange({ ...conn, developerUsernames: usernames })
  }

  function setDevUsername(devId: string, username: string) {
    onChange({ ...conn, developerUsernames: { ...(conn.developerUsernames ?? {}), [devId]: username } })
  }

  function formatGitlabError(msg: string): string {
    if (msg.includes('401')) return 'Token expired or invalid — create a new one at gitlab.com/-/user_settings/personal_access_tokens with read_api scope.'
    if (msg.includes('403')) return 'Access denied (403) — your GitLab role cannot list group MRs. Sync will fall back to per-developer fetch if usernames are configured.'
    if (msg.includes('404')) return 'Not found (404) — check the group/project path.'
    return msg
  }

  async function testConnection() {
    setTesting(true)
    setTestResult(null)
    try {
      const testCfg: GitLabConfig = { ...conn, token: conn.token.trim(), groupPath: conn.groupPath.trim() }
      const mrs = await fetchGroupMRs(testCfg)
      setTestResult({ ok: true, msg: `Connection successful ✓ — ${mrs.length} MR${mrs.length !== 1 ? 's' : ''} found` })
    } catch (err) {
      setTestResult({ ok: false, msg: formatGitlabError((err as Error).message) })
    }
    setTesting(false)
  }

  const norm = normalizeGroupPath(conn.groupPath)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 14px', background: 'var(--surface2)', borderRadius: 8, border: '1px solid var(--border)' }}>
      {/* header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          style={{ ...inputStyle, flex: 1, fontWeight: 600 }}
          placeholder="Connection name (e.g. Main Group, Team A)"
          value={conn.name}
          onChange={(e) => patch('name', e.target.value)}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', flexShrink: 0 }}>
          <input type="checkbox" checked={conn.enabled} onChange={(e) => patch('enabled', e.target.checked)} style={{ width: 14, height: 14 }} />
          <span style={{ fontSize: 11, color: 'var(--text2)' }}>Enabled</span>
        </label>
        {!isOnly && (
          <button
            onClick={onDelete}
            title="Remove connection"
            style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text3)', borderRadius: 5, padding: '3px 8px', cursor: 'pointer', fontSize: 12, flexShrink: 0 }}
          >✕</button>
        )}
      </div>

      {/* group path */}
      <div>
        <span style={labelStyle}>Group / Subgroup path</span>
        <input style={inputStyle} placeholder="mycompany or mycompany/subgroup" value={conn.groupPath} onChange={(e) => patch('groupPath', e.target.value)} />
        {conn.groupPath.trim()
          ? <div style={{ fontSize: 10, marginTop: 3, fontFamily: 'var(--mono)', color: norm !== conn.groupPath.trim() ? '#f97316' : 'var(--text3)' }}>Will use: <b>{norm}</b></div>
          : <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 3 }}>The path in the GitLab URL: gitlab.com/<b>mycompany</b></div>
        }
      </div>

      {/* token */}
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
            value={conn.token}
            onChange={(e) => patch('token', e.target.value)}
          />
          <button onClick={() => setShowToken((s) => !s)} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--text3)' }}>
            {showToken ? '🙈' : '👁'}
          </button>
        </div>
        <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 3 }}>Needs <code>read_api</code> scope · tokens expire after 1 year — if you get 401, create a new one</div>
      </div>

      {/* sync interval */}
      <div>
        <span style={labelStyle}>Auto-sync</span>
        <select value={conn.syncInterval} onChange={(e) => patch('syncInterval', Number(e.target.value))} style={{ ...inputStyle, cursor: 'pointer' }}>
          <option value={0}>Manual only</option>
          <option value={2}>Every 2 min</option>
          <option value={5}>Every 5 min</option>
          <option value={10}>Every 10 min</option>
          <option value={15}>Every 15 min</option>
          <option value={30}>Every 30 min</option>
        </select>
      </div>

      {/* test result + button */}
      {testResult && (
        <div style={{ fontSize: 11, padding: '7px 10px', borderRadius: 6, background: testResult.ok ? '#dcfce7' : '#fee2e2', color: testResult.ok ? '#15803d' : '#b91c1c', border: `1px solid ${testResult.ok ? '#86efac' : '#fca5a5'}`, fontFamily: 'var(--mono)' }}>
          {testResult.msg}
        </div>
      )}
      <button
        onClick={testConnection}
        disabled={testing || !conn.token || !conn.groupPath}
        style={{ alignSelf: 'flex-start', background: 'var(--surface3)', border: '1px solid var(--border)', color: 'var(--text2)', fontFamily: 'var(--mono)', fontSize: 11, padding: '5px 12px', borderRadius: 6, cursor: 'pointer', opacity: !conn.token || !conn.groupPath ? 0.5 : 1 }}
      >
        {testing ? '…testing' : 'Test connection'}
      </button>

      {conn.lastSync && (
        <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--mono)' }}>
          Last sync: {formatDateTime(conn.lastSync)}
          {conn.lastSyncResult ? ` — ${conn.lastSyncResult}` : ''}
        </div>
      )}

      {developers.length > 0 && (
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
          <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.7px', marginBottom: 8 }}>Developers in this connection</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {developers.filter((d) => d.id in (conn.developerUsernames ?? {})).map((d) => (
              <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: d.color, flexShrink: 0 }} />
                <span style={{ fontSize: 12, color: 'var(--text)', width: 110, flexShrink: 0 }}>{d.name}</span>
                <input
                  style={{ ...inputStyle, flex: 1 }}
                  placeholder="gitlab-username"
                  value={conn.developerUsernames?.[d.id] ?? ''}
                  onChange={(e) => setDevUsername(d.id, e.target.value)}
                  autoFocus={conn.developerUsernames?.[d.id] === ''}
                />
                <button onClick={() => removeDev(d.id)} style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: 13, padding: '0 2px', flexShrink: 0 }}>✕</button>
              </div>
            ))}
            {developers.some((d) => !(d.id in (conn.developerUsernames ?? {}))) && (
              <select
                value=""
                onChange={(e) => { if (e.target.value) addDev(e.target.value) }}
                style={{ ...inputStyle, color: 'var(--text3)', cursor: 'pointer' }}
              >
                <option value="">+ Add developer…</option>
                {developers.filter((d) => !(d.id in (conn.developerUsernames ?? {}))).map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default function GitLabConfigModal({ onClose, projectId }: Props) {
  const { gitlabConnections, developers, setGitlabConnections, syncGitlab } = useStore()

  const filteredConns = projectId ? gitlabConnections.filter((c) => c.projectId === projectId) : gitlabConnections
  const [conns, setConns] = useState<GitLabConfig[]>(
    filteredConns.length ? filteredConns : [makeEmptyConn(projectId)]
  )
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<string | null>(null)

  function updateConn(idx: number, c: GitLabConfig) {
    setConns((prev) => prev.map((x, i) => (i === idx ? c : x)))
  }

  function addConn() {
    setConns((prev) => [...prev, makeEmptyConn(projectId)])
  }

  function removeConn(idx: number) {
    setConns((prev) => prev.filter((_, i) => i !== idx))
  }

  function save() {
    if (projectId) {
      const others = gitlabConnections.filter((c) => c.projectId !== projectId)
      setGitlabConnections([...others, ...conns])
    } else {
      setGitlabConnections(conns)
    }
    onClose()
  }

  async function handleSyncNow() {
    if (projectId) {
      const others = gitlabConnections.filter((c) => c.projectId !== projectId)
      setGitlabConnections([...others, ...conns])
    } else {
      setGitlabConnections(conns)
    }
    setSyncing(true)
    setSyncResult(null)
    try {
      const r = await syncGitlab()

      const untrackedKeys = new Set<string>()
      r.noIssueList.forEach((entry) => {
        const m = entry.match(/\[([^\]]+)\]/)
        if (m) m[1].split(',').forEach((k) => untrackedKeys.add(k.trim()))
      })

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
      setConns(useStore.getState().gitlabConnections)
    } catch (err) {
      const msg = (err as Error).message
      let friendly = msg
      if (msg.includes('401')) friendly = 'Token expired or invalid — create a new one with read_api scope.'
      else if (msg.includes('403')) friendly = 'Access denied (403) — configure developer usernames for per-developer fallback.'
      else if (msg.includes('404')) friendly = 'Not found (404) — check the group/project path.'
      setSyncResult(`✗ ${friendly}`)
    }
    setSyncing(false)
  }

  const anyEnabled = conns.some((c) => c.enabled && c.token && c.groupPath)

  return (
    <Modal
      title="🦊 GitLab Connections"
      zIndex={1000}
      onClose={onClose}
      bodyStyle={{ display: 'flex', flexDirection: 'column', gap: 16 }}
      footer={
        <>
          <button
            className="btn-secondary"
            style={{ marginRight: 'auto', fontFamily: 'var(--mono)', opacity: !anyEnabled ? 0.4 : 1 }}
            onClick={handleSyncNow}
            disabled={syncing || !anyEnabled}
          >
            {syncing ? '⟳ Syncing…' : '⟳ Sync now'}
          </button>
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save}>Save</button>
        </>
      }
    >
      <>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {conns.map((c, i) => (
            <ConnForm
              key={c.id}
              conn={c}
              developers={developers.filter((d) => !d.archivedAt)}
              onChange={(updated) => updateConn(i, updated)}
              onDelete={() => removeConn(i)}
              isOnly={conns.length === 1}
            />
          ))}
        </div>

        <button
          onClick={addConn}
          style={{ alignSelf: 'flex-start', background: 'var(--surface2)', border: '1px dashed var(--border)', color: 'var(--text2)', fontFamily: 'var(--mono)', fontSize: 11, padding: '6px 14px', borderRadius: 6, cursor: 'pointer' }}
        >
          + Add connection
        </button>

        {syncResult && (
          <div style={{ fontSize: 11, padding: '7px 11px', borderRadius: 6, background: syncResult.startsWith('✓') ? '#dcfce7' : '#fee2e2', color: syncResult.startsWith('✓') ? '#15803d' : '#b91c1c', fontFamily: 'var(--mono)', whiteSpace: 'pre-wrap' }}>
            {syncResult}
          </div>
        )}
      </>
    </Modal>
  )
}
