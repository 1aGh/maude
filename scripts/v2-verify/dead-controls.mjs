#!/usr/bin/env node
// dead-controls.mjs — the DYNAMIC dead-control sweep (V2-8, before the merge).
//
// Boots the SOURCE studio on a throwaway fixture project (canvases with artboards, a design system,
// assets, comments) and the SOURCE Home server on a throwaway index holding that project, then
// walks both shells headless and clicks every reachable control — once with a Tauri global
// injected (desktop-shell parity, like check-client-boots-source) and once without (browser
// shell). Each click is judged by its visible effect (DOM change above the idle noise floor,
// aria state, URL, a new menu/sheet/toast, a studio request, a focus move, window.open, a native
// invoke); none of them = DEAD. Console errors, page errors, unhandled rejections and failed
// studio requests are collected with the control that triggered them.
//
//   node scripts/v2-verify/dead-controls.mjs                 # both modes, both shells
//   node scripts/v2-verify/dead-controls.mjs --mode browser  # one mode
//   node scripts/v2-verify/dead-controls.mjs --only home     # one shell (home | project)
//   --out <md>   the report (default .ai/plans/notes/v2-evidence/V2-8-dead-controls-dynamic.md)
//   --json <f>   the raw rows
//   --plant-dead the crawler's own red test: plants a no-op button in the shell, which must be DEAD (exit 1)
//
// Run it through the lane: scripts/v2-test-lane.sh --wait 3600 --max 3600 -- node scripts/v2-verify/dead-controls.mjs
// Needs: apps/studio deps installed, the committed release bundle in apps/studio/dist (it boots with
// MAUDE_NO_AUTOBUILD=1 and never builds), playwright chromium.
//
// Exit 0 = no dead control and no error; 1 = dead controls or errors (the report lists them);
// 2 = the rig could not run.

import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { Crawler } from './dead-controls/crawl.mjs';
import { registryMenu } from './dead-controls/registry.mjs';
import { renderReport, summarize } from './dead-controls/report.mjs';
import { bootRig, REPO, STUDIO } from './dead-controls/rig.mjs';

const argv = process.argv.slice(2);
const arg = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : d;
};
const MODES = arg('--mode', 'tauri,browser').split(',');
const ONLY = arg('--only', 'project,home').split(',');
const OUT = arg('--out', join(REPO, '.ai/plans/notes/v2-evidence/V2-8-dead-controls-dynamic.md'));
const JSON_OUT = arg('--json', null);

const require = createRequire(join(STUDIO, 'package.json'));
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('dead-controls: playwright is not installed in apps/studio');
  process.exit(2);
}

const canvas = (slug) => ({
  kind: 'click',
  frame: 'shell',
  key: `tid:canvas-row-${slug}`,
  occ: 0,
  label: `open ${slug}`,
  wait: 2500,
});
const PROJECT_ROOTS = [
  { name: 'shell', steps: [] },
  { name: 'canvas Landing', steps: [canvas('ui-landing')] },
  {
    name: 'canvas Landing › element selected',
    steps: [
      canvas('ui-landing'),
      { kind: 'select', frame: 'canvas', selector: '#hero-title', label: 'select #hero-title' },
    ],
  },
  {
    name: 'canvas Landing › ⌘K',
    steps: [canvas('ui-landing'), { kind: 'key', key: 'Meta+k', label: '⌘K' }],
  },
  {
    name: 'canvas Landing › ? sheet',
    steps: [canvas('ui-landing'), { kind: 'key', key: 'Shift+Slash', label: '?' }],
  },
  { name: 'canvas Smoke', steps: [canvas('ui-smoke')] },
  { name: 'canvas Video', steps: [canvas('ui-video')] },
];
const HOME_ROOTS = [{ name: 'home', steps: [] }];

async function seed(browser, url) {
  // comments on two canvases, through the shell's own origin
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'load' });
  const r = await page.evaluate(async () => {
    const out = [];
    for (const [file, text] of [
      ['.design/ui/Landing.tsx', 'Crawl fixture: tighten the hero copy'],
      ['.design/ui/Smoke.tsx', 'Crawl fixture: second thread'],
    ]) {
      const res = await fetch('/_api/comments/op', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ op: 'add', file, text, selector: 'h1' }),
      });
      out.push(res.status);
    }
    return out;
  });
  await ctx.close();
  return r;
}

const all = { results: [], errors: [], external: [], popups: [], unreachable: [] };
const t0 = Date.now();
let browser;
try {
  browser = await chromium.launch({ headless: true });
} catch (e) {
  console.error(`dead-controls: chromium missing — ${String(e).split('\n')[0]}`);
  process.exit(2);
}

async function crawlMode(mode, i) {
  let rig;
  try {
    rig = await bootRig({ portBase: Number(process.env.MAUDE_PORT_BASE || 48499) + i * 20 });
  } catch (e) {
    all.unreachable.push({ mode, surface: 'rig', why: e.message.slice(0, 600) });
    all.rigFailed = true;
    return;
  }
  console.log(`[${mode}] project ${rig.projectUrl}  home ${rig.homeUrl}`);
  const seeded = await seed(browser, rig.projectUrl).catch((e) => [String(e)]);
  console.log(`[${mode}] seeded comments: ${seeded.join(',')}`);
  const runs = [];
  if (ONLY.includes('project'))
    runs.push({
      label: 'project',
      url: rig.projectUrl,
      ready: '[data-testid="project-pill"]',
      roots: PROJECT_ROOTS,
      secret: null,
    });
  if (ONLY.includes('home') && rig.homeUrl)
    runs.push({
      label: 'home',
      url: rig.homeUrl,
      ready: '#root > *',
      roots: HOME_ROOTS,
      secret: rig.homeSecret,
    });
  if (ONLY.includes('home') && !rig.homeUrl)
    all.unreachable.push({ mode, surface: 'home', why: 'Home server never wrote its info file' });
  for (const run of runs) {
    const c = new Crawler({
      browser,
      mode,
      url: run.url,
      homeSecret: run.secret,
      readySel: run.ready,
      label: run.label,
      plantDead: argv.includes('--plant-dead'),
      budgetMs: Number(process.env.CRAWL_BUDGET_MIN || 20) * 60_000,
      onResult: (r) => r.effect === 'DEAD' && console.error(`  DEAD  ${r.surface} · ${r.control}`),
    });
    await c.open();
    try {
      await c.run(run.roots);
    } catch (e) {
      all.unreachable.push({
        mode,
        surface: run.label,
        why: `crawler crashed: ${String(e.stack || e).slice(0, 400)}`,
      });
    }
    await c.close();
    for (const r of c.results) all.results.push({ shell: run.label, ...r });
    all.errors.push(...c.errors.map((e) => ({ shell: run.label, ...e })));
    all.external.push(...c.external.map((e) => ({ shell: run.label, mode, ...e })));
    all.popups.push(...c.popups.map((e) => ({ shell: run.label, mode, ...e })));
    const s = summarize(c.results, c.errors);
    console.log(
      `[${mode}] ${run.label}: ${s.clicked} clicked · ${s.effect} effect · ${s.dead} dead · ${s.skipped} skipped · ${s.errors} errors`
    );
  }
  await rig.stop();
}
// the two modes run side by side (own rig, own fixture, own ports) — half the wall time
await Promise.all(
  MODES.map((m, i) => new Promise((r) => setTimeout(r, i * 4000)).then(() => crawlMode(m, i)))
);
await browser.close();
if (all.rigFailed && !all.results.length) {
  console.error(
    `dead-controls: the rig could not run — ${all.unreachable.map((u) => u.why).join('; ')}`
  );
  process.exit(2);
}

all.registry = ONLY.includes('project') ? registryMenu() : [];
const md = renderReport(all, { modes: MODES, minutes: ((Date.now() - t0) / 60000).toFixed(1) });
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, md);
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(all, null, 2));
const s = summarize(all.results, all.errors);
console.log(
  `\n${s.found} found · ${s.clicked} clicked · ${s.effect} effect · ${s.dead} DEAD · ${s.skipped} skipped-destructive · ${s.errors} errors`
);
console.log(`report: ${relative(process.cwd(), OUT)}`);
process.exit(s.dead || s.errors ? 1 : 0);
