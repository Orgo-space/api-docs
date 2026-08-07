// Tag half of the Activity seeding (see seed-activity.mjs for the notes half).
// Removes one tag and adds another on the member's Profile tab, through the UI,
// so ProfileActivityAuditSubscriber writes the tag Log rows the timeline reads.
//
//   node capture/seed-tags.mjs
//
// The remove "x" on a tag chip is display:none until the chip is hovered
// (UserTags.vue .user-tag-chip:hover .user-tag-remove), so hover before click.
import { chromium } from 'playwright';
import path from 'path';
import { PIPELINE_ROOT, FRONTEND } from '../config.mjs';

const USER_ID = process.env.SEED_USER_ID || '209251';
const TAG_TO_ADD = process.env.SEED_TAG_ADD || 'Leadership';
const TAG_TO_REMOVE = process.env.SEED_TAG_REMOVE || 'Sports';

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1920, height: 1290 },
  deviceScaleFactor: 1,
  storageState: path.join(PIPELINE_ROOT, 'capture', 'state-t187c.json'),
});
const page = await context.newPage();
await page.goto(`${FRONTEND}/user/${USER_ID}`, { waitUntil: 'domcontentloaded' });
await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(8000);
await page.addStyleTag({ content: '#webpack-dev-server-client-overlay,vite-error-overlay{display:none!important}' }).catch(() => {});

console.log('chips:', (await page.locator('.user-tag-chip').allInnerTexts()).join(' | '));

if (TAG_TO_REMOVE) {
  const chip = page.locator('.user-tag-chip', { hasText: TAG_TO_REMOVE }).first();
  if (await chip.count()) {
    await chip.scrollIntoViewIfNeeded();
    await chip.hover();
    await page.waitForTimeout(600);
    await chip.locator('.user-tag-remove').click();
    await page.waitForTimeout(3000);
    console.log(`tag removed: ${TAG_TO_REMOVE}`);
  } else {
    console.log(`tag NOT FOUND to remove: ${TAG_TO_REMOVE}`);
  }
}

if (TAG_TO_ADD) {
  await page.getByText('Add tags', { exact: false }).first().click();
  await page.waitForTimeout(1500);
  const input = page.locator('.taginput input[type="text"]').first();
  await input.click();
  await input.pressSequentially(TAG_TO_ADD, { delay: 90 });
  await page.waitForTimeout(3000);
  const option = page.locator('.dropdown-item').filter({ hasText: TAG_TO_ADD }).first();
  if (await option.count()) {
    await option.click();
  } else {
    await input.press('Enter');
  }
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Save' }).first().click();
  await page.waitForTimeout(4000);
  console.log(`tag add attempted: ${TAG_TO_ADD}`);
}

console.log('chips after:', (await page.locator('.user-tag-chip').allInnerTexts()).join(' | '));
await page.screenshot({ path: path.join(PIPELINE_ROOT, 'capture', 'probe-seed-tags.png') });
await browser.close();
