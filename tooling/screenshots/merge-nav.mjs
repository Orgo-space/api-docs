// Merge every platform page on disk into docs.json navigation.
// Existing entries keep their position; new pages are inserted after a named anchor
// inside their group, or appended to it. Groups are created only when needed.
//
//   node tooling/screenshots/merge-nav.mjs
//
// This rewrites docs.json. The PLACEMENT table below is the record of where the pages
// added during the 2026-08 accuracy pass belong; extend it when you add a page.
import fs from 'fs';
import path from 'path';
import { DOCS_DIR } from './config.mjs';

const DOCS = DOCS_DIR;
const docsJsonPath = path.join(DOCS, 'docs.json');
const docs = JSON.parse(fs.readFileSync(docsJsonPath, 'utf8'));

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : /\.mdx?$/.test(p) ? [p] : [];
  });
}
const onDisk = walk(path.join(DOCS, 'platform')).map((f) => path.relative(DOCS, f).replace(/\.mdx?$/, ''));

const tab = docs.navigation.tabs.find((t) => t.tab === 'Documentation');
const groups = tab.groups;
const inNav = new Set(groups.flatMap((g) => g.pages));

// page -> [group name, anchor page to insert after (or null = append)]
const PLACEMENT = [
  ['platform/usage-billing', 'Organization', 'platform/organisation/modules'],
  ['platform/logs', 'Organization', null],
  ['platform/insights', 'Organization', null],

  ['platform/users/companies', 'Users & Profiles', 'platform/users/family-members'],
  ['platform/professional-network', 'Users & Profiles', 'platform/users/privacy-settings'],

  ['platform/groups/units', 'Groups', 'platform/groups/local-groups'],
  ['platform/groups/transfers', 'Groups', 'platform/groups/units'],

  ['platform/discussion/moderation', 'Communication', 'platform/discussion/discussion-namespaces'],
  ['platform/newsletter-builder', 'Communication', 'platform/newsletter'],
  ['platform/newsletter-widgets', 'Communication', 'platform/newsletter-builder'],

  ['platform/emails/index', 'Emails', null],
  ['platform/emails/system-emails', 'Emails', null],
  ['platform/emails/email-templates', 'Emails', null],
  ['platform/emails/email-log', 'Emails', null],
  ['platform/emails/email-lists', 'Emails', null],

  ['platform/events/event-templates', 'Events', 'platform/events/event-types'],
  ['platform/events/sharing', 'Events', 'platform/events/public-page'],
  ['platform/events/speakers-trainers', 'Events', 'platform/events/attendance'],
  ['platform/events/analytics', 'Events', 'platform/events/check-in'],
  ['platform/events/event-report', 'Events', 'platform/events/analytics'],
  ['platform/events/annual-report', 'Events', 'platform/events/event-report'],
  ['platform/events/event-app', 'Events', 'platform/events/annual-report'],
  ['platform/events/event-app-feed', 'Events', 'platform/events/event-app'],
  ['platform/events/event-app-networking', 'Events', 'platform/events/event-app-feed'],

  ['platform/fees/invoices', 'Payments & Fees', 'platform/fees/record-payment'],
  ['platform/local-group-fees/member-fees', 'Payments & Fees', 'platform/local-group-fees/create-local-fees'],
  ['platform/local-group-fees/local-settings', 'Payments & Fees', 'platform/local-group-fees/member-fees'],

  ['platform/official-gazette', 'Governance', 'platform/organisational-chart'],
  ['platform/voting/elections', 'Governance', 'platform/e-voting'],

  ['platform/e-documents', 'Resources', 'platform/contracts'],
  ['platform/gamification', 'Resources', 'platform/badges'],

  ['platform/projects', 'Projects & Work', null],
  ['platform/tasks', 'Projects & Work', null],
  ['platform/forms', 'Projects & Work', null],
  ['platform/workflows', 'Projects & Work', null],

  ['platform/professional-network', 'Users & Profiles', 'platform/users/privacy-settings'],

  ['platform/webhooks', 'Developers', 'platform/api'],
];

const GROUP_AFTER = { Emails: 'Communication', 'Projects & Work': 'Events' };

let added = 0;
for (const [page, groupName, anchor] of PLACEMENT) {
  if (!onDisk.includes(page) || inNav.has(page)) continue;
  let group = groups.find((g) => g.group === groupName);
  if (!group) {
    group = { group: groupName, pages: [] };
    const afterIdx = groups.findIndex((g) => g.group === GROUP_AFTER[groupName]);
    groups.splice(afterIdx >= 0 ? afterIdx + 1 : groups.length, 0, group);
  }
  const at = anchor ? group.pages.indexOf(anchor) : -1;
  if (at >= 0) group.pages.splice(at + 1, 0, page);
  else group.pages.push(page);
  inNav.add(page);
  added++;
}

const orphans = onDisk.filter((p) => !inNav.has(p));
fs.writeFileSync(docsJsonPath, JSON.stringify(docs, null, 2) + '\n');
console.log(`added ${added} pages to navigation`);
console.log(orphans.length ? `STILL UNPLACED (${orphans.length}):\n  ${orphans.join('\n  ')}` : 'every page on disk is in the navigation');
