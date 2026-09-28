export type Status = 'todo' | 'inprogress' | 'review' | 'done' | 'blocked'
export type Priority = 'low' | 'medium' | 'high' | 'critical'
export type ScheduleType = 'work' | 'vacation' | 'dayoff' | 'sick' | 'holiday'
export type View = 'daily' | 'deadlines' | 'search' | 'performance' | 'plan' | 'schedule' | 'sprint' | 'timeline' | 'report' | 'notes' | 'team'

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

/*
 * One deployment as the provider recorded it. This is the piece DORA needs that nothing
 * else in the tracker can supply: Jira knows when work was called done and the git host
 * knows when it was merged, but only the deployment record says when it reached anybody.
 */
export interface DeploymentRecord {
  id: string              // "gitlab:<projectId>:<iid>" / "github:<owner>/<repo>:<id>"
  provider: 'gitlab' | 'github'
  repo: string            // path with namespace / owner-repo
  environment: string     // as the provider names it; production is matched loosely
  status: 'success' | 'failed' | 'running' | 'canceled'
  createdAt: string       // ISO
  finishedAt?: string     // ISO, when the provider recorded one
  sha?: string
  url?: string
  projectId?: string      // tracker project this connection belongs to, when it is scoped
}

export interface GitLabConfig {
  id: string
  name: string
  enabled: boolean
  token: string
  tokenInVault?: boolean  // token is held in the server's encrypted vault; `token` is then empty
  groupPath: string       // e.g. 'mycompany' or 'mycompany/subgroup'
  syncInterval: number    // minutes; 0 = manual only
  developerUsernames?: Record<string, string | string[]>  // devId → gitlab username(s) for this connection; read via identityList()
  lastSync?: string
  lastSyncResult?: string
  projectId?: string      // if set, this connection belongs to a specific project; empty = global
}

export interface GitHubConfig {
  id: string
  name: string
  enabled: boolean
  token: string
  tokenInVault?: boolean  // token is held in the server's encrypted vault; `token` is then empty
  orgOrUser: string       // GitHub org or user — all repos in this org are scanned (mirrors GitLab groupPath)
  syncInterval: number    // minutes; 0 = manual only
  developerUsernames?: Record<string, string | string[]>  // devId → github username(s); read via identityList()
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
  tokenInVault?: boolean  // token is held in the server's encrypted vault; `token` is then empty
  projectKeys: string[]
  syncInterval: number  // minutes; 0 = manual only
  developerEmails?: Record<string, string | string[]>  // devId → jira email(s) for this connection; read via identityList()
  statusGroups?: StatusGroup[]              // user-defined display groups
  statusMappings?: JiraStatusMapping[]      // jiraStatus → groupId mapping
  boardId?: number                          // board mode: sync only issues from this one board (Agile API)
  allowedBoardIds?: number[]               // project mode: show only issues from these boards (empty = all)
  hoursPerDay?: number                       // Jira working hours per day (default 8); used to format time estimates
  lastSync?: string
  lastFullSync?: string    // last sync that fetched everything and was allowed to prune
  lastSyncResult?: string
  projectId?: string                        // if set, this connection belongs to a specific project; empty = global
}

export type PrState = 'open' | 'draft' | 'merged' | 'closed'

export interface PrStateEvent {
  state: PrState
  at: string  // ISO timestamp
}

export interface PrEntry {
  url: string
  date: string
  time: string
  state?: PrState
  stateHistory?: PrStateEvent[]
}

export interface StatusHistoryEntry {
  status: Status
  at: string  // ISO timestamp
}

export interface DeadlineHistoryEntry {
  deadline: string      // YYYY-MM-DD
  deadlineTime?: string // HH:MM, when one was given
  at: string            // ISO instant the deadline was set to this value
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
  parentKey?: string      // Jira key of this issue's parent, when it is a subtask — drives nesting in the UI
  manualStatus?: Status  // set when user manually changes status; overrides Jira sync
  statusHistory?: StatusHistoryEntry[]
  /*
   * Every deadline this issue has had, oldest first, appended whenever it changes (by hand
   * or from a Jira sync). Without it "on time" is unfalsifiable: an issue whose due date
   * was moved on the last day is indistinguishable from one delivered comfortably early.
   */
  deadlineHistory?: DeadlineHistoryEntry[]
  storyPoints?: number              // from Jira customfield_10016 or customfield_10028
  timeOriginalEstimate?: number     // seconds, from Jira fields.timeoriginalestimate
  timeSpent?: number                // seconds, from Jira fields.timespent
  jiraCreatedAt?: string            // ISO date of issue creation in Jira (YYYY-MM-DD)
  // Issue type (Task/Bug/Story/Epic/…) — NOT a fixed set: every Jira project can define
  // its own types, so this mirrors whatever `issuetype.name` Jira returns verbatim.
  issueTypeName?: string
  issueTypeIconUrl?: string         // Jira's own per-type icon, rendered as-is (no local icon-per-type mapping)
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
  /*
   * Default integration identities. Each sync prefers the per-connection override
   * (conn.developerEmails / conn.developerUsernames) and falls back to these, so a
   * username set once here works across every connection without re-entry.
   *
   * A developer can legitimately have several identities per service (work vs personal
   * account, a renamed handle, separate Jira instances), so these accept a list. The
   * bare-string form is still accepted because that's what existing saved data holds —
   * always read them through identityList() rather than touching them directly.
   */
  jiraEmail?: string | string[]
  gitlabUsername?: string | string[]
  githubUsername?: string | string[]
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

/*
 * A commitment sent to a partner before development starts: how many hours each kind of
 * developer will spend, and by when. Lines are independent and add up — an allocation for
 * one person sits alongside a role allocation rather than inside it.
 */
export interface PlanLine {
  id: string
  label: string
  /*
   * Who this line's hours belong to. A line naming a person wins over a line naming their
   * role, so an issue is only ever counted once.
   */
  target: { kind: 'roles'; roles: string[] } | { kind: 'developer'; devId: string }
  hours: number
  /** This line's own date, when it differs from the project's. YYYY-MM-DD. */
  end?: string
}

export interface ProjectPlan {
  /** The whole project's date; a line without its own `end` is judged against this. */
  targetEnd?: string
  /** When the document was agreed, so work before it is not counted against the plan. */
  approvedAt?: string
  lines: PlanLine[]
}

export interface Project {
  id: string
  name: string
  color: string
  desc: string
  members: string[]
  /*
   * When each member joined THIS project (YYYY-MM-DD), keyed by developer id. Kept
   * alongside `members` rather than turning that into an array of objects, because
   * members is read in a couple of dozen places as a plain id list. A member with no
   * entry here simply has no known join date and is treated as always having been on
   * the project.
   */
  joinDates?: Record<string, string>
  nonWorkingDays?: number[]  // 0=Sun 1=Mon … 6=Sat; defaults to [0,6] when absent
  mode?: 'kanban' | 'scrum'
  jiraBoardId?: number
  jiraConnectionId?: string  // links this project to a specific Jira connection
  boardProjectKeys?: string[]  // Jira project key prefixes the selected board covers (e.g. ['COM']); resolved when board is saved. Empty array = board resolved but has no issues.
  boardIssueKeys?: string[]    // EXACT Jira issue keys on the selected board (e.g. ['COM-826','COM-813']); the accurate board-membership signal. Resolved on board save and refreshed each sync.
  /** The agreed hours-per-role document this project is delivered against. */
  plan?: ProjectPlan
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
  browserTimezone?: string  // this browser's IANA zone, saved so the server-side sync knows the user's "today"
  releaseNoteColumns?: ReleaseNoteColumn[]
  releaseNoteData?: Record<string, ReleaseNoteIssueData>  // key = jiraDedupeKey or issueId
  deployments?: DeploymentRecord[]  // what the git host published, for the DORA measures
}
