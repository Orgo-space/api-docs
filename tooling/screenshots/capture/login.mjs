// Log into the local Orgo frontend once per tenant through the real UI and save the
// browser storage state, so screenshot runs start already authenticated.
//
//   ORGO_DOCS_PASSWORD=... node capture/login.mjs           every demo account
//   ORGO_DOCS_PASSWORD=... node capture/login.mjs t187c     one tenant slug
//
// Writes capture/state-<slug>.json. Those files hold live session cookies and are
// git-ignored: never commit them.
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { FRONTEND, DOCS_ACCOUNTS, docsPassword } from '../config.mjs';

const PASSWORD = docsPassword();
const OUT = path.dirname(new URL(import.meta.url).pathname);

export const TENANTS = DOCS_ACCOUNTS;

export async function dismissCookieBanner(page) {
  for (const label of ['Accept all cookies', 'Reject optional']) {
    const btn = page.getByRole('button', { name: label });
    if (await btn.count()) {
      try { await btn.first().click({ timeout: 2000 }); return; } catch { /* ignore */ }
    }
  }
}

async function loginTenant(t) {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  await page.goto(`${FRONTEND}/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await dismissCookieBanner(page);

  // Switch from the default OTP flow to password auth.
  const usePassword = page.getByText('Use password instead', { exact: false });
  if (await usePassword.count()) await usePassword.first().click();
  await page.waitForTimeout(500);

  await page.locator('input[type="email"], input[name="email"]').first().fill(t.email);
  await page.waitForTimeout(2500); // /auth-tenant round trip resolves the workspace

  const pw = page.locator('input[type="password"]').first();
  await pw.waitFor({ state: 'visible', timeout: 15000 });
  await pw.fill(PASSWORD);
  await pw.press('Enter');

  await page.waitForURL(/\/(dashboard|getting-started|me)/, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(5000);

  const ok = !page.url().includes('/login');
  if (ok) {
    const state = await context.storageState();
    fs.writeFileSync(path.join(OUT, `state-${t.slug}.json`), JSON.stringify(state, null, 2));
  }
  await page.screenshot({ path: path.join(OUT, `probe-${t.slug}.png`) });
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${t.slug}: ${page.url()}`);
  await browser.close();
  return ok;
}

const only = process.argv[2];
for (const t of TENANTS) {
  if (only && only !== t.slug) continue;
  try { await loginTenant(t); } catch (e) { console.log(`ERROR ${t.slug}: ${e.message.split('\n')[0]}`); }
}
