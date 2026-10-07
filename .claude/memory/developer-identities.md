---
name: developer-identities
description: How developer↔integration identities (Jira email, GitLab/GitHub usernames) are stored and resolved — list-or-string shape, override precedence, and the traps
metadata:
  type: project
---

A developer's integration identities live in TWO places, and the resolution order matters:

1. **Global default** on `Developer`: `jiraEmail`, `gitlabUsername`, `githubUsername`
2. **Per-connection override**: `conn.developerEmails[devId]` / `conn.developerUsernames[devId]`

**Why:** one identity per service didn't match reality — people have work + personal accounts, renamed handles, and separate Jira instances. Issues under the second account were silently never synced.

**How to apply:**

- Every one of these fields is `string | string[]`. The bare-string form is legacy saved data and still exists in production — **never** read these directly. Always go through `identityList()` (normalizes, trims, dedupes, drops blanks) or `resolveIdentities(override, fallback)` in `src/utils/format.ts`.
- `resolveIdentities` uses `||`, not `??`, on purpose: a **blank** override must fall through to the global default. Using `??` meant a developer added to a connection but left blank synced *nothing* — a real production bug.
- All identities are used, not just the first. Jira puts them all in `assignee in (…)` (each expanded to email + local-part, since some instances key on username). Board modes query once per identity and merge by issue key.
- GitLab/GitHub usernames only *widen which MRs/PRs get fetched* into a pool deduped by id — they are never matched back to a developer. Task linking happens by Jira key. That's why extra usernames are low-risk there.
- UI editing rows must render from the RAW stored array, not `identityList()` — filtering blanks deletes a just-added empty row the instant it appears, making "Add another" look broken.
