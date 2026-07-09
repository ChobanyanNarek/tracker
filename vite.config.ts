import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Build id (local time, to the minute) so the running app can show which build
// it is — makes a stale browser cache obvious at a glance.
const buildId = new Date().toISOString().slice(5, 16).replace('T', ' ')

export default defineConfig({
  plugins: [react()],
  base: './',
  build: { outDir: 'dist' },
  define: { __BUILD_ID__: JSON.stringify(buildId) },
})
