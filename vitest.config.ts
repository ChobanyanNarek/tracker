import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // The store touches window/localStorage at import time, so run in a DOM.
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    restoreMocks: true,
  },
})
