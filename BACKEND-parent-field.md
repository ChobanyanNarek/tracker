# Backend change: return Jira's `parent` field

Repo: `progressor-backend` (deploy branch: `develop`)
File: `src/modules/pm-tracker/pm-tracker.service.ts`

## Why

The tracker nests subtasks under their parent issue. Jira exposes that link as
`fields.parent`, but the proxy only requests a fixed field list, so the frontend
never receives it.

## What to change

Find where `jiraSearch` builds the request to `/rest/api/3/search/jql`. It sends a
`fields` list that looks roughly like:

```ts
fields: [
  'summary', 'status', 'priority', 'duedate', 'assignee', 'created',
  'timeoriginalestimate', 'timespent', 'issuetype',
  'customfield_10016', 'customfield_10028',
]
```

Add `'parent'`:

```ts
fields: [
  'summary', 'status', 'priority', 'duedate', 'assignee', 'created',
  'timeoriginalestimate', 'timespent', 'issuetype', 'parent',
  'customfield_10016', 'customfield_10028',
]
```

Do the same in `jiraBoardIssues` (the `/rest/agile/1.0/board/{id}/issue` call), which
has its own field list.

## Shape Jira returns

```json
"parent": {
  "key": "MIN-1200",
  "fields": {
    "summary": "Parent epic or story",
    "issuetype": { "name": "Story" }
  }
}
```

The frontend reads `parent.key` only, and ignores the field when absent — so this
change is backward compatible and needs no coordinated release.

## Cost

One extra field per issue. No additional API calls, negligible payload increase.
