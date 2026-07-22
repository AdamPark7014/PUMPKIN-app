import { cpSync, mkdirSync, rmSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(pkgRoot, '..', '..');
const src = join(pkgRoot, 'generated', 'client');

const targets = [
  join(repoRoot, 'node_modules', '.prisma', 'client'),
  join(repoRoot, 'apps', 'api', 'node_modules', '.prisma', 'client'),
];

for (const dest of targets) {
  mkdirSync(dirname(dest), { recursive: true });
  rmSync(dest, { recursive: true, force: true });
  cpSync(src, dest, { recursive: true });
  console.log(`Synced Prisma client → ${dest}`);
}
