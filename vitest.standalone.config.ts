import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    include: ['test/{unit,integration}/**/*.test.ts'],
    exclude: [
      'test/unit/finance-detailed-api-call-provider-matrix.test.ts',
      'test/unit/finance-api-interface-adherence.test.ts',
      'test/unit/finance-data-api-completion-audit.test.ts',
      'test/unit/finance-data-health-report.test.ts',
      'test/unit/finance-live-probe-backlog.test.ts',
      'test/unit/finance-skill-contract.test.ts',
      'test/unit/finance-skill-provider-contract.test.ts',
      'test/unit/workflow-scenario-catalog.test.ts',
      'test/unit/data-api-interface-contract.test.ts',
      'test/unit/data-interface-health.test.ts',
      'test/unit/finance-news-data-api-service.test.ts',
      'test/unit/data-store-data-health.test.ts',
      'test/unit/data-store-interface-discovery.test.ts',
      'test/unit/fetch-queue.test.ts',
      'test/unit/industry-fetcher.test.ts',
      'test/unit/market-data-persistence.test.ts',
      'test/unit/structured-ingestion.test.ts',
      'test/unit/sync-tool-contracts.test.ts',
      'test/unit/tool-error.test.ts',
      'test/unit/watchlist-feed-codes.test.ts',
      'test/unit/watchlist-strategy-contract.test.ts',
      'test/unit/custom-strategy-preflight.test.ts',
      'test/unit/finance-provenance.test.ts',
      'test/unit/workflow-automation-control.test.ts',
      'test/integration/agent-loop.test.ts',
    ],
    testTimeout: 15000,
    globals: true,
  },
  resolve: {
    alias: {
      '@agent': resolve(__dirname, 'src/agent'),
    },
  },
})
