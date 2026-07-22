export type Status = 'todo' | 'inprogress' | 'review' | 'done' | 'blocked'
export type Priority = 'low' | 'medium' | 'high' | 'critical'
export type ScheduleType = 'work' | 'vacation' | 'dayoff' | 'sick' | 'holiday'
export type View = 'daily' | 'deadlines' | 'search' | 'performance' | 'schedule' | 'sprint'

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
  boardId?: number                          // if set, sync only issues from this board (Agile API)
  lastSync?: string
  lastSyncResult?: string
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
  manualStatus?: Status  // set when user manually changes status; overrides Jira sync
  statusHistory?: StatusHistoryEntry[]
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
}

export interface DeadlineItem {
  task: Task
  deadline: string
  deadlineTime: string
  title: string
  status: Status
  jiraUrl: string
  taskDate: string
  _key: string
  _daysStuck: number
  _sinceDate: string
}

export interface AppState {
  developers: Developer[]
  projects: Project[]
  sprints: Sprint[]
  tasks: Task[]
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
  trackerTimezone?: string  // single IANA zone for Performance calc; falls back to browser zone
}
