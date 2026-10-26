#!/usr/bin/env node
// V2-8.0 part B — which shell CSS rules can still style live DOM, and which `.st-*` / `--u-*` names are left.
//
//   node scripts/v2-css-inventory.mjs [--bundle <client.bundle.js>] [--also client/v2] [--report]
//        [--json <out>] [--apply <css,…>] [--check <css,…>] [--names]
//
// "Live" = a class token that appears in the SHELL BUNDLE (default apps/studio/dist/client.bundle.js — build it
// first with `MAUDE_SKIP_RUNTIME_BUILD=1 bun run build.ts --release` so it matches the sources) or in
// client/index.html, plus every token in the --also source dirs (default client/v2: a v2 component that is
// exported but not mounted yet keeps its styles). styles.css is loaded by index.html only (canvas iframes and
// comment-mount never load it), and the bundle is tree-shaken, so a class that is in neither cannot be on any
// element styles.css reaches. Dynamic names are honoured: a `foo-${x}` / 'foo-' + x prefix keeps every
// `foo-*` class live, a `${x}-bar` suffix keeps `<token>-bar` live.
//
// A rule is DEAD when every selector in its list requires a class that is not live (classes inside :not(),
// :is(), :where(), :has() and attribute selectors never kill a selector — conservative). --apply removes dead
// rules (and dead selectors from a list that also has live ones, plus a comment whose whole run of rules went)
// from the named files; --check exits 1 when any named file still has a dead rule; --names lists the `.st-*`
// classes and `--u-*` tokens still used and where.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STUDIO = join(ROOT, 'apps/studio');
const require = createRequire(join(STUDIO, 'package.json'));
const postcss = require('postcss');
const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const list = (v) => (v ?? '').split(',').filter(Boolean);

const SKIP_DIR = new Set(['node_modules', 'dist', 'test', 'tests', 'e2e', 'contracts']);
function walk(d, out, ext = /\.(jsx?|tsx?|mjs)$/) {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) {
      if (!SKIP_DIR.has(n) && !n.startsWith('.')) walk(p, out, ext);
    } else if (ext.test(n) && !/\.(test|spec)\./.test(n)) out.push(p);
  }
  return out;
}

// ── live tokens ─────────────────────────────────────────────────────────────────────────
const sources = [
  resolve(opt('--bundle', join(STUDIO, 'dist/client.bundle.js'))),
  join(STUDIO, 'client/index.html'),
];
for (const d of list(opt('--also', 'client/v2'))) walk(join(STUDIO, d), sources);
const tokens = new Set();
const prefixes = new Set();
const suffixes = new Set();
for (const f of sources) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/[A-Za-z_][A-Za-z0-9_-]*/g)) tokens.add(m[0]);
  for (const m of src.matchAll(/([A-Za-z][\w-]*-)\$\{/g)) prefixes.add(m[1]);
  for (const m of src.matchAll(/['"`]([A-Za-z][\w-]*[-_])['"`]\s*\+/g)) prefixes.add(m[1]);
  for (const m of src.matchAll(/\}(-[A-Za-z][\w-]*)/g)) suffixes.add(m[1]);
  for (const m of src.matchAll(/\+\s*['"`](-[A-Za-z][\w-]*)['"`]/g)) suffixes.add(m[1]);
}
const prefixList = [...prefixes].filter((p) => p.length >= 3);
function classLive(c) {
  if (tokens.has(c)) return true;
  for (const p of prefixList) if (c.startsWith(p) && c.length > p.length) return true;
  for (const s of suffixes)
    if (c.endsWith(s) && c.length > s.length && tokens.has(c.slice(0, -s.length))) return true;
  return false;
}
function requiredClasses(sel) {
  let s = sel.replace(/\[[^\]]*\]/g, '');
  for (let prev; prev !== s; ) {
    prev = s;
    s = s.replace(/\([^()]*\)/g, '');
  }
  return [...s.matchAll(/\.(-?[A-Za-z_][A-Za-z0-9_-]*)/g)].map((m) => m[1]);
}
const selectorDead = (sel) => requiredClasses(sel).some((c) => !classLive(c));

// ── the bundle's CSS files, in _index.css order ──────────────────────────────────────────
const INDEX = join(STUDIO, 'client/styles/_index.css');
const cssFiles = [...readFileSync(INDEX, 'utf8').matchAll(/@import url\("([^"]+)"\)/g)].map((m) =>
  resolve(dirname(INDEX), m[1])
);
const apply = new Set(list(opt('--apply')).map((p) => resolve(ROOT, p)));
const check = new Set(list(opt('--check')).map((p) => resolve(ROOT, p)));
const report = [];
let checkFailed = false;
for (const f of cssFiles) {
  const css = readFileSync(f, 'utf8');
  const root = postcss.parse(css, { from: f });
  let rules = 0;
  let deadBytes = 0;
  const dead = [];
  const trims = [];
  root.walkRules((rule) => {
    if (rule.parent?.type === 'atrule' && /keyframes$/i.test(rule.parent.name)) return;
    for (let p = rule.parent; p; p = p.parent) if (p.__dead) return;
    rules++;
    const sels = rule.selectors;
    const deadSels = sels.filter(selectorDead);
    if (deadSels.length === sels.length) {
      rule.__dead = true;
      dead.push(rule);
      deadBytes += rule.toString().length;
    } else if (deadSels.length) trims.push([rule, sels.filter((s) => !deadSels.includes(s))]);
  });
  const rel = relative(ROOT, f);
  report.push({
    file: rel,
    bytes: css.length,
    rules,
    dead: dead.length,
    partial: trims.length,
    deadBytes,
    deadSelectors: dead.map((r) => r.selector.replace(/\s+/g, ' ')),
  });
  if (check.has(f) && (dead.length || trims.length)) checkFailed = true;
  if (apply.has(f) && (dead.length || trims.length)) {
    const comments = [];
    root.walkComments((c) => {
      const run = [];
      for (let n = c.next(); n && n.type !== 'comment'; n = n.next()) run.push(n);
      if (run.length && run.every((n) => n.__dead)) comments.push(c);
    });
    for (const c of comments) c.remove();
    for (const r of dead) r.remove();
    for (const [r, keep] of trims) r.selector = keep.join(',\n  ');
    for (let changed = true; changed; ) {
      changed = false;
      root.walkAtRules((a) => {
        if (
          /^(media|supports|layer|container)$/i.test(a.name) &&
          a.nodes?.every((n) => n.type === 'comment')
        ) {
          a.remove();
          changed = true;
        }
      });
    }
    writeFileSync(f, root.toString());
  }
}

if (args.includes('--report') || !args.length) {
  for (const r of report.filter((r) => r.dead || r.partial))
    console.log(
      `${r.file.padEnd(58)} ${String(r.bytes).padStart(7)} B  rules ${String(r.rules).padStart(4)}  dead ${String(r.dead).padStart(4)}  partial ${String(r.partial).padStart(3)}  dead bytes ${r.deadBytes}`
    );
  const t = report.reduce((a, r) => [a[0] + r.bytes, a[1] + r.deadBytes], [0, 0]);
  console.log(
    `total ${t[0]} B of shell CSS source, ${t[1]} B in dead rules (${cssFiles.length} files)`
  );
}

if (args.includes('--names')) {
  // where each still-styled `.st-*` class and each `--u-*` token is used (client source, non-test)
  const client = walk(join(STUDIO, 'client'), [], /\.(jsx?|tsx?|mjs|css)$/);
  const st = new Map();
  const u = new Map();
  for (const f of client) {
    const rel = relative(join(STUDIO, 'client'), f);
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/(?<![\w-])(st-[a-z][a-z0-9-]*)/g))
      (st.get(m[1]) ?? st.set(m[1], new Set()).get(m[1])).add(rel);
    for (const m of src.matchAll(/(--u-[a-z][a-z0-9-]*)/g))
      (u.get(m[1]) ?? u.set(m[1], new Set()).get(m[1])).add(rel);
  }
  console.log(
    JSON.stringify({
      st: Object.fromEntries([...st].map(([k, v]) => [k, [...v]])),
      u: Object.fromEntries([...u].map(([k, v]) => [k, [...v]])),
    })
  );
}
if (opt('--json')) writeFileSync(opt('--json'), JSON.stringify(report, null, 1));
process.exit(checkFailed ? 1 : 0);
