---
name: backend-large-payloads
description: Never pass user task data through class-transformer (DTO .create / ClassSerializer) — it blocked Render past its 5s health check; and eslint --fix can merge ordered awaits
metadata:
  type: feedback
---

On 2026-09-24, Render instances failed with "HTTP health check timed out after 5 seconds".
- Cause: `PmTrackerRecordsDto.create()` (class-transformer plainToInstance) deep-copied every task. That blocked the event loop for 2+ s locally and multiplied heap use under the 300 MB cap.
- It ran on every `GET /pm-tracker/records` and on every server sync.
- Fix: plain objects internally. The HTTP response is assembled from Postgres `jsonb::text` (`records/load-records.ts` `recordsJson`) and sent with `@Res`.
- The same freeze also came from the provider relays: `jira-search`, `jira-board-issues`, `github` and `gitlab` serialized megabyte Jira and GitHub answers through class-transformer (245 ms per Jira search locally, versus 3 ms with `JSON.stringify`). They now use `common/http/send-json.ts` `sendJson()`.
- The 16:09 outage began 15 s after a push, so it was not the deploy. Check timestamps before blaming the latest change.

**Why:** the instance is single-threaded with 0.5 CPU and `--max-old-space-size=300`. Any synchronous walk over megabytes of JSON takes the whole service down.

**How to apply:**
- Any endpoint returning large provider data or task data sends it with `sendJson` or a string. Never use DTO `.create()` on it, and never let it pass through the ClassSerializer.
- Benchmark with a ~20 MB synthetic dataset under `--max-old-space-size=300`, measuring `monitorEventLoopDelay`, before shipping.
- Keep the kill switch `isServerSyncEnabled` in `server-sync.service.ts`.
- In progressor-backend, `eslint --fix` applies `awesome-nest/prefer-promise-all`, which merges sequential awaits into `Promise.all` even when their order matters. Review `git diff` after every `--fix`.

Related: [[server-side-sync]], [[state-save-architecture]]
