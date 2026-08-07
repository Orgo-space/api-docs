// One-off demo seeding for the profile Activity captures.
//
// Creates the activity through the product UI as the admin session, not by
// writing timeline rows: two notes on the member profile (one carrying the
// "Called" action, one plain), then a tag added and a tag removed on the
// Profile tab so the feed carries tag events too.
//
//   node capture/seed-activity.mjs
//
// Idempotency: re-running adds MORE notes. Check the feed before repeating.
import { chromium } from 'playwright';
import path from 'path';
import { PIPELINE_ROOT, FRONTEND } from '../config.mjs';

const USER_ID = process.env.SEED_USER_ID || '209251';
const NOTES = [
  {
    text: 'Renewal paperwork is complete. Membership committee has no outstanding questions, so nothing further is needed before the next review.',
    action: null,
  },
];
const TAG_TO_ADD = process.env.SEED_TAG_ADD || 'Leadership';
const TAG_TO_REMOVE = process.env.SEED_TAG_REMOVE || 'Sports';

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1920, height: 1290 },
  deviceScaleFactor: 1,
  storageState: path.join(PIPELINE_ROOT, 'capture', 'state-t187c.json'),
});
const page = await context.newPage();

async function settle(ms = 4000) {
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(ms);
}

// ---- notes -----------------------------------------------------------------
await page.goto(`${FRONTEND}/user/${USER_ID}?tab=activity`, { waitUntil: 'domcontentloaded' });
await settle(7000);
await page.addStyleTag({ content: '#webpack-dev-server-client-overlay,vite-error-overlay{display:none!important}' }).catch(() => {});

for (const note of NOTES) {
  await page.locator('textarea').first().fill(note.text);
  // The "no action" option is bound with :value="null", which has no usable
  // value attribute in the DOM, so select it positionally.
  await page.locator('select').first().selectOption(note.action ? { value: note.action } : { index: 0 });
  await page.locator('[data-test="add-note"]').click();
  await page.waitForTimeout(3500);
  console.log(`note added (${note.action || 'no action'})`);
}

// ---- tags ------------------------------------------------------------------
await page.goto(`${FRONTEND}/user/${USER_ID}`, { waitUntil: 'domcontentloaded' });
await settle(7000);

// Remove one existing tag: the chip's little x.
const chip = page.locator('.user-tag-chip', { hasText: TAG_TO_REMOVE }).first();
if (await chip.count()) {
  await chip.locator('.user-tag-remove').click();
  await page.waitForTimeout(2500);
  console.log(`tag removed: ${TAG_TO_REMOVE}`);
} else {
  console.log(`tag NOT FOUND to remove: ${TAG_TO_REMOVE}`);
}

// Add one: "Add tags" opens the taginput, type, pick the suggestion, Save.
await page.getByText('Add tags', { exact: false }).first().click();
await page.waitForTimeout(1200);
const input = page.locator('.taginput input[type="text"]').first();
await input.click();
await input.type(TAG_TO_ADD, { delay: 90 });
await page.waitForTimeout(2500);
const option = page.locator('.dropdown-item, .autocomplete .dropdown-content a').filter({ hasText: TAG_TO_ADD }).first();
if (await option.count()) {
  await option.click();
} else {
  await input.press('Enter');
}
await page.waitForTimeout(1200);
await page.getByRole('button', { name: 'Save' }).first().click();
await page.waitForTimeout(3000);
console.log(`tag added: ${TAG_TO_ADD}`);

await page.screenshot({ path: path.join(PIPELINE_ROOT, 'capture', 'probe-seed-tags.png') });
await browser.close();
