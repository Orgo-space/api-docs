// Delete the import drafts a capture of the import wizard leaves behind.
//
//   node capture/clean-import-drafts.mjs
//
// Opening the Map columns screen writes an `import` row in `preflight`, and it stays
// there: nothing in the wizard removes a draft that was never started. Left alone the
// rows pile up in Import History and the next capture renders "Waiting behind another
// import" across the top of the screen it is photographing.
//
// Only drafts are removed: preflight, queued, processing and mapping rows for the
// documentation tenant. 'mapping' is the one that matters most: a draft left in it turns
// the step's button from 'Map columns' into 'Continue mapping', which silently breaks any
// spec that clicks the first label. A completed or rolled-back import is history and is never touched. Gated on
// the docs_instance_marker table, like every other script here that writes.
import { execFileSync } from 'child_process';
import { DB_CONTAINER, DB_NAME, DB_USER, DB_PASSWORD } from '../config.mjs';

const sql = (q) =>
  execFileSync('docker', ['exec', DB_CONTAINER, 'mysql', `-u${DB_USER}`, `-p${DB_PASSWORD}`, DB_NAME, '-N', '-B', '-e', q],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

let marker = '';
try { marker = sql('SELECT note FROM docs_instance_marker LIMIT 1'); } catch { /* table missing */ }
if (!marker) {
  console.error(`\nABORT: ${DB_CONTAINER} has no docs_instance_marker row.\nThis is not the documentation database.\n`);
  process.exit(1);
}

const ids = sql("SELECT id FROM import WHERE status IN ('preflight','queued','processing','mapping')").split('\n').filter(Boolean);
if (!ids.length) { console.log('no import drafts to clean'); process.exit(0); }
const list = ids.join(',');
for (const table of ['import_preflight_key', 'import_log', 'import_modification_snapshot']) {
  sql(`DELETE FROM ${table} WHERE import_id IN (${list})`);
}
sql(`DELETE FROM import WHERE id IN (${list})`);
console.log(`removed ${ids.length} import draft(s): ${list}`);
