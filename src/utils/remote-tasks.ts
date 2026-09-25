import type { RemoteTask } from './cloud-api'
import type { Task } from '../types'

/*
 * Views that read tasks from the server (Search, Release Notes) receive them in this
 * shape. The browser already holds the same tasks, so when the server cannot be reached
 * they fall back to the local ones rather than showing an error over data that is here.
 */

export function taskToRemote(t: Task): RemoteTask {
  return {
    id: t.id, createdAt: '', updatedAt: '', clientId: t.id,
    devId: t.devId, projectId: t.projectId, title: t.title, status: t.status,
    date: t.date, comment: t.comment ?? null,
    jiras: (t.jiras ?? []) as unknown as Record<string, unknown>[],
    rest: { prs: t.prs ?? [], deadline: t.deadline, deadlineTime: t.deadlineTime },
  }
}

/*
 * The tasks a release-notes fetch would have returned: one project, one date range.
 * `dateTo` is optional because the scrum view asks for everything from a sprint's start
 * with no end, and the local answer has to match the server's.
 */
export function localReleaseNoteTasks(
  tasks: Task[],
  projectId: string | undefined,
  dateFrom: string,
  dateTo?: string,
): RemoteTask[] {
  return tasks
    .filter((t) => (!projectId || t.projectId === projectId) && t.date >= dateFrom && (!dateTo || t.date <= dateTo))
    .map((t) => taskToRemote(t))
}
