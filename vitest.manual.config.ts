import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    include: ['scripts/manual-tests/**/*.manual.ts'],
    globals: true,
  },
  resolve: {
    alias: {
      '@agent': resolve(__dirname, 'src/agent'),
    },
  },
})
