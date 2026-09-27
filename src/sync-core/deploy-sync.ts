import { authFor, hasCredential } from './credentials'
import { providerGet } from './providers'
import type { Transport } from './transport'
import type { DeploymentRecord, GitHubConfig, GitLabConfig } from '../types'
import { normalizeGroupPath } from './gitlab-api'
import { normalizeGithubPath } from './github-api'

/*
 * Deployment records from the git host — the one thing DORA needs that nothing else in
 * the tracker can supply. Both providers publish them; whether a team's CI actually
 * writes any is up to that team, so everything here treats "none" as an ordinary answer
 * rather than a failure.
 */

const MAX_PAGES = 5 // 5 × 100 — a year of deployments for all but the busiest repos

interface GitLabDeployment {
  id: number
  iid: number
  status: string
  created_at: string
  updated_at?: string
  environment?: { name?: string }
  deployable?: { status?: string; finished_at?: string; commit?: { id?: string }; web_url?: string }
  sha?: string
  ref?: string
}

/** GitLab and GitHub both have their own vocabulary; this is the tracker's. */
function normalizeStatus(raw: string | undefined): DeploymentRecord['status'] {
  switch ((raw ?? '').toLowerCase()) {
    case 'success':
    case 'successful':
    case 'active': return 'success'
    case 'failed':
    case 'failure':
    case 'error': return 'failed'
    case 'canceled':
    case 'cancelled':
    case 'inactive': return 'canceled'
    default: return 'running'
  }
}

export async function fetchGitLabDeployments(t: Transport, config: GitLabConfig): Promise<DeploymentRecord[]> {
  const path = normalizeGroupPath(config.groupPath)
  if (!path || !hasCredential(config)) return []
  const auth = authFor(config)
  const encoded = encodeURIComponent(path)
  const out: DeploymentRecord[] = []

  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await providerGet(t, 'gitlab', auth,
      `/api/v4/projects/${encoded}/deployments?per_page=100&page=${page}&order_by=created_at&sort=desc`)
    // 404 means the path is a group rather than a project, or deployments are off. Either
    // way there is nothing to read and nothing to report.
    if (!res.ok) break
    const batch = (await res.json()) as GitLabDeployment[]
    if (!Array.isArray(batch)) break
    for (const d of batch) {
      out.push({
        id: `gitlab:${path}:${d.id}`,
        provider: 'gitlab',
        repo: path,
        environment: d.environment?.name ?? '',
        status: normalizeStatus(d.deployable?.status ?? d.status),
        createdAt: d.created_at,
        ...(d.deployable?.finished_at ? { finishedAt: d.deployable.finished_at } : {}),
        ...(d.sha || d.deployable?.commit?.id ? { sha: d.sha ?? d.deployable!.commit!.id! } : {}),
        ...(d.deployable?.web_url ? { url: d.deployable.web_url } : {}),
        ...(config.projectId ? { projectId: config.projectId } : {}),
      })
    }
    if (batch.length < 100) break
  }
  return out
}

interface GitHubDeployment {
  id: number
  environment?: string
  created_at: string
  sha?: string
  statuses_url?: string
  url?: string
}

interface GitHubDeploymentStatus {
  state: string
  created_at: string
  target_url?: string
}

/** Every repo under the configured org, or the single repo when one was given. */
async function githubRepos(t: Transport, config: GitHubConfig): Promise<string[]> {
  const { owner, repo } = normalizeGithubPath(config.orgOrUser)
  if (repo) return [repo]
  const auth = authFor(config)
  for (const scope of ['orgs', 'users'] as const) {
    const found: string[] = []
    for (let page = 1; page <= MAX_PAGES; page++) {
      const res = await providerGet(t, 'github', auth, `/${scope}/${encodeURIComponent(owner)}/repos?type=all&per_page=100&page=${page}`)
      if (!res.ok) break
      const batch = (await res.json()) as { full_name: string }[]
      if (!Array.isArray(batch) || !batch.length) break
      for (const r of batch) found.push(r.full_name)
      if (batch.length < 100) break
    }
    if (found.length) return found
  }
  return []
}

export async function fetchGitHubDeployments(t: Transport, config: GitHubConfig): Promise<DeploymentRecord[]> {
  if (!config.orgOrUser.trim() || !hasCredential(config)) return []
  const auth = authFor(config)
  const repos = await githubRepos(t, config).catch(() => [])
  const out: DeploymentRecord[] = []

  for (const full of repos) {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const res = await providerGet(t, 'github', auth, `/repos/${full}/deployments?per_page=100&page=${page}`)
      if (!res.ok) break
      const batch = (await res.json()) as GitHubDeployment[]
      if (!Array.isArray(batch) || !batch.length) break

      for (const d of batch) {
        /*
         * GitHub keeps the outcome on a separate status resource, newest first. Without it
         * every deployment would look like it was still running.
         */
        const statusRes = await providerGet(t, 'github', auth, `/repos/${full}/deployments/${d.id}/statuses?per_page=1`)
        const statuses = statusRes.ok ? (await statusRes.json()) as GitHubDeploymentStatus[] : []
        const latest = Array.isArray(statuses) ? statuses[0] : undefined
        out.push({
          id: `github:${full}:${d.id}`,
          provider: 'github',
          repo: full,
          environment: d.environment ?? '',
          status: normalizeStatus(latest?.state),
          createdAt: d.created_at,
          ...(latest?.created_at ? { finishedAt: latest.created_at } : {}),
          ...(d.sha ? { sha: d.sha } : {}),
          ...(latest?.target_url ? { url: latest.target_url } : {}),
          ...(config.projectId ? { projectId: config.projectId } : {}),
        })
      }
      if (batch.length < 100) break
    }
  }
  return out
}

/** Newest first, one record per provider id — a re-sync overlaps with what is already held. */
export function mergeDeployments(existing: DeploymentRecord[], fresh: DeploymentRecord[]): DeploymentRecord[] {
  const byId = new Map(existing.map((d) => [d.id, d]))
  for (const d of fresh) byId.set(d.id, d)
  return [...byId.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
}
