// Capture documentation screenshots from the local, obfuscated Orgo instance.
//
//   node capture/run.mjs                 capture every spec whose status is new|recapture
//   node capture/run.mjs groups          only specs from specs/groups.json
//   node capture/run.mjs groups ID       only one spec id
//
// Writes PNGs straight into the docs repo (images/...) and a result manifest.
// Configuration (frontend URL, docs directory, concurrency): ../config.mjs.
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { PIPELINE_ROOT, DOCS_DIR, FRONTEND, CONCURRENCY } from '../config.mjs';

const ROOT = PIPELINE_ROOT;
const SPECS = path.join(ROOT, 'specs');
const DOCS = DOCS_DIR;

// Some agents were briefed with a slug that turned out to be wrong.
// 'eventapp' is not a tenant: it selects the attendee Event App session.
const SLUG_ALIAS = { 'dar-va': 't187c', 'lakeside': 't187c', 'ila-eit': 'ila' };

const VIEWPORTS = {
  desktop: { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 },
  // For pages that render taller than a screen and scroll an inner pane the wheel cannot reach.
  // NOTE: AppLayout hides the left sidebar whenever innerHeight > innerWidth (isPortrait),
  // so 'tall' produces a sidebar-less shot. Use 'wide' when the page needs more height than
  // 1080 but must keep the sidebar.
  tall: { viewport: { width: 1920, height: 2200 }, deviceScaleFactor: 2 },
  wide: { viewport: { width: 1920, height: 1290 }, deviceScaleFactor: 2 },
  mobile: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
};

const onlyFile = process.argv[2];
const onlyId = process.argv[3];

function loadSpecs() {
  const out = [];
  for (const f of fs.readdirSync(SPECS).filter((f) => f.endsWith('.json'))) {
    if (onlyFile && f !== `${onlyFile}.json`) continue;
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(path.join(SPECS, f), 'utf8'));
    } catch (e) {
      console.log(`SKIP ${f}: invalid JSON (${e.message.split('\n')[0]})`);
      continue;
    }
    for (const s of Array.isArray(parsed) ? parsed : parsed.specs || []) {
      if (onlyId && s.id !== onlyId) continue;
      if ((s.status || 'new') === 'keep') continue;
      if ((s.status || '') === 'dropped') continue;
      s._area = f.replace(/\.json$/, '');
      s.tenant = SLUG_ALIAS[s.tenant] || s.tenant || 'ila';
      out.push(s);
    }
  }
  return out;
}

function statePath(slug) {
  return path.join(ROOT, 'capture', `state-${slug}.json`);
}

async function applyActions(page, actions = [], failures = []) {
  for (const raw of actions) {
    // Agents write free-form hints; support the common verbs and skip the rest.
    const a = String(raw).trim();
    const m = a.match(/^(click|fill|wait|waitFor|press|hover|scroll|scrollto)\s+(.*)$/i);
    if (!m) continue;
    const verb = m[1].toLowerCase();
    let arg = m[2].replace(/\s*\(only if.*$/i, '').trim();
    try {
      if (verb === 'wait') {
        await page.waitForTimeout(parseInt(arg, 10) || 1000);
      } else if (verb === 'waitfor') {
        await page.locator(toLocator(arg)).first().waitFor({ timeout: 8000 });
      } else if (verb === 'click') {
        await page.locator(toLocator(arg)).first().click({ timeout: 8000 });
        await page.waitForTimeout(1200);
      } else if (verb === 'hover') {
        await page.locator(toLocator(arg)).first().hover({ timeout: 8000 });
      } else if (verb === 'press') {
        await page.keyboard.press(arg);
      } else if (verb === 'fill') {
        const [sel, val] = arg.split('|');
        await page.locator(toLocator(sel.trim())).first().fill((val || '').trim());
      } else if (verb === 'scroll') {
        // The app scrolls an inner container, so move the wheel over the content pane.
        const box = await page.locator('main, [class*="content"], body').first().boundingBox();
        if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.wheel(0, parseInt(arg, 10) || 400);
        await page.waitForTimeout(800);
      } else if (verb === 'scrollto') {
        await page.locator(toLocator(arg)).first().scrollIntoViewIfNeeded({ timeout: 8000 });
        await page.waitForTimeout(900);
      } else if (verb === 'scrolljs') {
        // The app scrolls an inner pane, not the window, so drive whichever element actually scrolls.
        await page.evaluate((px) => {
          const el = [...document.querySelectorAll('*')].find(
            (e) => e.scrollHeight > e.clientHeight + 50 && e.clientHeight > 300
          );
          (el || document.scrollingElement).scrollTop += px;
        }, parseInt(arg, 10) || 600);
        await page.waitForTimeout(900);
      }
    } catch (e) {
      // A silently skipped action produces a screenshot of the wrong screen,
      // which is how duplicate images crept in. Record it so the run reports it.
      failures.push(`${verb} ${arg}`);
    }
  }
}

function toLocator(s) {
  const t = s.trim().replace(/^["']|["']$/g, '');
  if (t.startsWith('text=')) return `text=${t.slice(5)}`;
  if (/^[.#\[]/.test(t) || t.includes(' > ') || /^[a-z]+\[/.test(t)) return t;
  return `text=${t}`;
}

async function capture(browser, spec) {
  // tenant 'anon' captures signed-out pages (login, public pages) with no session at all.
  const anon = spec.tenant === 'anon';
  const sp = statePath(spec.tenant);
  if (!anon && !fs.existsSync(sp)) return { ...spec, ok: false, error: `no session for tenant ${spec.tenant}` };

  const vp = VIEWPORTS[spec.viewport] || VIEWPORTS.desktop;
  // Playwright's `isMobile` viewport flag does NOT change the User-Agent, and the app
  // decides mobile-vs-desktop rendering from the UA (vue-mobile-detection). A spec can
  // opt into a real phone UA with "userAgent"; without it a 390px shot still renders the
  // desktop layout squeezed into 390px.
  const context = await browser.newContext({
    ...vp,
    ...(spec.userAgent ? { userAgent: spec.userAgent } : {}),
    ...(anon ? {} : { storageState: sp }),
  });
  const page = await context.newPage();
  const result = { id: spec.id, area: spec._area, image: spec.image, tenant: spec.tenant };

  try {
    const url = FRONTEND + (spec.route.startsWith('/') ? spec.route : `/${spec.route}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    // The app fetches after mount, so wait for the XHRs to settle before judging the page.
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(4000);
    // Skeleton placeholders mean the table has not painted yet.
    for (let i = 0; i < 6; i++) {
      const skeletons = await page.locator('.b-skeleton, [class*="skeleton"]').count().catch(() => 0);
      if (!skeletons) break;
      await page.waitForTimeout(2000);
    }

    // Cookie banner would otherwise sit in every screenshot.
    for (const label of ['Accept all cookies', 'Reject optional']) {
      const b = page.getByRole('button', { name: label });
      if (await b.count()) { try { await b.first().click({ timeout: 1500 }); } catch {} }
    }
    await page.addStyleTag({ content: '::-webkit-scrollbar{display:none!important}' }).catch(() => {});
    // A stale dev-server compile error paints a red overlay over the whole app.
    // The page underneath renders fine, so strip it rather than shipping a screenshot of it.
    await page.addStyleTag({
      content: '#webpack-dev-server-client-overlay,#webpack-dev-server-client-overlay-div,vite-error-overlay{display:none!important}',
    }).catch(() => {});

    const actionFailures = [];
    await applyActions(page, spec.actions, actionFailures);
    if (actionFailures.length) result.actionFailures = actionFailures;

    if (spec.waitFor) {
      try {
        await page.locator(toLocator(spec.waitFor)).first().waitFor({ timeout: 12000 });
        result.waitForMatched = true;
      } catch {
        result.waitForMatched = false;
      }
    }
    await page.waitForTimeout(1500);

    result.finalUrl = page.url();
    // Landing on /login means the session failed, unless the login screen is the subject.
    if (result.finalUrl.includes('/login') && !spec.route.startsWith('/login')) {
      throw new Error('bounced to login');
    }

    // The overlay can be injected after load, so clear it again immediately before the shot.
    await page.evaluate(() => {
      document
        .querySelectorAll('#webpack-dev-server-client-overlay,#webpack-dev-server-client-overlay-div,vite-error-overlay')
        .forEach((el) => el.remove());
    }).catch(() => {});

    const dest = path.join(DOCS, spec.image.replace(/^\//, ''));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (spec.selector) {
      await page.locator(spec.selector).first().screenshot({ path: dest });
    } else {
      await page.screenshot({ path: dest, fullPage: !!spec.fullPage });
    }
    result.ok = true;
    result.bytes = fs.statSync(dest).size;
    result.hash = crypto.createHash('md5').update(fs.readFileSync(dest)).digest('hex');
  } catch (e) {
    result.ok = false;
    result.error = e.message.split('\n')[0];
  } finally {
    await context.close();
  }
  return result;
}

const specs = loadSpecs();
console.log(`${specs.length} specs to capture from ${FRONTEND} into ${DOCS} (concurrency ${CONCURRENCY})`);
const browser = await chromium.launch();
const results = [];
for (let i = 0; i < specs.length; i += CONCURRENCY) {
  const batch = specs.slice(i, i + CONCURRENCY);
  const done = await Promise.all(batch.map((s) => capture(browser, s)));
  for (const r of done) {
    results.push(r);
    console.log(`${r.ok ? 'OK  ' : 'FAIL'} ${r.area}/${r.id} ${r.ok ? `(${Math.round(r.bytes / 1024)}kb${r.waitForMatched === false ? ', waitFor MISSED' : ''})` : `- ${r.error}`}`);
  }
}
await browser.close();
fs.writeFileSync(path.join(ROOT, 'capture', 'results.json'), JSON.stringify(results, null, 2));
const ok = results.filter((r) => r.ok).length;
const missed = results.filter((r) => r.ok && r.waitForMatched === false).length;
console.log(`\ncaptured ${ok}/${results.length} (${missed} captured but did not match their waitFor and need review)`);

// Two specs producing a byte-identical image means one of them shot the wrong screen.
const byHash = {};
for (const r of results.filter((x) => x.ok && x.hash)) (byHash[r.hash] ||= []).push(`${r.area}/${r.id}`);
const dupes = Object.values(byHash).filter((v) => v.length > 1);
if (dupes.length) {
  console.log(`\nDUPLICATE IMAGES (${dupes.length} group(s)) - these specs captured the same screen:`);
  for (const g of dupes) console.log('   ' + g.join('  ==  '));
}
const failed = results.filter((r) => r.actionFailures);
if (failed.length) {
  console.log(`\nACTIONS THAT DID NOT RUN (${failed.length}) - the screenshot is of the page before the action:`);
  for (const r of failed) console.log(`   ${r.area}/${r.id}: ${r.actionFailures.join('; ')}`);
}
