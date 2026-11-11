// One-off demo seeding for the Reports captures.
//
// Builds the demo organisation's saved reports THROUGH THE BUILDER UI as the
// admin session (never by inserting report_definition rows): pick the entity,
// tick the columns, add the filters, Save. The point is to photograph real
// product state, so the definitions must have travelled the same
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
//
// REWRITTEN 2026-11-11 for the redesigned two-pane builder. What changed:
//   - the entity is a dropdown (.report-entity-trigger + .report-entity-option),
//     not a row of chips, so .report-entity-chip no longer exists;
//   - the root entity's own fields live in the FIRST .report-field-group, which
//     has no label element; relations are the labelled groups after it;
//   - relation labels are now short nouns ("User", "Product") rather than the
//     sentences the schema used to return ("Member who made the payment");
//   - field labels are Title Case ("First Name", not "First name");
//   - Columns and Filters are rail sections on one pane, so there are no tabs
//     to click between them;
//   - Save is .report-builder-save.
import { chromium } from 'playwright';
import path from 'path';
import { PIPELINE_ROOT, FRONTEND } from '../config.mjs';

// Field labels are the builder's own, exactly as it prints them. Each entry may
// be a string or a list of candidates, because a few labels differ per relation.
const REPORTS = {
  members: {
    name: 'Member export by chapter',
    entity: 'Members',
    root: ['First Name', 'Last Name', 'Email', 'Status', 'Date Joined'],
    groups: [['Local Center', [['Display Name', 'Name']]]],
    filters: [],
  },
  payments: {
    name: 'Payments export by date',
    entity: 'Payments',
    root: ['Date Created', 'Amount', 'Currency', 'Status'],
    groups: [
      ['User', ['First Name', 'Last Name', 'Email']],
      ['Product', [['Name', 'Product Name']]],
    ],
    filters: [
      { field: 'dateCreated', operator: '>', value: '2026-01-01' },
      { field: 'dateCreated', operator: '<', value: '2026-07-01' },
    ],
  },
  attendees: {
    name: 'Event attendee contact list',
    entity: 'Event Attendees',
    root: ['Status Rsvp', 'Status Registration'],
    groups: [
      ['Event', [['Name', 'Event Name'], ['Date Time Begin', 'Date Start']]],
      ['User', ['First Name', 'Last Name', 'Email']],
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

// The root entity's fields are the first group and carry no label; the labelled
// groups after it are the relations. Matching is EXACT: Playwright's hasText is
// a case-insensitive substring, and "Email" is a prefix of "Company Email".
async function groupByLabel(label) {
  const groups = page.locator('.report-field-group');
  const count = await groups.count();
  for (let i = 0; i < count; i++) {
    const group = groups.nth(i);
    const labelNode = group.locator('.report-field-group-label');
    if (!(await labelNode.count())) continue;
    if ((await labelNode.first().innerText()).trim() === label) return group;
  }
  console.log(`  !! group not found: ${label}`);
  return null;
}

async function tick(group, candidates) {
  const wanted = Array.isArray(candidates) ? candidates : [candidates];
  const options = group.locator('.report-field-option');
  const count = await options.count();
  for (const label of wanted) {
    for (let i = 0; i < count; i++) {
      const option = options.nth(i);
      if ((await option.innerText()).trim() === label) {
        await option.click();
        await page.waitForTimeout(250);
        return true;
      }
    }
  }
  console.log(`  !! field not found: ${wanted.join(' / ')}`);
  return false;
}

async function build(report) {
  await page.goto(`${FRONTEND}/reports/create`, { waitUntil: 'domcontentloaded' });
  await settle(4000);
  await page.addStyleTag({ content: '#webpack-dev-server-client-overlay,vite-error-overlay{display:none!important}' }).catch(() => {});
  await page.locator('.report-entity-trigger').first().waitFor({ timeout: 20000 });

  await page.locator('.report-rail input.input').first().fill(report.name);

  // Members is the default; opening the dropdown and picking it again is harmless.
  await page.locator('.report-entity-trigger').first().click();
  await page.waitForTimeout(600);
  await page.locator('.report-entity-option', { hasText: report.entity }).first().click();
  await page.waitForTimeout(1800);

  const rootGroup = page.locator('.report-field-group').first();
  for (const field of report.root) await tick(rootGroup, field);

  for (const [groupLabel, fields] of report.groups) {
    const group = await groupByLabel(groupLabel);
    if (!group) continue;
    await group.locator('.report-field-group-head').click();
    await page.waitForTimeout(700);
    for (const field of fields) await tick(group, field);
  }

  for (let i = 0; i < report.filters.length; i++) {
    const filter = report.filters[i];
    await page.locator('.rf-add').first().click();
    await page.waitForTimeout(700);
    const row = page.locator('.rf-row').nth(i);
    // Property first: changing it resets operator and value (onConditionFieldChange).
    // A fresh row has ONE select (Property). The operator select is rendered only
    // after a property is chosen, so it must be re-counted rather than addressed
    // as nth(1) up front, and the value control appears after the operator.
    let propertyOk = true;
    await row.locator('select').first().selectOption(filter.field)
      .catch(() => { propertyOk = false; console.log(`  !! filter property not selectable on ${report.entity}: ${filter.field}`); });
    if (!propertyOk) continue;
    await page.waitForTimeout(700);
    if ((await row.locator('select').count()) > 1) {
      await row.locator('select').nth(1).selectOption(filter.operator)
        .catch(() => console.log(`  !! filter operator not selectable: ${filter.operator}`));
    }
    await page.waitForTimeout(600);
    // The value control differs by field type, so try the shapes in order and
    // leave the filter without a value rather than failing the whole seed.
    let filled = false;
    for (const sel of ['input[type="date"]', '.rf-value input', '.rf-input', 'input']) {
      const control = row.locator(sel);
      if (await control.count()) {
        await control.first().fill(filter.value).then(() => { filled = true; }).catch(() => {});
        if (filled) break;
      }
    }
    if (!filled) console.log(`  !! filter value not fillable: ${filter.field} ${filter.operator} ${filter.value}`);
    await page.waitForTimeout(400);
  }

  await page.locator('.report-builder-save').first().click();
  await page.waitForURL(/\/reports\/(edit|show)\//, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const uuid = page.url().split(/\/reports\/(?:edit|show)\//)[1] || 'NOT SAVED';
  console.log(`saved: ${report.name} -> ${uuid}`);
  return uuid;
}

for (const [key, report] of Object.entries(wanted)) {
  console.log(`building ${key}...`);
  await build(report);
}

await browser.close();
