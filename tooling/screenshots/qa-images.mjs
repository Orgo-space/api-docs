// Flag documentation screenshots that are blank, near-blank, or otherwise unusable.
// Heuristic: decode the PNG at low cost via `sips` for dimensions, and use the compressed
// size per megapixel as a proxy for how much is actually rendered. A 3840x2160 shot of an
// empty page compresses to a few tens of KB; a real screen is hundreds.
//
//   node tooling/screenshots/qa-images.mjs
//
// This is a triage aid, not a verdict. A skeleton-only capture has already come within 4%
// of a good file's size. Nothing is verified until the PNG has been opened and looked at.
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { PIPELINE_ROOT, DOCS_DIR, FRONTEND } from './config.mjs';

const DOCS = DOCS_DIR;
const ROOT = PIPELINE_ROOT;

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : p.endsWith('.png') ? [p] : [];
  });
}

// Only judge images this run actually produced.
let produced = [];
try {
  produced = JSON.parse(fs.readFileSync(path.join(ROOT, 'capture', 'results.json'), 'utf8'))
    .filter((r) => r.ok)
    .map((r) => ({ id: r.id, area: r.area, file: path.join(DOCS, r.image.replace(/^\//, '')), url: r.finalUrl }));
} catch {
  produced = walk(path.join(DOCS, 'images/platform')).map((f) => ({ id: path.basename(f), area: '?', file: f }));
}

const rows = [];
for (const p of produced) {
  if (!fs.existsSync(p.file)) continue;
  const bytes = fs.statSync(p.file).size;
  let w = 0, h = 0;
  try {
    const out = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', p.file], { encoding: 'utf8' });
    w = +(out.match(/pixelWidth: (\d+)/)?.[1] || 0);
    h = +(out.match(/pixelHeight: (\d+)/)?.[1] || 0);
  } catch { /* ignore */ }
  const mp = (w * h) / 1e6 || 1;
  const kbPerMp = bytes / 1024 / mp;
  rows.push({ ...p, bytes, w, h, kbPerMp });
}

rows.sort((a, b) => a.kbPerMp - b.kbPerMp);
const SUSPECT = Number(process.env.ORGO_QA_KB_PER_MP || 12); // KB per megapixel

console.log('Suspect captures (little or nothing rendered):');
let n = 0;
for (const r of rows) {
  if (r.kbPerMp >= SUSPECT) continue;
  n++;
  console.log(`  ${r.kbPerMp.toFixed(1)} kb/MP  ${r.area}/${r.id}  ${r.w}x${r.h}  ${(r.url || '').replace(FRONTEND, '')}`);
}
console.log(`\n${n} suspect of ${rows.length} checked (threshold ${SUSPECT} kb/MP)`);
