// Companion to run.mjs for the two organisation shots whose subject spans
// sibling elements with no shared wrapper, so no CSS selector can crop them
// and run.mjs (selector or whole viewport, no clip) cannot express them.
//
//   node capture/nw-capture.mjs            both
//   node capture/nw-capture.mjs <id>       one
//
// The matching specs carry "status": "keep" so run.mjs leaves these files alone.
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { PIPELINE_ROOT, DOCS_DIR, FRONTEND } from '../config.mjs';

const DIR = path.join(PIPELINE_ROOT, 'capture');
const DOCS = DOCS_DIR;

const SHOTS = [
  {
    id: 'branding-logo-grid',
    image: '/images/platform/organisation/branding-logo-grid.png',
    route: '/tenants/branding',
    waitFor: 'text=Logo light theme',
    // Children 0-2 of section.o-mediumwidth: the two logo rows and the PNG hint.
    // Stops above the auth-background block, which is its own image lower down.
    clip: { x: 0, y: 0, width: 1920, height: 660 },
  },
  {
    id: 'org-info-save-button',
    image: '/images/platform/organisation/org-info-save-button.png',
    route: '/tenants/update',
    waitFor: 'text=Is international organisation',
    // The name/tags level (y 87-111) and the sticky Save panel (y 111-151) sit
    // in two different Bulma columns, x 560 and x 1419. The Basic details card
    // starts at y=135, so the bottom of Save unavoidably clips its top edge.
    clip: { x: 530, y: 70, width: 1010, height: 100 },
  },
];

const only = process.argv[2];
const browser = await chromium.launch();

for (const s of SHOTS) {
  if (only && s.id !== only) continue;
  const ctx = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 2,
    storageState: path.join(DIR, 'state-t187c.json'),
  });
  const page = await ctx.newPage();
  await page.goto(FRONTEND + s.route, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(4000);
  for (const label of ['Accept all cookies', 'Reject optional']) {
    const b = page.getByRole('button', { name: label });
    if (await b.count()) { try { await b.first().click({ timeout: 1500 }); } catch {} }
  }
  await page.addStyleTag({ content: '::-webkit-scrollbar{display:none!important}' }).catch(() => {});
  let matched = true;
  try {
    await page.locator(s.waitFor).first().waitFor({ timeout: 12000 });
  } catch {
    matched = false;
  }
  // Logo slots are background-image; give the CDN fetch time to paint.
  await page.waitForTimeout(3000);
  if (page.url().includes('/login')) throw new Error(`${s.id}: bounced to login`);

  const dest = path.join(DOCS, s.image.replace(/^\//, ''));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  await page.screenshot({ path: dest, clip: s.clip });
  const kb = Math.round(fs.statSync(dest).size / 1024);
  console.log(`${matched ? 'OK  ' : 'WARN'} ${s.id} -> ${s.image} (${kb}kb${matched ? '' : ', waitFor MISSED'})`);
  await ctx.close();
}

await browser.close();
