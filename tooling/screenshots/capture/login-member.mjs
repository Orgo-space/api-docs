// Open a session for one specific account and save it under a chosen state slug.
// Used for the specs that must be shot as an ordinary member rather than an admin
// (tenant "t187c-member"), where the point of the screenshot is what a member sees.
//
//   ORGO_DOCS_PASSWORD=... node capture/login-member.mjs <email> <state-slug>
//   ORGO_DOCS_PASSWORD=... node capture/login-member.mjs member@example.org t187c-member
//
// Writes capture/state-<state-slug>.json, which run.mjs then picks up for any spec
// whose "tenant" is that slug.
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { FRONTEND, docsPassword } from '../config.mjs';

const email = process.argv[2];
const slug = process.argv[3];
if (!email || !slug) {
  console.error('usage: node capture/login-member.mjs <email> <state-slug>');
  process.exit(1);
}
const PASSWORD = docsPassword();
const OUT = path.dirname(new URL(import.meta.url).pathname);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
const page = await context.newPage();
await page.goto(`${FRONTEND}/login`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
for (const label of ['Accept all cookies', 'Reject optional']) {
  const btn = page.getByRole('button', { name: label });
  if (await btn.count()) { try { await btn.first().click({ timeout: 2000 }); break; } catch {} }
}
const usePassword = page.getByText('Use password instead', { exact: false });
if (await usePassword.count()) await usePassword.first().click();
await page.waitForTimeout(500);
await page.locator('input[type="email"], input[name="email"]').first().fill(email);
await page.waitForTimeout(2500);
const pw = page.locator('input[type="password"]').first();
await pw.waitFor({ state: 'visible', timeout: 15000 });
await pw.fill(PASSWORD);
await pw.press('Enter');
await page.waitForURL(/\/(dashboard|getting-started|me)/, { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(5000);
const ok = !page.url().includes('/login');
if (ok) fs.writeFileSync(path.join(OUT, `state-${slug}.json`), JSON.stringify(await context.storageState(), null, 2));
await page.screenshot({ path: path.join(OUT, `probe-${slug}.png`) });
console.log(`${ok ? 'OK' : 'FAIL'} ${slug}: ${page.url()}`);
await browser.close();
