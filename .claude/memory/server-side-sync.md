---
name: server-side-sync
description: "Stage D (2026-09-23) — Jira/GitHub/GitLab syncs run on the server using a generated copy of the app's src/sync-core; edit in the app, then regenerate"
metadata:
  node_type: memory
  type: project
  originSessionId: 065f8334-85f9-4e91-8753-6c7100ae2f5f
  modified: 2026-09-23T17:06:09.023Z
---

Since 2026-09-23 (Stage D, backend ADR-0019), the sync logic lives in `pm-tracker/src/sync-core`. It is pure TS:
- it takes a `Transport` plus `today` and `tz` as inputs
- each sync is split into compute (on a snapshot) and apply (onto live state)

The backend runs the SAME code from `progressor-backend/src/modules/pm-tracker/sync-core`, a **generated copy**.
- **Never edit the backend copy.** Edit the app, then run `node scripts/vendor-sync-core.mjs`, then commit both repos.
- `--check` fails when the copy is stale. Include it in the frontend deploy gate, together with `npx tsc -p tsconfig.sync-core.json` (the backend's strict flags).

Backend pieces:
- `ServerSyncService`
  - ticks every minute; runs users whose connection `lastSync + syncInterval` has passed
  - only subscribed, trial or admin users with a saved `browserTimezone`/`trackerTimezone`
  - per-provider backoff from 5 min up to 2 h
- `serverTransport`: in-process calls with the same ValidationPipe as the HTTP routes.
- Endpoints:
  - `POST /pm-tracker/sync` runs a sync now
  - `GET /pm-tracker/sync` returns status and the webhook path
  - `POST /pm-tracker/hooks/:token` is public; it triggers a debounced sync

Frontend behavior:
- Manual syncs go to the server and fall back to the browser if the server is unreachable.
- Background syncs are skipped when `serverSync.serverSync` is set.
- The app saves `browserTimezone` on load.

Performance rules, learned the hard way (2026-09-24):
- Always benchmark with 10 developers × 1,000 realistic Jira issues (including changelogs), full GitHub PR payloads and 1,500 tasks, under `--max-old-space-size=300`, before shipping sync changes.
- Rules for the code:
  - Linking goes through the issue index (`buildIssueIndex`), never a scan of every issue per PR.
  - Jira answers are trimmed by `compactJiraIssue`.
  - PRs are slimmed before they are kept.
  - Long loops call `pause()`.

**Why:** fresh data on open, one sync for all tabs and devices, and no second implementation of logic that took many production fixes.

**How to apply:**
- Any sync fix goes into `sync-core` in the app, then gets vendored.
- Server-run syncs save via `RecordTracker` + `CommitRecordsCommand`, like a tab. See [[state-save-architecture]].
