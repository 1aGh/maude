#!/usr/bin/env node
// V2-8.0 part C — retire the v1 `.st-*` class namespace by family, repo-wide, from one plan.
//
//   node scripts/v2-verify/st-rename.mjs [--apply] [--plan <file>]
//
// The plan (scripts/v2-verify/st-rename-plan.json, cumulative) maps a FAMILY — the first segment after `st-` — to
// its area's v2 namespace: `"share": "sh"` turns `st-share`, `st-share-ic`, `st-share-btn--x` … into `sh-share…`.
// When family === namespace the prefix collapses (`"insp": "insp"`: `st-insp-x` → `insp-x`). Renaming whole
// families keeps every dynamic name consistent (`st-callout--${tone}` → `sh-callout--${tone}`).
//
// What it rewrites: client source + CSS, studio tests, the v1 characterization goldens (class lists re-sorted, as
// the snapshot sorts them), desktop e2e specs, scenario runners, TESTIDS.md + testids.json — everything that
// selects the live DOM. What it never touches: the frozen v1 manifest (`client/v2/v1-manifest.json`) and the rules
// that match it (`scripts/v2-manifest/`), What's New (shared file — a patch request), plan history.
// A token only counts with no word char, `$` or `-` before it (so `--st-x`, `first-x` and `data-st-x` are safe).
// Refuses (exit 1) when a new name already exists in client source. Dry run by default.
//
// The A/B rig reuses `renameText` (`css-ab-rig.mjs --a-rename`) so the "before" stylesheet can be compared against
// the renamed DOM.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
export const PLAN_PATH = join(here, 'st-rename-plan.json');

const target = (plan, fam) => (plan[fam] === fam ? fam : `${plan[fam]}-${fam}`);
function familyRe(plan) {
  const fams = Object.keys(plan).sort((a, b) => b.length - a.length);
  return new RegExp(`(?<![\\w$-])st-(${fams.join('|')})(?![a-z0-9_])`, 'g');
}
/** Rewrite every `st-<family>` token of `text` per `plan`; `onToken(old, next)` sees each full name. */
export function renameText(text, plan, onToken) {
  if (!Object.keys(plan).length) return text;
  return text.replace(familyRe(plan), (all, fam, off) => {
    const next = target(plan, fam);
    if (onToken) {
      const tail = text.slice(off + all.length).match(/^[a-z0-9_-]*/)[0];
      const old = `${all}${tail}`.replace(/[-_]+$/, '');
      onToken(old, next + old.slice(3 + fam.length));
    }
    return next;
  });
}

const SKIP =
  /node_modules|\/dist\/|\/target\/|\/resources\/|\/\.git\/|\.sync-conflict|\/gen\/schemas\//;
const FROZEN = [
  'apps/studio/client/v2/v1-manifest.json',
  'apps/studio/whats-new.json',
  'scripts/v2-manifest/',
  'scripts/v2-verify/st-rename',
];
const SCAN = ['apps/studio', 'apps/desktop/e2e', 'scripts', '.ai/scenarios', 'cli'];
function walk(d, out = []) {
  let names;
  try {
    names = readdirSync(d);
  } catch {
    return out;
  }
  for (const n of names) {
    const p = join(d, n);
    if (SKIP.test(`${p}/`)) continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (
      /\.(jsx?|tsx?|mjs|cjs|css|md|json|html|ya?ml|sh)$/.test(n) ||
      /characterization\/.*\.txt$/.test(p)
    )
      out.push(p);
  }
  return out;
}
// The characterization snapshot sorts an element's classes; a rename can move one.
const resortGolden = (s) =>
  s
    .split('\n')
    .map((l) =>
      l.replace(
        /^(\s*[a-z][a-z0-9-]* )(\.[^\s"[]+)(?=\s|$)/,
        (all, head, cls) => `${head}.${cls.slice(1).split('.').sort().join('.')}`
      )
    )
    .join('\n');

function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const planPath = args.includes('--plan') ? resolve(args[args.indexOf('--plan') + 1]) : PLAN_PATH;
  const plan = JSON.parse(readFileSync(planPath, 'utf8'));
  if (args.includes('--bundle')) {
    // Residue check on a fresh release build: no planned family may survive in what ships.
    let left = 0;
    for (const f of ['apps/studio/dist/client.bundle.js', 'apps/studio/dist/styles.css']) {
      const seen = new Set();
      renameText(readFileSync(join(repo, f), 'utf8'), plan, (old) => seen.add(old));
      left += seen.size;
      console.log(`${f}: ${seen.size ? [...seen].join(' ') : 'no planned st-* family left'}`);
    }
    process.exit(left ? 1 : 0);
  }
  const files = SCAN.flatMap((d) => walk(join(repo, d))).filter((f) => {
    const r = relative(repo, f);
    return !FROZEN.some((z) => r.startsWith(z));
  });
  const existing = new Set();
  for (const f of files) {
    if (!relative(repo, f).startsWith('apps/studio/client/')) continue;
    for (const m of readFileSync(f, 'utf8').matchAll(/(?<![\w$-])[a-z][a-z0-9]*(?:-[a-z0-9]+)+/g))
      existing.add(m[0]);
  }
  const map = new Map();
  const changed = [];
  for (const f of files) {
    const s = readFileSync(f, 'utf8');
    let n = 0;
    let out = renameText(s, plan, (old, next) => {
      n++;
      map.set(old, next);
    });
    if (!n) continue;
    if (f.endsWith('.txt')) out = resortGolden(out);
    changed.push(`${String(n).padStart(5)}  ${relative(repo, f)}`);
    if (apply) writeFileSync(f, out);
  }
  const collisions = [...map]
    .filter(([, next]) => existing.has(next))
    .map(([old, next]) => `${old} → ${next}`);
  console.log(changed.join('\n'));
  console.log(
    `st-rename: ${map.size} names in ${changed.length} files${apply ? ' rewritten' : ' (dry run)'}`
  );
  if (collisions.length) {
    console.error(
      `st-rename: ${collisions.length} new names already exist:\n  ${collisions.join('\n  ')}`
    );
    process.exit(1);
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
