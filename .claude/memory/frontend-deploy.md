---
name: frontend-deploy
description: "How to deploy and verify the ProgressOr web app on Vercel, including the npm cache workaround and the live domain"
metadata:
  node_type: memory
  type: project
  originSessionId: 065f8334-85f9-4e91-8753-6c7100ae2f5f
  modified: 2026-09-26T12:12:46.333Z
---

The web app's production domain is **https://www.progressor.work** (Vercel project `progressor`).

Deploy: `npx vercel deploy --prod --yes` — the git webhook fires too, so a push can produce a
second production deployment; that is expected, not a fault.

Verify every deploy (the webhook sometimes does not fire):
1. `vercel ls` — the newest deployment is Ready and Production.
2. Fetch `https://www.progressor.work`, read the `assets/index-*.js` name out of the HTML, then
   grep that bundle for a string only the new code contains. The local `dist` hash does **not**
   match Vercel's, so comparing hashes proves nothing.

`npx vercel` fails with `EACCES … /Users/narekchobanyan/.npm/_cacache` (root-owned from an old
`sudo npm`). Work around it with a scratch cache, e.g.
`npm_config_cache=$SCRATCH/npmcache npx --yes vercel@latest deploy --prod --yes`.

**Why:** two deploys were reported as shipped without reaching the live domain.

**How to apply:** run the gate (`tsc` → `tsc -p tsconfig.sync-core.json` →
`vendor-sync-core.mjs --check` → `vitest run` → `npm run build`) before every push. See
[[backend-deploy-branch]] for the API side.
