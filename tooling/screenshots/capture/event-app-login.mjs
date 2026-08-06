// Sign in to the Event App as a real attendee and save the session.
// The Event App uses a one-time code sent by email. Locally there is no mailbox, so we
// let the app create the OTP row, overwrite its hash with a known code, and type that code
// into the real UI. Nothing about the login flow itself is bypassed.
//
//   node capture/event-app-login.mjs
//   ORGO_EVENT_APP_EMAIL=<contact@example.org> ORGO_EVENT_APP_STATE=state-eventappcontact.json \
//     node capture/event-app-login.mjs
//
// This script writes one row of the documentation database (the OTP it primes), so it is
// gated on the docs_instance_marker table: it refuses to run anywhere else.
import { chromium } from 'playwright';
import { execFileSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  FRONTEND,
  EVENT_APP_EMAIL,
  PHP_CONTAINER,
  DB_CONTAINER,
  DB_NAME,
  DB_USER,
  DB_PASSWORD,
} from '../config.mjs';

const OUT = path.dirname(new URL(import.meta.url).pathname);
// ORGO_EVENT_APP_EMAIL/ORGO_EVENT_APP_STATE let the same real OTP flow produce a second
// session file: the member (User) session used by the per-event tabs, and the
// Contact session that /event-app/my-events requires (that endpoint rejects a
// User principal outright, see EventAppMyEventsController).
const EMAIL = process.env.EVENT_APP_EMAIL || EVENT_APP_EMAIL;
const STATE_FILE = process.env.ORGO_EVENT_APP_STATE || process.env.EVENT_APP_STATE || 'state-eventapp.json';
const CODE = process.env.ORGO_EVENT_APP_CODE || '123456';

const sql = (q) =>
  execFileSync('docker', ['exec', DB_CONTAINER, 'mysql', `-u${DB_USER}`, `-p${DB_PASSWORD}`, DB_NAME, '-N', '-B', '-e', q], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();

// Refuse to touch anything but the documentation instance.
let marker = '';
try { marker = sql('SELECT note FROM docs_instance_marker LIMIT 1'); } catch { /* table missing */ }
if (!marker) {
  console.error(
    `\nABORT: ${DB_CONTAINER} has no docs_instance_marker row.\n` +
    'This is not the orgo-1 documentation database, and this script writes to it.\n'
  );
  process.exit(1);
}

// The salt that hashes one-time codes (MFA_CODE_HASH_SALT in the API .env). It is a secret,
// so it is read from the running container rather than written down here.
const SALT = process.env.ORGO_MFA_SALT || readSaltFromContainer();
function readSaltFromContainer() {
  const value = execFileSync(
    'docker',
    ['exec', PHP_CONTAINER, 'sh', '-lc', 'grep -h "^MFA_CODE_HASH_SALT=" .env.local .env 2>/dev/null | tail -1 | cut -d= -f2-'],
    { encoding: 'utf8' }
  ).trim().replace(/^["']|["']$/g, '');
  if (!value) {
    console.error(`\nABORT: could not read MFA_CODE_HASH_SALT from ${PHP_CONTAINER}. Set ORGO_MFA_SALT instead.\n`);
    process.exit(1);
  }
  return value;
}

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
});
const page = await context.newPage();

await page.goto(`${FRONTEND}/login`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
for (const label of ['Accept all cookies', 'Reject optional']) {
  const b = page.getByRole('button', { name: label });
  if (await b.count()) { try { await b.first().click({ timeout: 1500 }); } catch {} }
}

await page.locator('input[type="email"], input[name="email"]').first().fill(EMAIL);
await page.waitForTimeout(2000);
await page.getByRole('button', { name: /continue/i }).first().click();
// A Contact-only email needs two round-trips before the OTP row exists:
// /auth-tenant returns no User, then Login.vue falls through to
// /event-app/login-otp. 4s was enough for the User branch but not this one.
await page.waitForTimeout(10000);

// The app has now created an OTP row. Give it the code we are about to type.
// hash_hmac('sha256', code, salt) in PHP is HMAC-SHA256 keyed by the salt.
const hash = crypto.createHmac('sha256', SALT).update(CODE).digest('hex');
const id = sql(`SELECT id FROM login_otp WHERE email='${EMAIL}' ORDER BY id DESC LIMIT 1`);
sql(`UPDATE login_otp SET code_hash='${hash}', attempts=0, is_used=0 WHERE id=${id}`);
console.log(`otp row ${id} primed`);

// Type the code. The UI may use one input or six single-character boxes.
const boxes = page.locator('input[maxlength="1"]');
if (await boxes.count()) {
  for (let i = 0; i < CODE.length; i++) await boxes.nth(i).fill(CODE[i]);
} else {
  const single = page.locator('input[type="text"], input[type="tel"], input[inputmode="numeric"]').last();
  await single.fill(CODE);
  await single.press('Enter');
}
await page.waitForTimeout(6000);

const url = page.url();
if (!url.includes('/login')) {
  fs.writeFileSync(path.join(OUT, STATE_FILE), JSON.stringify(await context.storageState(), null, 2));
}
await page.screenshot({ path: path.join(OUT, 'probe-eventapp.png') });
console.log(`${url.includes('/login') ? 'FAIL' : 'OK  '} event app session: ${url}`);
await browser.close();
