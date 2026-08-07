import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

function required(name: string): string {
  const v = process.env[name];
  if (v == null || v.trim().length === 0) {
    throw new Error(
      `Missing required environment variable ${name}. Copy server/.env.example to server/.env and fill it in.`,
    );
  }
  return v;
}

function optional(name: string, fallback: string): string {
  const v = process.env[name];
  return v == null || v.trim().length === 0 ? fallback : v;
}

function int(name: string, fallback: number): number {
  const v = process.env[name];
  if (v == null || v.trim().length === 0) return fallback;
  const n = parseInt(v, 10);
  if (isNaN(n)) throw new Error(`Environment variable ${name} must be an integer, got "${v}".`);
  return n;
}

function bool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v == null || v.trim().length === 0) return fallback;
  return v.toLowerCase() === 'true' || v === '1';
}

export const env = {
  nodeEnv: optional('NODE_ENV', 'development'),
  get isProd(): boolean { return this.nodeEnv === 'production'; },
  /**
   * Passwordless "switch user" for LOCAL TESTING ONLY. Fail-closed on purpose:
   * needs the explicit PROSPECTOR_DEV_LOGIN flag AND a non-production NODE_ENV.
   * The live site sets neither (and the flag is in no committed env), so login
   * there is always real — even though it runs a dev build.
   */
  get devLogin(): boolean { return !this.isProd && bool('PROSPECTOR_DEV_LOGIN', false); },
  port: int('PORT', 4000),
  corsOrigin: optional('CORS_ORIGIN', 'http://localhost:3000'),

  db: {
    host: optional('DB_HOST', '127.0.0.1'),
    port: int('DB_PORT', 3306),
    user: required('DB_USER'),
    password: optional('DB_PASSWORD', ''),
    database: required('DB_NAME'),
    connectionLimit: int('DB_CONNECTION_LIMIT', 10),
  },

  cookieSecure: bool('COOKIE_SECURE', false),
  sessionTtlHours: int('SESSION_TTL_HOURS', 12),

  bootstrap: {
    email: optional('BOOTSTRAP_MANAGER_EMAIL', 'director@demo.ae'),
    name: optional('BOOTSTRAP_MANAGER_NAME', 'The Director'),
    password: optional('BOOTSTRAP_MANAGER_PASSWORD', ''),
  },
  seedDemoData: bool('SEED_DEMO_DATA', false),

  maxUploadBytes: int('MAX_UPLOAD_BYTES', 25 * 1024 * 1024),
  importSessionTtlMinutes: int('IMPORT_SESSION_TTL_MINUTES', 60),
};
