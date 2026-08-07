// One-off demo seeding for the Reports captures.
//
// Builds the demo organisation's saved reports THROUGH THE BUILDER UI as the
// admin session (never by inserting report_definition rows): pick the entity,
// expand a field group, tick the columns, add the filters, Save. The point is to
// photograph real product state, so the definitions must have travelled the same
// POST /report_definitions path a customer's would.
//
//   node capture/seed-reports.mjs            build all three
//   node capture/seed-reports.mjs payments   build one, by key
//
// Prints the uuid of every report it saves. Two specs (reports-filters,
// reports-export-*) address a report by uuid, so paste the new uuids into
// specs/reports.json after a re-seed.
//
// Idempotency: re-running creates DUPLICATES (the builder has no upsert).
// Clean up first: DELETE FROM report_definition WHERE tenant_id = 282;
import { chromium } from 'playwright';
import path from 'path';
import { PIPELINE_ROOT, FRONTEND } from '../config.mjs';

// Field and group labels below are the schema's own descriptions, exactly as
// GET /report_schema returns them and the builder prints them. They are long on
// purpose (the relation groups are described, not named), so they are written
// out in full rather than guessed at.
const REPORTS = {
  members: {
    name: 'Member export by chapter',
    entity: 'Members',
    groups: [
      ['Members', ['First name', 'Last name', 'Email', 'Status', 'Date user joined the organization']],
      ['Local center this user belongs to', ['Display name (used for LocalCenter, Group, etc.)']],
    ],
    filters: [],
  },
  payments: {
    name: 'Payments export by date',
    entity: 'Payments',
    groups: [
      ['Payments', ['Date created', 'Payment amount', 'Currency', 'Status']],
      ['Member who made the payment', ['First name', 'Last name', 'Email']],
      ['Product that was purchased', ['Product name']],
    ],
    // Two conditions on the same date field: the report is "this half year's
    // payments", and it is also what the AND label between rows is captured on.
    filters: [
      { field: 'dateCreated', operator: '>', value: '2026-01-01' },
      { field: 'dateCreated', operator: '<', value: '2026-07-01' },
    ],
  },
  attendees: {
    name: 'Event attendee contact list',
    entity: 'Event Attendees',
    groups: [
      ['Event Attendees', ['RSVP response', 'Registration workflow status']],
      ['The event this attendance belongs to', ['Event name', 'Event start date/time']],
      ['Member who registered', ['First name', 'Last name', 'Email']],
    ],
    filters: [],
  },
};

const only = process.argv[2];
const wanted = only ? { [only]: REPORTS[only] } : REPORTS;
if (only && !REPORTS[only]) {
  console.error(`unknown report key: ${only} (have: ${Object.keys(REPORTS).join(', ')})`);
  process.exit(1);
}

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1920, height: 1290 },
  deviceScaleFactor: 1,
  storageState: path.join(PIPELINE_ROOT, 'capture', 'state-t187c.json'),
});
const page = await context.newPage();

async function settle(ms = 3000) {
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(ms);
}

// The group whose head carries this label. Groups are addressed by label rather
// than by index because the relation list differs per entity.
//
// The match must be EXACT. Playwright's hasText is a case-insensitive substring,
// and on Payments the Contact relation is described "Non-member who made the
// payment" while the User relation is "Member who made the payment" - so a
// substring match silently selected the Contact group and none of the payer's
// fields were ticked (the first seeding run shipped exactly that report).
async function groupByLabel(label) {
  const labels = page.locator('.report-field-group-label');
  const count = await labels.count();
  for (let i = 0; i < count; i++) {
    if ((await labels.nth(i).innerText()).trim() === label) {
      return page.locator('.report-field-group').nth(i);
    }
  }
  console.log(`  !! group not found: ${label}`);
  return null;
}

// Tick one checkbox by its exact label. Substring matching is not safe here:
// "Email" is a prefix of "Company contact email", and several relations repeat
// the same field labels.
async function tick(group, label) {
  const options = group.locator('.report-field-option');
  const count = await options.count();
  for (let i = 0; i < count; i++) {
    const option = options.nth(i);
    const text = (await option.innerText()).trim();
    if (text === label) {
      await option.click();
      await page.waitForTimeout(250);
      return true;
    }
  }
  console.log(`  !! field not found: ${label}`);
  return false;
}

async function build(report) {
  await page.goto(`${FRONTEND}/reports/create`, { waitUntil: 'domcontentloaded' });
  await settle(4000);
  await page.addStyleTag({ content: '#webpack-dev-server-client-overlay,vite-error-overlay{display:none!important}' }).catch(() => {});
  await page.locator('.report-entity-chip').first().waitFor({ timeout: 20000 });

  await page.locator('.report-builder-config input.input').first().fill(report.name);

  // Members is the default chip; clicking the already-selected one is a no-op.
  await page.locator('.report-entity-chip', { hasText: report.entity }).first().click();
  await page.waitForTimeout(1200);

  for (const [groupLabel, fields] of report.groups) {
    const group = await groupByLabel(groupLabel);
    if (!group) continue;
    await group.locator('.report-field-group-head').click();
    await page.waitForTimeout(700);
    for (const field of fields) {
      await tick(group, field);
    }
  }

  if (report.filters.length) {
    await page.locator('nav.tabs a', { hasText: 'Filters' }).first().click();
    await page.waitForTimeout(900);
    for (let i = 0; i < report.filters.length; i++) {
      const filter = report.filters[i];
      await page.locator('.rf-add').click();
      await page.waitForTimeout(700);
      const row = page.locator('.rf-row').nth(i);
      // Property first: changing it resets operator and value (onConditionFieldChange).
      await row.locator('select').nth(0).selectOption(filter.field);
      await page.waitForTimeout(400);
      await row.locator('select').nth(1).selectOption(filter.operator);
      await page.waitForTimeout(400);
      const dateInput = row.locator('input[type="date"]');
      if (await dateInput.count()) {
        await dateInput.fill(filter.value);
      } else {
        await row.locator('.rf-input').fill(filter.value);
      }
      await page.waitForTimeout(400);
    }
  }

  await page.locator('.report-builder-config button.is-primary').first().click();
  // Create.vue routes to the new report's edit page, so the uuid is in the URL.
  await page.waitForURL(/\/reports\/edit\//, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const uuid = page.url().split('/reports/edit/')[1] || 'NOT SAVED';
  console.log(`saved: ${report.name} -> ${uuid}`);
  return uuid;
}

for (const [key, report] of Object.entries(wanted)) {
  console.log(`building ${key}...`);
  await build(report);
}

await page.goto(`${FRONTEND}/reports`, { waitUntil: 'domcontentloaded' });
await settle(3000);
await page.screenshot({ path: path.join(PIPELINE_ROOT, 'capture', 'probe-seed-reports.png') });
await browser.close();
