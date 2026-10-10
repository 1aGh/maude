// V2-2.4 — the v1 KEY characterization (V2-1.3 contract §7 row 3). Pins today's keyboard behaviour
// before the action registry replaces the listeners, and must stay byte-identical through every
// V2-2.4 step (the pure swap; the approved deltas move to Phase 4 — Q5).
//
// DOM-driven, both documents. It boots the SOURCE dev-server against a fixed fixture, drives a real
// Chromium with real key presses (playwright), and for every (setup, focus, key) case records what
// happened — not how:
//   · which document received the keydown, and whether its default was prevented;
//   · the `{dgn}` messages that crossed the frame boundary (shell → canvas and canvas → shell);
//   · the writes the page sent (non-GET requests);
//   · the structural change of each document (a line diff of a normalised DOM snapshot, plus the
//     focused element), summarised and hashed.
// Golden: apps/studio/test/characterization/v1/keys.txt. Any diff fails with the first differing
// case. Refresh deliberately with V1_KEYS_UPDATE=1, and only in Phase 4, or for a lead-approved
// transport-only delta (lane renames with identical keydown / writes / DOM), recorded in kg
// (decision:maude/v2-2.4-golden-transport-delta — V2-2.4 step 6's `key` / `run-action` lanes).
//
//   cd apps/studio && bun test test/characterization/v1-keys.test.ts
//     V1_KEYS_UPDATE=1   rewrite the golden
//     V1_KEYS_ONLY=<p>   only cases whose id starts with <p> (comma list; no golden check)
//     V1_KEYS_LANES=<n>  parallel servers (default 4)
//   Diagnostics (a body with any of these never matches the golden):
//     V1_KEYS_DUMP=1        list every hashed shell/canvas line, not only the salient ones
//     V1_KEYS_BODY_OUT=<f>  also write the whole body to <f>
//     V1_KEYS_LATE=1        re-snapshot the shell 1.5 s before the key and 2 s after it, and list
//                           any late change. It shifts the key's timing, so other cases can move
//                           too: use it to look for late DOM, not to compare against the golden.
//
// The server serves whatever apps/studio/dist/client.bundle.js holds: to test the SOURCE client,
// build it first (`MAUDE_SKIP_RUNTIME_BUILD=1 bun run build.ts --release`) and restore dist/ after.
// The canvas runtime and inspect.ts are always the source.

import { expect, test } from 'bun:test';
import { type ChildProcess, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
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
import { dirname, join } from 'node:path';

const STUDIO = join(import.meta.dir, '..', '..');
const GOLDEN = join(import.meta.dir, 'v1', 'keys.txt');
const UPDATE = process.env.V1_KEYS_UPDATE === '1';
const ONLY = process.env.V1_KEYS_ONLY ? process.env.V1_KEYS_ONLY.split(',') : null;
const LANES = Math.max(1, Number(process.env.V1_KEYS_LANES ?? 4));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── fixture ───────────────────────────────────────────────────────────────────────────────
const HOME_TSX = `import { DCArtboard, DCSection, DesignCanvas } from '@maude/canvas-lib';

export default function Home() {
  return (
    <DesignCanvas>
      <DCSection id="main" title="Home">
        <DCArtboard id="home-hero" label="Hero" width={800} height={500}>
          <main style={{ padding: 40, fontFamily: 'system-ui' }}>
            <h1 data-cd-id="home-hero-title">Hero</h1>
            <p data-cd-id="home-hero-body">Characterization fixture.</p>
            <input data-cd-id="home-hero-input" aria-label="Name" placeholder="Name" />
            <button data-cd-id="home-hero-cta" type="button">Get started</button>
          </main>
        </DCArtboard>
        <DCArtboard id="home-pricing" label="Pricing" width={800} height={500}>
          <main style={{ padding: 40, fontFamily: 'system-ui' }}>
            <h1 data-cd-id="home-pricing-title">Pricing</h1>
          </main>
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
`;

const FIXTURE: Record<string, string> = {
  '.design/config.json': `${JSON.stringify(
    {
      name: 'v1-keys',
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
  )}\n`,
  '.design/system/demo/colors_and_type.css':
    '.demo[data-theme="light"] { --bg-0: oklch(0.99 0 0); --fg-0: oklch(0.2 0 0); --accent: oklch(0.6 0.15 250); }\n' +
    '.demo[data-theme="dark"] { --bg-0: oklch(0.18 0 0); --fg-0: oklch(0.96 0 0); --accent: oklch(0.7 0.15 250); }\n',
  '.design/system/demo/README.md':
    '# demo\n\nA tiny design system for the v1 key characterization.\n',
  '.design/ui/Home.tsx': HOME_TSX,
};

function writeFixture(project: string) {
  for (const [rel, content] of Object.entries(FIXTURE)) {
    const p = join(project, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
  }
}

/** Put the project back to the fixture: drop every file the run wrote, rewrite the sources. */
function resetFixture(lane: Lane): boolean {
  // Touch only what a case changed: rewriting an unchanged source still fires the server's file
  // watcher, whose late canvas reload would land inside the NEXT case's window.
  let touched = false;
  const design = join(lane.project, '.design');
  for (const name of ['_history', '_canvas-state', '_comments', '_trash', '_state']) {
    const p = join(design, name);
    if (existsSync(p)) rmSync(p, { recursive: true, force: true });
  }
  const ui = join(design, 'ui');
  for (const name of readdirSync(ui))
    if (name !== 'Home.tsx') {
      rmSync(join(ui, name), { recursive: true, force: true });
      touched = true;
    }
  for (const [rel, content] of Object.entries(FIXTURE)) {
    const p = join(lane.project, rel);
    if (existsSync(p) && readFileSync(p, 'utf8') === content) continue;
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
    touched = true;
  }
  rmSync(join(lane.home, '.config', 'maude', 'prefs.json'), { force: true });
  return touched;
}

// ── servers (one per lane; cases are dealt to lanes round-robin, so the golden is stable) ──
interface Lane {
  n: number;
  work: string;
  project: string;
  home: string;
  server: ChildProcess;
  url: string;
  origin: string;
  log: string[];
}

async function bootLane(n: number, root: string, gen = 0): Promise<Lane> {
  const work = join(root, `lane-${n}-${gen}`);
  const project = join(work, 'project');
  const home = join(work, 'home');
  mkdirSync(join(home, '.config'), { recursive: true });
  writeFixture(project);
  const log: string[] = [];
  const server = spawn('bun', [join(STUDIO, 'server.ts'), '--root', project], {
    env: {
      ...process.env,
      HOME: home,
      XDG_CONFIG_HOME: join(home, '.config'),
      NO_OPEN: '1',
      MAUDE_NO_AUTOBUILD: '1',
      MAUDE_SYNC_IN_CI: '1',
      TZ: 'UTC',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout?.on('data', (d) => log.push(String(d)));
  server.stderr?.on('data', (d) => log.push(String(d)));
  let url = '';
  for (let waited = 0; waited < 60_000 && !url; waited += 300) {
    await sleep(300);
    if (server.exitCode !== null) break;
    const sj = join(project, '.design', '_server.json');
    if (!existsSync(sj)) continue;
    try {
      url = JSON.parse(readFileSync(sj, 'utf8')).url;
    } catch {
      /* mid-write */
    }
  }
  if (!url)
    throw new Error(`lane ${n}: the source dev-server never came up\n${log.join('').slice(-1500)}`);
  return { n, work, project, home, server, url, origin: new URL(url).origin, log };
}

// ── shells ────────────────────────────────────────────────────────────────────────────────
type ShellName = 'browser' | 'tauri' | 'viewer' | 'tauri-viewer';

const TAURI_STUB = `window.__TAURI__ = {
  core: { invoke: (cmd) => Promise.reject(new Error('v1-keys: ' + cmd)) },
  event: { listen: () => Promise.resolve(() => {}) },
  window: {}, path: {}, app: {},
};`;

// Recorder in EVERY frame (shell and canvas iframe): the dgn messages that arrive, and every
// keydown (read back after all listeners ran, for defaultPrevented).
const RECORDER = `(() => {
  if (window.__v1k) return;
  const rec = { msgs: [], keys: [] };
  window.__v1k = rec;
  const FIELDS = ['id', 'tool', 'op', 'mode', 'dir', 'frame', 'muted', 'loop', 'kind', 'on', 'open', 'visible'];
  const desc = (d) => {
    const parts = [String(d.dgn)];
    for (const f of FIELDS) {
      const v = d[f];
      if (v === undefined || v === null || typeof v === 'object') continue;
      parts.push(f + '=' + String(v).slice(0, 40));
    }
    return parts.join(' ');
  };
  window.addEventListener('message', (e) => {
    const d = e.data;
    if (!d || typeof d !== 'object' || typeof d.dgn !== 'string') return;
    const from = e.source === window ? 'self' : (window.parent !== window && e.source === window.parent) ? 'parent' : 'child';
    rec.msgs.push(from + ' ' + desc(d));
  }, true);
  window.addEventListener('keydown', (e) => { rec.keys.push(e); }, true);
})();`;

// The structural snapshot of one document, flat (one line per element; depth dropped so a moved
// wrapper does not drown the diff). Iframes / SVG / canvas insides are not descended into.
function fingerprintInPage(arg: { work: string }): string[] {
  const KEEP = [
    'data-testid',
    'role',
    'aria-label',
    'aria-pressed',
    'aria-expanded',
    'aria-selected',
    'aria-checked',
    'aria-current',
    'aria-disabled',
    'aria-hidden',
    'aria-modal',
    'data-tour',
    'data-path',
    'data-state',
    'data-active',
    'data-active-tool',
    'data-unseen',
    'data-busy',
    'title',
    'type',
    'placeholder',
    'disabled',
    'hidden',
    'checked',
    'href',
    'name',
    'tabindex',
  ];
  const norm = (s: string) =>
    String(s)
      .split(arg.work)
      .join('<work>')
      .replace(/https?:\/\/(127\.0\.0\.1|localhost|\[::1\]):\d+/g, '<origin>')
      .replace(/:\d{4,5}\b/g, ':<port>')
      .replace(/\b\d{1,2}:\d{2}(:\d{2})?\b/g, '<time>')
      .replace(
        /\b\d+\s*(s|sec|secs|seconds?|m|min|mins|minutes?|h|hrs?|hours?|d|days?)\s+ago\b/gi,
        '<ago>'
      )
      .replace(/\b(just now|a few seconds ago|a minute ago|an hour ago)\b/gi, '<ago>')
      .replace(/\bv?\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?\b/g, '<ver>')
      .replace(/\b20\d\d-\d\d-\d\d(T[\d:.]+Z?)?\b/g, '<date>')
      .replace(/\s+/g, ' ')
      .trim();
  const describe = (el: Element | null): string => {
    if (!el) return '(none)';
    const h = el as HTMLElement;
    const bits = [el.tagName.toLowerCase()];
    for (const a of ['data-testid', 'aria-label', 'type', 'placeholder', 'data-cd-id']) {
      const v = el.getAttribute(a);
      if (v) bits.push(`[${a}=${JSON.stringify(norm(v).slice(0, 60))}]`);
    }
    if (!bits[1] && h.className && typeof h.className === 'string')
      bits.push(`.${h.className.trim().split(/\s+/).sort().join('.')}`);
    return bits.join('');
  };
  const out: string[] = [];
  const walk = (el: Element) => {
    const tag = el.tagName.toLowerCase();
    if (tag === 'script' || tag === 'style' || tag === 'noscript') return;
    const parts = [tag];
    const cls = (el.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).sort();
    if (cls.length) parts.push(`.${cls.join('.')}`);
    for (const a of KEEP) {
      if (!el.hasAttribute(a)) continue;
      const v = el.getAttribute(a) ?? '';
      parts.push(v === '' ? `[${a}]` : `[${a}=${JSON.stringify(norm(v).slice(0, 80))}]`);
    }
    if (
      (tag === 'input' || tag === 'textarea' || tag === 'select') &&
      (el as HTMLInputElement).value
    )
      parts.push(`{value=${JSON.stringify(norm((el as HTMLInputElement).value).slice(0, 60))}}`);
    let text = '';
    for (const n of el.childNodes) if (n.nodeType === 3) text += n.nodeValue;
    text = norm(text);
    if (text) parts.push(JSON.stringify(text.slice(0, 120)));
    out.push(parts.join(' '));
    if (tag === 'svg' || tag === 'iframe' || tag === 'canvas' || tag === 'video') return;
    for (const c of el.children) walk(c);
  };
  if (document.body) walk(document.body);
  const world = document.querySelector('.dc-world') as HTMLElement | null;
  if (world) out.push(`@world ${world.style.transform || ''}`);
  out.push(`@focus ${describe(document.activeElement)}`);
  const html = document.documentElement;
  out.push(
    `@html ${[...html.attributes]
      .map((a) => `${a.name}=${norm(a.value).slice(0, 60)}`)
      .sort()
      .join(' ')}`
  );
  return out;
}

// ── the cases ─────────────────────────────────────────────────────────────────────────────
type Setup =
  | 'shell' // no canvas open
  | 'canvas' // Home open, focus stays in the shell
  | 'in-canvas' // Home open, focus inside the canvas iframe (browse tool, nothing selected)
  | 'in-canvas-text' // focus in an <input> inside the canvas
  | 'in-canvas-selected' // V, then click the hero title (element selected, focus in canvas)
  | 'timeline' // Home open, a video comp announced, Timeline open (⇧⌘T), focus in the shell
  | 'presenting'; // Home open, Presentation Mode on

type Focus =
  | 'chrome' // nothing focused (body)
  | 'text' // the tree's search field
  | 'select' // a <select> in the shell
  | 'range' // an <input type=range> in the shell
  | 'canvas'; // inside the canvas iframe (whatever the setup left focused there)

interface Case {
  id: string;
  shell: ShellName;
  setup: Setup;
  focus: Focus;
  keys: string;
}

const SHELL_KEYS = [
  'Meta+k',
  'Meta+Shift+K',
  'Meta+z',
  'Meta+Shift+Z',
  'Meta+y',
  'Meta+Shift+Y',
  'Meta+Shift+R',
  'Meta+r',
  'Meta+Shift+M',
  'Meta+Shift+G',
  'Meta+Shift+I',
  'Meta+Shift+A',
  'Meta+Shift+E',
  'Meta+Shift+H',
  'Meta+Comma',
  'Meta+Shift+T',
  'Slash',
  'Meta+Slash',
  'Meta+f',
  'Meta+Shift+F',
  't',
  'Shift+T',
  'h',
  's',
  'n',
  'Shift+Slash',
  'Meta+Shift+Slash',
  'F1',
  'Shift+F1',
  'Escape',
  'Backspace',
  'Delete',
  'Shift+Backspace',
  'Meta+Backspace',
  'Space',
  'ArrowRight',
  'Meta+b',
  'Meta+Equal',
  'c',
  'Digit0',
  'Meta+n',
  'Meta+c',
];

const CANVAS_KEYS = [
  'v',
  'Shift+V',
  'h',
  'c',
  'b',
  'i',
  'r',
  'o',
  'a',
  'n',
  't',
  'Shift+S',
  's',
  'e',
  'Escape',
  'Shift+Escape',
  'Meta+Escape',
  'Meta+z',
  'Meta+Shift+Z',
  'Meta+y',
  'Meta+Shift+Y',
  'Meta+k',
  'Meta+Shift+K',
  'Meta+r',
  'Meta+Shift+R',
  'Meta+Shift+I',
  'Meta+Shift+M',
  'Meta+Shift+E',
  'Meta+Shift+H',
  'Meta+Shift+T',
  'Meta+Shift+G',
  'Meta+Shift+A',
  'Meta+Comma',
  'Shift+Slash',
  'F1',
  'Slash',
  'Meta+f',
  'Meta+e',
  'Meta+0',
  'Meta+1',
  'Meta+Equal',
  'Meta+Minus',
  'Shift+P',
  'Meta+a',
  'Meta+d',
  'Meta+g',
  'Backspace',
  'ArrowLeft',
  'BracketRight',
  'Enter',
  'Tab',
];

const CANVAS_TEXT_KEYS = [
  'v',
  'h',
  'n',
  't',
  'Shift+S',
  'Escape',
  'Meta+z',
  'Meta+k',
  'Meta+r',
  'Meta+Shift+E',
  'Meta+Shift+I',
  'Meta+a',
  'Backspace',
  'ArrowLeft',
];

const SELECTED_KEYS = [
  'Escape',
  'ArrowLeft',
  'Shift+ArrowRight',
  'Meta+d',
  'Meta+Alt+c',
  'Backspace',
  'Enter',
  'Shift+Enter',
  'Tab',
  'Meta+a',
  'Meta+Shift+A',
  'Meta+z',
  'h',
];

const TIMELINE_KEYS = [
  'Space',
  'ArrowRight',
  'ArrowLeft',
  'Shift+ArrowRight',
  'Home',
  'End',
  'Period',
  'Comma',
  'Meta+z',
  'Meta+Shift+Z',
  'Meta+y',
  'Meta+b',
  'Escape',
  'Backspace',
  'c',
  'Digit0',
  'Meta+Equal',
  'Meta+Minus',
  't',
  'Meta+Shift+T',
];

function buildCases(): Case[] {
  const cases: Case[] = [];
  const add = (shell: ShellName, setup: Setup, focus: Focus, keys: string[]) => {
    for (const k of keys)
      cases.push({ id: `${shell}/${setup}/${focus} ${k}`, shell, setup, focus, keys: k });
  };
  add('browser', 'canvas', 'chrome', SHELL_KEYS);
  add('browser', 'canvas', 'text', SHELL_KEYS);
  add('browser', 'shell', 'chrome', [
    'Meta+z',
    'Meta+Shift+Z',
    'Meta+y',
    'Backspace',
    's',
    'Meta+r',
    'Meta+Shift+I',
  ]);
  add('browser', 'canvas', 'select', [
    't',
    'Shift+Slash',
    'Meta+z',
    'Backspace',
    'Escape',
    'Meta+k',
  ]);
  add('browser', 'canvas', 'range', [
    't',
    'Shift+Slash',
    'Meta+z',
    'Backspace',
    'Escape',
    'Meta+k',
  ]);
  add('browser', 'in-canvas', 'canvas', CANVAS_KEYS);
  add('browser', 'in-canvas-text', 'canvas', CANVAS_TEXT_KEYS);
  add('browser', 'in-canvas-selected', 'canvas', SELECTED_KEYS);
  add('browser', 'timeline', 'chrome', TIMELINE_KEYS);
  add('browser', 'timeline', 'text', [
    'Space',
    'ArrowRight',
    'Meta+z',
    'Meta+b',
    'Escape',
    'Backspace',
  ]);
  add('browser', 'timeline', 'select', ['Space', 'ArrowRight', 'Meta+z', 'Backspace']);
  add('browser', 'timeline', 'range', ['Space', 'ArrowRight', 'Meta+z', 'Backspace', 't']);
  add('browser', 'presenting', 'chrome', ['Escape', 'Shift+Escape', 't']);
  add('browser', 'presenting', 'text', ['Escape']);
  add('browser', 'presenting', 'canvas', ['Escape']);
  add('tauri', 'canvas', 'chrome', ['Meta+Shift+A', 'Meta+n', 'Meta+Comma']);
  add('tauri', 'canvas', 'text', ['Meta+Shift+A']);
  add('tauri', 'in-canvas', 'canvas', ['Meta+Shift+A', 'Meta+n']);
  add('viewer', 'canvas', 'chrome', ['Meta+Comma', 'Meta+z', 'n', 'Meta+Shift+E', 'Backspace']);
  add('viewer', 'in-canvas', 'canvas', ['c', 'b', 'n', 'v', 'Meta+z']);
  add('tauri-viewer', 'canvas', 'chrome', ['Meta+Shift+A', 'Meta+Comma']);
  return cases;
}

// ── driving one case ──────────────────────────────────────────────────────────────────────
type Browser = import('playwright').Browser;
type Page = import('playwright').Page;
type Frame = import('playwright').Frame;

// The studio's websocket keeps the network busy forever, so "networkidle" is useless here; a
// fixed pause plus `stable()` (two equal snapshots in a row) is what settles a step.
const settle = async (_page: Page, ms = 500) => {
  await sleep(ms);
};

function canvasFrame(page: Page, lane: Lane): Frame | null {
  for (const f of page.frames()) {
    if (f === page.mainFrame()) continue;
    try {
      const u = new URL(f.url());
      if (u.origin !== lane.origin && /canvas/.test(f.url())) return f;
    } catch {
      /* about:blank */
    }
  }
  return null;
}

async function openCanvas(page: Page) {
  // Sections and folders start closed; open them in bounded passes (same as the desktop e2e).
  const CLOSED =
    '[data-testid^="tree-section-"][aria-expanded="false"], [data-testid^="tree-folder-"][aria-expanded="false"]';
  for (let pass = 0; pass < 12; pass++) {
    const n = await page.evaluate((sel) => {
      const closed = Array.from(document.querySelectorAll(sel)) as HTMLElement[];
      for (const el of closed) el.click();
      return closed.length;
    }, CLOSED);
    if (!n) break;
    await sleep(200);
  }
  const row = page.locator('[data-testid="canvas-row-ui-home"]').first();
  await row.waitFor({ timeout: 15_000 });
  await row.click();
  await page.waitForFunction(
    () => !!document.querySelector('iframe[data-testid="canvas-frame"].active'),
    null,
    { timeout: 20_000 }
  );
}

async function waitCanvasReady(page: Page, lane: Lane): Promise<Frame> {
  for (let i = 0; i < 100; i++) {
    const f = canvasFrame(page, lane);
    if (f) {
      try {
        const ok = await f.evaluate(
          () => !!document.querySelector('[data-cd-id="home-hero-title"]')
        );
        if (ok) return f;
      } catch {
        /* navigating */
      }
    }
    await sleep(200);
  }
  throw new Error('the canvas never rendered the fixture');
}

const COMPS = [
  {
    id: 'comp-hero',
    fps: 30,
    durationInFrames: 90,
    width: 800,
    height: 500,
    artboardId: 'home-hero',
    artboardLabel: 'Hero',
  },
];

async function runSetup(page: Page, lane: Lane, c: Case): Promise<void> {
  if (c.setup === 'shell') return;
  await openCanvas(page);
  const frame = await waitCanvasReady(page, lane);
  await settle(page, 800);
  if (c.setup === 'in-canvas') {
    await frame.locator('[data-cd-id="home-hero-title"]').click({ timeout: 8000 });
  } else if (c.setup === 'in-canvas-text') {
    await frame.locator('[data-cd-id="home-hero-input"]').click({ timeout: 8000 });
  } else if (c.setup === 'in-canvas-selected') {
    await frame.locator('[data-cd-id="home-hero-body"]').click({ timeout: 8000 });
    await page.keyboard.press('v');
    await settle(page, 300);
    await frame.locator('[data-cd-id="home-hero-title"]').click({ timeout: 8000 });
  } else if (c.setup === 'timeline') {
    await frame.evaluate((comps) => {
      window.parent.postMessage({ dgn: 'timeline-comps', comps }, '*');
    }, COMPS);
    await settle(page, 300);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
    await page.keyboard.press('Meta+Shift+T');
    await page.waitForSelector('[data-testid="timeline-panel"]', { timeout: 8000 });
  } else if (c.setup === 'presenting') {
    await page.locator('[data-testid="menu-view"]').click();
    await page.locator('.st-dropdown [role="menuitem"]', { hasText: 'Presentation Mode' }).click();
    await page.waitForSelector('.st-present-exit', { timeout: 8000 });
  }
  await settle(page, 600);
}

async function placeFocus(page: Page, lane: Lane, c: Case): Promise<void> {
  if (c.focus === 'canvas') {
    if (c.setup === 'presenting') {
      const frame = canvasFrame(page, lane);
      await frame?.locator('[data-cd-id="home-hero-body"]').click({ timeout: 8000 });
    }
    return; // the setup put focus in the canvas
  }
  if (c.focus === 'chrome') {
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  } else if (c.focus === 'text') {
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="canvas-search"]') as HTMLElement | null;
      if (!el) throw new Error('no tree search field');
      el.focus();
    });
  } else if (c.focus === 'select' || c.focus === 'range') {
    // A neutral control outside React's tree: the v1 listeners read only its tag / type.
    await page.evaluate((kind) => {
      const el =
        kind === 'select' ? document.createElement('select') : document.createElement('input');
      if (kind === 'select') {
        for (const v of ['a', 'b']) {
          const o = document.createElement('option');
          o.value = v;
          o.textContent = v;
          el.appendChild(o);
        }
      } else (el as HTMLInputElement).type = 'range';
      el.setAttribute('data-v1k-probe', kind);
      el.style.cssText = 'position:fixed;left:2px;bottom:2px;width:40px;height:16px;z-index:0';
      document.body.appendChild(el);
      el.focus();
    }, c.focus);
  }
  await sleep(150);
}

interface DocSnap {
  lines: string[];
}

async function snapDoc(target: Page | Frame, lane: Lane): Promise<DocSnap | null> {
  try {
    return { lines: await target.evaluate(fingerprintInPage, { work: lane.work }) };
  } catch {
    return null;
  }
}

/** Snapshot until two in a row agree (≤ ~3 s) — async effects (a fetch, a timer) have landed. */
async function stable(target: Page | Frame, lane: Lane): Promise<DocSnap | null> {
  let prev = await snapDoc(target, lane);
  for (let i = 0; i < 12; i++) {
    await sleep(250);
    const next = await snapDoc(target, lane);
    if (next && prev && next.lines.join('\n') === prev.lines.join('\n')) return next;
    prev = next;
  }
  return prev;
}

function lineDiff(a: string[], b: string[]): { added: string[]; removed: string[] } {
  const count = new Map<string, number>();
  for (const l of a) count.set(l, (count.get(l) ?? 0) + 1);
  const added: string[] = [];
  for (const l of b) {
    const n = count.get(l) ?? 0;
    if (n > 0) count.set(l, n - 1);
    else added.push(l);
  }
  const removed: string[] = [];
  for (const [l, n] of count) for (let i = 0; i < n; i++) removed.push(l);
  return { added: added.sort(), removed: removed.sort() };
}

const SALIENT = /\[(data-testid|role|aria-|data-active-tool|data-state)|^@/;
function summarise(label: string, before: DocSnap | null, after: DocSnap | null): string[] {
  if (!before && !after) return [`  ${label}: (no document)`];
  if (!before || !after) return [`  ${label}: ${before ? 'document gone' : 'document appeared'}`];
  const { added, removed } = lineDiff(before.lines, after.lines);
  if (!added.length && !removed.length) return [`  ${label}: =`];
  const digest = createHash('sha256')
    .update(`${added.join('\n')}\n--\n${removed.join('\n')}`)
    .digest('hex')
    .slice(0, 10);
  const out = [`  ${label}: +${added.length} -${removed.length} #${digest}`];
  if (process.env.V1_KEYS_DUMP === '1') {
    for (const l of removed) out.push(`    DUMP- ${l}`);
    for (const l of added) out.push(`    DUMP+ ${l}`);
  }
  const pick = (ls: string[], sign: string) => {
    const sal = ls.filter((l) => SALIENT.test(l));
    for (const l of sal.slice(0, 8)) out.push(`    ${sign} ${l.slice(0, 160)}`);
    if (sal.length > 8) out.push(`    ${sign} … ${sal.length - 8} more`);
  };
  pick(removed, '-');
  pick(added, '+');
  return out;
}

async function readRec(target: Page | Frame | null): Promise<{ msgs: string[]; keys: string[] }> {
  if (!target) return { msgs: [], keys: [] };
  try {
    return await target.evaluate(() => {
      const r = (window as unknown as { __v1k?: { msgs: string[]; keys: KeyboardEvent[] } }).__v1k;
      if (!r) return { msgs: [], keys: [] };
      const keys = r.keys.map((e) => {
        const mods = `${e.ctrlKey ? '⌃' : ''}${e.altKey ? '⌥' : ''}${e.shiftKey ? '⇧' : ''}${e.metaKey ? '⌘' : ''}`;
        return `${mods}key=${JSON.stringify(e.key)} ${e.defaultPrevented ? 'PREVENTED' : 'default'}`;
      });
      return { msgs: r.msgs.slice(), keys };
    });
  } catch {
    return { msgs: [], keys: [] };
  }
}

async function msgCount(target: Page | Frame | null): Promise<number> {
  if (!target) return 0;
  try {
    return await target.evaluate(
      () => (window as unknown as { __v1k?: { msgs: unknown[] } }).__v1k?.msgs.length ?? 0
    );
  } catch {
    return -1;
  }
}

/** Wait until neither document has received a message for ~800 ms (≤ 8 s): the setup's own
 *  traffic (selection mirrors, layer trees, a late reload) must not land in the case's window. */
async function quiet(page: Page, frame: Frame | null) {
  let last = `${await msgCount(page)}/${await msgCount(frame)}`;
  let calm = 0;
  for (let i = 0; i < 20 && calm < 2; i++) {
    await sleep(400);
    const now = `${await msgCount(page)}/${await msgCount(frame)}`;
    calm = now === last ? calm + 1 : 0;
    last = now;
  }
}

async function clearRec(target: Page | Frame | null) {
  if (!target) return;
  try {
    await target.evaluate(() => {
      const r = (window as unknown as { __v1k?: { msgs: unknown[]; keys: unknown[] } }).__v1k;
      if (r) {
        r.msgs.length = 0;
        r.keys.length = 0;
      }
    });
  } catch {
    /* gone */
  }
}

// Messages that tick on their own (no key involved) and would make the record flaky. The selection
// mirror (select-set ⇄ select-by-id, layers-tree) echoes at its own pace; a selection a key changes
// still shows in the canvas DOM diff (the halo) and the shell's inspector.
const NOISE =
  /^(child|parent|self) (presence|cursor|camera|viewport-state|hover|perf|heartbeat|canvas-rects|select-set|select-by-id|layers-tree|request-layers)\b/;

async function runCase(browser: Browser, lane: Lane, c: Case): Promise<string> {
  if (resetFixture(lane)) await sleep(2500); // let the watcher fire before the page loads
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
    timezoneId: 'UTC',
    locale: 'en-US',
  });
  const writes: string[] = [];
  let recording = false;
  try {
    await context.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    // Pending What's New entries are dev-only and always unseen — v1 is the released feed
    // (same filter as scripts/check-v1-characterization.mjs).
    await context.route(`${lane.origin}/_api/whats-new`, async (route) => {
      const res = await route.fetch();
      const body = (await res.json()) as { entries?: Array<{ version?: string | null }> };
      const entries = (body.entries ?? []).filter((e) => e?.version != null);
      await route.fulfill({ response: res, json: { ...body, entries } });
    });
    if (c.shell === 'viewer' || c.shell === 'tauri-viewer') {
      await context.route(`${lane.origin}/_config`, async (route) => {
        const res = await route.fetch();
        const body = await res.json();
        await route.fulfill({ response: res, json: { ...body, readOnly: true } });
      });
    }
    await context.addInitScript(RECORDER);
    if (c.shell === 'tauri' || c.shell === 'tauri-viewer') await context.addInitScript(TAURI_STUB);
    context.on('request', (r) => {
      if (!recording) return;
      const m = r.method();
      if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return;
      try {
        const u = new URL(r.url());
        writes.push(`${m} ${u.origin === lane.origin ? '' : '(canvas)'}${u.pathname}`);
      } catch {
        writes.push(`${m} ?`);
      }
    });
    const page = await context.newPage();
    await page.goto(lane.url, { waitUntil: 'load', timeout: 60_000 });
    await page.waitForFunction(
      () => (document.getElementById('root')?.childElementCount ?? 0) > 0,
      null,
      {
        timeout: 30_000,
      }
    );
    await settle(page, 600);
    await stable(page, lane);
    await runSetup(page, lane, c);
    await placeFocus(page, lane, c);

    await quiet(page, canvasFrame(page, lane));
    const frame0 = canvasFrame(page, lane);
    const shellBefore = await stable(page, lane);
    const LATE: string[] = [];
    if (process.env.V1_KEYS_LATE === '1') {
      await sleep(1500);
      const again = await snapDoc(page, lane);
      if (again && shellBefore && again.lines.join('\n') !== shellBefore.lines.join('\n')) {
        const d = lineDiff(shellBefore.lines, again.lines);
        for (const l of d.removed) LATE.push(`    LATE-before- ${l}`);
        for (const l of d.added) LATE.push(`    LATE-before+ ${l}`);
      }
    }
    const canvasBefore = frame0 ? await stable(frame0, lane) : null;
    await clearRec(page);
    await clearRec(frame0);
    recording = true;
    await page.keyboard.press(c.keys);
    await settle(page, 400);
    // Let async effects land: wait until two snapshots in a row agree (bounded).
    const shellAfter = await stable(page, lane);
    if (process.env.V1_KEYS_LATE === '1') {
      await sleep(2000);
      const again = await snapDoc(page, lane);
      if (again && shellAfter && again.lines.join('\n') !== shellAfter.lines.join('\n')) {
        const d = lineDiff(shellAfter.lines, again.lines);
        for (const l of d.removed) LATE.push(`    LATE-after- ${l}`);
        for (const l of d.added) LATE.push(`    LATE-after+ ${l}`);
      }
    }
    const frame1 = canvasFrame(page, lane);
    const canvasAfter = frame1 ? await stable(frame1, lane) : null;
    recording = false;
    const shellRec = await readRec(page);
    const canvasRec = await readRec(frame1);

    const lines = [`## ${c.id}`];
    const events = [
      ...shellRec.keys.map((k) => `shell ${k}`),
      ...(frame1 === frame0 ? canvasRec.keys.map((k) => `canvas ${k}`) : []),
    ];
    lines.push(`  keydown: ${events.length ? events.join(' · ') : '(none)'}`);
    const toShell = shellRec.msgs.filter((m) => !m.startsWith('self ') && !NOISE.test(m));
    const toCanvas = canvasRec.msgs.filter((m) => m.startsWith('parent ') && !NOISE.test(m));
    lines.push(`  to-shell: ${toShell.length ? toShell.join(' · ') : '(none)'}`);
    lines.push(
      `  to-canvas: ${frame1 !== frame0 ? `(canvas reloaded) ${toCanvas.join(' · ')}`.trim() : toCanvas.length ? toCanvas.join(' · ') : '(none)'}`
    );
    lines.push(`  writes: ${writes.length ? [...new Set(writes)].sort().join(' · ') : '(none)'}`);
    lines.push(...summarise('shell', shellBefore, shellAfter));
    lines.push(...LATE);
    lines.push(
      ...(frame1 !== frame0 && frame0 && frame1
        ? ['  canvas: (reloaded)']
        : summarise('canvas', canvasBefore, canvasAfter))
    );
    return lines.join('\n');
  } finally {
    await context.close();
  }
}

// ── the test ──────────────────────────────────────────────────────────────────────────────
test(
  'v1 keys: every pinned (setup, focus, key) case behaves as the golden says',
  async () => {
    const require = createRequire(join(STUDIO, 'package.json'));
    const { chromium } = require('playwright') as typeof import('playwright');
    if (!existsSync(join(STUDIO, 'dist', 'client.bundle.js')))
      throw new Error('no dist/client.bundle.js — build the client first');
    const all = buildCases();
    const ids = new Set<string>();
    for (const c of all) {
      if (ids.has(c.id)) throw new Error(`duplicate case ${c.id}`);
      ids.add(c.id);
    }
    const cases = ONLY ? all.filter((c) => ONLY.some((p) => c.id.startsWith(p))) : all;
    const root = mkdtempSync(join(tmpdir(), 'maude-v1-keys-'));
    const lanes: Lane[] = [];
    const browser = await chromium.launch({ headless: true });
    try {
      for (let n = 0; n < Math.min(LANES, cases.length); n++) lanes.push(await bootLane(n, root));
      const LANE_COUNT = lanes.length;
      const results: string[] = new Array(cases.length);
      await Promise.all(
        lanes.map(async (first) => {
          let lane = first;
          let gen = 0;
          for (let i = first.n; i < cases.length; i += LANE_COUNT) {
            const c = cases[i];
            let text: string;
            try {
              text = await runCase(browser, lane, c);
            } catch (err) {
              text = `## ${c.id}\n  ERROR ${String(err).split('\n')[0]}`;
            }
            results[i] = text;
            // A case that wrote (a source edit, a camera PATCH) leaves the server's watchers and
            // caches mid-flight; the next case on this lane gets a fresh server and fixture, so a
            // late reload can never land inside its window.
            if (!/\n {2}writes: \(none\)/.test(text)) {
              lane.server.kill('SIGTERM');
              lane = await bootLane(first.n, root, ++gen);
              lanes.push(lane);
            }
          }
        })
      );
      const body = `# v1 key characterization — ${cases.length} cases (V2-2.4)\n${results.join('\n')}\n`;
      if (process.env.V1_KEYS_BODY_OUT) writeFileSync(process.env.V1_KEYS_BODY_OUT, body);
      if (UPDATE) {
        mkdirSync(dirname(GOLDEN), { recursive: true });
        writeFileSync(GOLDEN, body);
        console.log(`wrote ${GOLDEN} (${cases.length} cases)`);
        return;
      }
      if (ONLY) {
        console.log(body);
        return;
      }
      const golden = existsSync(GOLDEN) ? readFileSync(GOLDEN, 'utf8') : '';
      if (golden !== body) {
        const g = golden.split('\n');
        const b = body.split('\n');
        let i = 0;
        while (i < Math.max(g.length, b.length) && g[i] === b[i]) i++;
        let start = i;
        while (start > 0 && !g[start]?.startsWith('## ')) start--;
        console.log(
          `v1-keys: first difference at line ${i + 1}\n--- golden\n${g.slice(start, i + 8).join('\n')}\n+++ now\n${b.slice(start, i + 8).join('\n')}`
        );
        // V2-2.4 open item: this case's shell summary came out once (one capture run) with a
        // hash no later run reproduced (3 full runs and 5 lane replays matched the golden, no late
        // DOM change in any case, no observed line explains it). Name it, never pass it: a mismatch
        // stays red.
        const block = (lines: string[], id: string) => {
          const at = lines.indexOf(`## ${id}`);
          if (at < 0) return '';
          const end = lines.findIndex((l, k) => k > at && l.startsWith('## '));
          return lines.slice(at, end < 0 ? undefined : end).join('\n');
        };
        const META_D = 'browser/in-canvas-selected/canvas Meta+d';
        if (block(g, META_D) !== block(b, META_D))
          console.log(
            `v1-keys: ${META_D}: known one-off variant, rerun with V1_KEYS_DUMP=1 and attach the dump (V1_KEYS_BODY_OUT=<file> writes it)`
          );
      }
      expect(body).toBe(golden);
    } finally {
      await browser.close().catch(() => {});
      for (const lane of lanes) {
        try {
          lane.server.kill('SIGTERM');
        } catch {
          /* gone */
        }
      }
      await sleep(500);
      rmSync(root, { recursive: true, force: true });
    }
  },
  30 * 60_000
);
