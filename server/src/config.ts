/** Central runtime configuration, sourced entirely from environment variables. */

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v == null || v.length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v;
}

function bool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v == null) return fallback;
  return v === '1' || v.toLowerCase() === 'true';
}

const nodeEnv = process.env.NODE_ENV ?? 'development';

export const config = {
  nodeEnv,
  isProd: nodeEnv === 'production',
  host: process.env.HOST ?? '0.0.0.0',
  port: parseInt(process.env.PORT ?? '4000', 10),

  databaseUrl: required('DATABASE_URL', 'mysql://prospector:prospector@localhost:3306/prospector'),

  jwtSecret: required('JWT_SECRET', nodeEnv === 'production' ? undefined : 'dev-insecure-secret-change-me'),
  // Session lifetime for the auth cookie.
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  cookieName: process.env.COOKIE_NAME ?? 'prospector_token',
  // In production behind HTTPS this should be true.
  cookieSecure: bool('COOKIE_SECURE', nodeEnv === 'production'),
  cookieSameSite: (process.env.COOKIE_SAMESITE as 'lax' | 'strict' | 'none' | undefined) ?? 'lax',

  // Comma-separated list of allowed origins for CORS (used when the SPA is
  // served from a different origin than the API). Empty => same-origin only.
  corsOrigins: (process.env.CORS_ORIGIN ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(s => s.length > 0),

  orgId: process.env.ORG_ID ?? 'org-1',

  // Password used when seeding the demo accounts. Mirrors the original app's
  // `demo1234` so existing logins keep working out of the box.
  seedDemoPassword: process.env.SEED_DEMO_PASSWORD ?? 'demo1234',

  bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS ?? '12', 10),
};
