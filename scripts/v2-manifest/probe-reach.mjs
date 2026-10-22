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
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { stubClaudeEnv } from '../lib/stub-claude.mjs';
import { ACP_SCRIPTS, acpOpenFrames, acpReplies } from './acp-stub.mjs';
import { OPENERS, PALETTE, resolveOpener, tid, WS_PUSH } from './openers.mjs';
import {
  ACTION_SURFACE,
  actionProbes,
  GOLDEN_SHELLS,
  HOOK_PROOFS,
  hookMatcher,
  hookProbes,
  PRESENCE_ONLY,
  PROBES,
  proofHolds,
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
// --no-run: boot nothing; turn the evidence given to --merge into reachability.json (the last step of a pass split
// over several lane holds, and a way to ask "what is still open" without a browser)
const NO_RUN = args.includes('--no-run');
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
const { migrateSvg } = await import(join(STUDIO, 'annotations/migrate-v1.ts'));
const { canonical, serializeBoard } = await import(join(STUDIO, 'annotations/schema.ts'));
const { keyBetween } = await import(join(STUDIO, 'annotations/fractional-index.ts'));
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
      subjects.targets.push({
        id: t,
        need: actionProbes(a, isVisible, TOOL_ROLES),
        action: a.id,
        hook: null,
      });
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
            <p data-cd-id="${id}-body" data-cd-link="https://cal.com/studio">Reachability fixture.</p>
            <div data-cd-id="${id}-grid" data-dc-element="Grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
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
// ── the annotations board the probe draws on Home ─────────────────────────────────────────────
function annotationsFixture() {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" data-mdcc-annotations="1">' +
    '<rect data-id="r1" data-tool="rect" stroke="#222" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" fill="#fff4d6" x="500" y="260" width="160" height="90"/>' +
    '<text data-id="t1" data-tool="text" data-anchor-id="r1" data-font-size="14" fill="#1a1a1a" text-anchor="middle" dominant-baseline="middle">needs work</text>' +
    '<g data-id="mr1" data-tool="mediaref" data-src="assets/ab12cd34.mp4" data-media-kind="video" data-title="b-roll.mp4"><rect x="500" y="20" width="240" height="120" rx="8" ry="8" fill="#ffffff" stroke="#d4d4d8" stroke-width="1"/><text x="548" y="80" font-size="13" fill="#18181b" dominant-baseline="hanging">b-roll.mp4</text></g>' +
    '<text data-id="t2" data-tool="text" x="520" y="400" data-font-size="14" fill="#1a1a1a">Standalone note</text>' +
    '<g data-id="a1" data-tool="arrow" stroke="#1a8f3e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" fill="none"><line x1="420" y1="300" x2="500" y2="300"/><polyline points="485.6,306.9 500,300 485.6,293.1" fill="#1a8f3e"/></g>' +
    '</svg>';
  const base = migrateSvg(svg).elements;
  const human = (name) => ({ kind: 'human', name });
  const extra = [
    {
      id: 'st1',
      type: 'sticky',
      index: 'a5',
      x: 700,
      y: 260,
      w: 150,
      h: 120,
      text: 'Make the hero bolder',
      fill: '#fff3a0',
      at: '2026-10-19T08:00:00Z',
      author: human('Ana'),
      // rides with the Hero artboard: selecting it outlines that board ("On Hero · moves with it")
      parentArtboard: 'home-hero',
    },
    { id: 'sc1', type: 'section', index: 'a6', x: 880, y: 330, w: 400, h: 150, label: 'Ideas' },
    {
      id: 'st2',
      type: 'sticky',
      parent: 'sc1',
      index: 'a0',
      x: 20,
      y: 30,
      w: 140,
      h: 110,
      text: 'Shorter headline',
      fill: '#ffd9d0',
    },
    {
      id: 'si1',
      type: 'image',
      index: 'a7',
      x: 1160,
      y: 60,
      w: 96,
      h: 96,
      href: '',
      alt: 'Done',
      sticker: { pack: 'project-status', id: 'done' },
      author: { kind: 'ai' },
    },
    ...[
      ['stp1', 'plus-one', 'Ana'],
      ['stp2', 'heart', 'Jonas'],
      ['stp3', 'check', 'Mia'],
    ].map(([id, kind, who], i) => ({
      id,
      type: 'stamp',
      index: `a${8 + i}`,
      x: 640 + i * 4,
      y: 250,
      w: 28,
      h: 28,
      kind,
      target: 'r1',
      author: human(who),
    })),
    {
      id: 'a2',
      type: 'arrow',
      index: 'a9',
      start: { x: 900, y: 420 },
      end: { x: 860, y: 520 },
      color: '#1a8f3e',
      label: 'Goes here',
    },
    {
      id: 'a3',
      type: 'arrow',
      index: 'aa',
      start: { x: 900, y: 460 },
      end: { x: 960, y: 520 },
      endHost: { ref: 'el:home-hero/gone-button', label: 'Book a call' },
    },
    {
      id: 'vt1',
      type: 'vote',
      index: 'ab',
      targets: ['ab:home-hero', 'ab:home-pricing'],
      title: 'Which direction',
      state: 'open',
      startedBy: 'Ana',
      startedAt: '2026-10-19T08:00:00Z',
    },
  ];
  // one z-order for the top level (keyBetween appends); a section's child keeps its own
  let prev = null;
  const all = [...base, ...extra];
  for (const e of all) if (!e.parent) e.index = prev = keyBetween(prev, null);
  return serializeBoard(all.map((e) => canonical(e)));
}

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
  // drawn annotations: the board (`.annotations.json`, DDR-242) — the v1 note card / label / arrow / media card the
  // old openers press (migrated from the legacy SVG so their ids stay), plus what wave A added: stickies (one in a
  // section), a gallery sticker the AI placed, stamps from three people, an arrow with words on it, an arrow bound to
  // an artboard, an arrow whose element is gone (the dangling card) and a vote that is open
  put('.design/ui-home.annotations.json', annotationsFixture());
  // a plain one-artboard canvas the 'welcome' opener opens. A new project starts EMPTY since S6.15 (Q10), so
  // this is a fixture of the probe's own, not scaffold-design.ts's.
  put(
    '.design/ui/Welcome.tsx',
    `import { DCArtboard, DCSection, DesignCanvas } from '@maude/canvas-lib';

export default function Welcome() {
  return (
    <DesignCanvas>
      <DCSection id="welcome" title="Welcome">
        <DCArtboard id="welcome" label="WELCOME/01" width={680} height={440}>
          <main style={{ padding: 32 }}>Welcome</main>
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
`
  );
  put(
    '.design/ui/Welcome.meta.json',
    `${JSON.stringify({ title: 'Welcome', layout: { artboards: [{ id: 'welcome', x: 0, y: 0 }] } }, null, 2)}\n`
  );
  put(
    '.design/ui/Flyer.tsx',
    `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';

export default function Flyer() {
  return (
    <DesignCanvas>
      <DCArtboard id="flyer" kind="print" label="Flyer" width={420} height={594}>
        <main style={{ padding: 40, fontFamily: 'system-ui' }}>
          <h1 data-cd-id="flyer-title">Flyer</h1>
        </main>
      </DCArtboard>
    </DesignCanvas>
  );
}
`
  );
  put('.design/ui/marketing/Landing.tsx', CANVAS('Landing', [['landing', 'Landing']]));
  // a video comp: two sequences of 1 850 frames = 3 700, past the 3 600-frame default cap (S7.18), so the Timeline draws
  // its long-video badge (a click on it opens Advanced); each sequence animates its title, so Advanced has keyframes.
  // The Timeline and its clip inspector
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
    <Sequence from={0} durationInFrames={1850}><Title /></Sequence>
    <Sequence from={1850} durationInFrames={1850}><Title /></Sequence>
  </AbsoluteFill>
);

export default function Reel() {
  return (
    <DesignCanvas>
      <DCArtboard id="reel" kind="video" label="Reel" width={1080} height={1920}>
        <VideoComp component={ReelCut} durationInFrames={3700} fps={30} width={1080} height={1920} />
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
      // S5.1b — the local kernel's machine stamp stays in the throwaway HOME, never the person's.
      MAUDE_MACHINE_FILE: join(home, '.config', 'maude', 'machine.json'),
      // never the machine's real `claude` (keychain dialog in a throwaway HOME): scripts/lib/stub-claude.mjs
      ...stubClaudeEnv(home),
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
function collectInFrame([css, presence]) {
  const shown = (el) => el.getClientRects().length > 0;
  const testids = new Set();
  for (const el of document.querySelectorAll('[data-testid]'))
    if (shown(el)) testids.add(el.getAttribute('data-testid'));
  // a host is mounted to own dialogs and draws no box: it counts when it is in the document
  for (const t of presence) if (document.querySelector(`[data-testid="${t}"]`)) testids.add(t);
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

const PNG_1X1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const TAURI_STUB = `window.__TAURI__ = {
  core: {
    invoke: (cmd) => {
      const answers = window.__PROBE_INVOKE__ || {};
      if (!(cmd in answers)) return Promise.reject(new Error('reachability probe: ' + cmd));
      const a = answers[cmd];
      return a && a.__reject ? Promise.reject(new Error(a.__reject)) : Promise.resolve(a);
    },
  },
  event: { listen: () => Promise.resolve(() => {}) },
  window: {}, path: {}, app: {},
};`;

// How long a click waits for its element. The element is usually there at once; on a busy machine (a full pass shares
// the lane with builds) the left panel can take seconds to mount, and a 2 s wait reads as "not reachable". A genuinely
// absent element costs this once per attempt.
const LOAD_MS = 8000;

async function runOpener(browser, srv, probe, opener) {
  const startedAt = Date.now();
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
      page.on('console', (m) => {
        // the shell's error boundary reports through console.error, not as a page error
        if (m.type() === 'error') console.log(`  [console ${opener.id}] ${m.text().slice(0, 500)}`);
      });
    if (process.env.PROBE_DEBUG)
      page.on('pageerror', (e) =>
        console.log(`  [pageerror ${opener.id}] ${String(e).slice(0, 300)}`)
      );
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    const world = resolveOpener(opener);
    const config = { ...probe.config, ...world.config };
    if (Object.keys(config).length)
      await page.route(`${srv.origin}/_config`, async (route) => {
        // under machine load the fixture server resets a connection now and then: ask again once, and when it still
        // fails abort the request (the opener then fails and is retried) instead of crashing the whole pass with an
        // unhandled rejection (the cloud pass died that way at load 30+)
        let res = null;
        for (let attempt = 0; attempt < 3 && !res; attempt++) {
          res = await route.fetch().catch(() => null);
          if (!res) await sleep(500);
        }
        if (!res) return route.abort().catch(() => {});
        const body = await res.json();
        await route.fulfill({ response: res, json: { ...body, ...config } }).catch(() => {});
      });
    for (const [path, json] of Object.entries(world.routes))
      await page.route(
        path.startsWith('re:') ? new RegExp(path.slice(3)) : `${srv.origin}${path}`,
        (route) => {
          if (json?.__hang) return undefined; // the request never answers (a slow start)
          if (json?.__abort) return route.abort();
          if (json?.__png)
            return route.fulfill({
              contentType: 'image/png',
              body: Buffer.from(PNG_1X1, 'base64'),
            });
          if (json?.__status) return route.fulfill({ status: json.__status, json });
          return route.fulfill({ json });
        }
      );
    // the studio's own WebSocket, passed through; a `push` step injects a frame the server would send
    const sockets = [];
    await page.routeWebSocket(/\/_ws(\?|$)/, (ws) => {
      const server = ws.connectToServer();
      ws.onMessage((m) => server.send(m));
      // a state that stubs an answer also drops the real server's own pushes of it (a `git-status` frame would
      // overwrite the stubbed repo with the fixture's, which has none)
      server.onMessage((m) => {
        if (world.dropFrames.length) {
          try {
            if (world.dropFrames.includes(JSON.parse(String(m)).type)) return;
          } catch {
            /* not JSON: pass it on */
          }
        }
        ws.send(m);
      });
      sockets.push(ws);
    });
    // the desktop chat's bridge, played from a script (acp-stub.mjs): the frames the server would send
    if (world.acp) {
      await page.routeWebSocket(/\/_ws\/acp/, (ws) => {
        let chat = 'probe-chat';
        for (const f of acpOpenFrames(ACP_SCRIPTS, world.acp)) ws.send(JSON.stringify(f));
        ws.onMessage((raw) => {
          let frame;
          try {
            frame = JSON.parse(String(raw));
          } catch {
            return;
          }
          if (typeof frame.chat === 'string') chat = frame.chat;
          for (const [i, f] of acpReplies(ACP_SCRIPTS, world.acp, frame, chat).entries())
            setTimeout(() => ws.send(JSON.stringify(f)), 60 * (i + 1));
        });
      });
    }
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
          const r = await f.evaluate(collectInFrame, [cssHooks, [...PRESENCE_ONLY]]);
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
        await row.evaluate((n) => n.click(), null, { timeout: LOAD_MS });
      }
      await sleep(2500);
    }
    await collect();
    let gesture = { x: 0, y: 0 };
    for (const step of opener.steps) {
      // `unless`: skip the step when that selector is already on screen (a fold the Mac remembers open)
      if (
        step.unless &&
        (await page
          .locator(step.unless)
          .first()
          .isVisible()
          .catch(() => false))
      )
        continue;
      if (step.ensureOpen) {
        // a fold toggle: click it only while it says aria-expanded="false" (absent or open: no-op), so a
        // fold the Mac remembers open is not shut again (S2.2 — the Inspector's › Advanced fold)
        const el = page.locator(step.ensureOpen).first();
        if (!(await el.isVisible().catch(() => false))) continue;
        if ((await el.getAttribute('aria-expanded').catch(() => null)) !== 'false') continue;
        try {
          await el.click({ timeout: 3000 });
        } catch {
          await el.evaluate((n) => n.click(), null, { timeout: LOAD_MS });
        }
      } else if (step.click) {
        const el = page.locator(step.click).first();
        if (step.optional && !(await el.isVisible().catch(() => false))) continue;
        try {
          await el.click({ timeout: LOAD_MS });
        } catch {
          // covered / animating: a DOM click reaches the same onClick
          await el.evaluate((n) => n.click(), null, { timeout: LOAD_MS });
        }
      } else if (step.key) {
        await page.locator('body').press(step.key);
      } else if (step.frameClick) {
        const fr = page.frameLocator(tid('canvas-frame'));
        const target = fr.locator(step.frameClick).first();
        if (step.optional)
          await target.waitFor({ state: 'visible', timeout: 6000 }).catch(() => {});
        if (step.optional && !(await target.isVisible().catch(() => false))) continue;
        await target.click({
          timeout: 10_000,
          modifiers: step.modifiers,
          position: step.at ? { x: step.at[0], y: step.at[1] } : undefined,
        });
      } else if (step.frameDom) {
        // a click dispatched on the element itself: a flyout that opens off the edge of the window (a submenu of a
        // menu opened low on the screen) is real UI that Playwright's own click refuses as "outside the viewport"
        const target = page.frameLocator(tid('canvas-frame')).locator(step.frameDom).first();
        if (step.optional) {
          await target.waitFor({ state: 'attached', timeout: 4000 }).catch(() => {});
          if (!(await target.count().catch(() => 0))) continue;
        }
        await target.evaluate((n) => n.click(), null, { timeout: 8000 });
      } else if (step.upload) {
        const [selector, name, text] = step.upload;
        await page
          .locator(selector)
          .first()
          .setInputFiles({
            name,
            mimeType: 'image/svg+xml',
            buffer: Buffer.from(text),
          });
      } else if (step.post) {
        const [path, body] = step.post;
        await page.evaluate(
          ([u, b]) =>
            fetch(u, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(b),
            }).then((r) => r.status),
          [path, body]
        );
      } else if (step.hover) {
        await page.locator(step.hover).first().hover({ timeout: 4000 });
      } else if (step.frameDown) {
        // press on an element in the canvas and keep the button down (the next steps move / release)
        const t = page.frameLocator(tid('canvas-frame')).locator(step.frameDown).first();
        await t.waitFor({ state: 'visible', timeout: 8000 });
        const b = await t.boundingBox();
        gesture = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
        await page.mouse.move(gesture.x, gesture.y);
        await page.mouse.down();
      } else if (step.mouseMove) {
        const [dx, dy] = step.mouseMove;
        for (let i = 1; i <= 8; i++) {
          await page.mouse.move(gesture.x + (dx * i) / 8, gesture.y + (dy * i) / 8);
          await sleep(30);
        }
        gesture = { x: gesture.x + dx, y: gesture.y + dy };
      } else if (step.mouseUp) {
        await page.mouse.up();
      } else if (step.frameHover) {
        // the pointer rests on an element in the canvas (a hover card, a stamp cluster's list)
        const target = page.frameLocator(tid('canvas-frame')).locator(step.frameHover).first();
        if (step.optional) {
          await target.waitFor({ state: 'visible', timeout: 6000 }).catch(() => {});
          if (!(await target.isVisible().catch(() => false))) continue;
        }
        await target.hover({ timeout: 8000 });
      } else if (step.wheelZoom) {
        // ⌃ + wheel over empty canvas below the boards (the viewport's own zoom gesture); + = out, − = in
        const box = await page.locator(tid('canvas-frame')).boundingBox();
        // left of centre: the first-run hint, the What's New toast and the mode hint stack in the middle of the
        // bottom edge (wave B), and a wheel over one of them never reaches the canvas
        await page.mouse.move(box.x + box.width * 0.12, box.y + box.height - 130);
        await page.keyboard.down('Control');
        for (let i = 0; i < 12; i++) {
          await page.mouse.wheel(0, step.wheelZoom / 12);
          await sleep(60);
        }
        await page.keyboard.up('Control');
      } else if (step.frameKey) {
        // a key pressed with the canvas window focused (the shell's own key handlers never see it)
        await page.evaluate(() =>
          document.querySelector('[data-testid="canvas-frame"]')?.contentWindow?.focus()
        );
        await page.keyboard.press(step.frameKey);
      } else if (step.frameMsg) {
        // what the shell tells the canvas it is showing (`vote-state`, `ai-seen`…): posted from the shell page to
        // the canvas window, so the canvas gate sees its real parent as the source. The messages carry no
        // privilege the shell's own relays do not.
        await page.evaluate((msg) => {
          const f = document.querySelector('[data-testid="canvas-frame"]');
          f?.contentWindow?.postMessage(msg, '*');
        }, step.frameMsg);
        await sleep(250);
      } else if (step.frameDblclick) {
        const target = page.frameLocator(tid('canvas-frame')).locator(step.frameDblclick).first();
        if (step.optional) {
          await target.waitFor({ state: 'visible', timeout: 6000 }).catch(() => {});
          if (!(await target.isVisible().catch(() => false))) continue;
        }
        await target.dblclick({ timeout: 10_000 });
      } else if (step.dblclick) {
        const el = page.locator(step.dblclick).first();
        if (step.optional && !(await el.isVisible().catch(() => false))) continue;
        await el.dblclick({ timeout: 4000 });
      } else if (step.waitFor) {
        // wait for a screen to draw (a stubbed answer on a busy machine takes longer than any fixed wait); soft, so an
        // absent hook is the finding, not a timeout
        await page
          .locator(step.waitFor)
          .first()
          .waitFor({ state: 'visible', timeout: step.timeout ?? 15_000 })
          .catch(() => {});
      } else if (step.wait) {
        await sleep(step.wait);
      } else if (step.frameContext) {
        // a right-click inside the canvas iframe: the canvas's own context menu
        const fr = page.frameLocator(tid('canvas-frame'));
        const target = fr.locator(step.frameContext).first();
        if (step.optional)
          await target.waitFor({ state: 'visible', timeout: 6000 }).catch(() => {});
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
    // PROBE_SHOT=<dir>: a screenshot of every opener once its steps are done (what the person would see)
    if (process.env.PROBE_SHOT) {
      mkdirSync(process.env.PROBE_SHOT, { recursive: true });
      await page.screenshot({ path: join(process.env.PROBE_SHOT, `${probe.id}-${opener.id}.png`) });
    }
    // PROBE_EVAL='<js expression>': print what it returns in the main frame once the steps are done (debugging)
    if (process.env.PROBE_EVAL)
      console.log(
        `  [eval ${opener.id}]`,
        JSON.stringify(await page.evaluate(process.env.PROBE_EVAL))
      );
    // PROBE_FRAME_EVAL: the same, in every other frame (the canvas runs in one)
    if (process.env.PROBE_FRAME_EVAL)
      for (const f of page.frames().filter((x) => x !== page.mainFrame())) {
        const r = await f.evaluate(process.env.PROBE_FRAME_EVAL).catch(() => null);
        if (r != null) console.log(`  [frame-eval ${opener.id}]`, JSON.stringify(r));
      }
  } catch (err) {
    ev.ok = false;
    if (process.env.PROBE_SHOT)
      await ctx
        .pages()[0]
        ?.screenshot({ path: join(process.env.PROBE_SHOT, `${probe.id}-${opener.id}-FAILED.png`) })
        .catch(() => {});
    if (process.env.PROBE_DEBUG)
      console.log(`  [error ${opener.id}] ${String(err?.message ?? err).slice(0, 900)}`);
    // the failing call's own words: what it waited for and what covered it (Playwright's call log)
    ev.err = String(err?.message ?? err)
      .split('\n')
      .filter((l) => l.trim())
      .slice(0, 24)
      .join(' | ')
      .slice(0, 2600);
  } finally {
    // Every opener opens a fresh page, but the studio keeps the selection a page made: the next page opened with that
    // element selected, the Inspector opened and the left panel shut, so `left-trash` (after `photo`) and
    // `left-hidden-files` (after the history openers) found no Canvases panel and `acp-turn` / `acp-elicit` no chat
    // field — the 12:57 pass lost ~40 hooks that way, and a longer wait or a retry could not help. An opener leaves
    // with nothing selected (Esc twice, after its last look at the page). PROBE_LEAVE_SELECTED=1 skips it (debugging).
    if (!process.env.PROBE_LEAVE_SELECTED) {
      const last = ctx.pages()[0];
      for (let i = 0; last && i < 2; i++) {
        await last.keyboard.press('Escape').catch(() => {});
        await sleep(250);
      }
    }
    await ctx.close();
    // PROBE_STATE=1: what the opener wrote under the fixture (project + home) — the state the next opener inherits
    if (process.env.PROBE_STATE) {
      const out = [];
      const walk = (d) => {
        for (const e of readdirSync(d, { withFileTypes: true })) {
          const p = join(d, e.name);
          if (e.isDirectory()) walk(p);
          else if (statSync(p).mtimeMs >= startedAt) out.push(p.slice(runDir.length + 1));
        }
      };
      walk(runDir);
      const mine = out.filter((p) => !/^home\/\.(claude|npm)|\.log$|\.key$|\.json\.backup/.test(p));
      console.log(`  [state ${opener.id}] ${mine.join(' ') || '(nothing written)'}`);
    }
    // an opener that moved the camera (it is remembered per canvas, per person: `_canvas-state/<slug>.view.json`)
    // gives it back, so the next opener finds the boards where every other opener expects them
    if (opener.resetCamera) {
      const dir = join(runDir, 'project/.design/_canvas-state');
      if (existsSync(dir))
        for (const f of readdirSync(dir).filter((n) => n.endsWith('.view.json')))
          rmSync(join(dir, f), { force: true });
    }
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
const srv = NO_RUN ? null : await bootServer();
// --serve: boot the fixture project, print its address and wait (a person or an agent opens it in a browser to see
// what an opener would press) — minutes, not a probe pass; Ctrl-C / SIGTERM ends it
if (args.includes('--serve') && srv) {
  console.log(`SERVE ${srv.url}`);
  await new Promise((done) => {
    process.on('SIGTERM', done);
    process.on('SIGINT', done);
    setTimeout(done, 25 * 60_000);
  });
  srv.server.kill('SIGTERM');
  restoreDist();
  process.exit(0);
}
const browser = NO_RUN ? null : await chromium.launch({ headless: true });
let evidence = {};
// A hold of the test lane is killed at --max, and a full pass takes longer than one hold: every opener's evidence is
// written the moment it is in (--evidence), so a killed run loses one opener, not the pass, and the next hold
// continues with --merge <that file>.
const flushEvidence = () => {
  if (!opt('--evidence')) return;
  const base = MERGE && existsSync(MERGE) ? JSON.parse(readFileSync(MERGE, 'utf8')) : {};
  for (const [p, byOpener] of Object.entries(evidence))
    base[p] = { ...(base[p] ?? {}), ...byOpener };
  writeFileSync(opt('--evidence'), JSON.stringify(base));
};
try {
  for (const probe of PROBES.filter((p) => !NO_RUN && (!ONLY || ONLY.includes(p.id)))) {
    evidence[probe.id] = {};
    const openers = (probe.query ? OPENERS.filter((o) => o.id === 'shell') : OPENERS)
      .filter((o) => !o.probes || o.probes.includes(probe.id))
      .filter((o) => !ONLY_OPENERS || ONLY_OPENERS.includes(o.id));
    for (const o of openers) {
      const t0 = Date.now();
      let ev = await runOpener(browser, srv, probe, o);
      // one more try for a failed opener: a timeout on a loaded machine is not evidence of an unreachable screen
      // (an opener that fails twice is a real finding). Keep the attempt that saw more.
      if (!ev.ok) {
        const again = await runOpener(browser, srv, probe, o);
        if (again.ok || again.testids.length > ev.testids.length) ev = again;
      }
      evidence[probe.id][o.id] = ev;
      flushEvidence();
      console.log(
        `${probe.id.padEnd(13)} ${o.id.padEnd(20)} ${ev.ok ? 'ok    ' : 'FAILED'} ${String(ev.testids.length).padStart(4)} hooks  ${Date.now() - t0} ms${ev.ok ? '' : `  ${ev.err}`}`
      );
    }
  }
} finally {
  await browser?.close();
  srv?.server.kill('SIGTERM');
  restoreDist();
  try {
    rmSync(runDir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}

if (MERGE) {
  const base = JSON.parse(readFileSync(MERGE, 'utf8'));
  for (const [p, byOpener] of Object.entries(evidence))
    base[p] = { ...(base[p] ?? {}), ...byOpener };
  evidence = base;
}
const readRepoText = (rel) =>
  existsSync(join(REPO, rel)) ? readFileSync(join(REPO, rel), 'utf8') : null;
const proofs = new Map(
  Object.entries(HOOK_PROOFS).map(([h, p]) => [h, { ...p, ok: proofHolds(h, p, readRepoText) }])
);
const doc = summarize({
  evidence,
  subjects,
  proofs,
  hooksByName,
  taken: new Date().toISOString(),
  bundle: `${BUILD ? 'rebuilt from source' : 'committed dist/client.bundle.js'}${MERGE ? ' (earlier run + re-run openers merged)' : ''}`,
});
if (!PARTIAL || args.includes('--write')) writeFileSync(OUT, `${JSON.stringify(doc, null, 2)}\n`);
flushEvidence();
const okRows = Object.values(doc.rows).filter((v) => v === true).length;
const okT = Object.values(doc.targets).filter((v) => v === true).length;
console.log(
  `reachability: rows ${okRows}/${Object.keys(doc.rows).length} · kept targets ${okT}/${Object.keys(doc.targets).length} → apps/studio/client/v2/reachability.json`
);
if (!existsSync(OUT)) process.exit(2);
if (PARTIAL && !args.includes('--write'))
  console.log('partial run: reachability.json NOT written (add --write)');
