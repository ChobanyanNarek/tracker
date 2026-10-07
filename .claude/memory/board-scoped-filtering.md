---
name: board-scoped-filtering
description: How board/kanban/scrum scoping works across all dashboards in pm-tracker (progressor.work)
metadata: 
  node_type: memory
  type: project
  originSessionId: e28b4f00-0f8f-4577-bac4-5d3afca3fc23
  modified: 2026-07-24T17:18:49.806Z
---

Board scoping rules (progressor.work), applies to Daily, Deadlines, Performance, Sprint:
- **Kanban view** (project, mode=kanban / no board): show ALL that project's issues across all its boards. No board filtering.
- **Scrum view** (project + chosen board): show ONLY issues on that exact board.

Implementation (the correct one — earlier prefix-only attempts were buggy because multiple boards share a project key):
- `Project.boardIssueKeys: string[]` = the EXACT Jira issue keys on the selected board (e.g. ['COM-826','COM-813']). This is the accurate membership signal. Resolved via `fetchBoardIssueKeys(conn, boardId, emails)` (Agile API) at board-save time in ProjectPanel.handleSaveEdit AND refreshed on every `syncJira` for each scrum project.
- `Project.boardProjectKeys: string[]` = coarse prefix fallback (e.g. ['COM']), used only when exact keys unavailable.
- `getBoardScope(state): BoardScope { active, issueKeys?: Set, prefixes? }` — single source of truth. active=false for kanban/ALL/no-board.
- `jiraOnBoard(j, scope)` and `taskPassesBoardFilter(t, scope)` in store — ALL views + `countUrgentDeadlines` use these. Exact key match preferred; prefix fallback; when board active-but-unresolved → show (until next resolve).
- `jiraFullKey(j)` extracts real key (COM-826) from URL/name (NOT issueId — issueId can be synthetic).

Other dashboard rules established this session:
- Deadlines: only issues whose status GROUP id is exactly 'inprogress' or 'blocked' (custom groups like 'Testing' excluded even though they derive from inprogress), AND have a deadline, AND on today's task only (no history scan). Status badge label/color uses resolveIssueDisplay (group) — same as Daily.
- Urgent red badge (countUrgentDeadlines) = overdue issues from that same set.
- Daily hides issues whose group is 'hidden' or isClosed (issueShowsOnBoard) — integration settings are source of truth.
- Sync mirrors Jira: fetches all non-done + done-updated-≤30d, prunes issues Jira no longer returns (deleted/moved), status always from Jira (no manualStatus masking). Assignee matched by both email and username local-part.

PWA with network-first service worker — after deploy users MUST hard-refresh (Cmd+Shift+R).
