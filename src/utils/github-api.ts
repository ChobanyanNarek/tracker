import * as core from '../sync-core/github-api'
import type { ProviderAuth } from '../sync-core/credentials'
import { browserTransport } from './browser-transport'

export { extractJiraKeys, normalizeGithubPath } from '../sync-core/github-api'
export type { GitHubPR } from '../sync-core/github-api'

export const fetchOrgPRs = (orgOrUser: string, auth: ProviderAuth) => core.fetchOrgPRs(browserTransport, orgOrUser, auth)
export const fetchUserPRs = (username: string, auth: ProviderAuth, orgOrUser?: string) =>
  core.fetchUserPRs(browserTransport, username, auth, orgOrUser)
