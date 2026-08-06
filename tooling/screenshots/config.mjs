// Shared configuration for the screenshot pipeline.
//
// Everything the scripts need to know about the machine they run on comes from here,
// so no host path, container name or credential is written into a script.
// Values resolve in this order:
//
//   1. an environment variable
//   2. tooling/screenshots/.env  (git-ignored, KEY=VALUE per line)
//   3. the documented default
//
// The one value with no default is the demo login password: a credential does not
// belong in this repository, even a throwaway local one.
import fs from 'fs';
import path from 'path';

export const PIPELINE_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname));

// Local overrides, if the reader prefers a file to exported variables.
const envFile = path.join(PIPELINE_ROOT, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const value = m[2].replace(/^["']|["']$/g, '');
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}

const num = (v, fallback) => (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : fallback);

// The docs repo itself. Default: two levels up from this file, which is the checkout
// this pipeline ships inside, so the scripts work with no configuration at all.
export const DOCS_DIR = process.env.ORGO_DOCS_DIR || path.resolve(PIPELINE_ROOT, '..', '..');

// The orgo-1 documentation instance. 8095 is the owner's main development environment
// and must never be captured from.
export const FRONTEND = process.env.ORGO_FRONTEND || 'http://localhost:8105';

// 3 races the dev server and yields skeleton-only captures. See the README traps section.
export const CONCURRENCY = num(process.env.ORGO_CAPTURE_CONCURRENCY, 2);

export const PHP_CONTAINER = process.env.ORGO_PHP_CONTAINER || 'orgo-1-php';
export const DB_CONTAINER = process.env.ORGO_DB_CONTAINER || 'orgo-1-database';
export const DB_NAME = process.env.ORGO_DB_NAME || 'orgo';
export const DB_USER = process.env.ORGO_DB_USER || 'orgo';
export const DB_PASSWORD = process.env.ORGO_DB_PASSWORD || 'orgopass';

// Demo accounts used to open a session per tenant, as "slug=email,slug=email".
// These are obfuscated fictional members on the local documentation database.
const DEFAULT_ACCOUNTS = [
  'ila=jonas.whitfield.38226@example.org',
  't187c=julian.sorensen.207128@example.org',
  'oceanic-global=sofia.okafor.44197@example.org',
  'romanian-business-leaders=adrian.keller.45502@example.org',
  'oncr=isla.rivera.107@example.org',
  'preper=maya.novak.28725@example.org',
].join(',');

export const DOCS_ACCOUNTS = (process.env.ORGO_DOCS_ACCOUNTS || DEFAULT_ACCOUNTS)
  .split(',')
  .map((pair) => pair.trim())
  .filter(Boolean)
  .map((pair) => {
    const i = pair.indexOf('=');
    return { slug: pair.slice(0, i).trim(), email: pair.slice(i + 1).trim() };
  });

// The Event App attendee whose one-time-code session the event specs use.
export const EVENT_APP_EMAIL = process.env.ORGO_EVENT_APP_EMAIL || 'adrian.whitfield.209246@example.org';

export function requireEnv(name, hint) {
  const value = process.env[name];
  if (value) return value;
  console.error(`\n${name} is not set.\n${hint}\n`);
  process.exit(1);
}

// The password on the local demo accounts. Deliberately has no default: set it in the
// environment or in tooling/screenshots/.env before running a login script.
export function docsPassword() {
  return requireEnv(
    'ORGO_DOCS_PASSWORD',
    'It is the password set on the demo accounts when the documentation database was\n' +
      'seeded (see the audit archive README). Set it for one run:\n' +
      '  ORGO_DOCS_PASSWORD=... node capture/login.mjs\n' +
      'or put it in tooling/screenshots/.env, which is git-ignored.'
  );
}
