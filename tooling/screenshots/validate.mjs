// Validate the platform docs: internal links, image references, nav coverage, frontmatter.
//
//   node tooling/screenshots/validate.mjs
//
// Exits non-zero when a link, image, nav entry or frontmatter title is broken.
// Pages absent from docs.json and em dashes are reported but do not fail the run.
import fs from 'fs';
import path from 'path';
import { DOCS_DIR } from './config.mjs';

const DOCS = DOCS_DIR;
const PLATFORM = path.join(DOCS, 'platform');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : p.endsWith('.mdx') || p.endsWith('.md') ? [p] : [];
  });
}

const pages = walk(PLATFORM);
const docsJson = JSON.parse(fs.readFileSync(path.join(DOCS, 'docs.json'), 'utf8'));

const navPages = new Set();
(function collect(node) {
  if (Array.isArray(node)) return node.forEach(collect);
  if (node && typeof node === 'object') return Object.values(node).forEach(collect);
  if (typeof node === 'string' && node.startsWith('platform/')) navPages.add(node);
})(docsJson.navigation);

const slugOf = (f) => path.relative(DOCS, f).replace(/\.mdx?$/, '');
const onDisk = new Set(pages.map(slugOf));

const problems = { badLinks: [], missingImages: [], notInNav: [], navMissingFile: [], noFrontmatter: [], emDash: [] };

for (const f of pages) {
  const src = fs.readFileSync(f, 'utf8');
  const slug = slugOf(f);

  if (!/^---\n[\s\S]*?\btitle:/.test(src)) problems.noFrontmatter.push(slug);
  if (!navPages.has(slug)) problems.notInNav.push(slug);

  for (const m of src.matchAll(/\]\((\/platform\/[^)#\s]+)(#[^)\s]*)?\)/g)) {
    const target = m[1].replace(/^\//, '');
    // Mintlify serves folder/index.mdx at /folder, which is the convention these docs already use.
    if (!onDisk.has(target) && !onDisk.has(`${target}/index`)) problems.badLinks.push(`${slug} -> ${m[1]}`);
  }
  for (const m of src.matchAll(/src=["'](\/images\/[^"']+)["']/g)) {
    if (!fs.existsSync(path.join(DOCS, m[1].replace(/^\//, '')))) problems.missingImages.push(`${slug} -> ${m[1]}`);
  }
  // Body only: frontmatter descriptions are allowed to differ in punctuation.
  const body = src.replace(/^---[\s\S]*?\n---\n/, '');
  const dashes = [...body.matchAll(/[—–]/g)].length;
  if (dashes) problems.emDash.push(`${slug} (${dashes})`);
}

for (const p of navPages) if (!onDisk.has(p)) problems.navMissingFile.push(p);

const label = {
  badLinks: 'Internal links with no file on disk',
  missingImages: 'Image references with no file',
  notInNav: 'Pages on disk but absent from docs.json',
  navMissingFile: 'docs.json entries with no file',
  noFrontmatter: 'Pages missing frontmatter title',
  emDash: 'Pages containing em/en dashes in the body',
};

let failed = 0;
for (const [k, v] of Object.entries(problems)) {
  console.log(`\n## ${label[k]}: ${v.length}`);
  v.slice(0, 40).forEach((x) => console.log(`   ${x}`));
  if (v.length > 40) console.log(`   ... and ${v.length - 40} more`);
  if (v.length && k !== 'notInNav' && k !== 'emDash') failed += v.length;
}
console.log(`\npages: ${pages.length}, in nav: ${navPages.size}`);
process.exit(failed ? 1 : 0);
