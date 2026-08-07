#!/usr/bin/env node
/**
 * Tell me what shipped in the product since the docs were last reconciled.
 *
 *   node tooling/check-staleness.mjs                  # report
 *   node tooling/check-staleness.mjs --stamp          # report, then record HEAD as reviewed
 *   node tooling/check-staleness.mjs --since <ref>    # ignore the stamp, use this ref
 *   ORGO_REPO=/path/to/orgo node tooling/check-staleness.mjs
 *
 * Exit codes: 0 nothing to review, 1 commits need review, 2 could not run.
 *
 * Why this exists: the platform docs were verified page by page on 2026-08-03
 * and were already wrong on 2026-08-06. Thirty commits had landed, two of them
 * shipping whole features that were documented nowhere. Nobody was at fault;
 * there was simply no step that asked the question. This is that step, and it
 * takes about a second.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DOCS = join(dirname(fileURLToPath(import.meta.url)), '..');
const STAMP = join(DOCS, 'tooling', '.last-reviewed-commit');
const REPO = process.env.ORGO_REPO || '/Users/alex/orgo-instance-1';
const BRANCH = process.env.ORGO_BRANCH || 'origin/master';

// Paths whose changes can plausibly alter what a customer or admin sees.
// Deliberately broad: a false positive costs one glance, a false negative costs
// a wrong page in production.
const USER_VISIBLE = ['api/src/', 'client/src/', 'api/src/Resources/config/'];
// Subjects that almost never need a doc change.
const IGNORE_SUBJECT = /^(chore|ci|build|test|style|refactor)\(|^(chore|ci|build|test|style):/i;
// Areas that are infrastructure rather than product surface.
const IGNORE_SCOPE = /\((deploy|serverless|lambda|infra|docker|mailer|alert|monitoring)\)/i;

// Argument array, never a shell string: `since` and ORGO_BRANCH come from the
// command line and the environment, and a shell would interpret metacharacters
// in them.
const git = (...args) =>
  execFileSync('git', args, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

// Refs reach git as arguments, but a malformed one still produces a confusing
// error deep in a later call, so reject anything that is not ref-shaped early.
const assertRef = (ref, label) => {
  if (!/^[\w.\/-]+$/.test(ref)) {
    console.error(`Refusing to use ${label} "${ref}": not a valid git ref.`);
    process.exit(2);
  }
  return ref;
};

if (!existsSync(join(REPO, '.git'))) {
  console.error(`Cannot find a git repo at ${REPO}. Set ORGO_REPO.`);
  process.exit(2);
}

let since = null;
const sinceArg = process.argv.indexOf('--since');
if (sinceArg !== -1) since = process.argv[sinceArg + 1];
else if (existsSync(STAMP)) since = readFileSync(STAMP, 'utf8').trim();

assertRef(BRANCH, 'ORGO_BRANCH');
try { git('fetch', 'origin', BRANCH.replace('origin/', ''), '-q'); } catch { /* offline is fine */ }

const head = git('rev-parse', BRANCH);
if (!since) {
  console.log(`No review stamp yet. Recording ${head.slice(0, 9)} as the baseline.`);
  writeFileSync(STAMP, head + '\n');
  process.exit(0);
}

let log;
try {
  assertRef(since, 'the review stamp');
  log = git('log', '--no-merges', '--format=%H%x1f%s%x1f%an%x1f%ad', '--date=short', `${since}..${BRANCH}`);
} catch (e) {
  console.error(`Could not diff ${since}..${BRANCH}. Is the stamp a valid commit?\n${e.message}`);
  process.exit(2);
}

if (!log) {
  console.log(`Up to date. Nothing on ${BRANCH} since ${since.slice(0, 9)}.`);
  process.exit(0);
}

const commits = log.split('\n').map((line) => {
  const [sha, subject, author, date] = line.split('\x1f');
  let files = [];
  try { files = git('show', '--stat', '--format=', '--name-only', sha).split('\n').filter(Boolean); } catch { /* empty */ }
  const touchesSurface = files.some((f) => USER_VISIBLE.some((p) => f.startsWith(p)));
  const boring = IGNORE_SUBJECT.test(subject) || IGNORE_SCOPE.test(subject);
  return { sha, subject, author, date, files, touchesSurface, boring };
});

const features = commits.filter((c) => /^feat/i.test(c.subject) && !c.boring);
const review = commits.filter((c) => c.touchesSurface && !c.boring && !/^feat/i.test(c.subject));
const skipped = commits.filter((c) => c.boring || !c.touchesSurface);

console.log(`\n${commits.length} commit(s) on ${BRANCH} since ${since.slice(0, 9)}\n`);

if (features.length) {
  console.log(`NEW FEATURES (${features.length}) - these usually need a page and a changelog entry:`);
  for (const c of features) console.log(`  ${c.sha.slice(0, 9)}  ${c.date}  ${c.subject}`);
  console.log('');
}
if (review.length) {
  console.log(`BEHAVIOUR CHANGES (${review.length}) - check whether a page now says something untrue:`);
  for (const c of review) console.log(`  ${c.sha.slice(0, 9)}  ${c.date}  ${c.subject}`);
  console.log('');
}
if (skipped.length) console.log(`Ignored ${skipped.length} infrastructure/chore commit(s).\n`);

if (features.length || review.length) {
  console.log('For each one: read the code, not the commit subject. Grep platform/ for the');
  console.log('sentence it invalidates. Then re-run with --stamp to record this as reviewed.\n');
}

if (process.argv.includes('--stamp')) {
  writeFileSync(STAMP, head + '\n');
  console.log(`Stamped ${head.slice(0, 9)} as reviewed.`);
  process.exit(0);
}

process.exit(features.length || review.length ? 1 : 0);
