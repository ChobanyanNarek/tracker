---
name: backend-deploy-branch
description: "progressor-backend repo has two diverged branches; develop is the deployable one, main is broken"
metadata: 
  node_type: memory
  type: project
  originSessionId: e28b4f00-0f8f-4577-bac4-5d3afca3fc23
  modified: 2026-07-26T13:24:21.265Z
---

The backend lives in a **separate repo**: `ChobanyanNarek/progressor-backend` (NestJS, deployed on Render, frontend calls it at `https://progressor-backend.onrender.com`, set via `VITE_API_URL`).

Its `main` and `develop` branches have **completely diverged histories**:
- **`develop`** = the real, deployable app — has `Dockerfile`, `package.json`, `render.yaml`, full CQRS structure. Render builds this (Docker runtime). **Push backend changes here.**
- **`main`** = broken/orphaned — contains ONLY the `src/` directory, no Dockerfile, so Render's Docker build fails: `open Dockerfile: no such file or directory`. Do NOT deploy from main.

The pm-tracker Jira proxy work (statuses, boards, board-issues, board-keys, sprints, time-tracking) was mistakenly committed to `main` for a while; it was ported onto `develop` on 2026-07-26.

**pm-tracker module on develop uses CQRS**: `PmTrackerService.getState/saveState` go through `commandBus`/`queryBus` — do not overwrite with main's standalone version; merge the Jira proxy methods in instead.

Deploy: `cd /tmp/progressor-backend && git push origin develop` → Render auto-builds. Verify a route is live via public Swagger: `curl -s https://progressor-backend.onrender.com/documentation-json | grep -o jira-board-keys`. Unauthenticated POSTs to proxy routes return 404 (auth guard), so 404 alone does NOT mean the route is missing — use the Swagger check instead. Related: [[board-scoped-filtering]].
