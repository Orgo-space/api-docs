// Builds a SIGNED-OUT session that already knows which tenant it is looking at.
//
//   node capture/make-anon-state.mjs [tenant-slug]     default: t187c
//
// MapView calls loadAllCentersData() from the Google Maps init callback and reads
// this.tenant.slug. On a cold anonymous load the maps script wins the race against
// GET /tenants?slug=..., so the call throws "Cannot read properties of null
// (reading 'slug')" and no chapters are ever fetched: the finder renders the empty
// state over the hardcoded Romania fallback centre (MapView.vue:860,871).
//
// Visiting once warms the persisted Vuex tenant in localStorage. Saving that as a
// storage state gives later loads a non-null this.tenant at mount while keeping the
// session anonymous (no BEARER cookie), so the "Logged in as" chip stays away.
// Writes capture/state-anon-<slug>.json, used by specs with tenant "anon-<slug>".
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { FRONTEND } from '../config.mjs';

const SLUG = process.argv[2] || 't187c';
const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), `state-anon-${SLUG}.json`);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const page = await ctx.newPage();

await page.goto(`${FRONTEND}/local-center-map/?workspace=${SLUG}`, { waitUntil: 'domcontentloaded' });
await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(9000);

const state = await ctx.storageState();
const authCookies = state.cookies.filter((c) => /BEARER/i.test(c.name));
if (authCookies.length) {
  console.error('REFUSING: session carries auth cookies:', authCookies.map((c) => c.name).join(','));
  process.exit(1);
}
fs.writeFileSync(OUT, JSON.stringify(state, null, 1));
const hasTenant = JSON.stringify(state).includes(SLUG);
console.log(`wrote ${path.basename(OUT)}: cookies=${state.cookies.length}, tenant cached=${hasTenant}`);
await ctx.close();
await browser.close();
