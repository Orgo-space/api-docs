// Why did an action not run? Replays a spec's actions in order against the real
// app and stops at the first one that does not resolve, printing the selector,
// how many nodes it matched, the page URL and the visible button/tab/menu labels
// on screen. It takes no screenshot and changes nothing.
//
//   ORGO_ONLY_LIST=<file> node capture/diagnose.mjs
//   node capture/diagnose.mjs <area> <id>
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { PIPELINE_ROOT, FRONTEND } from '../config.mjs';

const SPECS = path.join(PIPELINE_ROOT, 'specs');
const onlyFile = process.argv[2];
const onlyId = process.argv[3];
const LIST = process.env.ORGO_ONLY_LIST
  ? new Set(fs.readFileSync(process.env.ORGO_ONLY_LIST, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean))
  : null;
const SLUG_ALIAS = { 'dar-va': 't187c', lakeside: 't187c', 'ila-eit': 'ila' };

const specs = [];
for (const f of fs.readdirSync(SPECS).filter((f) => f.endsWith('.json'))) {
  if (onlyFile && f !== `${onlyFile}.json`) continue;
  const area = f.replace(/\.json$/, '');
  for (const s of JSON.parse(fs.readFileSync(path.join(SPECS, f), 'utf8'))) {
    if (onlyId && s.id !== onlyId) continue;
    if (LIST && !LIST.has(`${area}/${s.id}`)) continue;
    s._area = area;
    s.tenant = SLUG_ALIAS[s.tenant] || s.tenant || 'ila';
    specs.push(s);
  }
}

// Same rule the runner uses: CSS only when it starts like CSS.
const isCss = (a) => /^[.#[]/.test(a) || a.includes(' > ') || /^[a-z]+\[/.test(a);
const loc = (page, arg) => (isCss(arg) ? page.locator(arg) : page.locator(`text=${arg.replace(/^text=/, '')}`));

const browser = await chromium.launch();
for (const spec of specs) {
  const statePath = path.join(PIPELINE_ROOT, 'capture', `state-${spec.tenant}.json`);
  if (!fs.existsSync(statePath)) { console.log(`SKIP ${spec._area}/${spec.id}: no session ${spec.tenant}`); continue; }
  const ctx = await browser.newContext({ storageState: statePath, viewport: { width: 1920, height: 1290 } });
  const page = await ctx.newPage();
  let verdict = 'all actions resolved';
  try {
    await page.goto(FRONTEND + spec.route, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(6000);
    for (const action of spec.actions || []) {
      const m = action.match(/^(click|hover|scroll|scrollto|waitfor|wait|fill|press)\s*(.*)$/i);
      if (!m) { verdict = `unknown verb: ${action}`; break; }
      const verb = m[1].toLowerCase();
      let arg = m[2];
      if (verb === 'wait') { await page.waitForTimeout(parseInt(arg, 10) || 500); continue; }
      // press takes a key name, not a locator, so there is nothing to resolve.
      if (verb === 'press') { await page.keyboard.press(arg).catch(() => {}); await page.waitForTimeout(500); continue; }
      // scroll takes a pixel distance over the content pane, not a locator.
      if (verb === 'scroll') { await page.mouse.wheel(0, parseInt(arg, 10) || 600).catch(() => {}); await page.waitForTimeout(700); continue; }
      if (verb === 'fill') arg = arg.split('|')[0].trim();
      const n = await loc(page, arg).count().catch(() => -1);
      if (n < 1) { verdict = `NO MATCH (${n}) for "${action}"`; break; }
      try {
        if (verb === 'click') await loc(page, arg).first().click({ timeout: 8000 });
        else if (verb === 'hover') await loc(page, arg).first().hover({ timeout: 8000 });
        else if (verb === 'scrollto') await loc(page, arg).first().scrollIntoViewIfNeeded({ timeout: 8000 });
        await page.waitForTimeout(900);
      } catch (e) {
        verdict = `MATCHED ${n} BUT ${verb} FAILED for "${action}": ${String(e).split('\n')[0].slice(0, 90)}`;
        break;
      }
    }
    if (verdict === 'all actions resolved' && spec.waitFor) {
      const n = await loc(page, spec.waitFor).count().catch(() => -1);
      if (n < 1) verdict = `actions ok, waitFor NO MATCH: "${spec.waitFor}"`;
    }
  } catch (e) {
    verdict = `navigation failed: ${String(e).split('\n')[0].slice(0, 100)}`;
  }
  console.log(`\n== ${spec._area}/${spec.id}  [${spec.tenant}] ${spec.route}`);
  console.log(`   ${verdict}`);
  if (verdict !== 'all actions resolved') {
    const labels = await page.evaluate(() => {
      const seen = new Set();
      for (const el of document.querySelectorAll('button, a.button, nav.tabs a, .tabs a, [role="tab"], .dropdown-item, h1, h2')) {
        const t = el.textContent.replace(/\s+/g, ' ').trim();
        if (t && t.length < 40) seen.add(t);
      }
      return Array.from(seen).slice(0, 28);
    }).catch(() => []);
    console.log(`   url: ${page.url()}`);
    console.log(`   on screen: ${labels.join(' | ')}`);
  }
  await ctx.close();
}
await browser.close();
