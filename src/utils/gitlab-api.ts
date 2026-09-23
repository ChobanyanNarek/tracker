import type { GitLabConfig } from '../types'
import * as core from '../sync-core/gitlab-api'
import type { ProviderAuth } from '../sync-core/credentials'
import { browserTransport } from './browser-transport'

export { extractJiraKey, extractJiraKeys, extractTitleJiraKeys, normalizeGroupPath } from '../sync-core/gitlab-api'
export type { GitLabMR } from '../sync-core/gitlab-api'

export const fetchGroupMRs = (config: GitLabConfig) => core.fetchGroupMRs(browserTransport, config)
export const fetchUserMRs = (usernames: string[], auth: ProviderAuth) => core.fetchUserMRs(browserTransport, usernames, auth)
