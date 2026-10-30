#!/usr/bin/env node
// scripts/v2-perf-home.mjs — Home's data path at Alligators scale (V2-8.14, V2-1.17 §5.11).
//
//   node scripts/v2-perf-home.mjs --index-dir <MAUDE_INDEX_DIR with the project's snapshot>
//                                 [--studio <apps/studio>] [--runs 30] [--json]
//
// Boots `maude-server --home` (a throwaway state dir, a stub claude, NO_OPEN=1) on an index dir a
// project server already filled, then times what Home reads: `GET /_home/index` (the Home merge —
// budget ≤ 150 ms for 20 projects; one project here, 20 × that is the derived figure), `GET
// /_home/search?q=…` (≤ 30 ms), and the first screen of covers `GET /_home/thumb/<key>` (the
// first 12, then all that exist) — the budget is "the first 12 in ≤ 3 s, the full pass ≤ 45 s".
// With --page it also loads Home's page in headless Chromium (a plain browser, so the page secret
// goes in sessionStorage as client/home/home-api.js documents) and reports the first paint of the
// shelves.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stubClaudeEnv } from './lib/stub-claude.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (k, d) => {
  const i = argv.indexOf(k);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const indexDir = resolve(opt('--index-dir', ''));
const studio = resolve(opt('--studio', join(HERE, '..', 'apps', 'studio')));
const RUNS = Number(opt('--runs', '30'));
const work = resolve(opt('--work', join(indexDir, '..', 'home-work')));
if (!opt('--index-dir', '')) {
  console.error('usage: v2-perf-home.mjs --index-dir <dir> [--studio <dir>] [--runs 30] [--page]');
  process.exit(2);
}
mkdirSync(work, { recursive: true });
const SECRET = 'cd'.repeat(32);
const TOKEN = 'ef'.repeat(32);
const info = join(work, 'shell', 'home.json');
const env = {
  ...process.env,
  HOME: work,
  XDG_CONFIG_HOME: join(work, '.config'),
  ...stubClaudeEnv(work),
  NO_OPEN: '1',
  // p8-orphan-sidecars — the server ends by itself if this script is SIGKILLed
  MAUDE_EXIT_WITH_PARENT: '1',
  MAUDE_NO_AUTOBUILD: '1',
  CLAUDE_PROJECT_DIR: work,
  MAUDE_HOME_STATE_DIR: work,
  MAUDE_INDEX_DIR: indexDir,
  MAUDE_HOME_TOKEN: TOKEN,
  MAUDE_HOME_PAGE_SECRET: SECRET,
  MAUDE_SHELL_INFO_FILE: info,
  MAUDE_CLOUD_URL: 'http://127.0.0.1:9',
};
const child = spawn('bun', ['run', join(studio, 'server.ts'), '--home'], {
  cwd: work,
  env,
  stdio: ['ignore', 'ignore', 'inherit'],
});
const stop = () => child.kill('SIGTERM');
process.on('exit', stop);
let rec = null;
for (let i = 0; i < 120 && !rec; i++) {
  await new Promise((r) => setTimeout(r, 250));
  if (existsSync(info)) {
    try {
      rec = JSON.parse(readFileSync(info, 'utf8'));
    } catch {}
  }
}
if (!rec) {
  console.error('home server never wrote its info file');
  process.exit(1);
}
const H = { 'x-maude-home': SECRET };
const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null;
};
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
async function timed(path) {
  const t = performance.now();
  const res = await fetch(`${rec.url}${path}`, { headers: H });
  const body = await res.arrayBuffer();
  return { ms: performance.now() - t, status: res.status, bytes: body.byteLength, body };
}
const out = { at: new Date().toISOString(), indexDir, runs: RUNS };
const pids = existsSync(join(indexDir, 'projects')) ? readdirSync(join(indexDir, 'projects')) : [];
const idxPath = `/_home/index?pids=${pids.join(',')}`;
const idx = [];
let sample = null;
for (let i = 0; i < RUNS; i++) {
  const r = await timed(idxPath);
  if (r.status !== 200) {
    out.indexStatus = r.status;
    break;
  }
  idx.push(r.ms);
  sample = r.body;
}
out.index = {
  coldMs: r1(idx[0]),
  p50: r1(pct(idx.slice(1), 0.5)),
  p95: r1(pct(idx.slice(1), 0.95)),
  budgetP95: 150,
  n: idx.length,
};
const keys = [];
try {
  const j = JSON.parse(Buffer.from(sample).toString('utf8'));
  for (const p of j.projects ?? [])
    for (const c of p.canvases ?? []) if (c.cover?.key) keys.push(`${p.pid}/${c.cover.key}`);
  out.index.bytes = sample.byteLength;
  out.index.projects = j.projects?.length ?? null;
  out.index.canvases = (j.projects ?? []).reduce((n, p) => n + (p.canvases?.length ?? 0), 0);
} catch {}
const search = [];
for (let i = 0; i < RUNS; i++)
  search.push(
    (
      await timed(
        `/_home/search?q=${encodeURIComponent(['combine', 'c1', 'kampan', 'ui web'][i % 4])}`
      )
    ).ms
  );
out.search = { p50: r1(pct(search, 0.5)), p95: r1(pct(search, 0.95)), budgetP95: 30 };
out.coverKeysFound = keys.length;
if (keys.length) {
  const t0 = performance.now();
  const first = [];
  for (const k of keys.slice(0, 12)) first.push((await timed(`/_home/thumb/${k}.jpg`)).status);
  out.covers12 = {
    ms: Math.round(performance.now() - t0),
    statuses: [...new Set(first)],
    budgetMs: 3000,
  };
}
if (argv.includes('--page')) {
  const req = createRequire(join(studio, 'package.json'));
  const { chromium } = req('playwright');
  const browser = await chromium.launch({
    executablePath: process.env.MAUDE_BROWSER_EXECUTABLE || undefined,
  });
  try {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
    });
    await ctx.addInitScript((s) => sessionStorage.setItem('maude-home-page-secret', s), SECRET);
    const times = [];
    const fcp = [];
    for (let i = 0; i < 5; i++) {
      const page = await ctx.newPage();
      const t = Date.now();
      await page.goto(rec.url, { waitUntil: 'domcontentloaded' });
      await page
        .waitForFunction(() => document.querySelectorAll('[data-testid]').length > 8, null, {
          timeout: 15000,
        })
        .catch(() => {});
      times.push(Date.now() - t);
      fcp.push(
        await page.evaluate(
          () => performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null
        )
      );
      out.shelfTestids = await page.evaluate(() =>
        [
          ...new Set(
            [...document.querySelectorAll('[data-testid]')].map((e) =>
              e.dataset.testid.replace(/[0-9a-f]{6,}/g, '*')
            )
          ),
        ].slice(0, 40)
      );
      await page.close();
    }
    out.page = {
      firstContentfulPaintMs: fcp,
      shelvesInDomMs: times,
      budgetMs: 300,
      note: 'domcontentloaded → shelves in the DOM; the page is a plain browser here',
    };
  } finally {
    await browser.close();
  }
}
stop();
console.log(JSON.stringify(out, null, 2));
process.exit(0);
