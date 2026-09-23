import type { JiraConfig } from '../types'
import * as core from '../sync-core/jira-api'
import { browserTransport } from './browser-transport'

// The browser's Jira calls: the shared implementation (sync-core) over an authenticated
// fetch to the backend.

export { buildJqlStatusFilter, groupIdToStatus, mergeStatusHistory, rawToJiraItem } from '../sync-core/jira-api'
export type { JiraBoardInfo, JiraFetchResult, JiraIssueRaw, JiraSprintInfo, JiraStatusInfo } from '../sync-core/jira-api'

const t = browserTransport

export const fetchJiraIssues = (config: JiraConfig, jql: string) => core.fetchJiraIssues(t, config, jql)
export const fetchJiraBoardIssues = (config: JiraConfig, boardId: number, assigneeEmail: string) =>
  core.fetchJiraBoardIssues(t, config, boardId, assigneeEmail)
export const fetchBoardIssueKeys = (config: JiraConfig, boardId: number, assigneeEmails?: string[]) =>
  core.fetchBoardIssueKeys(t, config, boardId, assigneeEmails)
export const fetchBoardProjectKeys = (config: JiraConfig, boardId: number, assigneeEmails?: string[]) =>
  core.fetchBoardProjectKeys(t, config, boardId, assigneeEmails)
export const fetchJiraBoards = (config: JiraConfig) => core.fetchJiraBoards(t, config)
export const fetchJiraSprints = (config: JiraConfig, boardId: number) => core.fetchJiraSprints(t, config, boardId)
export const fetchJiraTimeTracking = (config: JiraConfig) => core.fetchJiraTimeTracking(t, config)
export const fetchJiraStatuses = (config: JiraConfig) => core.fetchJiraStatuses(t, config)
export const fetchConnectionProjectKeys = (config: JiraConfig) => core.fetchConnectionProjectKeys(t, config)
