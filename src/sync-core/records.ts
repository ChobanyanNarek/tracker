import type { AppState, JiraConfig, GitLabConfig, ReleaseNoteColumn, ReleaseNoteIssueData, Task } from '../types'
import type { CommitBody, CommitResponse, RecordsResponse } from './records-types'
import { deepEqual, merge3 } from './merge'
import { repointOrphanMappings } from './status-groups'

/*
 * Client side of per-record storage (backend ADR-0018).
 *
 * The server holds a user's data as records: one per task, and one per settings section
 * below. For each record this keeps a "base": the revision the server last confirmed and
 * the value this tab held at that revision. A save sends only records whose current value
 * differs from its base, each naming that revision. If the server has moved on, it returns
 * its copy as a conflict and the three versions (base, this tab, server) are merged.
 * Nothing is ever overwritten wholesale.
 *
 * Values are compared by reference first. The store replaces only what an action touches,
 * so unchanged records are skipped without being inspected.
 */

export const DOC_KEYS = [
  'developers', 'projects', 'sprints', 'notes', 'schedule', 'scheduleHours', 'notifsEnabled',
  'jiraConnections', 'gitlabConnections', 'githubConnections', 'trackerTimezone',
  'selectedProject', 'selectedDev', 'selectedDate', 'releaseNoteColumns', 'releaseNoteData',
  'browserTimezone',
] as const
export type DocKey = typeof DOC_KEYS[number]
const DOC_KEY_SET = new Set<string>(DOC_KEYS)

/*
 * Per-screen and per-browser settings: what this tab is looking at, whether this browser
 * shows notifications, and its timezone. Saved as before, but another tab or device
 * changing them must not change this one, so incoming changes are noted and not applied.
 */
const VIEW_KEYS = new Set<string>(['selectedProject', 'selectedDev', 'selectedDate', 'notifsEnabled', 'browserTimezone'])

export type PersistedState = Pick<AppState, DocKey | 'tasks'>

// Most records per save request; the rest go in the next one.
export const BATCH_LIMIT = 300

export function normalizeTask(t: Task): Task {
  return {
    ...t,
    jiras: (t.jiras ?? []).map((j) => ({ ...j, prs: j.prs ?? [] })),
    prs: t.prs ?? [],
  }
}

/*
 * Saved data -> store fields, filling defaults older saves lack. Used for the initial
 * load and for every record that arrives later, so all of it is shaped the same way.
 */
export function cloudToState(cloud: Record<string, unknown>): Partial<AppState> {
  return {
    ...(cloud.developers ? { developers: (cloud.developers as AppState['developers']).map((d) => ({ periods: [], ...d })) } : {}),
    ...(cloud.projects ? { projects: (cloud.projects as AppState['projects']).map((p) => ({ nonWorkingDays: [0, 6] as number[], ...p, members: (p as { members?: string[] }).members ?? [] })) } : {}),
    ...(cloud.sprints ? { sprints: cloud.sprints as AppState['sprints'] } : {}),
    ...(cloud.tasks ? { tasks: (cloud.tasks as AppState['tasks']).map(normalizeTask) } : {}),
    ...(cloud.notes ? { notes: cloud.notes as AppState['notes'] } : {}),
    ...(cloud.schedule ? { schedule: cloud.schedule as AppState['schedule'] } : {}),
    ...(cloud.scheduleHours ? { scheduleHours: cloud.scheduleHours as AppState['scheduleHours'] } : {}),
    ...(cloud.jiraConnections
      ? { jiraConnections: (cloud.jiraConnections as AppState['jiraConnections']).map(repointOrphanMappings) }
      : cloud.jiraConfig
        ? { jiraConnections: [{ ...(cloud.jiraConfig as JiraConfig), id: 'j_legacy', name: 'Default' }] }
        : {}),
    ...(cloud.gitlabConnections
      ? { gitlabConnections: cloud.gitlabConnections as AppState['gitlabConnections'] }
      : cloud.gitlabConfig
        ? { gitlabConnections: [{ ...(cloud.gitlabConfig as GitLabConfig), id: 'gl_legacy', name: 'Default' }] }
        : {}),
    ...(cloud.githubConnections ? { githubConnections: cloud.githubConnections as AppState['githubConnections'] } : {}),
    ...(cloud.trackerTimezone !== undefined ? { trackerTimezone: cloud.trackerTimezone as string | undefined } : {}),
    ...(cloud.selectedProject ? { selectedProject: cloud.selectedProject as string } : {}),
    ...(cloud.selectedDev ? { selectedDev: cloud.selectedDev as string } : {}),
    ...(cloud.releaseNoteColumns ? { releaseNoteColumns: cloud.releaseNoteColumns as ReleaseNoteColumn[] } : {}),
    ...(cloud.releaseNoteData ? { releaseNoteData: cloud.releaseNoteData as Record<string, ReleaseNoteIssueData> } : {}),
  }
}

// The records as the old single-object shape, for cloudToState. A null section is absent.
export function recordsToCloud(res: RecordsResponse): Record<string, unknown> {
  const cloud: Record<string, unknown> = {}
  for (const d of res.docs) if (d.data !== null) cloud[d.key] = d.data
  cloud.tasks = res.tasks.map((t) => t.data)
  return cloud
}

// One section as the store holds it. Sections the load does not restore stay as saved.
function docValue(key: string, data: unknown): unknown {
  if (data === null || data === undefined) return undefined
  const mapped = cloudToState({ [key]: data }) as Record<string, unknown>
  return key in mapped ? mapped[key] : data
}

// rev null: the record does not exist on the server yet; `value` is what this tab had then.
interface Base<T> { rev: number | null; value: T }

export interface Batch {
  body: CommitBody
  sentTasks: Map<string, Task>
  sentDocs: Map<string, unknown>
  size: number
}

export interface ApplyOutcome {
  patch: Partial<AppState> | null
  conflicts: number
  rejected: string[]
  // Records the server answered for at all; zero means it ignored the whole request.
  answered: number
}

function sameAsBase<T>(value: T, base: Base<T> | undefined): boolean {
  return !!base && (value === base.value || deepEqual(value, base.value))
}

// Rebuild the task list with some tasks replaced, keeping order; new ones go at the end.
function withTasks(tasks: Task[], byId: Map<string, Task>, removed: Set<string>): Task[] {
  const out: Task[] = []
  const seen = new Set<string>()
  for (const t of tasks) {
    seen.add(t.id)
    if (removed.has(t.id)) continue
    out.push(byId.get(t.id) ?? t)
  }
  for (const [id, t] of byId) if (!seen.has(id) && !removed.has(id)) out.push(t)
  return out
}

export class RecordTracker {
  private tasks = new Map<string, Base<Task>>()
  private docs = new Map<string, Base<unknown>>()
  // A value the server refused as unstorable is not resent until it changes.
  private rejectedTasks = new Map<string, Task>()
  private rejectedDocs = new Map<string, unknown>()
  cursor = 0
  // False until a full snapshot has been loaded: without bases nothing can be diffed safely.
  ready = false

  /*
   * After a full load. `next` is the store state built from `res` by cloudToState, so the
   * bases point at the very objects the store holds and an untouched record costs nothing.
   */
  reset(res: RecordsResponse, next: Partial<AppState>): void {
    this.tasks.clear()
    this.docs.clear()
    this.rejectedTasks.clear()
    this.rejectedDocs.clear()
    const values = next as Record<string, unknown>
    for (const d of res.docs) {
      if (!DOC_KEY_SET.has(d.key)) continue
      this.docs.set(d.key, { rev: d.revision, value: d.key in values ? values[d.key] : docValue(d.key, d.data) })
    }
    const revs = new Map(res.tasks.map((t) => [t.id, t.revision]))
    for (const t of next.tasks ?? []) {
      const rev = revs.get(t.id)
      if (rev !== undefined) this.tasks.set(t.id, { rev, value: t })
    }
    this.cursor = res.cursor
    this.ready = true
  }

  /*
   * After a load has been applied: take the view this tab opened with (today's date, not
   * the one last saved) as agreed, so it is not re-saved until the user changes it.
   */
  adoptView(state: PersistedState): void {
    const values = state as unknown as Record<string, unknown>
    for (const key of VIEW_KEYS) {
      const base = this.docs.get(key)
      if (base) base.value = values[key]
    }
    // A section never saved (the old data had no such key) is created only once it changes.
    for (const key of DOC_KEYS) {
      if (!this.docs.has(key)) this.docs.set(key, { rev: null, value: values[key] })
    }
  }

  // The next save: records that differ from their base, at most `limit` of them.
  collect(state: PersistedState, limit = BATCH_LIMIT): Batch | null {
    if (!this.ready) return null
    const body: CommitBody = { docs: [], tasks: [], deletes: [] }
    const sentTasks = new Map<string, Task>()
    const sentDocs = new Map<string, unknown>()
    let size = 0
    const values = state as unknown as Record<string, unknown>

    for (const key of DOC_KEYS) {
      if (size >= limit) break
      const value = values[key]
      const base = this.docs.get(key)
      if (this.rejectedDocs.has(key) && this.rejectedDocs.get(key) === value) continue
      if (!base) {
        if (value === undefined) continue
      } else if (value === base.value || (base.rev === null && value === undefined)) {
        continue
      } else if (deepEqual(value, base.value)) {
        base.value = value
        continue
      }
      body.docs.push({ key, data: value ?? null, baseRevision: base?.rev ?? null })
      sentDocs.set(key, value)
      size++
    }

    const current = new Set<string>()
    for (const t of state.tasks) {
      if (current.has(t.id)) continue // a repeated id: the first copy is the one kept
      current.add(t.id)
      if (size >= limit) continue
      const base = this.tasks.get(t.id)
      if (this.rejectedTasks.get(t.id) === t) continue
      if (base) {
        if (t === base.value) continue
        if (deepEqual(t, base.value)) { base.value = t; continue }
      }
      body.tasks.push({ id: t.id, data: t, baseRevision: base?.rev ?? null })
      sentTasks.set(t.id, t)
      size++
    }

    for (const [id, base] of this.tasks) {
      if (size >= limit) break
      if (current.has(id)) continue
      if (base.rev === null) continue
      body.deletes.push({ id, baseRevision: base.rev })
      size++
    }

    return size > 0 ? { body, sentTasks, sentDocs, size } : null
  }

  // The server's answer to a save: move bases forward and merge whatever conflicted.
  apply(batch: Batch, result: CommitResponse, state: PersistedState): ApplyOutcome {
    for (const a of result.applied) {
      if (a.kind === 'doc') {
        this.docs.set(a.id, { rev: a.revision, value: batch.sentDocs.get(a.id) })
        this.rejectedDocs.delete(a.id)
      } else if (a.kind === 'task') {
        this.tasks.set(a.id, { rev: a.revision, value: batch.sentTasks.get(a.id)! })
        this.rejectedTasks.delete(a.id)
      } else {
        this.tasks.delete(a.id)
      }
    }

    const rejected: string[] = []
    for (const r of result.rejected) {
      rejected.push(`${r.kind}:${r.id}`)
      if (r.kind === 'doc') this.rejectedDocs.set(r.id, batch.sentDocs.get(r.id))
      else this.rejectedTasks.set(r.id, batch.sentTasks.get(r.id)!)
    }

    const patch: Record<string, unknown> = {}
    const byId = new Map(state.tasks.map((t) => [t.id, t]))
    let tasksChanged = false
    const values = state as unknown as Record<string, unknown>

    for (const c of result.conflicts) {
      const present = c.revision !== undefined
      if (c.kind === 'doc') {
        if (!present) { this.docs.delete(c.id); continue }
        const remote = docValue(c.id, c.data)
        const base = this.docs.get(c.id)
        const local = values[c.id]
        this.docs.set(c.id, { rev: c.revision!, value: remote })
        const merged = VIEW_KEYS.has(c.id) ? local : merge3(base?.value, local, remote)
        if (merged !== local) patch[c.id] = merged
      } else if (c.kind === 'task') {
        // Deleted elsewhere while edited here: dropping the base makes the next save recreate it.
        if (!present) { this.tasks.delete(c.id); continue }
        const remote = normalizeTask(c.data as Task)
        const base = this.tasks.get(c.id)
        this.tasks.set(c.id, { rev: c.revision!, value: remote })
        const local = byId.get(c.id)
        if (local) { byId.set(c.id, merge3(base?.value, local, remote)); tasksChanged = true }
      } else if (present) {
        // Deleted here but changed elsewhere since: keep the newer copy.
        const remote = normalizeTask(c.data as Task)
        this.tasks.set(c.id, { rev: c.revision!, value: remote })
        if (!byId.has(c.id)) { byId.set(c.id, remote); tasksChanged = true }
      }
    }

    if (tasksChanged) patch.tasks = withTasks(state.tasks, byId, new Set())
    return {
      patch: Object.keys(patch).length ? (patch as Partial<AppState>) : null,
      conflicts: result.conflicts.length,
      rejected,
      answered: result.applied.length + result.conflicts.length + result.rejected.length,
    }
  }

  /*
   * Changes other tabs and devices saved since this tab's cursor. A record this tab has
   * not touched is replaced; one it has edited is merged, and the merge is saved next.
   */
  pull(res: RecordsResponse, state: PersistedState): Partial<AppState> | null {
    const patch: Record<string, unknown> = {}
    const values = state as unknown as Record<string, unknown>

    for (const d of res.docs) {
      if (!DOC_KEY_SET.has(d.key)) continue
      const base = this.docs.get(d.key)
      if (base && base.rev !== null && base.rev >= d.revision) continue // already have it (typically our own save)
      const local = values[d.key]
      if (VIEW_KEYS.has(d.key)) { this.docs.set(d.key, { rev: d.revision, value: local }); continue }
      const remote = docValue(d.key, d.data)
      const merged = sameAsBase(local, base) ? remote : merge3(base?.value, local, remote)
      this.docs.set(d.key, { rev: d.revision, value: remote })
      if (merged !== local) patch[d.key] = merged
    }

    const byId = new Map(state.tasks.map((t) => [t.id, t]))
    const removed = new Set<string>()
    let tasksChanged = false

    for (const r of res.tasks) {
      const base = this.tasks.get(r.id)
      if (base && base.rev !== null && base.rev >= r.revision) continue
      const remote = normalizeTask(r.data as unknown as Task)
      const local = byId.get(r.id)
      this.tasks.set(r.id, { rev: r.revision, value: remote })
      // Missing here: new elsewhere, or deleted here but changed there since -- keep it either way.
      const merged = !local || sameAsBase(local, base) ? remote : merge3(base?.value, local, remote)
      if (merged !== local) { byId.set(r.id, merged); tasksChanged = true }
    }

    for (const d of res.deleted) {
      const base = this.tasks.get(d.id)
      if (base && base.rev !== null && base.rev >= d.revision) continue // recreated after that delete
      const local = byId.get(d.id)
      this.tasks.delete(d.id)
      // Edited here since: keep it, and the next save recreates it.
      if (local && sameAsBase(local, base)) { removed.add(d.id); tasksChanged = true }
    }

    this.cursor = Math.max(this.cursor, res.cursor)
    if (tasksChanged) patch.tasks = withTasks(state.tasks, byId, removed)
    return Object.keys(patch).length ? (patch as Partial<AppState>) : null
  }

  /*
   * A full load that arrived after this tab had already changed things. Neither side is
   * dropped: saved records this tab lacks are added, and where both have a record the two
   * are merged with this tab's values winning. Nothing is deleted because of it.
   */
  adoptStale(next: Partial<AppState>, state: PersistedState): Partial<AppState> | null {
    const patch: Record<string, unknown> = {}
    const values = state as unknown as Record<string, unknown>
    const incoming = next as Record<string, unknown>
    for (const key of DOC_KEYS) {
      if (VIEW_KEYS.has(key) || incoming[key] === undefined) continue
      const local = values[key]
      const merged = local === undefined ? incoming[key] : merge3(undefined, local, incoming[key])
      if (merged !== local) patch[key] = merged
    }
    const byId = new Map(state.tasks.map((t) => [t.id, t]))
    let tasksChanged = false
    for (const remote of next.tasks ?? []) {
      const local = byId.get(remote.id)
      const merged = local ? merge3(undefined, local, remote) : remote
      if (merged !== local) { byId.set(remote.id, merged); tasksChanged = true }
    }
    if (tasksChanged) patch.tasks = withTasks(state.tasks, byId, new Set())
    return Object.keys(patch).length ? (patch as Partial<AppState>) : null
  }
}
