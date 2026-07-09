import { useState } from 'react'
import { useStore } from '../../store'
import type { JiraConfig } from '../../types'
import { fetchJiraIssues } from '../../utils/jira-api'
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

const WORKER_CODE = `// 1. Go to https://workers.cloudflare.com  (free account)
// 2. Create a new Worker → paste this code → Deploy
export default {
  async fetch(req) {
    const target = new URL(req.url).searchParams.get('url')
    if (!target) return new Response('Missing ?url=', { status: 400 })
    const res = await fetch(target, { headers: req.headers })
    const h = new Headers(res.headers)
    h.set('Access-Control-Allow-Origin', '*')
    h.set('Access-Control-Allow-Headers', '*')
    return new Response(res.body, { status: res.status, headers: h })
  }
}
// 3. Copy the Worker URL (e.g. https://my-proxy.user.workers.dev)
// 4. Paste it below as:  https://my-proxy.user.workers.dev/?url=`

function makeEmptyConn(): JiraConfig {
  return {
    id: 'j_' + Date.now().toString(36),
    name: '',
    enabled: true,
    baseUrl: '',
    email: '',
    token: '',
    projectKeys: [],
    syncInterval: 5,
    proxyUrl: '',
  }
}

interface ConnFormProps {
  conn: JiraConfig
  onChange: (c: JiraConfig) => void
  onDelete: () => void
  isOnly: boolean
}

function ConnForm({ conn, onChange, onDelete, isOnly }: ConnFormProps) {
  const [projectKeysRaw, setProjectKeysRaw] = useState(conn.projectKeys.join(', '))
  const [showToken, setShowToken] = useState(false)
  const [showProxy, setShowProxy] = useState(!!conn.proxyUrl)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [copied, setCopied] = useState(false)

  function patch<K extends keyof JiraConfig>(key: K, value: JiraConfig[K]) {
    onChange({ ...conn, [key]: value })
  }

  function commitKeys(raw: string) {
    setProjectKeysRaw(raw)
    onChange({ ...conn, projectKeys: raw.split(',').map((k) => k.trim()).filter(Boolean) })
  }

  async function testConnection() {
    setTesting(true)
    setTestResult(null)
    const testCfg: JiraConfig = { ...conn, projectKeys: conn.projectKeys }
    try {
      await fetchJiraIssues(testCfg, 'assignee is not EMPTY AND statusCategory != Done ORDER BY updated DESC')
      setTestResult({ ok: true, msg: 'Connection successful ✓' })
    } catch (err) {
      const msg = (err as Error).message
      const isCors = !conn.proxyUrl && (msg.toLowerCase().includes('failed to fetch') || msg.toLowerCase().includes('network error'))
      setTestResult({ ok: false, msg: isCors ? 'CORS error — Jira blocks browser requests. Set up a proxy below.' : msg })
      if (isCors) setShowProxy(true)
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

      {/* URL */}
      <div>
        <span style={labelStyle}>Jira Base URL</span>
        <input style={inputStyle} placeholder="https://yourcompany.atlassian.net" value={conn.baseUrl} onChange={(e) => patch('baseUrl', e.target.value)} />
      </div>

      {/* email + token */}
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <span style={labelStyle}>Email</span>
          <input style={inputStyle} placeholder="you@company.com" value={conn.email} onChange={(e) => patch('email', e.target.value)} />
        </div>
        <div style={{ flex: 1 }}>
          <span style={labelStyle}>
            API Token
            <a href="https://id.atlassian.com/manage-profile/security/api-tokens" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', textDecoration: 'none', marginLeft: 4 }}>↗ create</a>
          </span>
          <div style={{ position: 'relative' }}>
            <input
              style={{ ...inputStyle, paddingRight: 32 }}
              type={showToken ? 'text' : 'password'}
              placeholder="API token"
              value={conn.token}
              onChange={(e) => patch('token', e.target.value)}
            />
            <button onClick={() => setShowToken((s) => !s)} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--text3)' }}>
              {showToken ? '🙈' : '👁'}
            </button>
          </div>
        </div>
      </div>

      {/* project keys + sync interval */}
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 2 }}>
          <span style={labelStyle}>Project keys (comma-separated, empty = all)</span>
          <input style={inputStyle} placeholder="PROJ, MOBILE, API" value={projectKeysRaw} onChange={(e) => commitKeys(e.target.value)} />
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

      {/* test */}
      {testResult && (
        <div style={{ fontSize: 11, padding: '7px 10px', borderRadius: 6, background: testResult.ok ? '#dcfce7' : '#fee2e2', color: testResult.ok ? '#15803d' : '#b91c1c', border: `1px solid ${testResult.ok ? '#86efac' : '#fca5a5'}`, fontFamily: 'var(--mono)' }}>
          {testResult.msg}
        </div>
      )}
      <button
        onClick={testConnection}
        disabled={testing || !conn.baseUrl || !conn.token}
        style={{ alignSelf: 'flex-start', background: 'var(--surface3)', border: '1px solid var(--border)', color: 'var(--text2)', fontFamily: 'var(--mono)', fontSize: 11, padding: '5px 12px', borderRadius: 6, cursor: 'pointer', opacity: !conn.baseUrl || !conn.token ? 0.5 : 1 }}
      >
        {testing ? '…testing' : 'Test connection'}
      </button>

      {/* CORS proxy */}
      <div style={{ border: '1px solid var(--border)', borderRadius: 7, overflow: 'hidden' }}>
        <button
          onClick={() => setShowProxy((s) => !s)}
          style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: conn.proxyUrl ? 'rgba(22,163,74,.08)' : 'var(--surface3)', border: 'none', cursor: 'pointer', textAlign: 'left' }}
        >
          <span style={{ fontSize: 11, fontWeight: 600, color: conn.proxyUrl ? '#16a34a' : 'var(--text3)', flex: 1 }}>
            {conn.proxyUrl ? '✓ CORS proxy configured' : '⚠ CORS proxy (if Jira blocks direct requests)'}
          </span>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)' }}>{showProxy ? '▲' : '▼'}</span>
        </button>
        {showProxy && (
          <div style={{ padding: '10px 12px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 11, color: 'var(--text2)', lineHeight: 1.5 }}>
              Paste a free Cloudflare Worker URL ending in <code style={{ background: 'var(--surface3)', padding: '1px 4px', borderRadius: 3 }}>?url=</code>
            </div>
            <div style={{ position: 'relative' }}>
              <pre style={{ margin: 0, padding: '8px 10px', background: 'var(--surface3)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 9.5, fontFamily: 'var(--mono)', color: 'var(--text2)', overflow: 'auto', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                {WORKER_CODE}
              </pre>
              <button
                onClick={() => { navigator.clipboard.writeText(WORKER_CODE).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) }) }}
                style={{ position: 'absolute', top: 6, right: 6, padding: '3px 7px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text2)', fontFamily: 'var(--mono)', fontSize: 10, cursor: 'pointer' }}
              >{copied ? '✓' : 'copy'}</button>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <input
                style={{ ...inputStyle, flex: 1 }}
                placeholder="https://my-proxy.user.workers.dev/?url="
                value={conn.proxyUrl}
                onChange={(e) => patch('proxyUrl', e.target.value)}
              />
              {conn.proxyUrl && (
                <button onClick={() => patch('proxyUrl', '')} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text3)', cursor: 'pointer', fontSize: 11, flexShrink: 0 }}>Clear</button>
              )}
            </div>
          </div>
        )}
      </div>

      {conn.lastSync && (
        <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--mono)' }}>
          Last sync: {new Date(conn.lastSync).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
          {conn.lastSyncResult ? ` — ${conn.lastSyncResult}` : ''}
        </div>
      )}
    </div>
  )
}

export default function JiraConfigModal({ onClose }: Props) {
  const { jiraConnections, developers, setJiraConnections, syncJira } = useStore()

  const [conns, setConns] = useState<JiraConfig[]>(
    jiraConnections.length ? jiraConnections : [makeEmptyConn()]
  )
  const [jiraEmails, setJiraEmails] = useState<Record<string, string>>(
    Object.fromEntries(developers.map((d) => [d.id, d.jiraEmail ?? ''])),
  )
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<string | null>(null)

  function updateConn(idx: number, c: JiraConfig) {
    setConns((prev) => prev.map((x, i) => (i === idx ? c : x)))
  }

  function addConn() {
    setConns((prev) => [...prev, makeEmptyConn()])
  }

  function removeConn(idx: number) {
    setConns((prev) => prev.filter((_, i) => i !== idx))
  }

  function save() {
    setJiraConnections(conns)
    useStore.setState((s) => ({
      developers: s.developers.map((dev) => {
        const email = jiraEmails[dev.id] ?? ''
        return email !== (dev.jiraEmail ?? '') ? { ...dev, jiraEmail: email || undefined } : dev
      }),
    }))
    onClose()
  }

  async function handleSyncNow() {
    // Save first so syncJira uses the latest connections
    setJiraConnections(conns)
    setSyncing(true)
    setSyncResult(null)
    try {
      const { added, updated, removed } = await syncJira()
      setSyncResult(`✓ Synced — ${added} added, ${updated} updated${removed ? `, ${removed} closed removed` : ''}`)
    } catch (err) {
      setSyncResult(`✗ ${(err as Error).message}`)
    }
    setSyncing(false)
  }

  const anyEnabled = conns.some((c) => c.enabled && c.baseUrl && c.token)

  return (
    <Modal
      title="🔗 Jira Connections"
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
        {/* connections list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {conns.map((c, i) => (
            <ConnForm
              key={c.id}
              conn={c}
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

        {/* developer email mapping */}
        {developers.length > 0 && (
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text2)', marginBottom: 10, paddingBottom: 5, borderBottom: '1px solid var(--border)' }}>Developer → Jira email</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {developers.map((d) => (
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
        )}

        {syncResult && (
          <div style={{ fontSize: 11, padding: '7px 11px', borderRadius: 6, background: syncResult.startsWith('✓') ? '#dcfce7' : '#fee2e2', color: syncResult.startsWith('✓') ? '#15803d' : '#b91c1c', fontFamily: 'var(--mono)', whiteSpace: 'pre-wrap' }}>
            {syncResult}
          </div>
        )}
      </>
    </Modal>
  )
}
