// The two export-window captures for platform/reports.mdx.
//
//   node capture/report-export-capture.mjs
//
// run.mjs cannot express these: the progress window only exists while a real
// export is running, and on the demo tenant a real export is over in about a
// second. So this script runs the export for real and freezes it in place:
//
//   1. starts ONE local worker on the report_export queue (nothing consumes it
//      on this machine otherwise, so the job would sit at pending forever),
//   2. presses Download on the saved "Payments export by date" report,
//   3. waits for the window to print its first row count, then SIGSTOPs the
//      worker and photographs the window,
//   4. SIGCONTs the worker, lets the export finish, and photographs the ready
//      state with its Download button.
//
// Nothing is faked: the row count, the status and the file are the product's.
// SIGSTOP is a pause button on a real run, not a substitute for one. The report
// is 646 payments = two pages of 500, so the writer really does pass through an
// intermediate count (ReportCsvWriter pages at QueryCompiler::MAX_PAGE_SIZE).
//
// Side effects to clean up afterwards: one report_export_job row per attempt,
// and one media/report/<uuid>.csv object in the S3 bucket per completed run.
import { chromium } from 'playwright';
import { execSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { PIPELINE_ROOT, DOCS_DIR, FRONTEND, PHP_CONTAINER } from '../config.mjs';

const REPORT_NAME = process.env.REPORT_NAME || 'Payments export by date';
const OUT_PROGRESS = path.join(DOCS_DIR, 'images/platform/reports/reports-export-progress.png');
const OUT_READY = path.join(DOCS_DIR, 'images/platform/reports/reports-export-ready.png');
const MAX_ATTEMPTS = 4;

// Write gate: every script that changes the documentation database checks the
// marker table first, which exists only on the orgo-1 instance.
const marker = execSync(
  `docker exec ${PHP_CONTAINER} bin/console dbal:run-sql "SELECT note FROM docs_instance_marker" 2>/dev/null || true`,
  { encoding: 'utf8' }
);
if (!marker.includes('orgo-1 documentation instance')) {
  console.error('docs_instance_marker not found: this is not the orgo-1 documentation database. Refusing to run.');
  process.exit(1);
}

// One worker, one message, then it exits. Told to print its own pid so the
// freeze does not have to guess it (pgrep is not installed in the image).
function startWorker() {
  const worker = spawn(
    'docker',
    [
      'exec',
      PHP_CONTAINER,
      'sh',
      '-c',
      'echo PID=$$; exec php bin/console messenger:consume report_export_transport --limit=1 --time-limit=240 -q',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );
  let pid = null;
  worker.stdout.on('data', (chunk) => {
    const m = String(chunk).match(/PID=(\d+)/);
    if (m) pid = Number(m[1]);
  });
  worker.stderr.on('data', (chunk) => process.stderr.write(`  worker: ${chunk}`));
  return { worker, pid: () => pid };
}

function signal(pid, sig) {
  execSync(`docker exec ${PHP_CONTAINER} sh -c "kill -${sig} ${pid}"`);
}

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 2,
  storageState: path.join(PIPELINE_ROOT, 'capture', 'state-t187c.json'),
});
const page = await context.newPage();

async function attempt(n) {
  console.log(`attempt ${n}`);
  const { worker, pid } = startWorker();
  // Let the worker boot and start long-polling before the job is queued.
  await new Promise((r) => setTimeout(r, 9000));
  const workerPid = pid();
  if (!workerPid) {
    console.log('  worker did not report a pid');
    worker.kill();
    return false;
  }

  await page.goto(`${FRONTEND}/reports`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(3500);
  await page
    .addStyleTag({ content: '#webpack-dev-server-client-overlay,vite-error-overlay{display:none!important}::-webkit-scrollbar{display:none!important}' })
    .catch(() => {});

  const row = page.locator('tbody tr', { hasText: REPORT_NAME }).first();
  await row.locator('.orgo-table-actions button').first().click();

  // Poll the window itself: it renders "<n> rows exported" from the job's
  // processedRows, over Mercure and its own 3s poll.
  let frozen = false;
  for (let i = 0; i < 600; i++) {
    const text = await page.locator('.modal-card').first().innerText().catch(() => '');
    if (/rows exported/i.test(text)) {
      signal(workerPid, 'STOP');
      frozen = true;
      console.log(`  frozen at: ${text.split('\n').find((l) => /rows exported/i.test(l))}`);
      break;
    }
    if (/report is ready/i.test(text)) {
      console.log('  missed: the export completed before a row count was rendered');
      break;
    }
    await page.waitForTimeout(100);
  }

  if (!frozen) {
    worker.kill();
    return false;
  }

  await page.waitForTimeout(1200);
  fs.mkdirSync(path.dirname(OUT_PROGRESS), { recursive: true });
  await page.locator('.modal-card').first().screenshot({ path: OUT_PROGRESS });
  console.log(`  wrote ${OUT_PROGRESS}`);

  signal(workerPid, 'CONT');
  await page.locator('.modal-card', { hasText: 'Your report is ready.' }).first().waitFor({ timeout: 120000 });
  await page.waitForTimeout(1500);
  await page.locator('.modal-card').first().screenshot({ path: OUT_READY });
  console.log(`  wrote ${OUT_READY}`);
  return true;
}

let ok = false;
for (let n = 1; n <= MAX_ATTEMPTS && !ok; n++) {
  ok = await attempt(n);
}

console.log(ok ? 'done' : 'FAILED to catch a mid-run frame');
console.log(
  execSync(
    `docker exec ${PHP_CONTAINER} bin/console dbal:run-sql "SELECT uuid, status, processed_rows, total_rows, object_name FROM report_export_job ORDER BY id"`,
    { encoding: 'utf8' }
  )
);
await browser.close();
