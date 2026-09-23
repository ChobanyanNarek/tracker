import { describe, expect, it } from 'vitest'
import type { JiraConfig, StatusGroup } from '../types'
import { buildJqlFromMappings, defaultGroupForCategory, groupForJiraStatus, isClosedGroup, remapAfterGroupChange, repointOrphanMappings, resolveGroups, DEFAULT_STATUS_GROUPS } from './status-groups'

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

describe('repointOrphanMappings', () => {
  it("moves a mapping off a missing stock id onto the user's same-named group", () => {
    // Regression: 'Code Review' mapped to 'review' while the user's group was
    // group_mub3smo1, so the group's closed setting was silently ignored.
    const fixed = repointOrphanMappings(conn({ statusMappings: [{ jiraStatus: 'Code Review', groupId: 'review' }] }))
    expect(fixed.statusMappings![0]!.groupId).toBe('group_mub3smo1')
    expect(isClosedGroup(fixed.statusMappings![0]!.groupId, fixed)).toBe(true)
  })

  it('leaves valid, hidden and unmatchable mappings untouched', () => {
    const c = conn({ statusMappings: [
      { jiraStatus: 'To Do', groupId: 'todo' },
      { jiraStatus: 'Parked', groupId: 'hidden' },
      { jiraStatus: 'Odd', groupId: 'group_gone' },
    ] })
    expect(repointOrphanMappings(c)).toBe(c)
  })
})

describe('defaultGroupForCategory', () => {
  it('only picks groups the connection has', () => {
    const custom: StatusGroup[] = [{ id: 'g_open', label: 'Open', color: 'blue' }, { id: 'g_shut', label: 'Shut', color: 'green', isClosed: true }]
    expect(defaultGroupForCategory('new', custom)).toBe('g_open')
    expect(defaultGroupForCategory('indeterminate', custom)).toBe('g_open')
    expect(defaultGroupForCategory('done', custom)).toBe('g_shut')
  })

  it('sends done statuses to a closed group, not hidden', () => {
    // hidden statuses are cut from the Jira query, so their issues would never be fetched.
    expect(defaultGroupForCategory('done', groups)).toBe('done')
  })
})

describe('remapAfterGroupChange', () => {
  it("re-points a removed group's mappings at a remaining open group", () => {
    const c = conn({ statusMappings: [{ jiraStatus: 'Code Review', groupId: 'group_mub3smo1' }] })
    const next = remapAfterGroupChange(c, groups.filter((g) => g.id !== 'group_mub3smo1'))
    expect(next.statusMappings![0]!.groupId).toBe('todo')
  })
})
