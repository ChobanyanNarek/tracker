import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Mirror the build-time constants vite.config.ts defines.
  define: { __BUILD_ID__: JSON.stringify('test'), __COMMIT__: JSON.stringify('test') },
  test: {
    // The store touches window/localStorage at import time, so run in a DOM.
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    restoreMocks: true,
  },
})
