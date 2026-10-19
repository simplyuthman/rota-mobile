#!/usr/bin/env node
// Helper to run vitest from node directly (workaround for pnpm script restriction on Windows)
const { spawnSync } = require('child_process');
const args = process.argv.slice(2);
const result = spawnSync(
  process.execPath,
  [
    'node_modules/vitest/vitest.mjs',
    ...args,
  ],
  {
    cwd: __dirname,
    stdio: 'inherit',
    shell: false,
  }
);
process.exit(result.status || 0);
