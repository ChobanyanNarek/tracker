import { describe, expect, it } from 'vitest'
import type { JiraConfig, StatusGroup } from '../types'
import { buildJqlFromMappings, groupForJiraStatus, isClosedGroup, resolveGroups, DEFAULT_STATUS_GROUPS } from './status-groups'

// The Mabrook configuration as reported: a mixed set, with a user-created
// "Code Review" group that carries a generated id.
const groups: StatusGroup[] = [
  { id: 'todo', label: 'To Do', color: 'blue', isClosed: false },
  { id: 'inprogress', label: 'In Progress', color: 'amber', isClosed: false },
  { id: 'blocked', label: 'Blocked', color: 'red', isClosed: false },
  { id: 'done', label: 'Done', color: 'green', isClosed: true },
  { id: 'testing', label: 'Testing', color: 'teal', isClosed: true },
  { id: 'backlog', label: 'Backlog', color: 'gray', isClosed: false },
  { id: 'group_mub3smo1', label: 'Code Review', color: 'purple', isClosed: true },
]

function conn(patch: Partial<JiraConfig> = {}): JiraConfig {
  return {
    id: 'j1', name: 'Mabrook', enabled: true, baseUrl: 'https://x.atlassian.net',
    email: 'a@b.c', token: 't', projectKeys: [], syncInterval: 5, projectId: 'p1',
    statusGroups: groups, statusMappings: [], ...patch,
  }
}

describe('resolveGroups', () => {
  it('returns the saved set exactly, with no duplicate labels', () => {
    // Regression: padding the saved set with defaults listed "Code Review" twice.
    const labels = resolveGroups(conn()).map((g) => g.label)
    expect(labels).toHaveLength(7)
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('falls back to the defaults only when nothing is saved', () => {
    expect(resolveGroups(conn({ statusGroups: [] }))).toBe(DEFAULT_STATUS_GROUPS)
  })
})

describe('isClosedGroup', () => {
  it('reads the closed flag of a saved group', () => {
    expect(isClosedGroup('done', conn())).toBe(true)
    expect(isClosedGroup('todo', conn())).toBe(false)
  })

  it('honours a closed user group reached through the stock id', () => {
    // Regression: mappings pointed at 'review' while the user's group was
    // group_mub3smo1, so the closed setting was silently ignored.
    expect(isClosedGroup('review', conn())).toBe(true)
  })

  it('does not infer closed for groups the user never defined', () => {
    // Regression: inferring from a unanimous set hid open groups in a mixed set.
    expect(isClosedGroup('something-else', conn())).toBe(false)
  })

  it('never treats hidden as closed', () => {
    expect(isClosedGroup('hidden', conn())).toBe(false)
  })
})

describe('groupForJiraStatus', () => {
  it('matches status names case-insensitively', () => {
    const m = [{ jiraStatus: 'Code Review', groupId: 'group_mub3smo1' }]
    expect(groupForJiraStatus('code review', m)).toBe('group_mub3smo1')
  })
})

describe('buildJqlFromMappings', () => {
  it('excludes a status only when its first mapping row is hidden', () => {
    // Regression: one stale hidden duplicate cut a visible status from the fetch.
    const jql = buildJqlFromMappings([
      { jiraStatus: 'Code Review', groupId: 'review' },
      { jiraStatus: 'Code Review', groupId: 'hidden' },
    ])
    expect(jql).not.toContain('status not in')
  })

  it('always bounds closed issues to the last 30 days', () => {
    expect(buildJqlFromMappings([])).toContain('updated >= -30d')
  })
})
