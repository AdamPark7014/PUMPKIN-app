#!/usr/bin/env node
/**
 * Runs all packages/venue-engine/scripts/smoke-*.cjs sequentially.
 * Requires a prior build (`pnpm --filter @boletera/venue-engine build`).
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const dir = __dirname;
const files = fs
  .readdirSync(dir)
  .filter((f) => /^smoke-.*\.cjs$/.test(f))
  .sort();

if (!files.length) {
  console.error('No smoke-*.cjs scripts found');
  process.exit(1);
}

const dist = path.join(dir, '..', 'dist', 'index.js');
if (!fs.existsSync(dist)) {
  console.error('Missing dist/index.js — run: pnpm --filter @boletera/venue-engine build');
  process.exit(1);
}

let failed = 0;
for (const file of files) {
  const full = path.join(dir, file);
  process.stdout.write(`\n── ${file} ──\n`);
  const r = spawnSync(process.execPath, [full], {
    cwd: path.join(dir, '..'),
    encoding: 'utf8',
    stdio: 'inherit',
  });
  if (r.status !== 0) {
    failed += 1;
    console.error(`FAIL ${file} (exit ${r.status})`);
  }
}

console.log(`\nVenue-engine smokes: ${files.length - failed}/${files.length} passed`);
process.exit(failed ? 1 : 0);
