import crypto from 'crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, '..', 'data');
const secretPath = join(dataDir, '.jwt-secret');

function resolveJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;

  // Try to read a previously persisted secret
  try {
    if (existsSync(secretPath)) {
      const stored = readFileSync(secretPath, 'utf8').trim();
      if (stored.length >= 32) return stored;
    }
  } catch { /* regenerate */ }

  // Generate a new random secret and persist it
  const secret = crypto.randomBytes(48).toString('base64url');
  try {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(secretPath, secret, { mode: 0o600 });
  } catch {
    console.warn('Warning: could not persist JWT secret to disk. Tokens will invalidate on restart.');
  }
  return secret;
}

export const JWT_SECRET = resolveJwtSecret();

// Whether open registration is allowed (disable for private deployments)
export const ALLOW_REGISTRATION = process.env.ALLOW_REGISTRATION !== 'false';

// Minimum password length
export const MIN_PASSWORD_LENGTH = parseInt(process.env.MIN_PASSWORD_LENGTH || '8', 10);
