/** Fails fast at boot instead of silently signing tokens with a public fallback secret. */
export function requireJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error(
      'JWT_SECRET environment variable is not set. Refusing to start with an insecure default.',
    );
  }
  return secret;
}
