import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    include: ['test/{unit,integration}/**/*.test.ts'],
    globals: true,
  },
  resolve: {
    alias: {
      '@agent': resolve(__dirname, 'src/agent'),
    },
  },
})
