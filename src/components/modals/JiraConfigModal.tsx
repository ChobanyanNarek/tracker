import { useState } from 'react'
import { useStore } from '../../store'
import type { JiraConfig, JiraStatusMapping, Status } from '../../types'
import { fetchJiraIssues, fetchJiraStatuses, type JiraStatusInfo } from '../../utils/jira-api'
import Modal from '../ui/Modal'
import { formatDateTime } from '../../utils/dates'

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

const BUCKET_OPTIONS: { value: Status | 'hidden'; label: string }[] = [
  { value: 'todo', label: 'To Do' },
  { value: 'inprogress', label: 'In Progress' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'review', label: 'Code Review' },
  { value: 'done', label: 'Done' },
  { value: 'hidden', label: '— hidden —' },
]

const BUCKET_STYLE: Record<string, React.CSSProperties> = {
  todo:       { background: 'var(--surface3)', color: 'var(--text3)', borderColor: 'var(--border2)' },
  inprogress: { background: 'var(--amber-dim)', color: 'var(--amber)', borderColor: 'var(--amber-border)' },
  blocked:    { background: 'var(--red-dim)', color: 'var(--red)', borderColor: 'var(--red-border)' },
  review:     { background: 'var(--purple-dim)', color: 'var(--purple)', borderColor: 'var(--purple-border)' },
  done:       { background: 'var(--green-dim)', color: 'var(--green)', borderColor: 'var(--green-border)' },
  hidden:     { background: 'var(--surface3)', color: 'var(--text4)', borderColor: 'var(--border)', opacity: 0.7 },
}

const CAT_STYLE: Record<string, React.CSSProperties> = {
  new:           { background: 'var(--surface3)', color: 'var(--text3)', borderColor: 'var(--border2)' },
  indeterminate: { background: 'var(--amber-dim)', color: 'var(--amber)', borderColor: 'var(--amber-border)' },
  done:          { background: 'var(--green-dim)', color: 'var(--green)', borderColor: 'var(--green-border)' },
}

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
  }
}

interface StatusMappingRowProps {
  info: JiraStatusInfo
  mapping: JiraStatusMapping
  onChange: (m: JiraStatusMapping) => void
}

function StatusMappingRow({ info, mapping, onChange }: StatusMappingRowProps) {
  const catStyle = CAT_STYLE[info.categoryKey] ?? CAT_STYLE['new']!
  const bucketStyle = BUCKET_STYLE[mapping.displayBucket] ?? BUCKET_STYLE['hidden']!
  const isHidden = mapping.displayBucket === 'hidden'

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 20px 100px 1fr', alignItems: 'center', gap: 6, padding: '3px 2px', borderRadius: 5 }}>
      <span style={{ fontSize: 10, fontFamily: 'var(--mono)', fontWeight: 600, padding: '4px 9px', borderRadius: 5, border: '1px solid', display: 'inline-flex', alignItems: 'center', gap: 5, overflow: 'hidden', ...catStyle }}>
        <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'currentColor', flexShrink: 0 }} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{info.name}</span>
      </span>
      <span style={{ color: 'var(--text4)', fontSize: 12, textAlign: 'center', userSelect: 'none' }}>→</span>
      <select
        value={mapping.displayBucket}
        onChange={(e) => onChange({ ...mapping, displayBucket: e.target.value as Status | 'hidden', displayLabel: e.target.value === 'hidden' ? '' : mapping.displayLabel })}
        style={{ fontSize: 10, fontFamily: 'var(--mono)', fontWeight: 600, border: '1px solid', borderRadius: 5, padding: '4px 6px', cursor: 'pointer', outline: 'none', width: '100%', appearance: 'none', ...bucketStyle }}
      >
        {BUCKET_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <input
        type="text"
        disabled={isHidden}
        placeholder={isHidden ? '' : `e.g. ${info.name}`}
        value={mapping.displayLabel ?? ''}
        onChange={(e) => onChange({ ...mapping, displayLabel: e.target.value })}
        style={{ ...inputStyle, fontSize: 10, padding: '4px 8px', opacity: isHidden ? 0.35 : 1, cursor: isHidden ? 'not-allowed' : 'text' }}
      />
    </div>
  )
}

interface ConnFormProps {
  conn: JiraConfig
  developers: import('../../types').Developer[]
  onChange: (c: JiraConfig) => void
  onDelete: () => void
  isOnly: boolean
}

function ConnForm({ conn, developers, onChange, onDelete, isOnly }: ConnFormProps) {
  const [projectKeysRaw, setProjectKeysRaw] = useState(conn.projectKeys.join(', '))
  const [showToken, setShowToken] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [fetchingStatuses, setFetchingStatuses] = useState(false)
  const [statuses, setStatuses] = useState<JiraStatusInfo[]>(() => {
    // Rebuild info list from saved mappings so rows appear without re-fetching
    return conn.statusMappings?.map((m) => ({ name: m.jiraStatus, categoryKey: 'new' })) ?? []
  })

  function patch<K extends keyof JiraConfig>(key: K, value: JiraConfig[K]) {
    onChange({ ...conn, [key]: value })
  }

  function addDev(devId: string) {
    onChange({ ...conn, developerEmails: { ...(conn.developerEmails ?? {}), [devId]: '' } })
  }

  function removeDev(devId: string) {
    const emails = { ...(conn.developerEmails ?? {}) }
    delete emails[devId]
    onChange({ ...conn, developerEmails: emails })
  }

  function setDevEmail(devId: string, email: string) {
    onChange({ ...conn, developerEmails: { ...(conn.developerEmails ?? {}), [devId]: email } })
  }

  function commitKeys(raw: string) {
    setProjectKeysRaw(raw)
    onChange({ ...conn, projectKeys: raw.split(',').map((k) => k.trim()).filter(Boolean) })
  }

  async function testConnection() {
    setTesting(true)
    setTestResult(null)
    try {
      await fetchJiraIssues(conn, 'assignee is not EMPTY AND statusCategory != Done ORDER BY updated DESC')
      setTestResult({ ok: true, msg: 'Connection successful ✓' })
    } catch (err) {
      setTestResult({ ok: false, msg: (err as Error).message })
    }
    setTesting(false)
  }

  async function fetchStatuses() {
    setFetchingStatuses(true)
    try {
      const fetched = await fetchJiraStatuses(conn)
      setStatuses(fetched)
      // Merge with existing mappings — keep user customisations, add new rows
      const existing = conn.statusMappings ?? []
      const merged: JiraStatusMapping[] = fetched.map((s) => {
        const prev = existing.find((m) => m.jiraStatus.toLowerCase() === s.name.toLowerCase())
        if (prev) return prev
        // Auto-guess bucket from category
        let bucket: Status | 'hidden' = 'todo'
        if (s.categoryKey === 'indeterminate') bucket = 'inprogress'
        if (s.categoryKey === 'done') bucket = 'hidden'
        return { jiraStatus: s.name, displayBucket: bucket, displayLabel: '' }
      })
      onChange({ ...conn, statusMappings: merged })
    } catch (err) {
      setTestResult({ ok: false, msg: `Failed to fetch statuses: ${(err as Error).message}` })
    }
    setFetchingStatuses(false)
  }

  function updateMapping(idx: number, m: JiraStatusMapping) {
    const updated = [...(conn.statusMappings ?? [])]
    updated[idx] = m
    onChange({ ...conn, statusMappings: updated })
  }

  const mappings = conn.statusMappings ?? []

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
          <button onClick={onDelete} title="Remove connection" style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text3)', borderRadius: 5, padding: '3px 8px', cursor: 'pointer', fontSize: 12, flexShrink: 0 }}>✕</button>
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

      {conn.lastSync && (
        <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--mono)' }}>
          Last sync: {formatDateTime(conn.lastSync)}
          {conn.lastSyncResult ? ` — ${conn.lastSyncResult}` : ''}
        </div>
      )}

      {/* ── STATUS MAPPING ── */}
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.7px' }}>
            Jira status → display as
          </span>
          <button
            onClick={fetchStatuses}
            disabled={fetchingStatuses || !conn.baseUrl || !conn.token}
            style={{ fontSize: 10, fontFamily: 'var(--mono)', fontWeight: 500, background: 'var(--accent-dim)', border: '1px solid var(--accent-border)', color: 'var(--accent)', borderRadius: 5, padding: '3px 9px', cursor: 'pointer', opacity: !conn.baseUrl || !conn.token ? 0.4 : 1 }}
          >
            {fetchingStatuses ? '…loading' : '⟳ Fetch statuses'}
          </button>
        </div>

        {statuses.length > 0 && (
          <>
            {/* column headers */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 20px 100px 1fr', gap: 6, padding: '0 2px', marginBottom: 4 }}>
              <span style={{ fontSize: 9, fontFamily: 'var(--mono)', color: 'var(--text4)', textTransform: 'uppercase', letterSpacing: '.6px' }}>Jira board status</span>
              <span />
              <span style={{ fontSize: 9, fontFamily: 'var(--mono)', color: 'var(--text4)', textTransform: 'uppercase', letterSpacing: '.6px' }}>Bucket</span>
              <span style={{ fontSize: 9, fontFamily: 'var(--mono)', color: 'var(--text4)', textTransform: 'uppercase', letterSpacing: '.6px' }}>Custom label</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {statuses.map((s, i) => (
                <StatusMappingRow
                  key={s.name}
                  info={s}
                  mapping={mappings[i] ?? { jiraStatus: s.name, displayBucket: 'todo', displayLabel: '' }}
                  onChange={(m) => updateMapping(i, m)}
                />
              ))}
            </div>
            <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--text3)', background: 'var(--surface3)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px', marginTop: 8, lineHeight: 1.5 }}>
              <strong style={{ color: 'var(--text2)' }}>hidden</strong> issues are synced but not shown on the dashboard. Leave <strong style={{ color: 'var(--text2)' }}>Custom label</strong> empty to use the bucket name.
            </div>
          </>
        )}

        {statuses.length === 0 && (
          <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--text4)', padding: '6px 2px' }}>
            Click "Fetch statuses" to load your Jira board statuses and configure visibility.
          </div>
        )}
      </div>

      {/* developers */}
      {developers.length > 0 && (
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
          <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.7px', marginBottom: 8 }}>Developers in this connection</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {developers.filter((d) => d.id in (conn.developerEmails ?? {})).map((d) => (
              <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: d.color, flexShrink: 0 }} />
                <span style={{ fontSize: 12, color: 'var(--text)', width: 110, flexShrink: 0 }}>{d.name}</span>
                <input
                  style={{ ...inputStyle, flex: 1 }}
                  placeholder="jira@company.com"
                  value={conn.developerEmails?.[d.id] ?? ''}
                  onChange={(e) => setDevEmail(d.id, e.target.value)}
                  // eslint-disable-next-line jsx-a11y/no-autofocus
                  autoFocus={conn.developerEmails?.[d.id] === ''}
                />
                <button onClick={() => removeDev(d.id)} style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: 13, padding: '0 2px', flexShrink: 0 }}>✕</button>
              </div>
            ))}
            {developers.some((d) => !(d.id in (conn.developerEmails ?? {}))) && (
              <select
                value=""
                onChange={(e) => { if (e.target.value) addDev(e.target.value) }}
                style={{ ...inputStyle, color: 'var(--text3)', cursor: 'pointer' }}
              >
                <option value="">+ Add developer…</option>
                {developers.filter((d) => !(d.id in (conn.developerEmails ?? {}))).map((d) => (
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

export default function JiraConfigModal({ onClose }: Props) {
  const { jiraConnections, developers, setJiraConnections, syncJira } = useStore()

  const [conns, setConns] = useState<JiraConfig[]>(
    jiraConnections.length ? jiraConnections : [makeEmptyConn()]
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
    onClose()
  }

  async function handleSyncNow() {
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {conns.map((c, i) => (
            <ConnForm
              key={c.id}
              conn={c}
              developers={developers}
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
