import { useEffect, useState } from 'react'
import { useStore, getBoardScope, jiraOnBoard } from '../../store'
import { STATUS_LABEL } from '../../constants'
import { resolveIssueDisplay } from '../ui/StatusBadge'
import { getJiras, jiraLabel, jiraDedupeKey, hexRgb, initials } from '../../utils/format'
import { dlInfo } from '../../utils/dates'
import { searchTasks, type RemoteTask } from '../../utils/cloud-api'
import type { Status, Task, JiraIssue, Developer, Project } from '../../types'
import EmptyState from '../ui/EmptyState'
import Icon from '../ui/Icon'
import Pagination from '../ui/Pagination'
import LoadingSpinner from '../ui/LoadingSpinner'

const PAGE_SIZE = 25
const DEBOUNCE_MS = 300

type StatusFilter = 'ALL' | Status

interface IssueResult {
  key: string
  issue: JiraIssue
  task: Task
  dev: Developer | undefined
  proj: Project | undefined
  issueKey: string | null  // extracted from URL via regex, e.g. "NML-3776"
}

interface PlainResult {
  task: Task
  dev: Developer | undefined
  proj: Project | undefined
}

// Reconstruct a Task-shaped object from a server RemoteTask row so the
// existing getJiras()/rendering logic (built around the local Task type)
// keeps working unmodified. `rest` carries every Task field beyond the ones
// the backend broke out into real columns (pr, prs, deadline, etc — see
// syncTasksFromState on the backend, which is the mirror of this).
function toLocalTask(remote: RemoteTask): Task {
  return {
    id: remote.clientId,
    devId: remote.devId,
    projectId: remote.projectId,
    title: remote.title,
    status: remote.status as Status,
    jira: '',
    jiras: remote.jiras as unknown as JiraIssue[],
    pr: '',
    prs: [],
    deadline: '',
    deadlineTime: '',
    reviewDate: '',
    reviewTime: '',
    comment: remote.comment ?? '',
    date: remote.date,
    ...(remote.rest as Partial<Task>),
  }
}

export default function SearchView() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [remoteTasks, setRemoteTasks] = useState<RemoteTask[]>([])
  const [totalPages, setTotalPages] = useState(1)
  const [totalCount, setTotalCount] = useState(0)
  const [fetchFailed, setFetchFailed] = useState(false)

  // Search has its own project filter, independent of the globally-selected
  // project elsewhere in the app (Daily/Reports) — otherwise leaving a board
  // selected there silently narrows search results to that board's issues,
  // making a valid issue key search on progressor.work: reproduces with
  // Daily on a scrum board's project, switch to Search, search another
  // board's issue key — a real search-not-found bug caused by inherited scope.
  const [searchProjectId, setSearchProjectId] = useState<string>('ALL')

  const state = useStore()
  const {
    developers, projects,
    searchQuery, setSearchQuery, jiraConnections,
    setSelectedDate, setSelectedDev, setSelectedProject, setHighlightedTaskId, setView,
  } = state
  const conn = jiraConnections.find((c) => c.enabled && c.statusMappings?.length)

  // Scope search to searchProjectId's board just like Daily / Reports do for
  // their own selection — not the app-wide selectedProject.
  const boardScope = getBoardScope({ ...state, selectedProject: searchProjectId })

  const q = searchQuery.trim()

  // Reset to page 1 whenever the query/filters change, then fetch that page.
  useEffect(() => { setPage(1) }, [q, statusFilter, searchProjectId])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setFetchFailed(false)

    // The backend intermittently 500s under load — retry a couple of times
    // with backoff before surfacing failure, instead of making the user
    // manually retype/refresh to get a fresh attempt.
    const RETRY_DELAYS_MS = [800, 2000]
    const runFetch = (attempt: number) => {
      void searchTasks({
        q: q || undefined,
        projectId: searchProjectId !== 'ALL' ? searchProjectId : undefined,
        status: statusFilter !== 'ALL' ? statusFilter : undefined,
        page,
        take: PAGE_SIZE,
      }).then((result) => {
        if (cancelled) return
        if (!result) {
          if (attempt < RETRY_DELAYS_MS.length) {
            setTimeout(() => runFetch(attempt + 1), RETRY_DELAYS_MS[attempt])
            return
          }
          setLoading(false)
          setFetchFailed(true); setRemoteTasks([]); setTotalPages(1); setTotalCount(0)
          return
        }
        setLoading(false)
        setRemoteTasks(result.data)
        setTotalPages(Math.max(1, result.meta.pageCount))
        setTotalCount(result.meta.itemCount)
      })
    }
    const handle = setTimeout(() => runFetch(0), DEBOUNCE_MS)
    return () => { cancelled = true; clearTimeout(handle) }
  }, [q, statusFilter, searchProjectId, page])

  const devById = new Map(developers.map((d) => [d.id, d]))
  const projById = new Map(projects.map((p) => [p.id, p]))

  // Expand this page's tasks into per-issue cards, applying the board-scope
  // filtering the backend doesn't know about — same behavior as before,
  // just applied to a server-fetched page instead of the full local list.
  // Unlike Daily/Reports, Search intentionally does NOT exclude archived
  // developers' tasks — searching by issue key should find historical work
  // regardless of whether the assignee is still active.
  const issueResults: IssueResult[] = []
  const plainResults: PlainResult[] = []
  const seenIssueKeys = new Set<string>()
  const seenPlainKeys = new Set<string>()

  const qLower = q.toLowerCase()

  for (const remote of remoteTasks) {
    const task = toLocalTask(remote)
    const jiras = getJiras(task)

    // The backend matches a task if q appears ANYWHERE on it (title, comment,
    // or any embedded jira's name/url) — a single task can carry dozens of
    // jiras (e.g. recurring "Daily update" tasks), so without this filter
    // every unrelated jira on a matched task gets expanded into its own
    // card, burying the one that actually matched.
    const jirasToShow = qLower
      ? jiras.filter((issue) => issue.name?.toLowerCase().includes(qLower) || issue.url?.toLowerCase().includes(qLower))
      : jiras

    if (jirasToShow.length) {
      for (const issue of jirasToShow) {
        if (issue.hidden) continue
        if (!jiraOnBoard(issue, boardScope)) continue
        if (statusFilter !== 'ALL' && issue.status !== statusFilter) continue
        const dk = jiraLabel(issue.url) ?? jiraDedupeKey(issue.url, issue.name)
        const key = `${task.devId}|${dk}`
        if (seenIssueKeys.has(key)) continue
        seenIssueKeys.add(key)
        issueResults.push({
          key,
          issue,
          task,
          dev: devById.get(task.devId),
          proj: projById.get(task.projectId),
          issueKey: jiraLabel(issue.url),
        })
      }
    } else if (task.title || task.comment) {
      if (statusFilter !== 'ALL' && task.status !== statusFilter) continue
      const pk = `${task.devId}|title:${task.title}`
      if (seenPlainKeys.has(pk)) continue
      seenPlainKeys.add(pk)
      plainResults.push({ task, dev: devById.get(task.devId), proj: projById.get(task.projectId) })
    }
  }

  // Merge into one date-sorted list, matching the server page's own order —
  // a single continuous list rather than issues-then-plain-tasks blocks.
  type MergedResult = { kind: 'issue'; r: IssueResult } | { kind: 'plain'; r: PlainResult }
  const pageItems: MergedResult[] = [
    ...issueResults.map((r): MergedResult => ({ kind: 'issue', r })),
    ...plainResults.map((r): MergedResult => ({ kind: 'plain', r })),
  ].sort((a, b) => b.r.task.date.localeCompare(a.r.task.date))

  // ── Highlight helper ──────────────────────────────────────────────────────────
  const escHtml = (s: string) =>
    s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

  const hl = (str: string) => {
    const safe = escHtml(str)
    if (!q) return safe
    return safe.replace(
      new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi'),
      '<mark style="background:var(--amber-dim);color:var(--text);border-radius:2px;padding:0 2px">$1</mark>',
    )
  }

  const jumpTo = (task: Task) => {
    setSelectedDev('ALL')
    setSelectedProject('ALL')
    setSelectedDate(task.date)
    setHighlightedTaskId(task.id)
    setView('daily')
  }

  const statuses: StatusFilter[] = ['ALL', 'todo', 'inprogress', 'review', 'done', 'blocked']

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* search bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--surface)', border: `1px solid ${q ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 'var(--rl)', padding: '8px 14px', boxShadow: 'var(--shadow)', transition: 'border-color .15s' }}>
        <Icon name="search" size={15} color={q ? 'var(--accent)' : 'var(--text3)'} />
        <input
          autoFocus
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search by issue key (NML-123), name, developer, project…"
          style={{ flex: 1, border: 'none', outline: 'none', fontSize: 14, color: 'var(--text)', background: 'transparent' }}
        />
        {loading && <LoadingSpinner size={14} />}
        {q && (
          <button onClick={() => setSearchQuery('')} style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: 14, padding: '2px 4px' }}>✕</button>
        )}
      </div>

      {/* status + project filters */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {statuses.map((s) => (
          <button
            key={s}
            className={`chip${statusFilter === s ? ' active' : ''}`}
            onClick={() => setStatusFilter(s)}
          >
            {s === 'ALL' ? 'All statuses' : STATUS_LABEL[s]}
          </button>
        ))}
        <select
          value={searchProjectId}
          onChange={(e) => setSearchProjectId(e.target.value)}
          style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text2)', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--rs)', padding: '6px 10px', cursor: 'pointer' }}
        >
          <option value="ALL">All projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      {/* count */}
      <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)' }}>
        {fetchFailed
          ? 'Search is temporarily unavailable — check your connection.'
          : q || statusFilter !== 'ALL'
            ? `${totalCount} task${totalCount !== 1 ? 's' : ''} matched${q ? ` "${q}"` : ''}`
            : `${totalCount} task${totalCount !== 1 ? 's' : ''} total`}
      </div>

      {/* results */}
      {!loading && pageItems.length === 0 ? (
        <EmptyState icon="search" title="No results" hint="Try different keywords or filters" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {pageItems.map((item) => item.kind === 'issue' ? (() => {
            const { issue, task, dev, proj, issueKey } = item.r
            const rgb = dev ? hexRgb(dev.color) : '37,99,235'
            const devColor = dev?.color ?? 'var(--accent)'
            const dl = issue.deadline ? dlInfo(issue.deadline) : null
            const { label: issueStatusLabel, text: statusColor } = resolveIssueDisplay(issue, conn)

            return (
              <div
                key={item.r.key}
                onClick={() => jumpTo(task)}
                style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--rl)', padding: '11px 13px', cursor: 'pointer', transition: 'all .15s' }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.boxShadow = 'var(--shadow)' }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.boxShadow = '' }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
                  {/* issue key badge */}
                  {issueKey && (
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: 'var(--surface3)', color: 'var(--text2)', border: '1px solid var(--border)', flexShrink: 0, whiteSpace: 'nowrap' }}
                      dangerouslySetInnerHTML={{ __html: hl(issueKey) }}
                    />
                  )}
                  <span
                    style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', flex: 1, minWidth: 0 }}
                    dangerouslySetInnerHTML={{ __html: hl(issue.name || issue.url || 'Issue') }}
                  />
                  {dl && (
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: dl.cls === 'dl-over' ? 'var(--red)' : dl.cls === 'dl-warn' ? 'var(--amber)' : 'var(--green)', flexShrink: 0, whiteSpace: 'nowrap' }}>
                      {dl.text}
                    </span>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  {/* status dot */}
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: 'var(--mono)', fontSize: 10, color: statusColor }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: statusColor, flexShrink: 0 }} />
                    {issueStatusLabel}
                  </span>

                  {issue.issueTypeName && (
                    <span title={issue.issueTypeName} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)' }}>
                      {issue.issueTypeIconUrl && <img src={issue.issueTypeIconUrl} alt="" width={10} height={10} style={{ display: 'block' }} />}
                      {issue.issueTypeName}
                    </span>
                  )}

                  {dev && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <div className="av" style={{ background: `rgba(${rgb},.15)`, color: devColor, width: 16, height: 16, fontSize: 8, flexShrink: 0 }}>{initials(dev.name)}</div>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)' }} dangerouslySetInnerHTML={{ __html: hl(dev.name) }} />
                    </div>
                  )}

                  {proj && (
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 10, padding: '1px 6px', borderRadius: 3, background: proj.color + '18', color: proj.color }}
                      dangerouslySetInnerHTML={{ __html: hl(proj.name) }}
                    />
                  )}

                  <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)' }}>{task.date}</span>

                  {issue.comment && (
                    <span style={{ fontSize: 11, color: 'var(--text3)', fontStyle: 'italic' }}
                      dangerouslySetInnerHTML={{ __html: hl(issue.comment.slice(0, 80) + (issue.comment.length > 80 ? '…' : '')) }}
                    />
                  )}
                </div>
              </div>
            )
          })() : (() => {
            const { task, dev, proj } = item.r
            const rgb = dev ? hexRgb(dev.color) : '37,99,235'
            const devColor = dev?.color ?? 'var(--accent)'
            return (
              <div
                key={task.id}
                onClick={() => jumpTo(task)}
                style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderLeft: '3px solid var(--border)', borderRadius: 'var(--rl)', padding: '11px 13px', cursor: 'pointer', transition: 'all .15s', opacity: 0.85 }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.boxShadow = 'var(--shadow)' }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.boxShadow = '' }}
              >
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', marginBottom: 5 }}
                  dangerouslySetInnerHTML={{ __html: hl(task.title) }}
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span className={`spill s-${task.status}`} style={{ marginTop: 0 }}>{STATUS_LABEL[task.status]}</span>
                  {dev && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <div className="av" style={{ background: `rgba(${rgb},.15)`, color: devColor, width: 16, height: 16, fontSize: 8, flexShrink: 0 }}>{initials(dev.name)}</div>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)' }}>{dev.name}</span>
                    </div>
                  )}
                  {proj && <span style={{ fontFamily: 'var(--mono)', fontSize: 10, padding: '1px 6px', borderRadius: 3, background: proj.color + '18', color: proj.color }}>{proj.name}</span>}
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)' }}>{task.date}</span>
                  {task.comment && (
                    <span style={{ fontSize: 11, color: 'var(--text3)', fontStyle: 'italic' }}
                      dangerouslySetInnerHTML={{ __html: hl(task.comment.slice(0, 60) + (task.comment.length > 60 ? '…' : '')) }}
                    />
                  )}
                </div>
              </div>
            )
          })())}
        </div>
      )}
      <Pagination page={page} totalPages={totalPages} onChange={setPage} />
    </div>
  )
}
