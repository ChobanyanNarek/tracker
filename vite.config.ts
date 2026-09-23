import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Build id (local time, to the minute) so the running app can show which build
// it is — makes a stale browser cache obvious at a glance.
const buildId = new Date().toISOString().slice(5, 16).replace('T', ' ')
// The git commit this build came from (Vercel sets it at build time). Attached to every
// reported error so a failure can be tied to the exact deploy that caused it.
const commit = (process.env.VERCEL_GIT_COMMIT_SHA ?? 'local').slice(0, 7)

export default defineConfig({
  plugins: [react()],
  base: '/',
  build: { outDir: 'dist' },
  define: { __BUILD_ID__: JSON.stringify(buildId), __COMMIT__: JSON.stringify(commit) },
})
