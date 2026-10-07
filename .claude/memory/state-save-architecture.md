---
name: state-save-architecture
description: "How pm-tracker persists state: per-record storage with revisions since 2026-09-23 (Stage C, backend ADR-0018); the old full-blob PUT is a frozen backup"
metadata:
  node_type: memory
  type: project
  originSessionId: 065f8334-85f9-4e91-8753-6c7100ae2f5f
  modified: 2026-09-23T15:58:49.157Z
---

Since 2026-09-23 (Stage C), data is stored **per record**:
- one row per task in `pm_tracker_task`
- one row per settings section in `pm_tracker_doc`
- deletes leave rows in `pm_tracker_tombstone`

Every record carries a `revision` from the global sequence `pm_tracker_revision_seq`.
- `GET /pm-tracker/records[?since=N]` returns everything, or only what changed after N.
- `POST /pm-tracker/records/commit` does a compare-and-set per record. Stale writes come back as conflicts with the server's copy.
- The backend's rules are in ADR-0018.

Frontend:
- `src/store/records-sync.ts` holds `RecordTracker`: a base revision and value per record. `collect` diffs by reference, then with `deepEqual`, in batches of at most 300. `apply` merges conflicts with `merge3` from `src/utils/merge.ts`. `pull` catches up on changes from other tabs.
- View keys (`selectedDate`, `selectedDev`, `selectedProject`, `notifsEnabled`) are never applied from other tabs.

Migration from the blob:
- Lazy and per user, on the first `/records` call, in one transaction with a count check.
- `pm_tracker_state.data` is left untouched as the backup, with `migrated_at` set.
- After migration, `PUT /state` returns 409 `error.pmTrackerStateMigrated`, and `GET /state` is assembled from the records.

**Why:** the full-blob PUT let stale tabs and devices overwrite newer data, which is why issues kept "disappearing", and it hit body-size limits.

**How to apply:**
- Keep these guards: one save in flight, gzip, backoff with jitter, `unauthorized` kept distinct from other errors, keepalive on pagehide, and backoff when a reply answers for zero records (it used to loop at full speed).
- A failed initial load keeps the loading screen and retries. Never show an empty board, because that looks like data loss.
- Jira/PR per-day issue copies are intentional history snapshots. "Store each issue once" was deliberately not done (see ADR-0018).
- Server-side sync/webhooks were deferred until this landed. Build them next on records + revisions.

Related: [[backend-deploy-branch]], [[legacy-jira-field]]
