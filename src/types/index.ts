export type Status = 'todo' | 'inprogress' | 'review' | 'done' | 'blocked'
export type Priority = 'low' | 'medium' | 'high' | 'critical'
export type ScheduleType = 'work' | 'vacation' | 'dayoff' | 'sick' | 'holiday'
export type View = 'daily' | 'deadlines' | 'search' | 'performance' | 'schedule' | 'sprint' | 'timeline' | 'report' | 'notes'

export interface Note {
  id: string
  title: string
  body: string                // lightweight markdown
  color?: string              // CSS var value, e.g. 'var(--amber)'
  projectId?: string          // optional: scope to a project
  pinned?: boolean
  reminderAt?: string         // ISO datetime "YYYY-MM-DDTHH:MM"; when set → notify
  reminderFired?: boolean     // one-shot guard; reset when reminderAt changes
  createdAt: string           // ISO
  updatedAt: string           // ISO
  archivedAt?: string
}

export interface GitLabConfig {
  id: string
  name: string
  enabled: boolean
  token: string
  groupPath: string       // e.g. 'mycompany' or 'mycompany/subgroup'
  syncInterval: number    // minutes; 0 = manual only
  developerUsernames?: Record<string, string>  // devId → gitlab username for this connection
  lastSync?: string
  lastSyncResult?: string
  projectId?: string      // if set, this connection belongs to a specific project; empty = global
}

export interface GitHubConfig {
  id: string
  name: string
  enabled: boolean
  token: string
  orgOrUser: string  // GitHub org or user — used to scope PR search; leave empty to search globally
  syncInterval: number  // minutes; 0 = manual only
  developerUsernames?: Record<string, string>  // devId → github username
  lastSync?: string
  lastSyncResult?: string
  projectId?: string      // if set, this connection belongs to a specific project; empty = global
}

export type StatusGroupColor = 'blue' | 'amber' | 'red' | 'purple' | 'green' | 'teal' | 'pink' | 'orange' | 'gray'

export interface StatusGroup {
  id: string             // unique slug e.g. 'inprogress', 'testing'
  label: string          // shown on card badge
  color: StatusGroupColor
  isClosed?: boolean     // issues in this group are removed from daily board (like "done")
}

export interface JiraStatusMapping {
  jiraStatus: string     // exact Jira status name
  groupId: string        // points to a StatusGroup id; 'hidden' = never show
}

export interface JiraConfig {
  id: string
  name: string
  enabled: boolean
  baseUrl: string
  email: string
  token: string
  projectKeys: string[]
  syncInterval: number  // minutes; 0 = manual only
  developerEmails?: Record<string, string>  // devId → jira email for this connection
  statusGroups?: StatusGroup[]              // user-defined display groups
  statusMappings?: JiraStatusMapping[]      // jiraStatus → groupId mapping
  boardId?: number                          // board mode: sync only issues from this one board (Agile API)
  allowedBoardIds?: number[]               // project mode: show only issues from these boards (empty = all)
  hoursPerDay?: number                       // Jira working hours per day (default 8); used to format time estimates
  lastSync?: string
  lastSyncResult?: string
  projectId?: string                        // if set, this connection belongs to a specific project; empty = global
}

export interface PrEntry {
  url: string
  date: string
  time: string
}

export interface StatusHistoryEntry {
  status: Status
  at: string  // ISO timestamp
}

export interface JiraIssue {
  issueId?: string   // stable identity — same across all days this issue appears on
  boardId?: number   // board this issue was synced from (set when conn uses board mode)
  url: string
  name: string
  status: Status
  priority: Priority
  deadline: string
  deadlineTime: string
  prs: PrEntry[]
  comment: string
  hidden?: boolean
  groupId?: string        // display group id from status mapping (drives label + color on card)
  jiraStatusName?: string // raw Jira status name (e.g. "In Review"); used to re-derive groupId when mappings change
  manualStatus?: Status  // set when user manually changes status; overrides Jira sync
  statusHistory?: StatusHistoryEntry[]
  storyPoints?: number              // from Jira customfield_10016 or customfield_10028
  timeOriginalEstimate?: number     // seconds, from Jira fields.timeoriginalestimate
  timeSpent?: number                // seconds, from Jira fields.timespent
  jiraCreatedAt?: string            // ISO date of issue creation in Jira (YYYY-MM-DD)
  _srcIdx?: number
}

export interface WorkSchedule {
  workDays: number[]   // 0=Sun 1=Mon … 6=Sat
  startTime: string    // "HH:MM"
  endTime: string      // "HH:MM"
  dailyHours: number   // actual productive hours/day (≤ window length)
  timezone?: string    // IANA e.g. "Asia/Yerevan"; falls back to browser timezone if not set
}

export interface Task {
  id: string
  devId: string
  projectId: string
  title: string
  status: Status
  jira: string
  jiras: JiraIssue[]
  pr: string
  prs: PrEntry[]
  deadline: string
  deadlineTime: string
  reviewDate: string
  reviewTime: string
  comment: string
  date: string
  carriedOver?: boolean
  carriedFrom?: string
  carriedOverNwd?: boolean
  jiraSync?: boolean
  deletedJiraUrls?: string[]
}

export interface EmploymentPeriod {
  type: 'full' | 'part'
  hours: number
  from: string
  to: string | null
}

export interface Developer {
  id: string
  name: string
  role: string
  color: string
  periods?: EmploymentPeriod[]
  jiraEmail?: string
  gitlabUsername?: string
  archivedAt?: string
  workSchedule?: WorkSchedule
}

export interface Sprint {
  id: string
  projectId: string
  name: string
  startDate: string  // YYYY-MM-DD
  endDate: string    // YYYY-MM-DD
  jiraSprintId?: number  // Jira sprint ID for dedup on re-sync
  jiraBoardId?: number   // board this sprint was synced from
}

export interface Project {
  id: string
  name: string
  color: string
  desc: string
  members: string[]
  nonWorkingDays?: number[]  // 0=Sun 1=Mon … 6=Sat; defaults to [0,6] when absent
  mode?: 'kanban' | 'scrum'
  jiraBoardId?: number
  jiraConnectionId?: string  // links this project to a specific Jira connection
  boardProjectKeys?: string[]  // Jira project key prefixes the selected board covers (e.g. ['COM']); resolved when board is saved. Empty array = board resolved but has no issues.
  boardIssueKeys?: string[]    // EXACT Jira issue keys on the selected board (e.g. ['COM-826','COM-813']); the accurate board-membership signal. Resolved on board save and refreshed each sync.
}

export interface DeadlineItem {
  task: Task
  deadline: string
  deadlineTime: string
  title: string
  status: Status
  groupId?: string   // display group from status mapping — same source as the Daily board
  jiraUrl: string
  taskDate: string
  _key: string
  _daysStuck: number
  _sinceDate: string
}

export interface ReleaseNoteColumn {
  id: string
  label: string
}

export interface ReleaseNoteIssueData {
  hidden?: boolean
  selected?: boolean
  customFields?: Record<string, string>  // colId → value
}

export interface AppState {
  developers: Developer[]
  projects: Project[]
  sprints: Sprint[]
  tasks: Task[]
  notes: Note[]
  schedule: Record<string, Record<string, string>>
  scheduleHours: Record<string, Record<string, number>>
  selectedDev: string
  selectedProject: string
  selectedDate: string
  view: View
  notifsEnabled: boolean
  jiraConnections: JiraConfig[]
  gitlabConnections: GitLabConfig[]
  githubConnections: GitHubConfig[]
  highlightedTaskId: string | null
  highlightedNoteId?: string | null
  trackerTimezone?: string  // single IANA zone for Performance calc; falls back to browser zone
  releaseNoteColumns?: ReleaseNoteColumn[]
  releaseNoteData?: Record<string, ReleaseNoteIssueData>  // key = jiraDedupeKey or issueId
}
