import { useState } from 'react'
import { useStore } from '../../store'
import type { JiraConfig, JiraStatusMapping, StatusGroup, StatusGroupColor } from '../../types'
import { fetchJiraIssues, fetchJiraStatuses, fetchJiraBoards, type JiraStatusInfo, type JiraBoardInfo } from '../../utils/jira-api'
import { DEFAULT_STATUS_GROUPS, GROUP_COLOR_TOKENS, GROUP_COLOR_HEX } from '../../utils/status-groups'
import Modal from '../ui/Modal'
import { formatDateTime } from '../../utils/dates'

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

const COLOR_OPTIONS: StatusGroupColor[] = ['gray', 'blue', 'amber', 'red', 'purple', 'green', 'teal', 'pink', 'orange']

function makeEmptyConn(projectId?: string): JiraConfig {
  return {
    id: 'j_' + Date.now().toString(36),
    name: '', enabled: true, baseUrl: '', email: '', token: '',
    projectKeys: [], syncInterval: 5,
    ...(projectId ? { projectId } : {}),
  }
}

// ── Group Manager ──────────────────────────────────────────────
interface GroupManagerProps {
  groups: StatusGroup[]
  onChange: (groups: StatusGroup[]) => void
}

function GroupManager({ groups, onChange }: GroupManagerProps) {
  function addGroup() {
    const id = 'group_' + Date.now().toString(36)
    onChange([...groups, { id, label: 'New Group', color: 'blue' }])
  }
  function updateGroup(idx: number, patch: Partial<StatusGroup>) {
    onChange(groups.map((g, i) => i === idx ? { ...g, ...patch } : g))
  }
  function removeGroup(idx: number) {
    onChange(groups.filter((_, i) => i !== idx))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {groups.map((g, i) => {
        const tokens = GROUP_COLOR_TOKENS[g.color]
        return (
          <div key={g.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: 6, alignItems: 'center' }}>
            <input
              style={{ ...inputStyle, fontSize: 11 }}
              value={g.label}
              onChange={(e) => updateGroup(i, { label: e.target.value })}
              placeholder="Group label"
            />
            {/* color picker — circles */}
            <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
              {COLOR_OPTIONS.map((c) => (
                <button
                  key={c}
                  title={c}
                  onClick={() => updateGroup(i, { color: c })}
                  style={{
                    width: 14, height: 14, borderRadius: '50%', border: g.color === c ? '2px solid var(--text)' : '2px solid transparent',
                    background: GROUP_COLOR_HEX[c], cursor: 'pointer', padding: 0, outline: 'none', flexShrink: 0,
                  }}
                />
              ))}
            </div>
            {/* isClosed toggle */}
            <label title="Issues in this group are removed from the daily board" style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', flexShrink: 0 }}>
              <input type="checkbox" checked={!!g.isClosed} onChange={(e) => updateGroup(i, { isClosed: e.target.checked })} style={{ width: 12, height: 12 }} />
              <span style={{ fontSize: 9, fontFamily: 'var(--mono)', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.5px' }}>closed</span>
            </label>
            {/* preview badge */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 9, fontFamily: 'var(--mono)', fontWeight: 600, padding: '2px 7px', borderRadius: 10, background: tokens.bg, color: tokens.text, border: `1px solid ${tokens.border}`, whiteSpace: 'nowrap' }}>
                {g.label || 'Group'}
              </span>
              <button onClick={() => removeGroup(i)} title="Remove group" style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: 13, padding: '0 2px', flexShrink: 0 }}>✕</button>
            </div>
          </div>
        )
      })}
      <button
        onClick={addGroup}
        style={{ alignSelf: 'flex-start', background: 'none', border: '1px dashed var(--border2)', color: 'var(--text3)', fontFamily: 'var(--mono)', fontSize: 10, padding: '3px 10px', borderRadius: 5, cursor: 'pointer' }}
      >
        + Add group
      </button>
    </div>
  )
}

// ── Status Mapping Row ─────────────────────────────────────────
interface MappingRowProps {
  info: JiraStatusInfo
  mapping: JiraStatusMapping
  groups: StatusGroup[]
  onChange: (m: JiraStatusMapping) => void
}

const CAT_TOKENS: Record<string, React.CSSProperties> = {
  new:           { background: 'var(--surface3)', color: 'var(--text3)', borderColor: 'var(--border2)' },
  indeterminate: { background: 'var(--amber-dim)', color: 'var(--amber)', borderColor: 'var(--amber-border)' },
  done:          { background: 'var(--green-dim)', color: 'var(--green)', borderColor: 'var(--green-border)' },
}

function MappingRow({ info, mapping, groups, onChange }: MappingRowProps) {
  const catStyle = CAT_TOKENS[info.categoryKey] ?? CAT_TOKENS['new']!
  const selectedGroup = groups.find((g) => g.id === mapping.groupId)
  const isHidden = mapping.groupId === 'hidden'
  const selTokens = selectedGroup ? GROUP_COLOR_TOKENS[selectedGroup.color] : GROUP_COLOR_TOKENS['gray']

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 20px 1fr', alignItems: 'center', gap: 6, padding: '3px 2px', borderRadius: 5 }}>
      <span style={{ fontSize: 10, fontFamily: 'var(--mono)', fontWeight: 600, padding: '4px 9px', borderRadius: 5, border: '1px solid', display: 'inline-flex', alignItems: 'center', gap: 5, overflow: 'hidden', ...catStyle }}>
        <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'currentColor', flexShrink: 0 }} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{info.name}</span>
      </span>
      <span style={{ color: 'var(--text4)', fontSize: 12, textAlign: 'center', userSelect: 'none' }}>→</span>
      <select
        value={mapping.groupId}
        onChange={(e) => onChange({ ...mapping, groupId: e.target.value })}
        style={{
          fontSize: 10, fontFamily: 'var(--mono)', fontWeight: 600,
          border: '1px solid', borderRadius: 5, padding: '4px 6px',
          cursor: 'pointer', outline: 'none', width: '100%', appearance: 'none',
          ...(isHidden ? { background: 'var(--surface3)', color: 'var(--text4)', borderColor: 'var(--border)', opacity: 0.7 } : { background: selTokens.bg, color: selTokens.text, borderColor: selTokens.border }),
        }}
      >
        {groups.map((g) => {
          const t = GROUP_COLOR_TOKENS[g.color]
          return <option key={g.id} value={g.id} style={{ color: t.text }}>{g.label}{g.isClosed ? ' (closed)' : ''}</option>
        })}
        <option value="hidden">— hidden —</option>
      </select>
    </div>
  )
}

// ── Connection Form ────────────────────────────────────────────
interface ConnFormProps {
  conn: JiraConfig
  developers: import('../../types').Developer[]
  onChange: (c: JiraConfig) => void
  onDelete: () => void
  isOnly: boolean
}

function parseJiraUrl(raw: string): { baseUrl: string; projectKey: string | null; boardId: number | null } {
  const trimmed = raw.trim().replace(/\/$/, '')
  // https://company.atlassian.net/jira/software/projects/KEY/boards/123
  const boardMatch = trimmed.match(/^(https?:\/\/[^/]+)(?:\/jira)?\/software\/(?:c\/)?projects\/([A-Z][A-Z0-9_]+)\/boards\/(\d+)/i)
  if (boardMatch) return { baseUrl: boardMatch[1]!, projectKey: boardMatch[2]!.toUpperCase(), boardId: Number(boardMatch[3]) }
  // https://company.atlassian.net/jira/software/projects/KEY (no board id)
  const projectMatch = trimmed.match(/^(https?:\/\/[^/]+)(?:\/jira)?\/software\/(?:c\/)?projects\/([A-Z][A-Z0-9_]+)/i)
  if (projectMatch) return { baseUrl: projectMatch[1]!, projectKey: projectMatch[2]!.toUpperCase(), boardId: null }
  // https://company.atlassian.net/browse/KEY-123
  const browseMatch = trimmed.match(/^(https?:\/\/[^/]+)\/browse\/([A-Z][A-Z0-9_]+)-\d+/i)
  if (browseMatch) return { baseUrl: browseMatch[1]!, projectKey: browseMatch[2]!.toUpperCase(), boardId: null }
  // plain base URL
  return { baseUrl: trimmed, projectKey: null, boardId: null }
}

function ConnForm({ conn, developers, onChange, onDelete, isOnly }: ConnFormProps) {
  const [syncMode, setSyncModeState] = useState<'project' | 'board'>(conn.boardId ? 'board' : 'project')
  const [projectKeysRaw, setProjectKeysRaw] = useState(conn.projectKeys.join(', '))
  const [showToken, setShowToken] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [fetchingStatuses, setFetchingStatuses] = useState(false)
  const [boards, setBoards] = useState<JiraBoardInfo[]>([])
  const [fetchingBoards, setFetchingBoards] = useState(false)
  const [statuses, setStatuses] = useState<JiraStatusInfo[]>(() =>
    conn.statusMappings?.map((m) => ({ name: m.jiraStatus, categoryKey: 'new' })) ?? []
  )
  const groups = conn.statusGroups?.length ? conn.statusGroups : DEFAULT_STATUS_GROUPS

  function setSyncMode(mode: 'project' | 'board') {
    setSyncModeState(mode)
    if (mode === 'project') onChange({ ...conn, boardId: undefined })
    else { onChange({ ...conn, projectKeys: [] }); setProjectKeysRaw('') }
  }

  function patch<K extends keyof JiraConfig>(key: K, value: JiraConfig[K]) {
    onChange({ ...conn, [key]: value })
  }
  function addDev(devId: string) {
    onChange({ ...conn, developerEmails: { ...(conn.developerEmails ?? {}), [devId]: '' } })
  }
  function removeDev(devId: string) {
    const emails = { ...(conn.developerEmails ?? {}) }; delete emails[devId]
    onChange({ ...conn, developerEmails: emails })
  }
  function setDevEmail(devId: string, email: string) {
    onChange({ ...conn, developerEmails: { ...(conn.developerEmails ?? {}), [devId]: email } })
  }
  function commitKeys(raw: string) {
    setProjectKeysRaw(raw)
    onChange({ ...conn, projectKeys: raw.split(',').map((k) => k.trim()).filter(Boolean) })
  }
  function handleBoardUrlChange(raw: string) {
    const { baseUrl, boardId } = parseJiraUrl(raw.trim())
    onChange({ ...conn, baseUrl: baseUrl || conn.baseUrl, boardId: boardId ?? undefined, projectKeys: [] })
  }

  async function testConnection() {
    setTesting(true); setTestResult(null)
    try {
      await fetchJiraIssues(conn, 'assignee is not EMPTY AND statusCategory != Done ORDER BY updated DESC')
      setTestResult({ ok: true, msg: 'Connection successful ✓' })
    } catch (err) { setTestResult({ ok: false, msg: (err as Error).message }) }
    setTesting(false)
  }

  async function loadBoards() {
    setFetchingBoards(true)
    try {
      const fetched = await fetchJiraBoards(conn)
      setBoards(fetched)
    } catch (err) {
      setTestResult({ ok: false, msg: `Failed to fetch boards: ${(err as Error).message}` })
    }
    setFetchingBoards(false)
  }

  function toggleAllowedBoard(id: number) {
    const current = conn.allowedBoardIds ?? []
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id]
    onChange({ ...conn, allowedBoardIds: next })
  }

  async function fetchStatuses() {
    setFetchingStatuses(true)
    try {
      const fetched = await fetchJiraStatuses(conn)
      setStatuses(fetched)
      const existing = conn.statusMappings ?? []
      const merged: JiraStatusMapping[] = fetched.map((s) => {
        const prev = existing.find((m) => m.jiraStatus.toLowerCase() === s.name.toLowerCase())
        if (prev) return prev
        let groupId = 'todo'
        if (s.categoryKey === 'indeterminate') groupId = 'inprogress'
        if (s.categoryKey === 'done') groupId = 'hidden'
        return { jiraStatus: s.name, groupId }
      })
      onChange({ ...conn, statusMappings: merged })
    } catch (err) {
      setTestResult({ ok: false, msg: `Failed to fetch statuses: ${(err as Error).message}` })
    }
    setFetchingStatuses(false)
  }

  function updateMapping(idx: number, m: JiraStatusMapping) {
    const updated = [...(conn.statusMappings ?? [])]; updated[idx] = m
    onChange({ ...conn, statusMappings: updated })
  }

  const mappings = conn.statusMappings ?? []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '14px', background: 'var(--surface2)', borderRadius: 8, border: '1px solid var(--border)' }}>

      {/* Row 1: name + enabled + delete */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input style={{ ...inputStyle, flex: 1, fontWeight: 600 }} placeholder="Connection name" value={conn.name} onChange={(e) => patch('name', e.target.value)} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', flexShrink: 0 }}>
          <input type="checkbox" checked={conn.enabled} onChange={(e) => patch('enabled', e.target.checked)} style={{ width: 13, height: 13 }} />
          <span style={{ fontSize: 11, color: 'var(--text2)', whiteSpace: 'nowrap' }}>Enabled</span>
        </label>
        {!isOnly && (
          <button onClick={onDelete} style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text3)', borderRadius: 5, padding: '3px 8px', cursor: 'pointer', fontSize: 12, flexShrink: 0 }}>✕</button>
        )}
      </div>

      {/* Row 2: mode toggle */}
      <div>
        <span style={labelStyle}>Sync mode</span>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          <button
            type="button" onClick={() => setSyncMode('project')}
            style={{ padding: '8px 10px', fontSize: 11, fontWeight: 600, borderRadius: 6, cursor: 'pointer', textAlign: 'left', border: `1.5px solid ${syncMode === 'project' ? 'var(--accent)' : 'var(--border2)'}`, background: syncMode === 'project' ? 'var(--accent-dim)' : 'var(--surface3)', color: syncMode === 'project' ? 'var(--accent)' : 'var(--text3)' }}
          >
            <div>Project</div>
            <div style={{ fontSize: 9, fontWeight: 400, marginTop: 2, opacity: 0.8 }}>All issues from Jira project</div>
          </button>
          <button
            type="button" onClick={() => setSyncMode('board')}
            style={{ padding: '8px 10px', fontSize: 11, fontWeight: 600, borderRadius: 6, cursor: 'pointer', textAlign: 'left', border: `1.5px solid ${syncMode === 'board' ? 'var(--accent)' : 'var(--border2)'}`, background: syncMode === 'board' ? 'var(--accent-dim)' : 'var(--surface3)', color: syncMode === 'board' ? 'var(--accent)' : 'var(--text3)' }}
          >
            <div>Board / Sprint</div>
            <div style={{ fontSize: 9, fontWeight: 400, marginTop: 2, opacity: 0.8 }}>Only this board's active sprint</div>
          </button>
        </div>
      </div>

      {/* Row 3: credentials */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div>
          <span style={labelStyle}>Email</span>
          <input style={inputStyle} placeholder="you@company.com" value={conn.email} onChange={(e) => patch('email', e.target.value)} />
        </div>
        <div>
          <span style={labelStyle}>
            API Token{' '}
            <a href="https://id.atlassian.com/manage-profile/security/api-tokens" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', textDecoration: 'none' }}>↗ create</a>
          </span>
          <div style={{ position: 'relative' }}>
            <input style={{ ...inputStyle, paddingRight: 32 }} type={showToken ? 'text' : 'password'} placeholder="API token" value={conn.token} onChange={(e) => patch('token', e.target.value)} />
            <button onClick={() => setShowToken((s) => !s)} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--text3)' }}>{showToken ? '🙈' : '👁'}</button>
          </div>
        </div>
      </div>

      {/* Row 4: mode-specific URL fields */}
      {syncMode === 'project' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div>
              <span style={labelStyle}>Jira base URL</span>
              <input style={inputStyle} placeholder="https://company.atlassian.net" value={conn.baseUrl} onChange={(e) => patch('baseUrl', e.target.value.trim().replace(/\/$/, ''))} />
            </div>
            <div>
              <span style={labelStyle}>Project keys (comma-sep, empty = all)</span>
              <input style={inputStyle} placeholder="PROJ, MOBILE" value={projectKeysRaw} onChange={(e) => commitKeys(e.target.value)} />
            </div>
          </div>
          {/* Board filter */}
          <div style={{ background: 'var(--surface3)', border: '1px solid var(--border)', borderRadius: 6, padding: '10px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ ...labelStyle, marginBottom: 0 }}>Show only selected boards (empty = all)</span>
              <button
                type="button"
                onClick={loadBoards}
                disabled={fetchingBoards || !conn.baseUrl || !conn.token}
                style={{ fontSize: 10, fontFamily: 'var(--mono)', background: 'var(--accent-dim)', border: '1px solid var(--accent-border)', color: 'var(--accent)', borderRadius: 5, padding: '3px 9px', cursor: 'pointer', opacity: !conn.baseUrl || !conn.token ? 0.4 : 1 }}
              >
                {fetchingBoards ? '…loading' : '⟳ Load boards'}
              </button>
            </div>
            {boards.length === 0 && (conn.allowedBoardIds?.length ?? 0) === 0 && (
              <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--text4)' }}>Click "Load boards" to fetch available boards and filter which ones to sync.</div>
            )}
            {(conn.allowedBoardIds?.length ?? 0) > 0 && boards.length === 0 && (
              <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--accent)' }}>
                {conn.allowedBoardIds!.length} board(s) selected · click "Load boards" to change
              </div>
            )}
            {boards.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 160, overflowY: 'auto' }}>
                {boards.map((b) => {
                  const checked = (conn.allowedBoardIds ?? []).includes(b.id)
                  return (
                    <label key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', padding: '3px 2px', borderRadius: 4, background: checked ? 'var(--accent-dim)' : 'transparent' }}>
                      <input type="checkbox" checked={checked} onChange={() => toggleAllowedBoard(b.id)} style={{ width: 12, height: 12, flexShrink: 0 }} />
                      <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: checked ? 'var(--accent)' : 'var(--text2)', flex: 1 }}>{b.name}</span>
                      <span style={{ fontSize: 9, color: 'var(--text4)', textTransform: 'uppercase', letterSpacing: '.5px' }}>{b.type}</span>
                    </label>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div>
          <span style={labelStyle}>Board URL — paste your Jira board link</span>
          <input
            style={inputStyle}
            placeholder="https://company.atlassian.net/jira/software/projects/KEY/boards/123"
            defaultValue={conn.boardId ? `${conn.baseUrl}/jira/software/projects/_/boards/${conn.boardId}` : ''}
            onChange={(e) => handleBoardUrlChange(e.target.value)}
          />
          {conn.boardId && (
            <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--green)', marginTop: 3 }}>
              Board #{conn.boardId} · {conn.baseUrl}
            </div>
          )}
        </div>
      )}

      {/* Row 5: auto-sync */}
      <div>
        <span style={labelStyle}>Auto-sync interval</span>
        <select value={conn.syncInterval} onChange={(e) => patch('syncInterval', Number(e.target.value))} style={{ ...inputStyle, cursor: 'pointer', width: 'auto', minWidth: 140 }}>
          <option value={0}>Manual only</option>
          <option value={2}>Every 2 min</option>
          <option value={5}>Every 5 min</option>
          <option value={10}>Every 10 min</option>
          <option value={15}>Every 15 min</option>
          <option value={30}>Every 30 min</option>
        </select>
      </div>

      {/* test */}
      {testResult && (
        <div style={{ fontSize: 11, padding: '7px 10px', borderRadius: 6, background: testResult.ok ? '#dcfce7' : '#fee2e2', color: testResult.ok ? '#15803d' : '#b91c1c', border: `1px solid ${testResult.ok ? '#86efac' : '#fca5a5'}`, fontFamily: 'var(--mono)' }}>
          {testResult.msg}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={testConnection} disabled={testing || !conn.baseUrl || !conn.token} style={{ background: 'var(--surface3)', border: '1px solid var(--border)', color: 'var(--text2)', fontFamily: 'var(--mono)', fontSize: 11, padding: '5px 12px', borderRadius: 6, cursor: 'pointer', opacity: !conn.baseUrl || !conn.token ? 0.5 : 1 }}>
          {testing ? '…testing' : 'Test connection'}
        </button>
        {conn.lastSync && (
          <span style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--mono)' }}>
            Last sync: {formatDateTime(conn.lastSync)}{conn.lastSyncResult ? ` — ${conn.lastSyncResult}` : ''}
          </span>
        )}
      </div>

      {/* ── STATUS GROUPS ── */}
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
        <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.7px', marginBottom: 8 }}>Display groups</div>
        <GroupManager groups={groups} onChange={(g) => onChange({ ...conn, statusGroups: g })} />
      </div>

      {/* ── STATUS MAPPING ── */}
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.7px' }}>Jira status → group</span>
          <button onClick={fetchStatuses} disabled={fetchingStatuses || !conn.baseUrl || !conn.token} style={{ fontSize: 10, fontFamily: 'var(--mono)', fontWeight: 500, background: 'var(--accent-dim)', border: '1px solid var(--accent-border)', color: 'var(--accent)', borderRadius: 5, padding: '3px 9px', cursor: 'pointer', opacity: !conn.baseUrl || !conn.token ? 0.4 : 1 }}>
            {fetchingStatuses ? '…loading' : '⟳ Fetch statuses'}
          </button>
        </div>
        {statuses.length > 0 ? (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 20px 1fr', gap: 6, padding: '0 2px', marginBottom: 4 }}>
              <span style={{ fontSize: 9, fontFamily: 'var(--mono)', color: 'var(--text4)', textTransform: 'uppercase', letterSpacing: '.6px' }}>Jira status</span>
              <span />
              <span style={{ fontSize: 9, fontFamily: 'var(--mono)', color: 'var(--text4)', textTransform: 'uppercase', letterSpacing: '.6px' }}>Show as group</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {statuses.map((s, i) => (
                <MappingRow key={s.name} info={s} mapping={mappings[i] ?? { jiraStatus: s.name, groupId: 'todo' }} groups={groups} onChange={(m) => updateMapping(i, m)} />
              ))}
            </div>
            <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--text3)', background: 'var(--surface3)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px', marginTop: 8, lineHeight: 1.5 }}>
              <strong style={{ color: 'var(--text2)' }}>hidden</strong> — synced but not shown. Groups marked <strong style={{ color: 'var(--text2)' }}>closed</strong> remove issues from the daily board.
            </div>
          </>
        ) : (
          <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--text4)', padding: '6px 2px' }}>
            Click "Fetch statuses" to load your Jira statuses and map them to display groups.
          </div>
        )}
      </div>

      {/* ── DEVELOPERS ── */}
      {developers.length > 0 && (
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
          <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.7px', marginBottom: 8 }}>Developers in this connection</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {developers.filter((d) => d.id in (conn.developerEmails ?? {})).map((d) => (
              <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: d.color, flexShrink: 0 }} />
                <span style={{ fontSize: 12, color: 'var(--text)', width: 110, flexShrink: 0 }}>{d.name}</span>
                <input style={{ ...inputStyle, flex: 1 }} placeholder="jira@company.com" value={conn.developerEmails?.[d.id] ?? ''} onChange={(e) => setDevEmail(d.id, e.target.value)} />
                <button onClick={() => removeDev(d.id)} style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: 13, padding: '0 2px' }}>✕</button>
              </div>
            ))}
            {developers.some((d) => !(d.id in (conn.developerEmails ?? {}))) && (
              <select value="" onChange={(e) => { if (e.target.value) addDev(e.target.value) }} style={{ ...inputStyle, color: 'var(--text3)', cursor: 'pointer' }}>
                <option value="">+ Add developer…</option>
                {developers.filter((d) => !(d.id in (conn.developerEmails ?? {}))).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main Modal ─────────────────────────────────────────────────
export default function JiraConfigModal({ onClose, projectId }: Props) {
  const { jiraConnections, developers, setJiraConnections, syncJira } = useStore()
  const filteredConns = projectId ? jiraConnections.filter((c) => c.projectId === projectId) : jiraConnections
  const [conns, setConns] = useState<JiraConfig[]>(filteredConns.length ? filteredConns : [makeEmptyConn(projectId)])
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<string | null>(null)

  function updateConn(idx: number, c: JiraConfig) {
    setConns((prev) => prev.map((x, i) => (i === idx ? c : x)))
  }

  function save() {
    if (projectId) {
      // Merge: keep connections not belonging to this project, replace this project's connections
      const others = jiraConnections.filter((c) => c.projectId !== projectId)
      setJiraConnections([...others, ...conns])
    } else {
      setJiraConnections(conns)
    }
    onClose()
  }

  async function handleSyncNow() {
    if (projectId) {
      const others = jiraConnections.filter((c) => c.projectId !== projectId)
      setJiraConnections([...others, ...conns])
    } else {
      setJiraConnections(conns)
    }
    setSyncing(true); setSyncResult(null)
    try {
      const { added, updated, removed } = await syncJira()
      setSyncResult(`✓ Synced — ${added} added, ${updated} updated${removed ? `, ${removed} closed removed` : ''}`)
    } catch (err) { setSyncResult(`✗ ${(err as Error).message}`) }
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
          <button className="btn-secondary" style={{ marginRight: 'auto', fontFamily: 'var(--mono)', opacity: !anyEnabled ? 0.4 : 1 }} onClick={handleSyncNow} disabled={syncing || !anyEnabled}>
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
            <ConnForm key={c.id} conn={c} developers={developers}
              onChange={(updated) => updateConn(i, updated)}
              onDelete={() => setConns((prev) => prev.filter((_, j) => j !== i))}
              isOnly={conns.length === 1}
            />
          ))}
        </div>
        <button onClick={() => setConns((prev) => [...prev, makeEmptyConn(projectId)])} style={{ alignSelf: 'flex-start', background: 'var(--surface2)', border: '1px dashed var(--border)', color: 'var(--text2)', fontFamily: 'var(--mono)', fontSize: 11, padding: '6px 14px', borderRadius: 6, cursor: 'pointer' }}>
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
