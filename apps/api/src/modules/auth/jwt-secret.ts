import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

/** Load .env files before JwtModule evaluates secrets (Nest ConfigModule loads too late). */
function hydrateEnvFromFiles() {
  if (process.env.JWT_SECRET) return;
  const candidates = [
    resolve(process.cwd(), '.env.local'),
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), '../../.env'),
    resolve(__dirname, '../../../../.env'),
  ];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      if (!line || line.trimStart().startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq < 1) continue;
      const key = line.slice(0, eq).trim();
      if (!key || process.env[key] != null) continue;
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
}

/** Fails fast at boot instead of silently signing tokens with a public fallback secret. */
export function requireJwtSecret(): string {
  hydrateEnvFromFiles();
  const secret = process.env.JWT_SECRET;
  if (
    !secret ||
    Buffer.byteLength(secret, 'utf8') < 32 ||
    /^(change-me|secret|your-super-secret)/i.test(secret)
  ) {
    throw new Error(
      'JWT_SECRET must be a non-default secret with at least 32 bytes.',
    );
  }
  return secret;
}
