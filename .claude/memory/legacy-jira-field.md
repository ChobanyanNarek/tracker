---
name: legacy-jira-field
description: "Tasks have a legacy single t.jira string field separate from the modern t.jiras[] array; filters must handle both"
metadata: 
  node_type: memory
  type: project
  originSessionId: e28b4f00-0f8f-4577-bac4-5d3afca3fc23
  modified: 2026-07-26T14:13:06.550Z
---

A `Task` can carry a Jira issue in **two** shapes:
- `t.jiras[]` — the modern array of `JiraIssue` objects (has url, name, boardId, groupId, status…).
- `t.jira` — a **legacy single URL string** (e.g. `https://…/browse/MONE-777`). Older tasks still use this.

**Trap:** any filter/scope logic must handle BOTH. In `getVisibleTasks` (store/index.ts) the `t.jiras[]` branch applied `jiraOnBoard`, but the `else`/`t.jira` branch did NOT — so legacy issues bypassed board scoping and leaked onto boards (e.g. MONE-777 showing on the CS/Mabrook board 432). Fixed 2026-07-26 by building a minimal `{url: t.jira}` JiraIssue and running it through `jiraOnBoard`.

**When debugging "wrong issue shows" complaints:** check whether the offending issue lives in `t.jira` vs `t.jiras[]` — a store dump searching `JSON.stringify(t)` for the key reveals which field. Other views (Deadlines, Timeline, Reports, Search) may still have the same legacy-field gap — audit them if a scoping leak reappears. Related: [[board-scoped-filtering]].
