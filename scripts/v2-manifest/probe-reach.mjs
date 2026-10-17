#!/usr/bin/env node
// Nothing-deleted reachability probe (Phase 4 gate; contract
// apps/studio/client/v2/contracts/V2-4-gate-nothing-deleted.md).
//
//   scripts/v2-test-lane.sh --wait 1800 -- node scripts/v2-manifest/probe-reach.mjs [--build] [--only desktop,browser]
//
// Boots the SOURCE dev-server once on a throwaway fixture project (NO_OPEN=1, MAUDE_NO_AUTOBUILD=1,
// throwaway HOME — never this repo's .design, which is linked to a hub), then for every probe (shell ×
// role, reach-rules.mjs PROBES) opens a fresh page per OPENER — a short data-driven path from boot
// (open the menu and every submenu, a Settings section, a Diagnostics view, a left-panel tab, ⌘K…) —
// and records every on-screen testid / data-tour / selector hook in the shell AND the canvas iframe
// after each step. For ⌘K it types each needed action's label and reads the result rows. The evidence
// goes through reach-rules.mjs `summarize` into apps/studio/client/v2/reachability.json, which
// scripts/check-v2-nothing-deleted.mjs reads.
//
//   --build   release-build the client from the current source first (dist/ restored afterwards);
//             default = the committed dist/client.bundle.js (what ships)
//   --only    comma-separated probe ids (the other probes then read as missing — a debugging aid)
//   --evidence <file>  also write the raw per-opener evidence there
// Exit 0 = written; 2 = could not run.

import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { OPENERS, PALETTE, resolveOpener, tid, WS_PUSH } from './openers.mjs';
import {
  ACTION_SURFACE,
  actionProbes,
  GOLDEN_SHELLS,
  hookMatcher,
  hookProbes,
  PROBES,
  rowProbes,
  summarize,
  toolRoles,
} from './reach-rules.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const STUDIO = join(REPO, 'apps/studio');
const OUT = join(STUDIO, 'client/v2/reachability.json');
const args = process.argv.slice(2);
const opt = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : null;
};
const ONLY = opt('--only')?.split(',') ?? null;
const ONLY_OPENERS = opt('--openers')?.split(',') ?? null;
// a partial run (some probes or some openers) only prints; --write lets it replace reachability.json
// --merge <evidence.json>: overlay this run's openers onto an earlier run's evidence (the file --evidence wrote), so a
// re-run of a few openers or probes refreshes reachability.json without a full ~45 min pass
const MERGE = opt('--merge');
const PARTIAL = Boolean(ONLY || ONLY_OPENERS) && !MERGE;
const BUILD = args.includes('--build');
const die = (m) => {
  console.error(`probe-reach: ${m}`);
  process.exit(2);
};

// ── openers + states: scripts/v2-manifest/openers.mjs (data) ───────────────────────────────

// ── inputs ─────────────────────────────────────────────────────────────────────────────────
const nd = JSON.parse(readFileSync(join(STUDIO, 'client/v2/nothing-deleted.json'), 'utf8'));
const hooks = JSON.parse(readFileSync(join(STUDIO, 'client/testids.json'), 'utf8'));
const hooksByName = new Map(hooks.map((h) => [h.hook, h]));
const { ACTIONS_BY_ID } = await import(join(STUDIO, 'actions/index.ts'));
const { isVisible } = await import(join(STUDIO, 'actions/resolve.ts'));
const { SETTINGS_ROWS } = await import(join(STUDIO, 'client/v2/settings/settings-model.js'));
const { MODE_TOOLS } = await import(join(STUDIO, 'bridge/canvas-modes.ts'));
const { slotActionId } = await import(join(STUDIO, 'actions/defs/tool.ts'));
const TOOL_ROLES = toolRoles(MODE_TOOLS, slotActionId);
const settingsLocal = new Set(SETTINGS_ROWS.filter((r) => r.nd && r.local).map((r) => r.nd));

// Where v1 showed each hook: the committed characterization goldens, one file per <shell>__<state>.
const v1Seen = new Map();
const GOLDEN = join(STUDIO, 'test/characterization/v1');
for (const f of readdirSync(GOLDEN).filter((n) => n.includes('__'))) {
  const probes = GOLDEN_SHELLS[f.split('__')[0]] ?? [];
  const txt = readFileSync(join(GOLDEN, f), 'utf8');
  for (const m of txt.matchAll(/\[data-testid="([^"]+)"\]/g))
    for (const h of hooks) {
      const mt = hookMatcher(h);
      if (!mt) continue;
      const hit = mt.testid
        ? mt.testid === m[1]
        : mt.testidRe
          ? new RegExp(mt.testidRe).test(m[1])
          : false;
      if (!hit) continue;
      if (!v1Seen.has(h.hook)) v1Seen.set(h.hook, new Set());
      for (const p of probes) v1Seen.get(h.hook).add(p);
    }
}

const live = nd.rows.filter((r) => !r.orphaned);
const subjects = {
  rows: live.map((r) => ({
    id: r.id,
    need: rowProbes(r, { settingsLocal, actions: ACTIONS_BY_ID, isVisible, toolRoles: TOOL_ROLES }),
    hook: r.v2?.testid ?? null,
    action: r.v2?.action ?? null,
  })),
  targets: [],
};
for (const t of [...new Set(Object.values(nd.map ?? {}))].filter((x) => x.includes(':')).sort()) {
  if (t.startsWith('action:')) {
    const a = ACTIONS_BY_ID.get(t.slice(7));
    if (a)
      subjects.targets.push({ id: t, need: actionProbes(a, isVisible, TOOL_ROLES), action: a.id, hook: null });
  } else
    subjects.targets.push({
      id: t,
      need: hookProbes(t.slice(7), v1Seen, TOOL_ROLES),
      hook: t.slice(7),
      action: null,
    });
}
const neededHooks = [
  ...new Set([
    ...[...subjects.rows, ...subjects.targets].map((s) => s.hook).filter(Boolean),
    ...Object.values(ACTION_SURFACE),
  ]),
];
// selector hooks are evaluated in the page; testid / data-tour hooks are matched from the dump
const cssHooks = neededHooks
  .map((h) => [h, hookMatcher(hooksByName.get(h) ?? h)])
  .filter(([, m]) => m?.css)
  .map(([h, m]) => [h, m.css]);
const neededActions = [
  ...new Set([...subjects.rows, ...subjects.targets].map((s) => s.action).filter(Boolean)),
]
  .map((id) => ACTIONS_BY_ID.get(id))
  .filter(Boolean);

// ── optional release build ───────────────────────────────────────────────────────────────
const distDirty = () =>
  spawnSync('git', ['status', '--porcelain', '--', 'apps/studio/dist/'], {
    cwd: REPO,
    encoding: 'utf8',
  }).stdout.trim();
if (BUILD) {
  if (distDirty()) die('apps/studio/dist/ is dirty — commit or restore it before --build.');
  const b = spawnSync('bun', ['run', 'build.ts', '--release'], {
    cwd: STUDIO,
    env: { ...process.env, MAUDE_SKIP_RUNTIME_BUILD: '1' },
    encoding: 'utf8',
  });
  if (b.status !== 0) die(`release build failed:\n${(b.stderr || b.stdout).slice(-1500)}`);
}
const restoreDist = () => {
  if (BUILD) spawnSync('git', ['checkout', '--', 'apps/studio/dist/'], { cwd: REPO });
};

// ── fixture + server ─────────────────────────────────────────────────────────────────────
const runDir = mkdtempSync(join(tmpdir(), 'maude-v2-reach-'));
const CANVAS = (
  name,
  boards
) => `import { DCArtboard, DCSection, DesignCanvas } from '@maude/canvas-lib';

export default function ${name}() {
  return (
    <DesignCanvas>
      <DCSection id="main" title="${name}">
${boards
  .map(
    ([id, label]) => `        <DCArtboard id="${id}" label="${label}" width={800} height={500}>
          <main style={{ padding: 40, fontFamily: 'system-ui' }}>
            <h1 data-cd-id="${id}-title">${label}</h1>
            <p data-cd-id="${id}-body">Reachability fixture.</p>
            <div data-cd-id="${id}-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <span>A</span>
              <span>B</span>
            </div>
            <img data-cd-id="${id}-photo" src="assets/ab12cd34.png" width={60} height={30} alt="" />
          </main>
        </DCArtboard>`
  )
  .join('\n')}
      </DCSection>
    </DesignCanvas>
  );
}
`;
function makeFixture(project) {
  const put = (rel, content) => {
    mkdirSync(dirname(join(project, rel)), { recursive: true });
    writeFileSync(join(project, rel), content);
  };
  put(
    '.design/config.json',
    `${JSON.stringify(
      {
        name: 'reachability',
        designRoot: '.design',
        rootClass: 'demo',
        canvasGroups: [
          { label: 'Design system', path: 'system' },
          { label: 'UI kit', path: 'ui' },
        ],
        designSystems: [
          {
            name: 'demo',
            path: 'system/demo',
            tokensCssRel: 'system/demo/colors_and_type.css',
            rootClass: 'demo',
            themeDefault: 'light',
            themes: ['light', 'dark'],
            newCanvasDir: 'ui',
          },
        ],
      },
      null,
      2
    )}\n`
  );
  put(
    '.design/system/demo/colors_and_type.css',
    '.demo { --bg-0: #fff; --fg-0: #111; --accent: #36c; }\n'
  );
  put('.design/system/demo/README.md', '# demo\n');
  // a content-addressed photo (assets/<8 hex>.<ext>): selecting it opens the Inspector's Photo tab
  mkdirSync(join(project, '.design/assets'), { recursive: true });
  writeFileSync(
    join(project, '.design/assets/ab12cd34.png'),
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64'
    )
  );
  put('.design/system/demo/preview/colors.tsx', CANVAS('Colors', [['colors', 'Colors']]));
  put(
    '.design/ui/Home.tsx',
    CANVAS('Home', [
      ['home-hero', 'Hero'],
      ['home-pricing', 'Pricing'],
    ])
  );
  // the sidecar the Layers panel reads its artboard count from (GET /_api/canvas-meta)
  put(
    '.design/ui/Home.meta.json',
    `${JSON.stringify({ artboards: [{ id: 'home-hero' }, { id: 'home-pricing' }] }, null, 2)}\n`
  );
  put('.design/ui/marketing/Landing.tsx', CANVAS('Landing', [['landing', 'Landing']]));
  // a video comp (two 20 s sequences = long, each animates its title): the Timeline and its clip inspector
  put(
    '.design/ui/Reel.tsx',
    `import { DCArtboard, DesignCanvas, VideoComp } from '@maude/canvas-lib';
import { AbsoluteFill, Sequence, interpolate, useCurrentFrame } from 'remotion';

const Title = () => {
  const frame = useCurrentFrame();
  const o = interpolate(frame, [0, 20], [0, 1]);
  return <h1 style={{ opacity: o }}>Reel</h1>;
};

const ReelCut = () => (
  <AbsoluteFill style={{ background: '#000' }}>
    <Sequence from={0} durationInFrames={600}><Title /></Sequence>
    <Sequence from={600} durationInFrames={600}><Title /></Sequence>
  </AbsoluteFill>
);

export default function Reel() {
  return (
    <DesignCanvas>
      <DCArtboard id="reel" kind="video" label="Reel" width={1080} height={1920}>
        <VideoComp component={ReelCut} durationInFrames={1200} fps={30} width={1080} height={1920} />
      </DCArtboard>
    </DesignCanvas>
  );
}
`
  );
}
async function bootServer() {
  const project = join(runDir, 'project');
  const home = join(runDir, 'home');
  mkdirSync(home, { recursive: true });
  makeFixture(project);
  const log = [];
  const server = spawn('bun', [join(STUDIO, 'server.ts'), '--root', project], {
    env: {
      ...process.env,
      HOME: home,
      XDG_CONFIG_HOME: join(home, '.config'),
      NO_OPEN: '1',
      MAUDE_NO_AUTOBUILD: '1',
      MAUDE_SYNC_IN_CI: '1',
      TZ: 'UTC',
      OLLAMA_HOST: '127.0.0.1:9',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (d) => log.push(String(d)));
  server.stderr.on('data', (d) => log.push(String(d)));
  let url = null;
  for (let waited = 0; waited < 45_000 && !url && server.exitCode === null; waited += 300) {
    await sleep(300);
    try {
      url = JSON.parse(readFileSync(join(project, '.design/_server.json'), 'utf8')).url;
    } catch {
      /* not yet */
    }
  }
  if (!url) {
    server.kill('SIGTERM');
    die(`the source dev-server never came up:\n${log.join('').slice(-1500)}`);
  }
  return { server, url, origin: new URL(url).origin };
}

// ── in-page collector (runs in every frame) ──────────────────────────────────────────────
function collectInFrame(css) {
  const shown = (el) => el.getClientRects().length > 0;
  const testids = new Set();
  for (const el of document.querySelectorAll('[data-testid]'))
    if (shown(el)) testids.add(el.getAttribute('data-testid'));
  const tours = new Set();
  for (const el of document.querySelectorAll('[data-tour]'))
    if (shown(el)) tours.add(el.getAttribute('data-tour'));
  const hit = [];
  for (const [hook, alts] of css)
    for (const a of alts) {
      try {
        if ([...document.querySelectorAll(a)].some(shown)) {
          hit.push(hook);
          break;
        }
      } catch {
        /* not a selector */
      }
    }
  return { testids: [...testids], tours: [...tours], css: hit };
}

const TAURI_STUB = `window.__TAURI__ = {
  core: {
    invoke: (cmd) =>
      cmd in (window.__PROBE_INVOKE__ || {})
        ? Promise.resolve(window.__PROBE_INVOKE__[cmd])
        : Promise.reject(new Error('reachability probe: ' + cmd)),
  },
  event: { listen: () => Promise.resolve(() => {}) },
  window: {}, path: {}, app: {},
};`;

async function runOpener(browser, srv, probe, opener) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'reduce',
    timezoneId: 'UTC',
    locale: 'en-US',
  });
  const ev = { ok: true, testids: new Set(), tours: new Set(), css: new Set(), palette: {} };
  try {
    const page = await ctx.newPage();
    if (process.env.PROBE_DEBUG)
      page.on('pageerror', (e) => console.log(`  [pageerror ${opener.id}] ${String(e).slice(0, 300)}`));
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    const world = resolveOpener(opener);
    const config = { ...probe.config, ...world.config };
    if (Object.keys(config).length)
      await page.route(`${srv.origin}/_config`, async (route) => {
        const res = await route.fetch();
        const body = await res.json();
        await route.fulfill({ response: res, json: { ...body, ...config } });
      });
    for (const [path, json] of Object.entries(world.routes))
      await page.route(`${srv.origin}${path}`, (route) => route.fulfill({ json }));
    // the studio's own WebSocket, passed through; a `push` step injects a frame the server would send
    const sockets = [];
    await page.routeWebSocket(/\/_ws(\?|$)/, (ws) => {
      const server = ws.connectToServer();
      ws.onMessage((m) => server.send(m));
      server.onMessage((m) => ws.send(m));
      sockets.push(ws);
    });
    if (probe.tauri) {
      await page.addInitScript(`window.__PROBE_INVOKE__ = ${JSON.stringify(world.invoke)};`);
      await page.addInitScript(TAURI_STUB);
    }
    const q = probe.query ? `${probe.query}&open=${encodeURIComponent('.design/ui/Home.tsx')}` : '';
    await page.goto(`${srv.url}${q}`, { waitUntil: 'load', timeout: 60_000 });
    await page.waitForFunction(
      () => (document.getElementById('root')?.childElementCount ?? 0) > 0,
      null,
      {
        timeout: 30_000,
      }
    );
    await sleep(1500);
    const collect = async () => {
      for (const f of page.frames()) {
        try {
          const r = await f.evaluate(collectInFrame, cssHooks);
          for (const t of r.testids) ev.testids.add(t);
          for (const t of r.tours) ev.tours.add(t);
          for (const t of r.css) ev.css.add(t);
        } catch {
          /* detached / not ready */
        }
      }
    };
    if (opener.canvas !== false && !probe.query) {
      // sections and folders start closed (same reveal as apps/desktop/e2e/helpers/tree.ts)
      for (let pass = 0; pass < 12; pass++) {
        const n = await page.evaluate(() => {
          const closed = document.querySelectorAll(
            '[data-testid^="tree-section-"][aria-expanded="false"], [data-testid^="tree-folder-"][aria-expanded="false"]'
          );
          for (const el of closed) el.click();
          return closed.length;
        });
        if (!n) break;
        await sleep(200);
      }
      const row = page.locator(tid('canvas-row-ui-home')).first();
      await row.waitFor({ timeout: 15_000 });
      try {
        await row.click({ timeout: 5000 });
      } catch {
        // a banner / dialog from the state under test covers the tree: a DOM click reaches the same onClick
        await row.evaluate((n) => n.click(), null, { timeout: 2000 });
      }
      await sleep(2500);
    }
    await collect();
    for (const step of opener.steps) {
      // `unless`: skip the step when that selector is already on screen (a fold the Mac remembers open)
      if (step.unless && (await page.locator(step.unless).first().isVisible().catch(() => false)))
        continue;
      if (step.click) {
        const el = page.locator(step.click).first();
        if (step.optional && !(await el.isVisible().catch(() => false))) continue;
        try {
          await el.click({ timeout: 3000 });
        } catch {
          // covered / animating: a DOM click reaches the same onClick
          await el.evaluate((n) => n.click(), null, { timeout: 2000 });
        }
      } else if (step.key) {
        await page.locator('body').press(step.key);
      } else if (step.frameClick) {
        const fr = page.frameLocator(tid('canvas-frame'));
        const target = fr.locator(step.frameClick).first();
        if (step.optional) await target.waitFor({ state: 'visible', timeout: 6000 }).catch(() => {});
        if (step.optional && !(await target.isVisible().catch(() => false))) continue;
        await target.click({ timeout: 10_000, modifiers: step.modifiers });
      } else if (step.dblclick) {
        const el = page.locator(step.dblclick).first();
        if (step.optional && !(await el.isVisible().catch(() => false))) continue;
        await el.dblclick({ timeout: 4000 });
      } else if (step.wait) {
        await sleep(step.wait);
      } else if (step.frameContext) {
        // a right-click inside the canvas iframe: the canvas's own context menu
        const fr = page.frameLocator(tid('canvas-frame'));
        const target = fr.locator(step.frameContext).first();
        if (step.optional) await target.waitFor({ state: 'visible', timeout: 6000 }).catch(() => {});
        if (step.optional && !(await target.isVisible().catch(() => false))) continue;
        await target.click({ button: 'right', timeout: 10_000 });
      } else if (step.expandMenu) {
        const subs = await page
          .locator('[data-testid^="project-menu-row-sub-"]')
          .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
        for (const s of subs) {
          await page.locator(tid(s)).first().click({ timeout: 3000 });
          await sleep(150);
          await collect();
          const nested = await page
            .locator(`${tid(s)} ~ [role=menu] [data-testid^="project-menu-row-sub-"]`)
            .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
          for (const n of nested) {
            await page.locator(tid(n)).first().click({ timeout: 3000 });
            await sleep(150);
            await collect();
          }
        }
      } else if (step.expand) {
        for (let pass = 0; pass < 3; pass++) {
          const n = await page.evaluate((root) => {
            const r = document.querySelector(root);
            if (!r) return 0;
            const closed = [...r.querySelectorAll('[aria-expanded="false"]')];
            for (const el of closed) el.click();
            return closed.length;
          }, step.expand);
          if (!n) break;
          await sleep(200);
          await collect();
        }
      } else if (step.push) {
        for (const ws of sockets) ws.send(JSON.stringify(WS_PUSH[step.push]));
      } else if (step.fill) {
        await page.locator(step.fill[0]).first().fill(step.fill[1], { timeout: 4000 });
      } else if (step.type) {
        await page.keyboard.type(step.type);
      } else if (step.run) {
        // ⌘K, then the one row for this action: `palette-row-action:<id>` (or `-tool:`)
        const a = ACTIONS_BY_ID.get(step.run);
        await page.locator('body').press(PALETTE.key);
        const input = page.locator(PALETTE.input).first();
        await input.waitFor({ timeout: 5000 });
        await input.fill(a.label);
        await sleep(200);
        const row = page
          .locator(`${tid(`palette-row-action:${a.id}`)}, ${tid(`palette-row-tool:${a.id}`)}`)
          .first();
        await row.click({ timeout: 4000 });
      } else if (step.palette) {
        await page.locator('body').press(PALETTE.key);
        const input = page.locator(PALETTE.input).first();
        await input.waitFor({ timeout: 5000 });
        await collect();
        for (const a of neededActions) {
          await input.fill(a.label);
          await sleep(120);
          const rows = await page
            .locator(PALETTE.rowTestid)
            .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
          const names = await page.locator(PALETTE.label).allInnerTexts();
          const want = a.label.toLowerCase();
          ev.palette[a.id] =
            rows.includes(`palette-row-action:${a.id}`) ||
            rows.includes(`palette-row-tool:${a.id}`) ||
            names.some((l) => l.trim().toLowerCase() === want);
        }
      }
      await sleep(400);
      await collect();
    }
  } catch (err) {
    ev.ok = false;
    ev.err = String(err?.message ?? err)
      .split('\n')[0]
      .slice(0, 160);
  } finally {
    await ctx.close();
  }
  return { ...ev, testids: [...ev.testids], tours: [...ev.tours], css: [...ev.css] };
}

// ── run ──────────────────────────────────────────────────────────────────────────────────
let chromium;
try {
  ({ chromium } = createRequire(join(STUDIO, 'package.json'))('playwright'));
} catch {
  restoreDist();
  die('playwright not installed in apps/studio — run `bun install` there first.');
}
const srv = await bootServer();
const browser = await chromium.launch({ headless: true });
let evidence = {};
try {
  for (const probe of PROBES.filter((p) => !ONLY || ONLY.includes(p.id))) {
    evidence[probe.id] = {};
    const openers = (probe.query ? OPENERS.filter((o) => o.id === 'shell') : OPENERS).filter(
      (o) => !ONLY_OPENERS || ONLY_OPENERS.includes(o.id)
    );
    for (const o of openers) {
      const t0 = Date.now();
      const ev = await runOpener(browser, srv, probe, o);
      evidence[probe.id][o.id] = ev;
      console.log(
        `${probe.id.padEnd(13)} ${o.id.padEnd(20)} ${ev.ok ? 'ok    ' : 'FAILED'} ${String(ev.testids.length).padStart(4)} hooks  ${Date.now() - t0} ms${ev.ok ? '' : `  ${ev.err}`}`
      );
    }
  }
} finally {
  await browser.close();
  srv.server.kill('SIGTERM');
  restoreDist();
  try {
    rmSync(runDir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}

if (MERGE) {
  const base = JSON.parse(readFileSync(MERGE, 'utf8'));
  for (const [p, byOpener] of Object.entries(evidence)) base[p] = { ...(base[p] ?? {}), ...byOpener };
  evidence = base;
}
const doc = summarize({
  evidence,
  subjects,
  hooksByName,
  taken: new Date().toISOString(),
  bundle: `${BUILD ? 'rebuilt from source' : 'committed dist/client.bundle.js'}${MERGE ? ' (earlier run + re-run openers merged)' : ''}`,
});
if (!PARTIAL || args.includes('--write')) writeFileSync(OUT, `${JSON.stringify(doc, null, 2)}\n`);
if (opt('--evidence')) writeFileSync(opt('--evidence'), JSON.stringify(evidence));
const okRows = Object.values(doc.rows).filter((v) => v === true).length;
const okT = Object.values(doc.targets).filter((v) => v === true).length;
console.log(
  `reachability: rows ${okRows}/${Object.keys(doc.rows).length} · kept targets ${okT}/${Object.keys(doc.targets).length} → apps/studio/client/v2/reachability.json`
);
if (!existsSync(OUT)) process.exit(2);
if (PARTIAL && !args.includes('--write')) console.log('partial run: reachability.json NOT written (add --write)');
