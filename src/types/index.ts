export type Status = 'todo' | 'inprogress' | 'review' | 'done' | 'blocked'
export type Priority = 'low' | 'medium' | 'high' | 'critical'
export type ScheduleType = 'work' | 'vacation' | 'dayoff' | 'sick' | 'holiday'
export type View = 'daily' | 'deadlines' | 'search' | 'performance' | 'schedule'

export interface GitLabConfig {
  enabled: boolean
  token: string
  groupPath: string       // e.g. 'mycompany' or 'mycompany/subgroup'
  syncInterval: number    // minutes; 0 = manual only
  lastSync?: string
  lastSyncResult?: string
}

export interface JiraConfig {
  enabled: boolean
  baseUrl: string
  email: string
  token: string
  projectKeys: string[]
  syncInterval: number  // minutes; 0 = manual only
  proxyUrl: string      // optional CORS proxy prefix, e.g. https://worker.dev/?url=
  lastSync?: string
  lastSyncResult?: string
}

export interface PrEntry {
  url: string
  date: string
  time: string
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
  _srcIdx?: number
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
  jiraSync?: boolean
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
}

export interface Project {
  id: string
  name: string
  color: string
  desc: string
  members: string[]
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
  tasks: Task[]
  schedule: Record<string, Record<string, string>>
  scheduleHours: Record<string, Record<string, number>>
  selectedDev: string
  selectedProject: string
  selectedDate: string
  view: View
  notifsEnabled: boolean
  jiraConfig: JiraConfig
  gitlabConfig: GitLabConfig
}
