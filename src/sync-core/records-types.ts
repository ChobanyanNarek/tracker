// Wire shapes of the per-record storage API (backend ADR-0018), shared by the web app and
// the server-side sync.

export interface DocRecord { key: string; data: unknown; revision: number }
export interface TaskRecord { id: string; data: Record<string, unknown>; revision: number }
export interface RecordsResponse {
  full: boolean
  cursor: number
  docs: DocRecord[]
  tasks: TaskRecord[]
  deleted: Array<{ id: string; revision: number }>
}

export interface CommitBody {
  docs: Array<{ key: string; data: unknown; baseRevision: number | null }>
  tasks: Array<{ id: string; data: unknown; baseRevision: number | null }>
  deletes: Array<{ id: string; baseRevision: number }>
}
export interface CommitResponse {
  applied: Array<{ kind: 'doc' | 'task' | 'delete'; id: string; revision: number }>
  conflicts: Array<{ kind: 'doc' | 'task' | 'delete'; id: string; data?: unknown; revision?: number }>
  rejected: Array<{ kind: 'doc' | 'task'; id: string; reason: string }>
}
