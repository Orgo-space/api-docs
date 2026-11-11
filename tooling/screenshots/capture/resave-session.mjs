// Re-save a session's storage state after its account's flags changed in the database.
// The app persists the tenant and the member's own settings into localStorage, so a saved
// session keeps replaying the state it was captured with: the first-login wizard, a feature
// flag that was off, a stale tenant. Opening the app once lets it refetch, and saving the
// state again bakes the current values in.
//
//   node capture/resave-session.mjs <state-slug> [path]
import { chromium } from 'playwright';
import path from 'path';
import { PIPELINE_ROOT, FRONTEND } from '../config.mjs';

const slug = process.argv[2];
if (!slug) { console.error('usage: node capture/resave-session.mjs <state-slug> [path]'); process.exit(1); }
const route = process.argv[3] || '/';
const file = path.join(PIPELINE_ROOT, 'capture', `state-${slug}.json`);

const browser = await chromium.launch();
const ctx = await browser.newContext({ storageState: file, viewport: { width: 1920, height: 1080 } });
const page = await ctx.newPage();
await page.goto(FRONTEND + route, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(10000);
// A first-login wizard blocks every other route until it is finished.
const finish = page.locator('button:has-text("Finish")');
if (await finish.count()) {
  console.log('onboarding wizard present, finishing it');
  await finish.first().click().catch(() => {});
  await page.waitForTimeout(6000);
}
await ctx.storageState({ path: file });
console.log(`re-saved state-${slug}.json, landed on ${page.url()}`);
await browser.close();
