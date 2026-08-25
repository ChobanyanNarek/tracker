import { useState } from 'react'
import { useStore } from '../../store'
import type { GitHubConfig } from '../../types'
import { normalizeGithubPath } from '../../utils/github-api'
import { formatDateTime } from '../../utils/dates'
import Modal from '../ui/Modal'
import Icon, { BrandIcon } from '../ui/Icon'

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

function makeEmptyConn(projectId?: string): GitHubConfig {
  return {
    id: 'gh_' + Date.now().toString(36),
    name: '',
    enabled: true,
    token: '',
    orgOrUser: '',
    syncInterval: 0,
    developerUsernames: {},
    ...(projectId ? { projectId } : {}),
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

  function formatGithubError(msg: string): string {
    if (msg.includes('401')) return 'Token expired or invalid — create a new one at github.com/settings/tokens with repo scope.'
    if (msg.includes('403')) return 'Access denied (403) — your token cannot list org repos. Sync will fall back to per-developer fetch if usernames are configured.'
    if (msg.includes('404') || msg.includes('neither a readable')) return 'Not found — check the org / user name.'
    return msg
  }

  async function testConnection() {
    setTesting(true)
    setTestResult(null)
    try {
      const { owner, repo: singleRepo } = normalizeGithubPath(conn.orgOrUser.trim())
      const headers = {
        Authorization: `Bearer ${conn.token.trim()}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      }
      if (singleRepo) {
        // Single repo — verify it exists and count open PRs
        const res = await fetch(`https://api.github.com/repos/${singleRepo}/pulls?state=open&per_page=1`, { headers })
        if (!res.ok) throw new Error(`GitHub ${res.status}: ${await res.text().catch(() => res.statusText)}`)
        setTestResult({ ok: true, msg: `Connection successful ✓ — repo ${singleRepo} is accessible` })
      } else {
        // Org/user — list repos
        let repos: string[] = []
        for (const scope of ['orgs', 'users'] as const) {
          const res = await fetch(`https://api.github.com/${scope}/${encodeURIComponent(owner)}/repos?type=all&per_page=100`, { headers })
          if (!res.ok) continue
          const batch = await res.json() as { full_name: string }[]
          repos = batch.map((r) => r.full_name)
          if (repos.length) break
        }
        if (!repos.length) {
          setTestResult({ ok: false, msg: `Token can see 0 repos under "${owner}". The token needs full "repo" scope (not just public_repo) to access private org repos. Go to github.com/settings/tokens and regenerate with repo scope.` })
        } else {
          setTestResult({ ok: true, msg: `Connection successful ✓ — ${repos.length} repo${repos.length !== 1 ? 's' : ''} found under ${owner}` })
        }
      }
    } catch (err) {
      setTestResult({ ok: false, msg: formatGithubError((err as Error).message) })
    }
    setTesting(false)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 14px', background: 'var(--surface2)', borderRadius: 8, border: '1px solid var(--border)' }}>
      {/* header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          style={{ ...inputStyle, flex: 1, fontWeight: 600 }}
          placeholder="Connection name (e.g. Main Org, Mobile Team)"
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
            style={{ display: 'inline-flex', alignItems: 'center', background: 'none', border: '1px solid var(--border)', color: 'var(--text3)', borderRadius: 'var(--r)', padding: '5px', cursor: 'pointer', flexShrink: 0 }}
          ><Icon name="close" size={12} /></button>
        )}
      </div>

      {/* org / repo path */}
      <div>
        <span style={labelStyle}>Org or Repo URL</span>
        <input style={inputStyle} placeholder="https://github.com/mycompany or mycompany/myrepo" value={conn.orgOrUser} onChange={(e) => patch('orgOrUser', e.target.value)} />
        {conn.orgOrUser.trim() ? (() => {
          const { owner, repo } = normalizeGithubPath(conn.orgOrUser)
          const normalized = repo ?? owner
          const isFullUrl = conn.orgOrUser.trim().toLowerCase().startsWith('http')
          return (
            <div style={{ fontSize: 10, marginTop: 3, fontFamily: 'var(--mono)', color: isFullUrl ? 'var(--orange)' : 'var(--text3)' }}>
              Will use: <b>{normalized}</b> — {repo ? 'single repo' : 'all repos in org/user'}
            </div>
          )
        })()
          : <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 3 }}>Paste the GitHub org or repo URL, e.g. <b>https://github.com/mycompany</b></div>
        }
      </div>

      {/* token */}
      <div>
        <span style={labelStyle}>
          Personal Access Token (PAT)
          <a href="https://github.com/settings/tokens" target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 2, color: 'var(--accent)', textDecoration: 'none', marginLeft: 4 }}><Icon name="external" size={11} />create</a>
        </span>
        <div style={{ position: 'relative' }}>
          <input
            style={{ ...inputStyle, paddingRight: 32 }}
            type={showToken ? 'text' : 'password'}
            placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
            value={conn.token}
            onChange={(e) => patch('token', e.target.value)}
          />
          <button onClick={() => setShowToken((s) => !s)} title={showToken ? 'Hide token' : 'Show token'} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', display: 'flex', alignItems: 'center' }}>
            <Icon name={showToken ? 'eye-off' : 'eye'} size={14} />
          </button>
        </div>
        <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 3 }}>Needs <code>repo</code> (or <code>public_repo</code>) scope · if you get 401, create a new token</div>
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
        <div style={{ fontSize: 11, padding: '7px 10px', borderRadius: 6, background: testResult.ok ? 'var(--green-dim)' : 'var(--red-dim)', color: testResult.ok ? 'var(--green)' : 'var(--red)', border: `1px solid ${testResult.ok ? 'var(--green-border)' : 'var(--red-border)'}`, fontFamily: 'var(--mono)' }}>
          {testResult.msg}
        </div>
      )}
      <button
        onClick={testConnection}
        disabled={testing || !conn.token || !conn.orgOrUser}
        style={{ alignSelf: 'flex-start', background: 'var(--surface3)', border: '1px solid var(--border)', color: 'var(--text2)', fontFamily: 'var(--mono)', fontSize: 11, padding: '5px 12px', borderRadius: 6, cursor: 'pointer', opacity: !conn.token || !conn.orgOrUser ? 0.5 : 1 }}
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
                  placeholder="github-username"
                  value={conn.developerUsernames?.[d.id] ?? ''}
                  onChange={(e) => setDevUsername(d.id, e.target.value)}
                  autoFocus={conn.developerUsernames?.[d.id] === ''}
                />
                <button onClick={() => removeDev(d.id)} title="Remove" style={{ display: 'inline-flex', background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', padding: '0 2px', flexShrink: 0 }}><Icon name="close" size={13} /></button>
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

export default function GitHubConfigModal({ onClose, projectId }: Props) {
  const { githubConnections, developers, setGithubConnections, syncGithub } = useStore()

  const filteredConns = projectId ? githubConnections.filter((c) => c.projectId === projectId) : githubConnections
  const [conns, setConns] = useState<GitHubConfig[]>(
    filteredConns.length ? filteredConns : [makeEmptyConn(projectId)]
  )
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<string | null>(null)

  function updateConn(idx: number, c: GitHubConfig) {
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
      const others = githubConnections.filter((c) => c.projectId !== projectId)
      setGithubConnections([...others, ...conns])
    } else {
      setGithubConnections(conns)
    }
    onClose()
  }

  async function handleSyncNow() {
    if (projectId) {
      const others = githubConnections.filter((c) => c.projectId !== projectId)
      setGithubConnections([...others, ...conns])
    } else {
      setGithubConnections(conns)
    }
    setSyncing(true)
    setSyncResult(null)
    try {
      const r = await syncGithub()
      setSyncResult(`✓ Synced — ${r.linked} linked, ${r.updated} already tracked`)
      setConns(useStore.getState().githubConnections)
    } catch (err) {
      const msg = (err as Error).message
      let friendly = msg
      if (msg.includes('401')) friendly = 'Token expired or invalid — create a new one with repo scope.'
      else if (msg.includes('403')) friendly = 'Access denied (403) — configure developer usernames for per-developer fallback.'
      else if (msg.includes('404') || msg.includes('neither a readable')) friendly = 'Not found — check the org / user name.'
      setSyncResult(`✗ ${friendly}`)
    }
    setSyncing(false)
  }

  const anyEnabled = conns.some((c) => c.enabled && c.token && c.orgOrUser)

  return (
    <Modal
      title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><BrandIcon brand="github" size={16} /> GitHub Connections</span>}
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
          <div style={{ fontSize: 11, padding: '7px 11px', borderRadius: 'var(--r)', background: syncResult.startsWith('✓') ? 'var(--green-dim)' : 'var(--red-dim)', color: syncResult.startsWith('✓') ? 'var(--green)' : 'var(--red)', border: `1px solid ${syncResult.startsWith('✓') ? 'var(--green-border)' : 'var(--red-border)'}`, fontFamily: 'var(--mono)', whiteSpace: 'pre-wrap' }}>
            {syncResult}
          </div>
        )}
      </>
    </Modal>
  )
}
