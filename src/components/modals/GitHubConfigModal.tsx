import { useState } from 'react'
import { useStore } from '../../store'
import type { GitHubConfig } from '../../types'
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

function makeEmptyConn(): GitHubConfig {
  return {
    id: 'gh_' + Date.now().toString(36),
    name: '',
    enabled: true,
    token: '',
    orgOrUser: '',
    syncInterval: 0,
    developerUsernames: {},
  }
}

interface ConnFormProps {
  conn: GitHubConfig
  developers: import('../../types').Developer[]
  onChange: (c: GitHubConfig) => void
  onDelete: () => void
  isOnly: boolean
}

function ConnForm({ conn, developers, onChange, onDelete, isOnly }: ConnFormProps) {
  const [showToken, setShowToken] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)

  function patch<K extends keyof GitHubConfig>(key: K, value: GitHubConfig[K]) {
    onChange({ ...conn, [key]: value })
  }

  function toggleDev(devId: string, selected: boolean) {
    const usernames = { ...(conn.developerUsernames ?? {}) }
    if (selected) usernames[devId] = usernames[devId] ?? ''
    else delete usernames[devId]
    onChange({ ...conn, developerUsernames: usernames })
  }

  function setDevUsername(devId: string, username: string) {
    onChange({ ...conn, developerUsernames: { ...(conn.developerUsernames ?? {}), [devId]: username } })
  }

  async function testConnection() {
    setTesting(true)
    setTestResult(null)
    try {
      const res = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${conn.token.trim()}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`GitHub ${res.status}: ${text.slice(0, 200) || res.statusText}`)
      }
      const data = (await res.json()) as { login: string }
      setTestResult({ ok: true, msg: `Connection successful ✓ — authenticated as ${data.login}` })
    } catch (err) {
      const msg = (err as Error).message
      const friendly = msg.includes('401') ? 'Invalid token — create a PAT at github.com/settings/tokens with repo scope.' : msg
      setTestResult({ ok: false, msg: friendly })
    }
    setTesting(false)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 14px', background: 'var(--surface2)', borderRadius: 8, border: '1px solid var(--border)' }}>
      {/* header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          style={{ ...inputStyle, flex: 1, fontWeight: 600 }}
          placeholder="Connection name (e.g. Main, Mobile Team)"
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

      {/* token */}
      <div>
        <span style={labelStyle}>
          Personal Access Token (PAT)
          <a href="https://github.com/settings/tokens" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', textDecoration: 'none', marginLeft: 4 }}>↗ create</a>
        </span>
        <div style={{ position: 'relative' }}>
          <input
            style={{ ...inputStyle, paddingRight: 32 }}
            type={showToken ? 'text' : 'password'}
            placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
            value={conn.token}
            onChange={(e) => patch('token', e.target.value)}
          />
          <button onClick={() => setShowToken((s) => !s)} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--text3)' }}>
            {showToken ? '🙈' : '👁'}
          </button>
        </div>
        <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 3 }}>Needs <code>repo</code> (or <code>public_repo</code>) scope for PR search</div>
      </div>

      {/* org or user + sync interval */}
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 2 }}>
          <span style={labelStyle}>Org or user (optional, for scoping)</span>
          <input style={inputStyle} placeholder="mycompany" value={conn.orgOrUser} onChange={(e) => patch('orgOrUser', e.target.value)} />
          <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 3 }}>Restricts PR search to this GitHub org</div>
        </div>
        <div style={{ flex: 1 }}>
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
      </div>

      {/* test result + button */}
      {testResult && (
        <div style={{ fontSize: 11, padding: '7px 10px', borderRadius: 6, background: testResult.ok ? '#dcfce7' : '#fee2e2', color: testResult.ok ? '#15803d' : '#b91c1c', border: `1px solid ${testResult.ok ? '#86efac' : '#fca5a5'}`, fontFamily: 'var(--mono)' }}>
          {testResult.msg}
        </div>
      )}
      <button
        onClick={testConnection}
        disabled={testing || !conn.token}
        style={{ alignSelf: 'flex-start', background: 'var(--surface3)', border: '1px solid var(--border)', color: 'var(--text2)', fontFamily: 'var(--mono)', fontSize: 11, padding: '5px 12px', borderRadius: 6, cursor: 'pointer', opacity: !conn.token ? 0.5 : 1 }}
      >
        {testing ? '…testing' : 'Test connection'}
      </button>

      {conn.lastSync && (
        <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--mono)' }}>
          Last sync: {new Date(conn.lastSync).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
          {conn.lastSyncResult ? ` — ${conn.lastSyncResult}` : ''}
        </div>
      )}

      {developers.length > 0 && (
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
          <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.7px', marginBottom: 8 }}>Developers in this connection</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {developers.map((d) => {
              const selected = d.id in (conn.developerUsernames ?? {})
              return (
                <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="checkbox" checked={selected} onChange={(e) => toggleDev(d.id, e.target.checked)} style={{ width: 13, height: 13, flexShrink: 0, cursor: 'pointer' }} />
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: d.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: selected ? 'var(--text)' : 'var(--text3)', width: 110, flexShrink: 0 }}>{d.name}</span>
                  {selected && (
                    <input
                      style={{ ...inputStyle, flex: 1 }}
                      placeholder="github-username"
                      value={conn.developerUsernames?.[d.id] ?? ''}
                      onChange={(e) => setDevUsername(d.id, e.target.value)}
                      autoFocus={!conn.developerUsernames?.[d.id]}
                    />
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

export default function GitHubConfigModal({ onClose }: Props) {
  const { githubConnections, developers, setGithubConnections, syncGithub } = useStore()

  const [conns, setConns] = useState<GitHubConfig[]>(
    githubConnections.length ? githubConnections : [makeEmptyConn()]
  )
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<string | null>(null)

  function updateConn(idx: number, c: GitHubConfig) {
    setConns((prev) => prev.map((x, i) => (i === idx ? c : x)))
  }

  function addConn() {
    setConns((prev) => [...prev, makeEmptyConn()])
  }

  function removeConn(idx: number) {
    setConns((prev) => prev.filter((_, i) => i !== idx))
  }

  function save() {
    setGithubConnections(conns)
    onClose()
  }

  async function handleSyncNow() {
    setGithubConnections(conns)
    setSyncing(true)
    setSyncResult(null)
    try {
      const { linked, updated } = await syncGithub()
      setSyncResult(`✓ Synced — ${linked} linked, ${updated} already tracked`)
      setConns(useStore.getState().githubConnections)
    } catch (err) {
      setSyncResult(`✗ ${(err as Error).message}`)
    }
    setSyncing(false)
  }

  const anyEnabled = conns.some((c) => c.enabled && c.token)

  return (
    <Modal
      title="🐙 GitHub Connections"
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
