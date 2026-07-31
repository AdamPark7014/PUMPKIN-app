/**
 * Load monorepo env files, then start Nest in watch mode.
 * Avoids Prisma Accelerate mis-detect when cwd env is incomplete.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.trimStart().startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    if (!key) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

const apiRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(apiRoot, '../..');

loadEnvFile(path.join(repoRoot, '.env'));
loadEnvFile(path.join(apiRoot, '.env'));
loadEnvFile(path.join(apiRoot, '.env.local'));

const db = process.env.DATABASE_URL || '';
if (!db.startsWith('postgresql://') && !db.startsWith('postgres://')) {
  console.error(
    `[dev-with-env] DATABASE_URL must be postgres(ql):// (got protocol=${db.split('://')[0] || 'empty'})`,
  );
  process.exit(1);
}

const child = spawn(
  process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
  ['exec', 'nest', 'start', '--watch'],
  {
    cwd: apiRoot,
    stdio: 'inherit',
    env: process.env,
    shell: true,
  },
);

child.on('exit', (code) => process.exit(code ?? 1));
