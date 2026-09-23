import type { AppState, GitHubConfig, GitLabConfig, JiraIssue, PrEntry, PrState, PrStateEvent } from '../types'
import { authFor, hasCredential } from './credentials'
import { localParts } from './dates'
import { extractJiraKeys as extractGithubJiraKeys, fetchOrgPRs, fetchUserPRs, normalizeGithubPath } from './github-api'
import { extractJiraKeys, fetchGroupMRs, fetchUserMRs } from './gitlab-api'
import { fetchConnectionProjectKeys } from './jira-api'
import type { SyncRun, SyncState } from './jira-sync'
import { identityList, jiraDedupeKey } from './keys'
import type { Transport } from './transport'

/*
 * The GitLab and GitHub syncs, shared by the web app and the server: link merge and pull
 * requests to the Jira issues they mention. Compute against a snapshot, apply to the
 * state as it is when the work finishes.
 */

export interface GitlabSyncCounts {
  linked: number
  updated: number
  noKey: number
  noIssue: number
  noKeyList: string[]
  noIssueList: string[]
}

export interface GitlabSyncPlan {
  counts: GitlabSyncCounts
  prPatches: Map<string, Map<string, PrEntry[]>>
  mrUrlToStatus: Map<string, JiraIssue['status']>
  syncedConns: GitLabConfig[]
  resultStr: string
}

export async function computeGitlabSync(state: SyncState, transport: Transport, run: SyncRun): Promise<GitlabSyncPlan> {
  const { gitlabConnections, jiraConnections, tasks, developers, projects } = state
  const enabledConns = gitlabConnections.filter((c) => c.enabled && hasCredential(c) && c.groupPath)
  if (!enabledConns.length) throw new Error('No GitLab connections configured')

  // All external timestamps are recorded in the tracker's timezone.
  const toLocalParts = (d: Date) => localParts(d, run.tz)

  // Issue-key prefixes PER PROJECT. Pooling every project's keys meant a connection
  // belonging to one project recognised another project's keys in PR/MR titles and
  // linked across the boundary. Each project sees only its own Jira keys and its own
  // tasks' keys.
  // Every Jira key prefix that belongs to THIS project, from three sources so the user
  // never has to maintain the list by hand: a Jira instance can hold many projects and
  // boards with unrelated keys, and a forgotten one would silently stop linking PRs.
  //   1. keys typed into the connection (if any)
  //   2. prefixes discovered from the linked board, straight from Jira
  //   3. prefixes of issues already synced into this project
  // Discovered from Jira, per project, at most once per sync. Covers the case the
  // three static sources miss: a new project with no board resolved and no issues yet.
  const discoveredKeys = new Map<string, string[]>()
  const discoverKeysFor = async (projectId: string): Promise<string[]> => {
    if (discoveredKeys.has(projectId)) return discoveredKeys.get(projectId)!
    const conn = jiraConnections.find(
      (c) => (c.projectId ?? '') === projectId && c.enabled && c.baseUrl && hasCredential(c),
    )
    const keys = conn ? await fetchConnectionProjectKeys(transport, conn) : []
    discoveredKeys.set(projectId, keys)
    return keys
  }

  const projectKeysFor = (projectId: string): string[] => {
    const own = jiraConnections.filter((c) => (c.projectId ?? '') === projectId)
    const proj = projects.find((p) => p.id === projectId)
    return [
      ...new Set([
        ...own.flatMap((c) => c.projectKeys.map((k) => k.trim().toUpperCase()).filter(Boolean)),
        ...(proj?.boardProjectKeys ?? []).map((k) => k.trim().toUpperCase()).filter(Boolean),
        ...tasks
          .filter((t) => (t.projectId ?? '') === projectId)
          .flatMap((t) => t.jiras ?? [])
          .map((j) => jiraDedupeKey(j.url, j.name).match(/^([A-Za-z][A-Za-z0-9]+)-\d+$/)?.[1]?.toUpperCase() ?? '')
          .filter(Boolean),
        ...(discoveredKeys.get(projectId) ?? []),
      ]),
    ]
  }

  const mrById = new Map<number, Awaited<ReturnType<typeof fetchGroupMRs>>[number]>()
  // Which project each MR's connection belongs to. MRs are pooled across connections
  // before they're linked, so without this a connection scoped to one project would
  // attach its MRs to another project's tasks whenever an issue key happened to match.
  const mrProjectId = new Map<number, string>()
  const syncedConns: GitLabConfig[] = []

  for (const conn of enabledConns) {
    // Every identity a developer has — these only widen which MRs get fetched into
    // the shared pool; linking to tasks happens by Jira key, not by username.
    const devUsernames = [...new Set(developers
      .filter((d) => !d.archivedAt)
      .flatMap((d) => identityList(conn.developerUsernames?.[d.id])))]

    try {
      const groupMrs = await fetchGroupMRs(transport, conn)
      for (const m of groupMrs) { mrById.set(m.id, m); mrProjectId.set(m.id, conn.projectId ?? '') }
    } catch (err) {
      const msg = (err as Error).message
      const isPermission = msg.includes('403') || msg.includes('Forbidden') || msg.includes('401')
      if (!isPermission || devUsernames.length === 0) throw err
    }

    if (devUsernames.length > 0) {
      const userMrs = await fetchUserMRs(transport, devUsernames, authFor(conn))
      for (const m of userMrs) { mrById.set(m.id, m); mrProjectId.set(m.id, conn.projectId ?? '') }
    }

    syncedConns.push({ ...conn, lastSync: new Date().toISOString() })
  }

  const mrs = [...mrById.values()]

  let linked = 0
  let updated = 0
  const skippedNoKey: string[] = []
  const skippedNoIssue: string[] = []

  const prPatches = new Map<string, Map<string, PrEntry[]>>()
  const mrUrlToStatus = new Map<string, JiraIssue['status']>()

  for (const mr of mrs) {
    // Only this MR's own project's issue keys — never another project's.
    const mrProj = mrProjectId.get(mr.id) ?? ''
    // Nothing known yet for this project (new, no board, no issues): ask Jira once.
    if (mrProj && !projectKeysFor(mrProj).length) await discoverKeysFor(mrProj)
    const keys = extractJiraKeys(mr, projectKeysFor(mrProj))
    if (!keys.length) {
      skippedNoKey.push(`!${mr.iid} "${mr.title}" [${mr.source_branch}]`)
      continue
    }

    const { date: pushDate, time: pushTime } = toLocalParts(new Date(mr.created_at))
    const isDraft = !!(mr.draft ?? mr.work_in_progress ?? /^(Draft|WIP):/i.test(mr.title))
    const mrPrState: PrState =
      mr.state === 'merged' ? 'merged'
      : mr.state === 'closed' ? 'closed'
      : isDraft ? 'draft'
      : 'open'
    const mrStateHistory: PrStateEvent[] = [
      { state: isDraft ? 'draft' : 'open', at: mr.created_at },
      ...(mr.merged_at ? [{ state: 'merged' as const, at: mr.merged_at }] : []),
      ...(mr.closed_at && !mr.merged_at ? [{ state: 'closed' as const, at: mr.closed_at }] : []),
    ]
    mrUrlToStatus.set(mr.web_url, 'done')

    const keySet = new Set(keys)
    const keyRes = keys.map((key) => new RegExp(`(^|[^A-Za-z0-9])${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^0-9]|$)`, 'i'))
    const matchesIssue = (jira: JiraIssue) => {
      if (jira.issueId && keySet.has(jira.issueId.toUpperCase())) return true
      const k = jiraDedupeKey(jira.url, jira.name)
      if (k && k !== 'name:' && keySet.has(k.toUpperCase())) return true
      return keyRes.some((re) => re.test(jira.url ?? ''))
    }

    let matched = false
    let addedSomewhere = false

    // Only link into the project this MR's connection belongs to. Every connection
    // belongs to exactly one project, so an issue key that happens to match in another
    // project must never pull this MR across.
    // An unscoped connection links anywhere instead of matching nothing.
    for (const task of tasks) {
      if (mrProj && (task.projectId ?? '') !== mrProj) continue
      for (const jira of (task.jiras ?? [])) {
        if (!matchesIssue(jira)) continue
        matched = true
        const identity = jira.issueId ?? (jira.url || null)
        if (!identity) continue
        if (!prPatches.has(task.id)) prPatches.set(task.id, new Map())
        const taskPatch = prPatches.get(task.id)!
        const existing = taskPatch.get(identity) ?? []
        if (!existing.some((p) => p.url === mr.web_url)) {
          const alreadyInJira = (jira.prs ?? []).some((p) => p.url === mr.web_url)
          taskPatch.set(identity, [...existing, { url: mr.web_url, date: pushDate, time: pushTime, state: mrPrState, stateHistory: mrStateHistory }])
          if (!alreadyInJira) addedSomewhere = true
        } else {
          taskPatch.set(identity, existing.map((p) => p.url === mr.web_url ? { ...p, state: mrPrState, stateHistory: mrStateHistory } : p))
        }
      }
    }

    if (!matched) {
      skippedNoIssue.push(`!${mr.iid} [${keys.join(',')}]`)
      continue
    }
    if (addedSomewhere) linked++
    else updated++
  }

  if (skippedNoKey.length) console.info('[GitLab sync] no Jira key in branch/title:', skippedNoKey)
  if (skippedNoIssue.length) console.info('[GitLab sync] Jira key found but not tracked in any task:', skippedNoIssue)

  const parts = [`+${linked} linked`, `${updated} already`]
  if (skippedNoKey.length) parts.push(`${skippedNoKey.length} no-key`)
  if (skippedNoIssue.length) parts.push(`${skippedNoIssue.length} untracked`)
  const resultStr = parts.join(', ')

  return {
    counts: { linked, updated, noKey: skippedNoKey.length, noIssue: skippedNoIssue.length, noKeyList: skippedNoKey, noIssueList: skippedNoIssue },
    prPatches, mrUrlToStatus, syncedConns, resultStr,
  }
}

export function applyGitlabSync(s: SyncState, plan: GitlabSyncPlan): Pick<AppState, 'tasks' | 'gitlabConnections'> {
  const { prPatches, mrUrlToStatus, syncedConns, resultStr } = plan
  return {
  tasks: s.tasks.map((t) => {
    const taskPatch = prPatches.get(t.id)
    if (!taskPatch) return t
    let changed = false
    const jiras = (t.jiras ?? []).map((j) => {
      const identity = j.issueId ?? (j.url || null)
      if (!identity) return j
      const newPrs = taskPatch.get(identity)
      const existingUrls = new Set((j.prs ?? []).map((p) => p.url))
      const toAdd = (newPrs ?? []).filter((p) => !existingUrls.has(p.url))
      // Update state + stateHistory on existing PRs even if no new ones added
      const updatedExisting = (j.prs ?? []).map((p) => {
        const patch = (newPrs ?? []).find((np) => np.url === p.url)
        if (!patch) return p
        return { ...p, ...(patch.state ? { state: patch.state } : {}), ...(patch.stateHistory ? { stateHistory: patch.stateHistory } : {}) }
      })
      const stateChanged = updatedExisting.some((p, i) => {
        const orig = (j.prs ?? [])[i]
        return p.state !== orig?.state || JSON.stringify(p.stateHistory) !== JSON.stringify(orig?.stateHistory)
      })
      if (!toAdd.length && !stateChanged) return j
      changed = true
      let newStatus = j.status
      for (const p of toAdd) {
        const st = mrUrlToStatus.get(p.url)
        if (st === 'done') { newStatus = 'done'; break }
        if (st === 'review' && newStatus !== 'done' && newStatus !== 'blocked') newStatus = 'review'
      }
      return { ...j, prs: [...updatedExisting, ...toAdd], status: newStatus }
    })
    return changed ? { ...t, jiras } : t
  }),
  gitlabConnections: s.gitlabConnections.map((c) => {
    const synced = syncedConns.find((sc) => sc.id === c.id)
    if (!synced) return c
    return { ...synced, lastSyncResult: resultStr }
  }),
  }
}

export interface GithubSyncPlan {
  counts: { linked: number; updated: number }
  prPatches: Map<string, Map<string, PrEntry[]>>
  prUrlToStatus: Map<string, JiraIssue['status']>
  prUrlToKeys: Map<string, Set<string>>
  fetchedGithubUrls: Set<string>
  syncedConns: GitHubConfig[]
}

export async function computeGithubSync(state: SyncState, transport: Transport, run: SyncRun): Promise<GithubSyncPlan> {
  const { githubConnections, jiraConnections, tasks, developers, projects } = state
  const enabledConns = githubConnections.filter((c) => c.enabled && hasCredential(c))
  if (!enabledConns.length) throw new Error('No GitHub connections configured')

  // All external timestamps are recorded in the tracker's timezone.
  const toLocalParts = (d: Date) => localParts(d, run.tz)

  // Issue-key prefixes PER PROJECT. Pooling every project's keys meant a connection
  // belonging to one project recognised another project's keys in PR/MR titles and
  // linked across the boundary. Each project sees only its own Jira keys and its own
  // tasks' keys.
  // Every Jira key prefix that belongs to THIS project, from three sources so the user
  // never has to maintain the list by hand: a Jira instance can hold many projects and
  // boards with unrelated keys, and a forgotten one would silently stop linking PRs.
  //   1. keys typed into the connection (if any)
  //   2. prefixes discovered from the linked board, straight from Jira
  //   3. prefixes of issues already synced into this project
  // Discovered from Jira, per project, at most once per sync. Covers the case the
  // three static sources miss: a new project with no board resolved and no issues yet.
  const discoveredKeys = new Map<string, string[]>()
  const discoverKeysFor = async (projectId: string): Promise<string[]> => {
    if (discoveredKeys.has(projectId)) return discoveredKeys.get(projectId)!
    const conn = jiraConnections.find(
      (c) => (c.projectId ?? '') === projectId && c.enabled && c.baseUrl && hasCredential(c),
    )
    const keys = conn ? await fetchConnectionProjectKeys(transport, conn) : []
    discoveredKeys.set(projectId, keys)
    return keys
  }

  const projectKeysFor = (projectId: string): string[] => {
    const own = jiraConnections.filter((c) => (c.projectId ?? '') === projectId)
    const proj = projects.find((p) => p.id === projectId)
    return [
      ...new Set([
        ...own.flatMap((c) => c.projectKeys.map((k) => k.trim().toUpperCase()).filter(Boolean)),
        ...(proj?.boardProjectKeys ?? []).map((k) => k.trim().toUpperCase()).filter(Boolean),
        ...tasks
          .filter((t) => (t.projectId ?? '') === projectId)
          .flatMap((t) => t.jiras ?? [])
          .map((j) => jiraDedupeKey(j.url, j.name).match(/^([A-Za-z][A-Za-z0-9]+)-\d+$/)?.[1]?.toUpperCase() ?? '')
          .filter(Boolean),
        ...(discoveredKeys.get(projectId) ?? []),
      ]),
    ]
  }

  const prById = new Map<number, Awaited<ReturnType<typeof fetchOrgPRs>>[number]>()
  // Which project each PR's connection belongs to — PRs are pooled across connections
  // before linking, so this keeps one project's PRs off another project's tasks.
  const prProjectId = new Map<number, string>()
  const syncedConns: GitHubConfig[] = []

  for (const conn of enabledConns) {
    // Every identity a developer has — these only widen which PRs get fetched into
    // the shared pool; linking to tasks happens by Jira key, not by username.
    const devUsernames = [...new Set(developers
      .filter((d) => !d.archivedAt)
      .flatMap((d) => identityList(conn.developerUsernames?.[d.id])))]

    if (conn.orgOrUser.trim()) {
      try {
        const orgPRs = await fetchOrgPRs(transport, conn.orgOrUser, authFor(conn))
        for (const p of orgPRs) { prById.set(p.id, p); prProjectId.set(p.id, conn.projectId ?? '') }
      } catch (err) {
        const msg = (err as Error).message
        const isPermission = msg.includes('403') || msg.includes('Forbidden') || msg.includes('401')
        if (!isPermission || devUsernames.length === 0) throw err
      }
    }

    if (devUsernames.length > 0) {
      const ownerScope = conn.orgOrUser.trim() ? normalizeGithubPath(conn.orgOrUser).owner : ''
      const userPRs = await Promise.all(devUsernames.map((u) => fetchUserPRs(transport, u, authFor(conn), ownerScope)))
      for (const prs of userPRs) for (const p of prs) { prById.set(p.id, p); prProjectId.set(p.id, conn.projectId ?? '') }
    }

    syncedConns.push({ ...conn, lastSync: new Date().toISOString() })
  }

  const allPRs = [...prById.values()]

  const prPatches = new Map<string, Map<string, PrEntry[]>>()
  const prUrlToStatus = new Map<string, JiraIssue['status']>()
  const prUrlToKeys = new Map<string, Set<string>>()  // url → matched issue keys (uppercase)
  const prUrlToState = new Map<string, PrState>()
  const prUrlToHistory = new Map<string, PrStateEvent[]>()
  let linked = 0
  let updated = 0

  for (const pr of allPRs) {
    // Only this PR's own project's issue keys — never another project's.
    const prProj = prProjectId.get(pr.id) ?? ''
    // Nothing known yet for this project (new, no board, no issues): ask Jira once.
    if (prProj && !projectKeysFor(prProj).length) await discoverKeysFor(prProj)
    const keys = extractGithubJiraKeys(pr, projectKeysFor(prProj))
    console.info('[GitHub sync] PR:', pr.html_url, 'title:', pr.title, 'branch:', pr.head?.ref, 'keys:', keys)
    prUrlToKeys.set(pr.html_url, new Set(keys.map((k) => k.toUpperCase())))
    if (!keys.length) continue
    const { date: pushDate, time: pushTime } = toLocalParts(new Date(pr.created_at))
    const isMerged = !!(pr.merged_at ?? pr.pull_request?.merged_at)
    prUrlToStatus.set(pr.html_url, isMerged ? 'done' : 'review')
    const ghPrState: PrState =
      isMerged ? 'merged'
      : pr.state === 'closed' ? 'closed'
      : pr.draft ? 'draft'
      : 'open'
    prUrlToState.set(pr.html_url, ghPrState)
    const mergedAt = pr.merged_at ?? pr.pull_request?.merged_at ?? null
    const closedAt = pr.closed_at ?? null
    prUrlToHistory.set(pr.html_url, [
      { state: pr.draft ? 'draft' as const : 'open' as const, at: pr.created_at },
      ...(mergedAt ? [{ state: 'merged' as const, at: mergedAt }] : []),
      ...(closedAt && !mergedAt ? [{ state: 'closed' as const, at: closedAt }] : []),
    ])

    const keySet = new Set(keys)
    const matchesIssue = (jira: JiraIssue) => {
      if (jira.issueId && keySet.has(jira.issueId.toUpperCase())) return true
      const k = jiraDedupeKey(jira.url, jira.name)
      return !!(k && k !== 'name:' && keySet.has(k.toUpperCase()))
    }

    let matched = false
    let addedSomewhere = false

    // Only link into this PR's own project. Every connection belongs to one project.
    // A connection saved before projectId became mandatory has none. Treat that as
    // "not scoped" and let it link anywhere, rather than comparing against '' and
    // matching no task at all -- which made those connections' PRs vanish completely.
    for (const task of tasks) {
      if (prProj && (task.projectId ?? '') !== prProj) continue
      for (const jira of (task.jiras ?? [])) {
        if (!matchesIssue(jira)) continue
        matched = true
        const identity = jira.issueId ?? (jira.url || null)
        if (!identity) continue
        if (!prPatches.has(task.id)) prPatches.set(task.id, new Map())
        const taskPatch = prPatches.get(task.id)!
        const existing = taskPatch.get(identity) ?? []
        const ghState = prUrlToState.get(pr.html_url)
        const ghHistory = prUrlToHistory.get(pr.html_url)
        if (!existing.some((p) => p.url === pr.html_url)) {
          const alreadyInJira = (jira.prs ?? []).some((p) => p.url === pr.html_url)
          taskPatch.set(identity, [...existing, { url: pr.html_url, date: pushDate, time: pushTime, state: ghState, stateHistory: ghHistory }])
          if (!alreadyInJira) addedSomewhere = true
        } else {
          taskPatch.set(identity, existing.map((p) => p.url === pr.html_url ? { ...p, state: ghState, stateHistory: ghHistory } : p))
        }
      }
    }

    if (matched) {
      if (addedSomewhere) linked++
      else updated++
    }
  }

  // All GitHub PR urls fetched this sync
  const fetchedGithubUrls = new Set(allPRs.map((p) => p.html_url))

  return { counts: { linked, updated }, prPatches, prUrlToStatus, prUrlToKeys, fetchedGithubUrls, syncedConns }
}

export function applyGithubSync(s: SyncState, plan: GithubSyncPlan): Pick<AppState, 'tasks' | 'githubConnections'> {
  const { prPatches, prUrlToStatus, prUrlToKeys, fetchedGithubUrls, syncedConns } = plan
  return {
  tasks: s.tasks.map((t) => {
    const taskPatch = prPatches.get(t.id)
    let changed = false
    const jiras = (t.jiras ?? []).map((j) => {
      const identity = j.issueId ?? (j.url || null)
      const issueKey = (() => {
        if (j.issueId) return j.issueId.toUpperCase()
        const k = jiraDedupeKey(j.url, j.name)
        return k && k !== 'name:' ? k.toUpperCase() : null
      })()

      // Remove stale GitHub PR links: fetched this sync but key doesn't match this issue
      const filteredPrs = (j.prs ?? []).filter((p) => {
        if (!p.url.includes('github.com')) return true  // keep non-GitHub links always
        if (!fetchedGithubUrls.has(p.url)) return true  // not fetched = keep (might be from outside org)
        if (!issueKey) return true  // no key to check against = keep
        const prKeys = prUrlToKeys.get(p.url)
        return !prKeys || prKeys.has(issueKey)  // keep only if PR actually mentions this issue
      })
      if (filteredPrs.length !== (j.prs ?? []).length) changed = true

      if (!identity) return changed ? { ...j, prs: filteredPrs } : j
      const newPrs = taskPatch?.get(identity)
      // Update state + stateHistory on existing PRs
      const updatedFiltered = filteredPrs.map((p) => {
        const patch = (newPrs ?? []).find((np) => np.url === p.url)
        if (!patch) return p
        return { ...p, ...(patch.state ? { state: patch.state } : {}), ...(patch.stateHistory ? { stateHistory: patch.stateHistory } : {}) }
      })
      const stateUpdated = updatedFiltered.some((p, i) => {
        const orig = filteredPrs[i]
        return p.state !== orig?.state || JSON.stringify(p.stateHistory) !== JSON.stringify(orig?.stateHistory)
      })
      if (stateUpdated) changed = true
      if (!newPrs?.length) return changed ? { ...j, prs: updatedFiltered } : j
      const existingUrls = new Set(updatedFiltered.map((p) => p.url))
      const toAdd = newPrs.filter((p) => !existingUrls.has(p.url))
      if (!toAdd.length) return changed ? { ...j, prs: updatedFiltered } : j
      changed = true
      let newStatus = j.status
      for (const p of toAdd) {
        const st = prUrlToStatus.get(p.url)
        if (st === 'done') { newStatus = 'done'; break }
        if (st === 'review' && newStatus !== 'done' && newStatus !== 'blocked') newStatus = 'review'
      }
      return { ...j, prs: [...updatedFiltered, ...toAdd], status: newStatus }
    })
    return changed ? { ...t, jiras } : t
  }),
  githubConnections: s.githubConnections.map((c) => syncedConns.find((sc) => sc.id === c.id) ?? c),
  }
}
