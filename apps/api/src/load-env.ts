import { config } from 'dotenv';
import { existsSync } from 'fs';
import { resolve } from 'path';

/**
 * Load .env before Prisma/Nest bootstrap (monorepo: api folder + repo root).
 */
export function loadEnvFiles() {
  const candidates = [
    resolve(process.cwd(), '.env.local'),
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), '../../.env'),
    resolve(__dirname, '../.env'),
    resolve(__dirname, '../../.env'),
    resolve(__dirname, '../../../.env'),
  ];

  const loaded: string[] = [];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    const result = config({ path: file, override: false });
    if (!result.error) loaded.push(file);
  }

  if (!process.env.DATABASE_URL && existsSync(resolve(process.cwd(), '../../.env.example'))) {
    config({ path: resolve(process.cwd(), '../../.env.example'), override: false });
  }

  return loaded;
}

loadEnvFiles();
