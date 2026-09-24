import type { AppState, JiraConfig, JiraIssue, PrEntry, Task } from '../types'
import { hasCredential } from './credentials'
import {
  buildJqlStatusFilter, fetchBoardIssueKeys, fetchJiraBoardIssues, fetchJiraIssues, fetchJiraTimeTracking,
  mergeStatusHistory, rawToJiraItem, type JiraIssueRaw,
} from './jira-api'
import { identityList, jiraDedupeKey } from './keys'
import type { Transport } from './transport'
import { makeId, pause, sortJiraIssues } from './util'

/*
 * The Jira sync, shared by the web app and the server. `computeJiraSync` does the network
 * work against a snapshot of the state; `applyJiraSync` folds the result into the state as
 * it is when the work finishes, so edits made meanwhile are kept.
 */

export type SyncState = Pick<AppState, 'developers' | 'projects' | 'tasks' | 'jiraConnections' | 'gitlabConnections' | 'githubConnections'>

export interface SyncRun {
  // An automatic sync (startup, timer, server schedule) rather than one the user asked for.
  // Background syncs may be incremental; manual ones are always full.
  background?: boolean
  // The tracker's current workday, YYYY-MM-DD, in the tracker's timezone.
  today: string
  // The tracker's timezone, for PR/MR timestamps.
  tz: string
}

// A full Jira sync -- the only kind allowed to prune issues -- runs at least this often.
export const FULL_SYNC_EVERY_MS = 6 * 60 * 60 * 1000

export interface JiraSyncCounts { added: number; updated: number; removed: number }

export interface JiraSyncPlan {
  counts: JiraSyncCounts
  dedupedTasks: Task[]
  newTasks: Task[]
  syncedConns: JiraConfig[]
  issueIdToBoardId: Map<string, number>
  boardKeyUpdates: Map<string, string[]>
}

export async function computeJiraSync(state: SyncState, transport: Transport, run: SyncRun): Promise<JiraSyncPlan> {
  const { jiraConnections, developers, tasks, projects } = state
  const enabledConns = jiraConnections.filter((c) => c.enabled && c.baseUrl && hasCredential(c))
  if (!enabledConns.length) throw new Error('No Jira connections configured')

  const today = run.today
  let added = 0
  let updated = 0
  let removed = 0

  const tasksCopy = tasks.map((t) => ({
    ...t,
    jiras: [...(t.jiras ?? [])],
    jiraSync: t.jiraSync || t.title === 'Jira Issues' || undefined,
  }))

  // Collapse duplicate sync tasks for the same developer and day -- but only WITHIN a
  // project. Keying on devId+date alone merged a developer's tasks across projects and
  // deleted all but one, so a developer on two projects permanently lost one project's
  // issues on the next sync (and after a reload, since the merge is what gets saved).
  const mergedIds = new Set<string>()
  const primarySyncTask = new Map<string, typeof tasksCopy[number]>()
  tasksCopy.forEach((t) => {
    if (!t.jiraSync) return
    const key = `${t.projectId ?? ''}_${t.devId}_${t.date}`
    const primary = primarySyncTask.get(key)
    if (!primary) {
      primarySyncTask.set(key, t)
    } else {
      ;(t.jiras ?? []).forEach((j) => {
        const k = jiraDedupeKey(j.url, j.name)
        const alreadyIn = primary.jiras.some((ej) => {
          const ek = jiraDedupeKey(ej.url, ej.name)
          return (k && k !== 'name:' && ek === k) || ej.url === j.url
        })
        if (!alreadyIn) primary.jiras.push(j)
      })
      if (t.deletedJiraUrls?.length) {
        primary.deletedJiraUrls = [...new Set([...(primary.deletedJiraUrls ?? []), ...t.deletedJiraUrls])]
      }
      mergedIds.add(t.id)
    }
  })
  const dedupedTasks = tasksCopy.filter((t) => !mergedIds.has(t.id))
  const newTasks: Task[] = []

  const syncedConns: JiraConfig[] = []

  for (const conn of enabledConns) {
    const projList = conn.projectKeys.map((k) => `"${k.trim()}"`).join(',')
    // A developer can hold several Jira identities (separate instances, a renamed
    // account). `emails` carries all of them; `email` is the primary, used where a
    // single value is required (the board API takes one assignee per call).
    const connDevs = developers
      .map((d) => {
        const emails = identityList(conn.developerEmails?.[d.id])
        return { dev: d, emails, email: emails[0] ?? '' }
      })
      .filter((x) => x.emails.length > 0)

    // Resolve effective board ID: project's jiraBoardId takes priority over conn.boardId
    const linkedProj = conn.projectId ? projects.find((p) => p.id === conn.projectId) : null
    const effectiveBoardId = linkedProj?.jiraBoardId ?? conn.boardId

    /*
     * Incremental sync: a background sync fetches only issues updated since the last
     * one (the window is relative, so Jira evaluates it in its own timezone, with a
     * margin for clock skew). An incremental fetch cannot prove an issue is gone, so it
     * never prunes; a full sync -- every manual sync, and a background one at least
     * every FULL_SYNC_EVERY_MS -- is the only kind allowed to delete. Board mode stays
     * full every time: its pruning depends on complete board membership.
     */
    const boardMode = !!effectiveBoardId || !!conn.allowedBoardIds?.length
    const lastSyncAt = conn.lastSync ? Date.parse(conn.lastSync) : 0
    const lastFullAt = conn.lastFullSync ? Date.parse(conn.lastFullSync) : 0
    const incremental = !!run.background && !boardMode && lastSyncAt > 0 && lastFullAt > 0
      && Date.now() - lastFullAt < FULL_SYNC_EVERY_MS
    const sinceClause = incremental ? `updated >= -${Math.ceil((Date.now() - lastSyncAt) / 60_000) + 10}m` : ''

    // Each developer's issues, already in the app's compact form: the raw Jira JSON is
    // dropped as soon as a developer is fetched, so a sync never holds every developer's
    // raw responses at once (that exhausted the server's memory).
    const byDev = new Map<string, JiraIssue[]>()
    // Track devs whose fetch succeeded, and the full set of issue keys Jira returned
    // for each. Used to prune issues that were deleted/reassigned away in Jira.
    const fetchedDevs = new Set<string>()
    const returnedKeysByDev = new Map<string, Set<string>>()
    // Devs whose fetch was cut short by a backend memory-safety cap — pruning MUST skip
    // these, since an issue's absence here doesn't mean it's no longer assigned, only
    // that it didn't fit within the cap. Treating a truncated response as complete would
    // wrongly delete issues that are still genuinely assigned (this happened in
    // production — see the commit that added this comment).
    const truncatedDevs = new Set<string>()
    for (const { dev, emails } of connDevs) {
      let devIssues: JiraIssueRaw[]
      let truncated = false
      // Merge issues fetched across a developer's identities, keyed by issue key so
      // the same issue found under two accounts appears once.
      const dedupe = (lists: JiraIssueRaw[][]): JiraIssueRaw[] => {
        const seen = new Set<string>()
        return lists.flat().filter((issue) => {
          if (seen.has(issue.key)) return false
          seen.add(issue.key)
          return true
        })
      }
      try {
      if (effectiveBoardId) {
        // Board mode: one board, one assignee per call — so query each identity.
        const perEmail = await Promise.all(
          emails.map((e) =>
            fetchJiraBoardIssues(transport, conn, effectiveBoardId, e).catch(() => ({ issues: [] as JiraIssueRaw[], truncated: false }))
          )
        )
        truncated = perEmail.some((r) => r.truncated)
        devIssues = dedupe(perEmail.map((r) => r.issues))
      } else if (conn.allowedBoardIds?.length) {
        // Project mode with board filter: every allowed board × every identity.
        const perBoard = await Promise.all(
          conn.allowedBoardIds.flatMap((bid) =>
            emails.map((e) =>
              fetchJiraBoardIssues(transport, conn, bid, e).catch(() => ({ issues: [] as JiraIssueRaw[], truncated: false }))
            )
          )
        )
        truncated = perBoard.some((r) => r.truncated)
        devIssues = dedupe(perBoard.map((r) => r.issues))
      } else {
        const statusFilter = buildJqlStatusFilter(conn.statusMappings)
        // Match every identity by both the full email AND the username (local-part
        // before @) — some Jira instances identify users by username, not email, so
        // `assignee = "email"` alone silently misses those issues.
        const assigneeVals = [...new Set(
          emails.flatMap((e) => [e, e.includes('@') ? e.slice(0, e.indexOf('@')) : e]),
        )].map((v) => `"${v}"`).join(', ')
        const assigneeClause = `assignee in (${assigneeVals})`
        const projClause = projList ? `project in (${projList})` : ''
        const buildJql = (withStatus: boolean) =>
          [projClause, assigneeClause, sinceClause, withStatus ? statusFilter : '']
            .filter(Boolean)
            .join(' AND ') + ' ORDER BY updated DESC'
        let r: { issues: JiraIssueRaw[]; truncated: boolean }
        try {
          r = await fetchJiraIssues(transport, conn, buildJql(true))
        } catch (e) {
          // The status filter (built from status-group mappings) can reference a status
          // name that no longer exists in Jira, which makes the whole query 500 and
          // silently drops that developer's issues. Retry WITHOUT the status filter so
          // the issues still sync.
          console.warn('[sync] status-filtered search failed, retrying without status filter:', e)
          r = await fetchJiraIssues(transport, conn, buildJql(false))
        }
        devIssues = r.issues
        truncated = r.truncated
      }
      } catch {
        // Fetch failed for this dev — skip pruning to avoid wiping issues on a transient error.
        continue
      }
      fetchedDevs.add(dev.id)
      if (truncated) truncatedDevs.add(dev.id)
      returnedKeysByDev.set(dev.id, new Set(devIssues.map((i) => i.key)))
      if (devIssues.length) byDev.set(dev.id, devIssues.map((i) => rawToJiraItem(i, conn.baseUrl, conn.statusMappings, effectiveBoardId)))
    }

    let connAdded = 0
    let connUpdated = 0
    let connRemoved = 0

    const mergeDeveloper = (devIssues: JiraIssue[], devId: string): void => {
      // Scope to this connection's project. Matching on devId+date alone meant a
      // developer who works on two projects had both projects' issues land on whichever
      // project's task synced first, so the other project showed nothing for them.
      const connProjectId = conn.projectId ?? ''
      const inProject = (t: typeof dedupedTasks[number]) => (t.projectId ?? '') === connProjectId
      const syncTask =
        dedupedTasks.find((t) => t.devId === devId && t.date === today && inProject(t) && t.jiraSync) ??
        dedupedTasks.find((t) => t.devId === devId && t.date === today && inProject(t))

      const incoming = devIssues
      const todayTasks = dedupedTasks.filter((t) => t.devId === devId && t.date === today && inProject(t))

      const keyToTask = new Map<string, { task: typeof dedupedTasks[number]; idx: number }>()
      todayTasks.forEach((t) => {
        ;(t.jiras ?? []).forEach((j, idx) => {
          const k = jiraDedupeKey(j.url, j.name)
          if (k && k !== 'name:') keyToTask.set(k, { task: t, idx })
        })
      })

      const trulyNew: typeof incoming = []
      // If Jira returns an issue that was previously removed, it's genuinely assigned
      // and active again — clear it from the deleted list so it comes back. (deletedJiraUrls
      // must not be a permanent blocklist against Jira re-adding an active issue.)
      const incomingUrls = new Set(incoming.map((nj) => nj.url))
      dedupedTasks.forEach((t) => {
        if (t.devId !== devId || !t.deletedJiraUrls?.length) return
        const kept = t.deletedJiraUrls.filter((u) => !incomingUrls.has(u))
        if (kept.length !== t.deletedJiraUrls.length) t.deletedJiraUrls = kept
      })

      // Where each existing issue sits in the day's task, by key and by URL (first one wins,
      // as findIndex did). Replacing an issue in place keeps its key and URL, so the
      // positions stay right for the whole loop; new issues are only appended after it.
      const firstByKey = new Map<string, number>()
      const firstByUrl = new Map<string, number>()
      syncTask?.jiras.forEach((ej, idx) => {
        const ejKey = jiraDedupeKey(ej.url, ej.name)
        if (!firstByKey.has(ejKey)) firstByKey.set(ejKey, idx)
        if (!firstByUrl.has(ej.url)) firstByUrl.set(ej.url, idx)
      })

      incoming.forEach((nj) => {
        const njKey = jiraDedupeKey(nj.url, nj.name)

        if (syncTask) {
          const byKey = njKey && njKey !== 'name:' ? firstByKey.get(njKey) : undefined
          const byUrl = firstByUrl.get(nj.url)
          const existIdx = byKey === undefined ? (byUrl ?? -1) : byUrl === undefined ? byKey : Math.min(byKey, byUrl)
          if (existIdx >= 0) {
            const ex = syncTask.jiras[existIdx]!
            // Jira is the source of truth on sync: take the fresh Jira status and
            // clear any manual override (manualStatus is only an optimistic hint
            // between syncs — it must never permanently mask the real Jira status).
            syncTask.jiras[existIdx] = { ...ex, boardId: nj.boardId ?? ex.boardId, status: nj.status, groupId: nj.groupId, manualStatus: undefined, priority: nj.priority, deadline: nj.deadline || ex.deadline, statusHistory: mergeStatusHistory(ex.statusHistory, nj.statusHistory), storyPoints: nj.storyPoints ?? ex.storyPoints, timeOriginalEstimate: nj.timeOriginalEstimate ?? ex.timeOriginalEstimate, timeSpent: nj.timeSpent ?? ex.timeSpent, jiraCreatedAt: nj.jiraCreatedAt ?? ex.jiraCreatedAt, issueTypeName: nj.issueTypeName ?? ex.issueTypeName, issueTypeIconUrl: nj.issueTypeIconUrl ?? ex.issueTypeIconUrl, parentKey: nj.parentKey ?? ex.parentKey, jiraStatusName: nj.jiraStatusName }
            connUpdated++
            return
          }
        }

        if (njKey && njKey !== 'name:' && keyToTask.has(njKey)) {
          const { task, idx } = keyToTask.get(njKey)!
          const ex = task.jiras[idx]!
          // Jira is the source of truth on sync — take fresh status, clear manual override.
          task.jiras[idx] = { ...ex, boardId: nj.boardId ?? ex.boardId, status: nj.status, groupId: nj.groupId, manualStatus: undefined, priority: nj.priority, deadline: nj.deadline || ex.deadline, statusHistory: mergeStatusHistory(ex.statusHistory, nj.statusHistory), storyPoints: nj.storyPoints ?? ex.storyPoints, timeOriginalEstimate: nj.timeOriginalEstimate ?? ex.timeOriginalEstimate, timeSpent: nj.timeSpent ?? ex.timeSpent, issueTypeName: nj.issueTypeName ?? ex.issueTypeName, issueTypeIconUrl: nj.issueTypeIconUrl ?? ex.issueTypeIconUrl, parentKey: nj.parentKey ?? ex.parentKey, jiraStatusName: nj.jiraStatusName }
          connUpdated++
          return
        }

        // Add all fresh issues, including Done/closed — the tracker mirrors Jira.
        trulyNew.push(nj)
      })

      if (trulyNew.length > 0) {
        if (syncTask) {
          syncTask.jiras = [...syncTask.jiras, ...trulyNew]
          connAdded += trulyNew.length
        } else {
          connAdded += trulyNew.length
          newTasks.push({
            id: makeId('t'),
            devId,
            projectId: conn.projectId ?? '',
            title: 'Jira Issues',
            status: 'inprogress',
            jira: '',
            jiras: trulyNew,
            pr: '',
            prs: [],
            deadline: '',
            deadlineTime: '',
            reviewDate: '',
            reviewTime: '',
            comment: '',
            date: today,
            jiraSync: true,
          })
        }
      }

      if (syncTask) {
        syncTask.status = syncTask.jiras.every((j) => j.status === 'done') ? 'done' : 'inprogress'
      }
    }

    // One developer at a time, letting other work run in between: the whole merge in one
    // go blocked the server (and a browser tab) for the length of every developer's issues.
    for (const [devId, devIssues] of byDev) {
      mergeDeveloper(devIssues, devId)
      await pause()
    }

    // Prune issues Jira no longer returns (deleted in Jira, or reassigned away).
    // Runs across ALL tasks (every date) for devs whose fetch succeeded, so a deleted
    // issue disappears from every dashboard — not just today's board.
    const connKeys = conn.projectKeys.map((k) => k.trim().toUpperCase()).filter(Boolean)
    const keyPrefix = (j: JiraIssue): string | undefined => {
      const dk = jiraDedupeKey(j.url, j.name)
      const m = dk.match(/^([A-Z][A-Z0-9]+)-\d+$/)
      return m ? m[1]!.toUpperCase() : undefined
    }
    const jiraTicket = (j: JiraIssue): string | undefined => {
      const dk = jiraDedupeKey(j.url, j.name)
      return /^[A-Z][A-Z0-9]+-\d+$/.test(dk) ? dk : undefined
    }
    if (!incremental && fetchedDevs.size) {
      dedupedTasks.forEach((t) => {
        // A truncated fetch didn't see this dev's full assigned-issue set, so an issue
        // missing from it may simply not have fit the cap, not have been unassigned —
        // pruning here would silently delete issues that are still genuinely assigned.
        if (!fetchedDevs.has(t.devId) || truncatedDevs.has(t.devId) || !t.jiras?.length) return
        // A fetch that SUCCEEDED but returned nothing is not authority to delete. Jira
        // answers with zero issues for all sorts of benign reasons -- a JQL that matched
        // nothing this time, an identity that stopped resolving, a status filter that
        // excluded everything -- and treating that as "the developer has no issues any
        // more" wiped every issue they had. Genuine removals still prune on any sync
        // that returns at least one issue for the developer.
        const returned = returnedKeysByDev.get(t.devId)
        if (!returned || returned.size === 0) return
        // Never prune another project's tasks. A developer on two projects has a task per
        // project, and this connection only knows about its own -- in board mode the check
        // below prunes anything the board didn't return, which would wipe the other
        // project's issues outright.
        if ((t.projectId ?? '') !== (conn.projectId ?? '')) return
        // Prune against THIS dev's own returned keys, not the connection-wide union —
        // otherwise a reassigned issue (still returned for the new assignee) never gets
        // pruned from the old assignee's tasks, duplicating it across both.
        const devReturnedKeys = returnedKeysByDev.get(t.devId) ?? new Set<string>()
        const keep = t.jiras.filter((j) => {
          const ticket = jiraTicket(j)
          if (!ticket) return true                  // manual / non-key issue — never prune
          // In board mode: prune any issue (including done) not returned to this dev by this board.
          // The board API returns exact per-assignee membership — absent = moved/deleted/reassigned.
          if (effectiveBoardId) {
            return devReturnedKeys.has(ticket)
          }
          const pfx = keyPrefix(j)
          // Only prune issues whose prefix belongs to this connection's project keys.
          // Issues from other projects are not our responsibility to prune.
          if (connKeys.length && (!pfx || !connKeys.includes(pfx))) return true
          // For active issues: prune if Jira no longer returns them to this dev (moved/deleted/reassigned).
          // For done issues: also prune if absent — done issues from a moved key should not persist.
          return devReturnedKeys.has(ticket)
        })
        if (keep.length !== t.jiras.length) {
          connRemoved += t.jiras.length - keep.length
          t.jiras = keep
        }
      })
    }

    added += connAdded
    updated += connUpdated
    removed += connRemoved
    // Only fetch working-hours config once (it rarely changes). Avoids hitting
    // jira-time-tracking on every sync, which was producing repeated 403 noise.
    const hoursPerDay = conn.hoursPerDay != null
      ? conn.hoursPerDay
      : await fetchJiraTimeTracking(transport, conn).catch(() => 8)
    syncedConns.push({
      ...conn,
      hoursPerDay,
      lastSync: new Date().toISOString(),
      ...(incremental ? {} : { lastFullSync: new Date().toISOString() }),
      lastSyncResult: `+${connAdded} added, ${connUpdated} updated${connRemoved ? `, ${connRemoved} closed removed` : ''}`,
    })
  }

  // Build a map of issueId → boardId from all synced incoming issues, for backfilling old tasks
  const issueIdToBoardId = new Map<string, number>()
  for (const conn of syncedConns) {
    const linkedProj2 = conn.projectId ? projects.find((p) => p.id === conn.projectId) : null
    const bId = (linkedProj2?.jiraBoardId ?? conn.boardId)
    if (!bId) continue
    // We already have incoming stamped — collect from dedupedTasks that now have boardId
    for (const t of dedupedTasks) {
      for (const j of t.jiras ?? []) {
        if (j.boardId === bId && j.issueId) issueIdToBoardId.set(j.issueId, bId)
      }
    }
    for (const t of newTasks) {
      for (const j of t.jiras ?? []) {
        if (j.boardId === bId && j.issueId) issueIdToBoardId.set(j.issueId, bId)
      }
    }
  }

  // Refresh each scrum project's exact board issue keys, so board-scoped display stays
  // current (issues added/moved to a board appear without re-saving the project).
  const boardKeyUpdates = new Map<string, string[]>()
  for (const proj of projects) {
    if (proj.mode !== 'scrum' || !proj.jiraBoardId) continue
    const conn = (proj.jiraConnectionId ? enabledConns.find((c) => c.id === proj.jiraConnectionId) : undefined)
      ?? enabledConns.find((c) => c.projectId === proj.id)
      ?? enabledConns[0]
    if (!conn) continue
    const members = proj.members ?? []
    const emails = [...new Set(developers
      .filter((d) => members.length === 0 || members.includes(d.id))
      .flatMap((d) => identityList(conn.developerEmails?.[d.id])))]
    try {
      const keys = await fetchBoardIssueKeys(transport, conn, proj.jiraBoardId, emails)
      // An empty result would hide every issue in the project on the next render, so
      // keep the previous set rather than trusting it.
      if (keys.length) boardKeyUpdates.set(proj.id, keys)
      else console.warn('[sync] board key lookup returned 0 issues — keeping the previous set')
      if (!keys.length) console.warn(`[board-keys] ${proj.name} (board ${proj.jiraBoardId}) resolved 0 keys`)
    } catch (e) {
      console.warn(`[board-keys] ${proj.name} (board ${proj.jiraBoardId}) resolve FAILED — board scope will fall back to boardId/prefix:`, e)
    }
  }

  return { counts: { added, updated, removed }, dedupedTasks, newTasks, syncedConns, issueIdToBoardId, boardKeyUpdates }
}

export function applyJiraSync(s: SyncState, plan: JiraSyncPlan): Pick<AppState, 'tasks' | 'jiraConnections' | 'projects'> {
  const { dedupedTasks, newTasks, issueIdToBoardId, boardKeyUpdates, syncedConns } = plan
  const finalConns = s.jiraConnections.map((c) => syncedConns.find((sc) => sc.id === c.id) ?? c)
  const livePrsByTask = new Map<string, Map<string, PrEntry[]>>()
  for (const t of s.tasks) {
    for (const j of t.jiras ?? []) {
      if (!(j.prs ?? []).length) continue
      const identity = j.issueId ?? (j.url || null)
      if (!identity) continue
      if (!livePrsByTask.has(t.id)) livePrsByTask.set(t.id, new Map())
      const taskMap = livePrsByTask.get(t.id)!
      const arr = taskMap.get(identity) ?? []
      for (const p of j.prs ?? []) if (p.url && !arr.some((x) => x.url === p.url)) arr.push(p)
      taskMap.set(identity, arr)
    }
  }
  // dedupedTasks was built from the snapshot taken BEFORE this sync's network calls.
  // Another sync (autosync fires on a timer, with no mutual exclusion) can have
  // written newer tasks in the meantime, so rebuild each task from the CURRENT state
  // and fall back to the snapshot only for tasks that no longer exist. Writing the
  // snapshot verbatim silently reverted the other sync's work, which looked exactly
  // like issues appearing and then disappearing again.
  const liveById = new Map(s.tasks.map((t) => [t.id, t]))
  const merged = dedupedTasks.map((snapshot) => {
    const t = liveById.has(snapshot.id)
      ? { ...liveById.get(snapshot.id)!, jiras: snapshot.jiras, jiraSync: snapshot.jiraSync, deletedJiraUrls: snapshot.deletedJiraUrls }
      : snapshot
    return t
  }).map((t) => {
    const taskLivePrs = livePrsByTask.get(t.id)
    const jiras = taskLivePrs?.size
      ? (t.jiras ?? []).map((j) => {
          const identity = j.issueId ?? (j.url || null)
          if (!identity) return j
          const live = taskLivePrs.get(identity)
          if (!live?.length) return j
          const existingUrls = new Set((j.prs ?? []).map((p) => p.url))
          const toAdd = live.filter((p) => !existingUrls.has(p.url))
          return toAdd.length ? { ...j, prs: [...(j.prs ?? []), ...toAdd] } : j
        })
      : (t.jiras ?? [])
    // Backfill boardId on any jira whose issueId we now know the board for
    const stamped = jiras.map((j) => {
      if (j.boardId != null || !j.issueId) return j
      const bId = issueIdToBoardId.get(j.issueId)
      return bId != null ? { ...j, boardId: bId } : j
    })
    return { ...t, jiras: sortJiraIssues(stamped) }
  })
  // Also backfill tasks NOT in dedupedTasks (i.e. tasks from other dates not touched by this sync)
  const mergedIds = new Set(merged.map((t) => t.id))
  const untouched = s.tasks.filter((t) => !mergedIds.has(t.id) && !newTasks.some((n) => n.id === t.id))
  const untouchedStamped = untouched.map((t) => {
    if (!issueIdToBoardId.size) return t
    const jiras = (t.jiras ?? []).map((j) => {
      if (j.boardId != null || !j.issueId) return j
      const bId = issueIdToBoardId.get(j.issueId)
      return bId != null ? { ...j, boardId: bId } : j
    })
    return { ...t, jiras }
  })
  const projectsUpdated = boardKeyUpdates.size
    ? s.projects.map((p) => boardKeyUpdates.has(p.id) ? { ...p, boardIssueKeys: boardKeyUpdates.get(p.id) } : p)
    : s.projects
  return { tasks: [...merged, ...untouchedStamped, ...newTasks], jiraConnections: finalConns, projects: projectsUpdated }
}
