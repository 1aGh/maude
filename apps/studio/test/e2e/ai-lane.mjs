// P8 test round, G3 (AI-run states) - the lane the AI-state e2e files share.
//
// A real studio server on a throwaway project, a real canvas in headless Chromium, and a SCRIPTED fake ACP agent that
// runs the design plugin's real hook code (fixtures/hook-agent.mjs), so the run registry, leases, rings, holds,
// result cards and the working line are the real ones. No model is ever reached: the `claude` on PATH is a stub that
// answers "signed in" and nothing else (memory maude-fake-home-real-claude-keychain), the HOME/XDG are throwaways.
//
// A scenario does:   const lane = await startAiLane({ files })      // project + server
//                    const ui = await lane.open('ui/Landing.tsx')   // page, canvas frame, AI panel helpers
//                    lane.script([ ...steps ])                      // what the NEXT prompt does (see hook-agent.mjs)
//                    await ui.ask('A calm landing page')            // the real composer, Enter
//                    ...assert the mid-run state...  lane.gate('g1')  // let the agent go on
//
// Nothing here is a shared product helper; it lives next to the browser e2e files (harness.mjs is the annotation lane).

import { spawn } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const STUDIO_DIR = resolve(process.env.STUDIO_DIR ?? join(HERE, '..', '..'));
const REPO = resolve(STUDIO_DIR, '..', '..');
const require = createRequire(join(STUDIO_DIR, 'package.json'));
const { chromium } = require('playwright');

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll `fn` until it returns something truthy (returns it) or `ms` pass (throws `what`). */
let DIAG = null;
export async function until(fn, what, ms = 20_000, every = 100) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < ms) {
    try {
      last = await fn();
      if (last) return last;
    } catch {
      /* the page is mid-navigation: try again */
    }
    await sleep(every);
  }
  let extra = '';
  try {
    if (DIAG) extra = `\n--- state ---\n${await DIAG()}`;
  } catch {
    /* no state to print */
  }
  throw new Error(`timed out (${ms} ms) waiting for: ${what}${extra}`);
}

async function freePort() {
  return new Promise((res) => {
    const s = createServer();
    s.listen(0, () => {
      const { port } = s.address();
      s.close(() => res(port));
    });
  });
}

/** What a window looks like to the shell when it runs inside the desktop app: the pieces the AI panel asks for. */
const TAURI_STUB = `window.__TAURI__ = { core: { invoke: async (cmd, args) => { (window.__invokes = window.__invokes || []).push([cmd, args]); return null; } }, event: { listen: async () => () => {} } };`;

/** One landing artboard's source (Desktop 1440 - Tablet 834 - Mobile 390), the way the first-draft order writes it. */
export function landingBoard(id, { dark = false, footer = false } = {}) {
  const [label, w, h, fs] = {
    desktop: ['Desktop', 1440, 900, 56],
    tablet: ['Tablet', 834, 900, 36],
    mobile: ['Mobile', 390, 844, 36],
  }[id];
  const d = dark && id === 'desktop';
  return `        <DCArtboard id="${id}" label="${label}" kind="web" width={${w}} height={${h}}>
          <div data-cd-id="${id}-page" style={{ padding: 48, fontFamily: "system-ui, sans-serif", background: "${d ? '#14181d' : '#fff'}", color: "${d ? '#f2efe6' : '#111'}", minHeight: ${h} }}>
            <h1 data-cd-id="${id}-headline" style={{ margin: "0 0 12px", fontSize: ${fs} }}>Calm software, made in Brno</h1>
            <p data-cd-id="${id}-lede" style={{ margin: "0 0 24px" }}>A small studio for calm, careful software.</p>
            <button data-cd-id="${id}-cta" type="button" style={{ padding: "12px 20px" }}>Book a call</button>${footer ? `\n            <footer data-cd-id="${id}-footer" style={{ marginTop: 40 }}>Studio site - Brno</footer>` : ''}
          </div>
        </DCArtboard>
`;
}

/** The anchor a model's small Edit inserts a new artboard before. */
export const SECTION_END = '      </DCSection>';

/** A canvas of the first `drawn` landing artboards (1..3). */
export function landingSource({ drawn = 3, dark = false, footer = false } = {}) {
  const all = ['desktop', 'tablet', 'mobile']
    .slice(0, drawn)
    .map((id) => landingBoard(id, { dark, footer }));
  return `import { DCArtboard, DCSection, DesignCanvas } from "@maude/canvas-lib";

export default function Landing() {
  return (
    <DesignCanvas>
      <DCSection id="landing" title="Landing page" subtitle="First draft">
${all.join('')}${SECTION_END}
    </DesignCanvas>
  );
}
`;
}

/** A canvas with no artboard yet (the blank one a new canvas starts as). */
export const BLANK = `import { DesignCanvas } from "@maude/canvas-lib";
export default function Blank() {
  return <DesignCanvas>{null}</DesignCanvas>;
}
`;

/**
 * Boot a lane. `files` maps a project-relative path to its text (`.design/ui/Landing.tsx`, ...). Returns the lane.
 */
export async function startAiLane({ files = {}, name = 'Studio site', prefs = {} } = {}) {
  const scratch = mkdtempSync(join(tmpdir(), 'maude-ai-e2e-'));
  const project = join(scratch, 'project');
  const gates = join(scratch, 'gates');
  const home = join(scratch, 'home');
  const bin = join(scratch, 'bin');
  mkdirSync(join(project, '.design', 'ui'), { recursive: true });
  mkdirSync(gates, { recursive: true });
  mkdirSync(join(home, 'xdg', 'maude'), { recursive: true });
  mkdirSync(bin, { recursive: true });
  writeFileSync(
    join(project, '.design', 'config.json'),
    JSON.stringify({ name, formatVersion: 2 })
  );
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(project, rel)), { recursive: true });
    writeFileSync(join(project, rel), text);
  }
  // a throwaway config home (never ~/.config/maude) with the What's New toast already seen
  writeFileSync(
    join(home, 'xdg', 'maude', 'prefs.json'),
    JSON.stringify({ whatsNewSeen: '99.0.0', ...prefs })
  );
  // the signed-in `claude` stub, first on PATH AND pinned: nothing reaches the person's real CLI or keychain
  const stub = join(bin, 'claude');
  copyFileSync(join(REPO, 'apps/desktop/e2e/fixtures/fake-acp/claude-stub.sh'), stub);
  chmodSync(stub, 0o755);

  const scriptFile = join(scratch, 'agent-script.json');
  const sdk = join(STUDIO_DIR, 'node_modules/@agentclientprotocol/sdk/dist/acp.js');
  if (!existsSync(sdk)) throw new Error(`missing ${sdk} (run \`bun install\` in apps/studio)`);
  const port = await freePort();
  const env = {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: join(home, 'xdg'),
    PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`,
    NO_OPEN: '1',
    MAUDE_NO_AUTOBUILD: '1',
    MAUDE_MACHINE_FILE: join(scratch, 'machine.json'),
    MAUDE_CLAUDE_BIN: stub,
    MAUDE_ACP_ADAPTER_ENTRY: join(HERE, 'fixtures', 'hook-agent.mjs'),
    MAUDE_ACP_RUNTIME: process.execPath.endsWith('bun')
      ? process.execPath
      : (process.env.BUN_BIN ?? 'bun'),
    FAKE_ACP_SDK: sdk,
    HOOK_AGENT_SCRIPT: scriptFile,
    HOOK_AGENT_GATES: gates,
    ...(process.env.MAUDE_E2E_ENV_JSON ? JSON.parse(process.env.MAUDE_E2E_ENV_JSON) : {}),
  };
  const proc = spawn(
    'bun',
    ['run', join(STUDIO_DIR, 'server.ts'), '--root', project, '--port', String(port)],
    {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  let log = '';
  proc.stdout.on('data', (d) => (log += d));
  proc.stderr.on('data', (d) => (log += d));
  const t0 = Date.now();
  let up = false;
  while (Date.now() - t0 < 40_000) {
    try {
      const r = await fetch(`http://localhost:${port}/`);
      if (r.ok) {
        up = true;
        break;
      }
    } catch {
      /* not yet */
    }
    await sleep(200);
  }
  if (!up) throw new Error(`studio server did not start:\n${log.slice(-2000)}`);

  const pages = [];
  const lane = {
    port,
    project,
    scratch,
    log: () => log,
    /** A project file's text. */
    read: (rel) => readFileSync(join(project, rel), 'utf8'),
    write: (rel, text) => {
      mkdirSync(dirname(join(project, rel)), { recursive: true });
      writeFileSync(join(project, rel), text);
    },
    /** What the NEXT prompt does (see fixtures/hook-agent.mjs). */
    script: (steps) => writeFileSync(scriptFile, JSON.stringify({ steps })),
    /** Let a `gate` step go on. */
    gate: (n) => writeFileSync(join(gates, n), ''),
    /** Open the studio on a canvas (project-relative to .design, e.g. `ui/Landing.tsx`). */
    open: (rel, opts = {}) => openStudio(lane, rel, opts, pages),
    async stop() {
      for (const p of pages) await p.browser.close().catch(() => {});
      proc.kill('SIGTERM');
    },
  };
  return lane;
}

/** A page on the studio, with the helpers every AI-state scenario needs. */
async function openStudio(lane, rel, { w = 1600, h = 1000, theme = 'dark', ls = {} } = {}, pages) {
  const browser = await chromium.launch({ headless: process.env.E2E_HEADED !== '1' });
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: theme });
  await ctx.addInitScript(TAURI_STUB);
  const store = {
    'mdcc-theme': theme,
    'mdcc-usage-tour-seen': '1',
    'mdcc-collab-tour-seen': '1',
    'mdcc-whatsnew-seen': '99.0.0',
    'maude-mode-hint-seen': '1',
    ...ls,
  };
  await ctx.addInitScript(
    `try{const s=${JSON.stringify(store)};for(const k in s)localStorage.setItem(k,s[k]);}catch(e){}`
  );
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://localhost:${lane.port}/${rel ? `?open=${rel}` : ''}`, {
    waitUntil: 'domcontentloaded',
  });
  const shotDir = process.env.E2E_SHOTS ?? join(tmpdir(), 'maude-ai-e2e-shots');
  mkdirSync(shotDir, { recursive: true });
  const tid = (id) => page.locator(`[data-testid="${id}"]`);
  const ui = {
    page,
    browser,
    errors,
    tid,
    /** The canvas iframe's frame (re-resolved: a file change reloads it). */
    frame: () => page.frames().find((f) => f.url().includes('_canvas-shell')) ?? null,
    inFrame: async (fn, arg) => {
      const f = ui.frame();
      return f ? f.evaluate(fn, arg) : null;
    },
    fid: (id) => page.frameLocator('[data-testid="canvas-frame"]').locator(`[data-testid="${id}"]`),
    /** Wait for the canvas to mount its artboards. */
    async ready(minArtboards = 0) {
      await until(
        async () =>
          (await ui.inFrame(() => document.querySelectorAll('[data-dc-screen]').length)) >=
            minArtboards && (await ui.inFrame(() => !!document.querySelector('.dc-world'))),
        'the canvas to mount',
        40_000
      );
      await sleep(600);
    },
    /** Fit everything into view: a double-click on empty canvas (the frame's bottom-left corner) is the shell's fit(). */
    async fit() {
      const b = await tid('canvas-frame').boundingBox();
      await page.mouse.dblclick(b.x + 12, b.y + b.height - 12);
      await sleep(700);
    },
    /**
     * A page point ON the stroke of the longest svg path/line under `selector` (its midpoint by length, mapped through
     * the element's screen matrix and the canvas frame's box) - the bounding-box centre of a curve is often off it.
     */
    async strokePoint(selector) {
      const local = await ui.inFrame((sel) => {
        let best = null;
        for (const p of document.querySelectorAll(sel)) {
          if (typeof p.getTotalLength !== 'function') continue;
          const len = p.getTotalLength();
          if (!best || len > best.len) best = { p, len };
        }
        if (!best) return null;
        const pt = best.p.getPointAtLength(best.len / 2);
        const m = best.p.getScreenCTM();
        return {
          x: m.a * pt.x + m.c * pt.y + m.e,
          y: m.b * pt.x + m.d * pt.y + m.f,
          len: best.len,
        };
      }, selector);
      if (!local) return null;
      const fb = await tid('canvas-frame').boundingBox();
      return { x: fb.x + local.x, y: fb.y + local.y, len: local.len };
    },
    artboards: async () =>
      (await ui.inFrame(() =>
        [...document.querySelectorAll('[data-dc-screen]')].map((e) =>
          e.getAttribute('data-dc-screen')
        )
      )) ?? [],
    /** Open the AI panel (the spark in the corner) if its composer is not on screen. */
    async openAi() {
      if (!(await tid('chat-composer').locator(':visible').count())) {
        await tid('panel-icon-assistant').click();
      }
      await until(
        () => tid('chat-composer').locator(':visible').count(),
        'the AI composer',
        15_000
      );
    },
    /** Type into the real composer and send. */
    async ask(text) {
      await ui.openAi();
      const input = page.locator('[data-testid="chat-composer"] .chat-input:visible').last();
      await input.click();
      await page.keyboard.type(text);
      await sleep(150);
      await page.keyboard.press('Enter');
    },
    /** A screenshot into the evidence folder. */
    async shot(name) {
      const p = join(shotDir, `${name}.png`);
      mkdirSync(dirname(p), { recursive: true });
      await page.screenshot({ path: p });
      return p;
    },
  };
  // what a timed-out wait prints: the registry's runs, every ring / hold / scope outline on the canvas, the panel's words
  ui.snap = async () => {
    const runs = await fetch(`http://localhost:${lane.port}/_api/ai/runs`)
      .then((r) => r.text())
      .catch(() => '');
    const frame = await ui
      .inFrame(() =>
        [...document.querySelectorAll('[data-testid^="ai-ring-"],[data-testid^="edit-ai-"]')].map(
          (e) => [e.getAttribute('data-testid'), e.getAttribute('data-state') || '', e.textContent]
        )
      )
      .catch(() => null);
    const panel = await page
      .locator('[data-testid="ai-chat-island"]')
      .first()
      .innerText()
      .catch(() => '');
    const layer = await ui
      .inFrame(() =>
        [...document.querySelectorAll('.dc-annot-scene [data-id]')].map((e) => [
          e.getAttribute('data-id'),
          e.getAttribute('data-type'),
          e.getAttribute('data-author') || '',
        ])
      )
      .catch(() => null);
    const verbs = readdirSync(join(lane.scratch, 'gates'))
      .filter((f) => f.startsWith('maude-'))
      .map((f) => readFileSync(join(lane.scratch, 'gates', f), 'utf8').slice(0, 700))
      .join('\n');
    return `verbs: ${verbs}\nruns: ${runs.slice(0, 1800)}\nframe: ${JSON.stringify(frame)}\nlayer: ${JSON.stringify(layer)}\npanel: ${JSON.stringify(panel.slice(0, 900))}\nerrors: ${errors.join(' | ').slice(0, 300)}`;
  };
  DIAG = ui.snap;
  /** A visible `data-testid` (the AI panel keeps one hidden feed per chat). */
  ui.vis = (id) => page.locator(`[data-testid="${id}"]:visible`);
  pages.push(ui);
  return ui;
}
