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
//   CRAWL_BUDGET_MIN=<n> per shell and mode (default 40); states past it are listed 'unreachable'
//   --replay <path>[|<path>…]  judge only the states on those paths (' › '-joined state names, the first is a
//                root name: 'shell', 'canvas Landing' …). Every path but the last is only walked (it sets the
//                fixture up, e.g. creates an artboard); the last path's state is judged. Reproduces one report row.
//   --resume <json>[,<json>…]  continue from earlier shards (their --json files): what they judged is a twin here,
//                the states they listed 'not reached' are walked to and crawled (and the child states those open),
//                until CRAWL_BUDGET_MIN. Run it on a clean tree of the same commit; the new --json merges with the old
//                ones (--merge drops a not-reached row once any shard entered that state).
//   --seed-shard <i>/<n>  with --resume: take every n-th seed (shallowest first) — n shards run side by side
//   --plant-dead the crawler's own red test: plants a no-op button in the shell, which must be DEAD (exit 1)
//   --plant-noise (with --plant-dead) also fires an unrelated status message every 200 ms in a far corner: the
//                 button must still be DEAD (an announcement counts only inside the control's own area)
//
// Run it through the lane: scripts/v2-test-lane.sh --wait 3600 --max 3600 -- node scripts/v2-verify/dead-controls.mjs
// Needs: apps/studio deps installed, the committed release bundle in apps/studio/dist (it boots with
// MAUDE_NO_AUTOBUILD=1 and never builds), playwright chromium.
//
// Exit 0 = no dead control and no error; 1 = dead controls or errors (the report lists them);
// 2 = the rig could not run.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { Crawler, tagErrorKind } from './dead-controls/crawl.mjs';
import { registryMenu } from './dead-controls/registry.mjs';
import { collapseTwins, renderReport, summarize } from './dead-controls/report.mjs';
import { mergeShards, planResume } from './dead-controls/resume.mjs';
import { bootRig, REPO, STUDIO } from './dead-controls/rig.mjs';

const argv = process.argv.slice(2);
const arg = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : d;
};
const MODES = arg('--mode', 'tauri,browser').split(',');
const ONLY = arg('--only', 'project,home').split(',');
const REPLAY = arg('--replay', null)?.split('|');
// --roots <name>[|<name>…]  crawl only the roots whose name starts with one of these (a shard); --merge <json>[,…]
// renders the report from shards' --json files instead of crawling
const ROOTS = arg('--roots', null)?.split('|');
const MERGE = arg('--merge', null)?.split(',');
const NOTE = arg('--note', null);
const RESUME = arg('--resume', null)?.split(',');
const SEED_SHARD = arg('--seed-shard', null)?.split('/').map(Number) ?? null;
if (SEED_SHARD && !(SEED_SHARD[0] >= 1 && SEED_SHARD[0] <= SEED_SHARD[1])) {
  console.error('dead-controls: --seed-shard wants <i>/<n> with 1 <= i <= n');
  process.exit(2);
}
const OUT = arg(
  '--out',
  // a replay judges a handful of states: never let it overwrite the full report
  REPLAY
    ? join(REPO, '.ai/plans/notes/v2-evidence/V2-8-dead-controls-replay.md')
    : join(REPO, '.ai/plans/notes/v2-evidence/V2-8-dead-controls-dynamic.md')
);
const JSON_OUT = arg('--json', null);

if (MERGE) {
  const parts = MERGE.map((f) => JSON.parse(readFileSync(f, 'utf8')));
  const merged = mergeShards(parts);
  merged.results = collapseTwins(merged.results);
  // shards that ran under older rules: the rig-only tags are applied again (a tagged error keeps its tag)
  merged.errors = merged.errors.map((e) => ({ ...e, kind: tagErrorKind(e.kind, e.text) }));
  merged.registry = parts.some((p) => p.registry?.length) ? registryMenu() : [];
  const modes = [...new Set(merged.results.map((r) => r.mode))];
  const minutes = parts.map((p) => p.minutes ?? '?').join(' + ');
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, renderReport(merged, { modes, minutes, note: NOTE }));
  const ms = summarize(merged.results, merged.errors);
  console.log(
    `merged ${parts.length} shards: ${ms.found} found · ${ms.clicked} clicked · ${ms.dead} DEAD · ${ms.errors} errors`
  );
  process.exit(ms.dead || ms.errors || ms.unpinned || ms.notReached ? 1 : 0);
}

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
// The rig has no hub, so the sync rows of Menu › Diagnostics › Advanced (Resync now, Download all) are hidden by
// `when` (`hiddenMenuIds`: no sync status → no Resync; no file plane → no Download all). This state hands the
// shell the status message a linked project's server broadcasts, then opens the menu to that fold. The clicks
// are real: they POST to the fixture server's own /_api/sync routes, which answer for an unlinked project.
const HUB_LINKED = `(() => {
  const msg = JSON.stringify({ type: 'sync:status', payload: { linked: true, state: 'online', docs: { synced: 3, total: 3 }, files: { state: 'idle' }, canvases: 3 } });
  for (const ws of window.__crawlSockets || []) ws.dispatchEvent(new MessageEvent('message', { data: msg }));
})()`;
const tid = (id, label) => ({
  kind: 'click',
  frame: 'shell',
  key: `tid:${id}`,
  occ: 0,
  label: label ?? id,
  wait: 900,
});
PROJECT_ROOTS.push({
  name: 'shell with a hub link',
  quiet: true,
  steps: [
    {
      kind: 'eval',
      frame: 'shell',
      name: 'hub-linked',
      script: HUB_LINKED,
      label: 'hub link status',
      wait: 1200,
    },
    tid('project-pill'),
    tid('project-menu-row-sub-diagnostics'),
    tid('project-menu-row-sub-advanced'),
  ],
});
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

const all = {
  results: [],
  errors: [],
  external: [],
  popups: [],
  unreachable: [],
  statesDone: [],
};
const PRIOR = RESUME?.map((f) => JSON.parse(readFileSync(f, 'utf8'))) ?? [];
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
  rig.snapshot();
  const runs = [];
  if (ONLY.includes('project'))
    runs.push({
      label: 'project',
      url: rig.projectUrl,
      ready: '[data-testid="project-pill"]',
      // a name ending in $ is that root only; otherwise it also takes the roots named '<name> › …'
      roots: ROOTS
        ? PROJECT_ROOTS.filter((r) =>
            ROOTS.some((x) =>
              x.endsWith('$')
                ? r.name === x.slice(0, -1)
                : r.name === x || r.name.startsWith(`${x} ›`)
            )
          )
        : PROJECT_ROOTS,
      secret: null,
    });
  if (ONLY.includes('home') && rig.homeUrl && !REPLAY && (!ROOTS || ROOTS.includes('home')))
    runs.push({
      label: 'home',
      url: rig.homeUrl,
      ready: '#root > *',
      roots: HOME_ROOTS,
      secret: rig.homeSecret,
    });
  if (ONLY.includes('home') && !rig.homeUrl && !REPLAY && (!ROOTS || ROOTS.includes('home')))
    all.unreachable.push({ mode, surface: 'home', why: 'Home server never wrote its info file' });
  for (const run of runs) {
    const c = new Crawler({
      browser,
      mode,
      url: run.url,
      homeSecret: run.secret,
      readySel: run.ready,
      label: run.label,
      reset: run.label === 'project' && !argv.includes('--no-reset') ? () => rig.reset() : null,
      plantDead: argv.includes('--plant-dead'),
      plantNoise: argv.includes('--plant-noise'),
      budgetMs: Number(process.env.CRAWL_BUDGET_MIN || 120) * 60_000,
      onResult: (r) =>
        (r.effect === 'DEAD' || process.env.CRAWL_VERBOSE) &&
        console.error(
          `  ${r.effect === 'DEAD' ? 'DEAD' : 'ok  '}  ${r.surface} · ${r.control} → ${r.effect.slice(0, 90)}`
        ),
    });
    await c.open();
    try {
      if (REPLAY) await c.runPaths(run.roots, REPLAY);
      else if (RESUME) {
        const plan = planResume(PRIOR, {
          mode,
          shell: run.label,
          shard: SEED_SHARD,
          accept: (surface) =>
            run.roots.some((r) => surface === r.name || surface.startsWith(`${r.name} › `)),
        });
        console.log(
          `[${mode}] ${run.label}: resuming ${plan.seeds.length} unreached states (${plan.judged.size} controls already judged)`
        );
        c.resume(plan);
        await c.runSeeds(run.roots, plan.seeds);
      } else await c.run(run.roots);
    } catch (e) {
      all.unreachable.push({
        mode,
        surface: run.label,
        why: `crawler crashed: ${String(e.stack || e).slice(0, 6000)}`,
      });
    }
    await c.close();
    for (const r of c.results) all.results.push({ shell: run.label, ...r });
    all.statesDone.push(...c.statesDone.map((d) => ({ shell: run.label, ...d })));
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

all.results = collapseTwins(all.results);
all.registry = ONLY.includes('project') ? registryMenu() : [];
all.minutes = ((Date.now() - t0) / 60000).toFixed(1);
const md = renderReport(all, { modes: MODES, minutes: all.minutes });
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, md);
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(all, null, 2));
const s = summarize(all.results, all.errors);
console.log(
  `\n${s.found} found · ${s.clicked} clicked · ${s.effect} effect · ${s.dead} DEAD · ${s.skipped} skipped-destructive · ${s.notReached} not reached · ${s.errors} errors`
);
console.log(`report: ${relative(process.cwd(), OUT)}`);
process.exit(s.dead || s.errors || s.unpinned || s.notReached ? 1 : 0);
