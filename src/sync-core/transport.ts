/*
 * How the sync reaches the backend's provider endpoints (Jira search, GitHub and GitLab
 * proxies). In the browser this is an authenticated fetch to the API; on the server it
 * calls the same handlers in-process. The sync itself never knows which.
 */
export interface TransportResponse {
  ok: boolean
  status: number
  json: () => Promise<unknown>
  text: () => Promise<string>
}

export interface Transport {
  // `path` is an API route such as /pm-tracker/jira-search.
  post: (path: string, body: Record<string, unknown>) => Promise<TransportResponse>
}
