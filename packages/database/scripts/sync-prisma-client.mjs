import { cpSync, mkdirSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(pkgRoot, '..', '..');
const src = join(pkgRoot, 'generated', 'client');

const targets = [
  join(repoRoot, 'node_modules', '.prisma', 'client'),
  join(repoRoot, 'apps', 'api', 'node_modules', '.prisma', 'client'),
];

// pnpm's isolated store keeps its own copy of `.prisma/client` next to
// @prisma/client itself — `require('.prisma/client')` inside @prisma/client
// resolves there first, so every consumer (including apps/api) actually
// loads THIS copy at runtime, not the ones above. Without syncing it too,
// the app keeps running a stale client after schema changes even though
// `prisma generate` succeeded.
const pnpmDir = join(repoRoot, 'node_modules', '.pnpm');
try {
  for (const entry of readdirSync(pnpmDir)) {
    if (!entry.startsWith('@prisma+client@')) continue;
    targets.push(join(pnpmDir, entry, 'node_modules', '.prisma', 'client'));
  }
} catch {
  // pnpm store not found (e.g. different package manager) — skip silently.
}

for (const dest of targets) {
  mkdirSync(dest, { recursive: true });
  // Overwrite in place rather than rmSync-then-copy: under OneDrive-synced
  // folders, deleting the destination directory intermittently fails with
  // EPERM (cloud-sync file lock) even when no process holds it open, while
  // overwriting existing files does not hit that lock.
  cpSync(src, dest, { recursive: true, force: true });
  console.log(`Synced Prisma client → ${dest}`);
}
