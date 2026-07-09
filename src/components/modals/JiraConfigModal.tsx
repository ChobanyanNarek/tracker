import { useState, useRef } from 'react'
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

const NODE_PROXY = `// Save as jira-proxy.js, then: node jira-proxy.js
// Set Proxy URL below to: http://localhost:8765/?url=
const http = require('http'), https = require('https');
http.createServer((req, res) => {
  const t = new URL(decodeURIComponent(req.url.slice(1)));
  https.request({ hostname: t.hostname, port: 443,
    path: t.pathname + t.search,
    headers: { ...req.headers, host: t.hostname },
  }, (r) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    r.pipe(res);
  }).end();
}).listen(8765, '127.0.0.1', () =>
  console.log('Proxy running: http://localhost:8765/?url='));`

export default function JiraConfigModal({ onClose }: Props) {
  const { jiraConfig, developers, setJiraConfig, syncJira } = useStore()

  const [cfg, setCfg] = useState<JiraConfig>({ ...jiraConfig })
  const [projectKeysRaw, setProjectKeysRaw] = useState(jiraConfig.projectKeys.join(', '))
  const [jiraEmails, setJiraEmails] = useState<Record<string, string>>(
    Object.fromEntries(developers.map((d) => [d.id, d.jiraEmail ?? ''])),
  )
  const [showToken, setShowToken] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string; isCors?: boolean } | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<string | null>(null)
  const [showProxy, setShowProxy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [copiedNode, setCopiedNode] = useState(false)
  const proxyRef = useRef<HTMLDivElement>(null)

  function patch(key: keyof JiraConfig, value: unknown) {
    setCfg((c) => ({ ...c, [key]: value }))
  }

  async function testConnection() {
    setTesting(true)
    setTestResult(null)
    const testCfg: JiraConfig = {
      ...cfg,
      baseUrl: cfg.baseUrl.trim(),
      email: cfg.email.trim(),
      token: cfg.token.trim(),
      proxyUrl: cfg.proxyUrl.trim(),
      projectKeys: projectKeysRaw.split(',').map((k) => k.trim()).filter(Boolean),
    }
    try {
      await fetchJiraIssues(testCfg, 'assignee is not EMPTY AND statusCategory != Done ORDER BY updated DESC')
      setTestResult({ ok: true, msg: 'Connection successful ✓' })
    } catch (err) {
      const msg = (err as Error).message
      const isCors = !testCfg.proxyUrl && (msg.toLowerCase().includes('failed to fetch') || msg.toLowerCase().includes('network error') || msg.toLowerCase().includes('cors'))
      setTestResult({
        ok: false,
        isCors,
        msg: isCors ? 'CORS error — Jira blocks browser requests. Set up a proxy (see below).' : msg,
      })
      if (isCors) {
        setShowProxy(true)
        setTimeout(() => proxyRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 120)
      }
    }
    setTesting(false)
  }

  function save() {
    const saved: JiraConfig = {
      ...cfg,
      baseUrl: cfg.baseUrl.trim(),
      email: cfg.email.trim(),
      token: cfg.token.trim(),
      proxyUrl: cfg.proxyUrl.trim(),
      projectKeys: projectKeysRaw.split(',').map((k) => k.trim()).filter(Boolean),
    }
    setJiraConfig(saved)
    useStore.setState((s) => ({
      developers: s.developers.map((dev) => {
        const email = jiraEmails[dev.id] ?? ''
        return email !== (dev.jiraEmail ?? '') ? { ...dev, jiraEmail: email || undefined } : dev
      }),
    }))
    onClose()
  }

  async function handleSyncNow() {
    setSyncing(true)
    setSyncResult(null)
    try {
      const { added, updated, removed } = await syncJira()
      setSyncResult(`✓ Synced — ${added} added, ${updated} updated${removed ? `, ${removed} closed removed` : ''}`)
    } catch (err) {
      const msg = (err as Error).message
      const isCors = !cfg.proxyUrl && (msg.toLowerCase().includes('failed to fetch') || msg.toLowerCase().includes('network error'))
      setSyncResult(isCors ? '✗ CORS error — set a Proxy URL in settings above, then save and retry.' : `✗ ${msg}`)
      if (isCors) {
        setShowProxy(true)
        setTimeout(() => proxyRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 120)
      }
    }
    setSyncing(false)
  }

  function copyWorker() {
    navigator.clipboard.writeText(WORKER_CODE).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
  }

  const lastSync = cfg.lastSync
    ? new Date(cfg.lastSync).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : 'Never'

  return (
    <Modal
      title="🔗 Jira Integration"
      zIndex={1000}
      onClose={onClose}
      bodyStyle={{ display: 'flex', flexDirection: 'column', gap: 16 }}
      footer={
        <>
          <button
            className="btn-secondary"
            style={{ marginRight: 'auto', fontFamily: 'var(--mono)', opacity: !jiraConfig.enabled ? 0.4 : 1 }}
            onClick={handleSyncNow}
            disabled={syncing || !jiraConfig.enabled || !jiraConfig.baseUrl || !jiraConfig.token}
          >
            {syncing ? '⟳ Syncing…' : '⟳ Sync now'}
          </button>
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save}>Save</button>
        </>
      }
    >
      <>

          {/* enable toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: cfg.enabled ? 'var(--accent-dim)' : 'var(--surface2)', borderRadius: 8, border: `1px solid ${cfg.enabled ? 'var(--accent)' : 'var(--border)'}` }}>
            <input type="checkbox" id="jira-enabled" checked={cfg.enabled} onChange={(e) => patch('enabled', e.target.checked)} style={{ width: 16, height: 16, cursor: 'pointer' }} />
            <label htmlFor="jira-enabled" style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', cursor: 'pointer', flex: 1 }}>Enable Jira auto-import</label>
            {cfg.lastSync && <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)' }}>Last sync: {lastSync}</span>}
          </div>

          {/* connection */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text2)', marginBottom: 10, paddingBottom: 5, borderBottom: '1px solid var(--border)' }}>Connection</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div>
                <span style={labelStyle}>Jira Base URL</span>
                <input style={inputStyle} placeholder="https://yourcompany.atlassian.net" value={cfg.baseUrl} onChange={(e) => patch('baseUrl', e.target.value)} />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <span style={labelStyle}>Email</span>
                  <input style={inputStyle} placeholder="you@company.com" value={cfg.email} onChange={(e) => patch('email', e.target.value)} />
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
                      value={cfg.token}
                      onChange={(e) => patch('token', e.target.value)}
                    />
                    <button onClick={() => setShowToken((s) => !s)} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--text3)' }}>
                      {showToken ? '🙈' : '👁'}
                    </button>
                  </div>
                </div>
              </div>

              {testResult && (
                <div style={{ fontSize: 11, padding: '8px 11px', borderRadius: 6, background: testResult.ok ? '#dcfce7' : '#fee2e2', color: testResult.ok ? '#15803d' : '#b91c1c', border: `1px solid ${testResult.ok ? '#86efac' : '#fca5a5'}`, fontFamily: 'var(--mono)' }}>
                  {testResult.msg}
                </div>
              )}

              <button
                onClick={testConnection}
                disabled={testing || !cfg.baseUrl || !cfg.token}
                style={{ alignSelf: 'flex-start', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text2)', fontFamily: 'var(--mono)', fontSize: 11, padding: '5px 12px', borderRadius: 6, cursor: 'pointer', opacity: !cfg.baseUrl || !cfg.token ? 0.5 : 1 }}
              >
                {testing ? '…testing' : 'Test connection'}
              </button>
            </div>
          </div>

          {/* CORS proxy */}
          <div ref={proxyRef} style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
            <button
              onClick={() => setShowProxy((s) => !s)}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: cfg.proxyUrl ? 'rgba(22,163,74,.08)' : 'var(--surface2)', border: 'none', cursor: 'pointer', textAlign: 'left' }}
            >
              <span style={{ fontSize: 11, fontWeight: 600, color: cfg.proxyUrl ? '#16a34a' : 'var(--text2)', flex: 1 }}>
                {cfg.proxyUrl ? '✓ CORS Proxy configured' : '⚠ CORS Proxy required for browser access'}
              </span>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)' }}>{showProxy ? '▲' : '▼'} setup</span>
            </button>

            {showProxy && (
              <div style={{ padding: '12px 14px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.5 }}>
                  Jira blocks direct browser requests (CORS). You need a small proxy. Pick one option below:
                </div>

                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text2)' }}>Option A — free Cloudflare Worker (recommended, always-on)</div>
                {/* Worker code */}
                <div style={{ position: 'relative' }}>
                  <pre style={{ margin: 0, padding: '10px 12px', background: 'var(--surface3)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--text2)', overflow: 'auto', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                    {WORKER_CODE}
                  </pre>
                  <button
                    onClick={copyWorker}
                    style={{ position: 'absolute', top: 6, right: 6, padding: '3px 8px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text2)', fontFamily: 'var(--mono)', fontSize: 10, cursor: 'pointer' }}
                  >
                    {copied ? '✓ copied' : 'copy'}
                  </button>
                </div>

                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                  <div style={{ flex: 1 }}>
                    <span style={labelStyle}>Proxy URL (paste your Worker URL + ?url=)</span>
                    <input
                      style={inputStyle}
                      placeholder="https://my-proxy.user.workers.dev/?url="
                      value={cfg.proxyUrl}
                      onChange={(e) => patch('proxyUrl', e.target.value)}
                    />
                  </div>
                  {cfg.proxyUrl && (
                    <button
                      onClick={() => patch('proxyUrl', '')}
                      style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text3)', cursor: 'pointer', fontSize: 11, flexShrink: 0 }}
                    >Clear</button>
                  )}
                </div>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text2)', marginTop: 4 }}>Option B — local Node.js proxy (if you have Node.js)</div>
                <div style={{ position: 'relative' }}>
                  <pre style={{ margin: 0, padding: '10px 12px', background: 'var(--surface3)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--text2)', overflow: 'auto', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                    {NODE_PROXY}
                  </pre>
                  <button
                    onClick={() => { navigator.clipboard.writeText(NODE_PROXY).then(() => { setCopiedNode(true); setTimeout(() => setCopiedNode(false), 2000) }) }}
                    style={{ position: 'absolute', top: 6, right: 6, padding: '3px 8px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text2)', fontFamily: 'var(--mono)', fontSize: 10, cursor: 'pointer' }}
                  >
                    {copiedNode ? '✓ copied' : 'copy'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* sync settings */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text2)', marginBottom: 10, paddingBottom: 5, borderBottom: '1px solid var(--border)' }}>Sync settings</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div>
                <span style={labelStyle}>Project keys (comma-separated, leave empty for all)</span>
                <input style={inputStyle} placeholder="PROJ, MOBILE, API" value={projectKeysRaw} onChange={(e) => setProjectKeysRaw(e.target.value)} />
              </div>
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
            </div>
          </div>

          {/* developer mapping */}
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

          {cfg.lastSyncResult && !syncResult && (
            <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--mono)' }}>Last result: {cfg.lastSyncResult}</div>
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
