import { createHash } from 'node:crypto';
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from '@playwright/test';
import { $, browser } from '@wdio/globals';
// @ts-expect-error — a plain .mjs data module shared with the runner; it has
// no types of its own and needs none: the shape is asserted by
// `scripts/dev/sync-e2e/surface-requirements.test.mjs`.
import { unresolvedRequirements } from '../../../../scripts/dev/sync-e2e/surface-requirements.mjs';
import { isNativeShell } from '../helpers/native';
import { waitForSidecar } from '../helpers/sidecar';

const runPath = process.env.MAUDE_SURFACE_CONFIG;
if (!runPath) throw new Error('Missing isolated surface configuration');
const run = JSON.parse(readFileSync(runPath, 'utf8'));
const rows: Array<Record<string, unknown>> = [];
let notesSidecar = 'ui-surfacemedia.annotations.svg';
let currentCase: Record<string, unknown> | null = null;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const selector = (id: string) => `[data-testid="${id}"]`;
const slug = (s: string) => s.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
type ProbeResult = {
  text: string | null;
  color?: string;
  visible: boolean;
  width?: number;
  height?: number;
  /** An <img>: decoded and ready (HTMLImageElement.complete). */
  complete?: boolean;
  /** The element's outerHTML, bounded. */
  markup?: string | null;
  pixel?: number[];
  time?: number;
  seeking?: boolean;
  /** A <video>: how much of it the element can actually play (HTMLMediaElement.readyState).
   *  The probe has always returned it; the type did not say so, which made the
   *  one oracle that reads it a type error that happened to work. */
  readyState?: number;
  error?: string;
  href?: string;
  matches?: Array<{ id: string | null; tool: string | null }>;
  rect?: { x: number; y: number; width: number; height: number };
  /** The canvas's own WORLD geometry for this node, when it draws one.
   *  `rect` is screen space and the canvas fits its content to the viewport,
   *  so a document that grew can render the same width. */
  worldRect?: { x: number; y: number; width: number; height: number };
};
type ProbeArgument =
  | number
  | string
  | null
  | {
      x?: number;
      y?: number;
      dx?: number;
      dy?: number;
      key?: string;
      shift?: boolean;
      meta?: boolean;
      hold?: number;
      name?: string;
      type?: string;
      base64?: string;
    };
type ProbeWindow = Window & {
  __maudeE2EFrameProbe: (
    q: string,
    op?: string,
    value?: ProbeArgument
  ) => Promise<ProbeResult | null>;
};
type Surface = {
  name: string;
  root: string;
  probe: (q: string, op?: string, value?: ProbeArgument) => Promise<ProbeResult | null>;
  read: (q: string, frame?: boolean) => Promise<string | null>;
  click: (q: string) => Promise<void>;
  hover: (q: string) => Promise<void>;
  menu: (text: string) => Promise<void>;
  confirmNext: () => Promise<void>;
  promptNext: (value: string) => Promise<void>;
  fill: (q: string, value: string) => Promise<void>;
  select: (q: string, value: string) => Promise<void>;
  dragTo: (source: string, destination: string) => Promise<void>;
  screenshot: (file: string) => Promise<void>;
  photoTrace: () => Promise<unknown>;
  /** A real pointer drag inside the canvas (browsers only; the native lane
   *  drives the frame probe). Returns false when not available. */
  canvasDrag?: (q: string, dx: number, dy: number, holdMs: number) => Promise<boolean>;
  /** A keyboard shortcut pressed in the shell (not the canvas frame), e.g.
   *  `Meta+z` — the way the menubar's own shortcuts are reached. */
  press: (chord: string) => Promise<void>;
  /** How many shell (not canvas-frame) elements match. */
  count: (q: string) => Promise<number>;
  /** Run a script string in the shell document (a bounded DOM gesture the
   *  shell's own handlers receive — never a store or API mutation). */
  shell: (script: string) => Promise<unknown>;
};
// Read browser code verbatim: TS function serialization can capture esbuild's
// Node-side __name helper, which does not exist inside Chromium/WKWebView.
const treeDragSource = readFileSync(new URL('./tree-drag.js', import.meta.url), 'utf8');
const photoTraceSource = readFileSync(new URL('./photo-trace.js', import.meta.url), 'utf8');

function web(name: string, root: string, page: Page): Surface {
  return {
    name,
    root,
    async photoTrace() {
      return page.evaluate(`(${photoTraceSource})()`);
    },
    async probe(q, op = 'read', value = null) {
      return page.evaluate(
        ([query, operation, argument]) =>
          (window as unknown as ProbeWindow).__maudeE2EFrameProbe(query, operation, argument),
        [q, op, value] as [string, string, ProbeArgument]
      );
    },
    async read(q, frame = false) {
      if (frame) {
        const result = await this.probe(q);
        return result?.visible ? result.text : null;
      }
      // One DOM snapshot: count→visibility→textContent races a deletion and
      // Playwright then auto-waits 30s for an element that correctly vanished.
      return page.evaluate((query) => {
        const element = document.querySelector(query);
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 &&
          rect.height > 0 &&
          style.visibility !== 'hidden' &&
          style.display !== 'none'
          ? element.textContent
          : null;
      }, q);
    },
    async hover(q) {
      await page.locator(q).hover();
    },
    async menu(text) {
      // A menu opened near the bottom of a long tree slides into place; wait
      // for it to settle rather than racing its transition.
      const item = page.getByRole('menuitem', { name: text, exact: true });
      await item.waitFor({ state: 'visible' });
      await page.waitForTimeout(250);
      await item.click({ timeout: 10000 }).catch(() => item.click({ force: true }));
    },
    async confirmNext() {
      page.once('dialog', (dialog) => dialog.accept());
    },
    async promptNext(value) {
      page.once('dialog', (dialog) => dialog.accept(value));
    },
    async click(q) {
      await page.locator(q).click();
    },
    async fill(q, value) {
      await page.locator(q).fill(value);
    },
    async select(q, value) {
      // By value: the disabled placeholder's LABEL is the computed value, and
      // a bare string also matches labels.
      await page.locator(q).selectOption({ value });
    },
    async dragTo(source, destination) {
      await page.locator(source).scrollIntoViewIfNeeded();
      await page.locator(destination).scrollIntoViewIfNeeded();
      await page.evaluate(`(${treeDragSource})(${JSON.stringify({ source, destination })})`);
    },
    async screenshot(path) {
      await page.screenshot({ path });
    },
    async press(chord) {
      await page.keyboard.press(chord);
    },
    async count(q) {
      return page.locator(q).count();
    },
    async shell(script) {
      return page.evaluate(script);
    },
    async canvasDrag(q, dx, dy, holdMs) {
      const frame = page.frameLocator('[data-testid="canvas-frame"]');
      const box = await frame.locator(q).first().boundingBox();
      if (!box) return false;
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      const seen: string[] = [];
      const onReq = (r: { url(): string; method(): string }) => {
        if (/\/_api\//.test(r.url())) seen.push(`${r.method()} ${r.url().replace(/\?.*$/, '')}`);
      };
      const onConsole = (m: { type(): string; text(): string }) => {
        seen.push(`console.${m.type()}: ${m.text().slice(0, 400)}`);
      };
      page.on('request', onReq);
      page.on('console', onConsole);
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + dx, y + dy, { steps: 12 });
      await page.waitForTimeout(holdMs);
      await page.mouse.move(x + dx, y + dy + 1);
      await page.mouse.up();
      await page.waitForTimeout(1500);
      page.off('request', onReq);
      page.off('console', onConsole);
      writeFileSync(join(run.out, `canvas-drag-${name}.json`), JSON.stringify(seen, null, 2));
      return true;
    },
  };
}
const native: Surface = {
  async count(q) {
    return (await browser.$$(q)).length;
  },
  async shell(script) {
    return browser.execute(`return (${script});`);
  },
  async press(chord) {
    // A real chord: modifiers go down, the key goes down and up, modifiers go
    // up — one W3C action sequence (browser.keys did not hold Shift here).
    const KEY: Record<string, string> = {
      Meta: '\uE03D',
      Shift: '\uE008',
      Control: '\uE009',
      Alt: '\uE00A',
      ArrowRight: '\uE014',
      ArrowLeft: '\uE012',
      Home: '\uE011',
      End: '\uE010',
      Delete: '\uE017',
      Backspace: '\uE003',
      Escape: '\uE00C',
      Enter: '\uE007',
    };
    const parts = chord.split('+');
    const key = parts.pop() as string;
    const code = (k: string) => KEY[k] ?? k;
    const mods = parts.map(code);
    await browser.performActions([
      {
        type: 'key',
        id: 'surface-keyboard',
        actions: [
          ...mods.map((value) => ({ type: 'keyDown', value })),
          { type: 'keyDown', value: code(key) },
          { type: 'keyUp', value: code(key) },
          ...[...mods].reverse().map((value) => ({ type: 'keyUp', value })),
        ],
      },
    ]);
    await browser.releaseActions().catch(() => {});
  },

  name: 'native',
  root: run.roots.native,
  async photoTrace() {
    return browser.execute(`return (${photoTraceSource})();`);
  },
  async probe(q, op = 'read', value = null) {
    // The embedded driver treats a top-level `error` field as a WebDriver
    // protocol failure. Keep observation errors inside a data envelope.
    const envelope = await browser.execute(
      async (query, operation, argument) => ({
        observation: await (window as unknown as ProbeWindow).__maudeE2EFrameProbe(
          query,
          operation,
          argument
        ),
      }),
      q,
      op,
      value
    );
    return envelope.observation;
  },
  async read(q, inFrame = false) {
    if (inFrame) {
      const result = await this.probe(q);
      return result?.visible ? result.text : null;
    }
    return browser.execute((query) => {
      const element = document.querySelector(query);
      if (!element || element.getBoundingClientRect().height === 0) return null;
      return element.textContent;
    }, q);
  },
  async hover(q) {
    await (await $(q)).moveTo();
  },
  async menu(text) {
    const items = await browser.$$('button[role="menuitem"]');
    for (const item of items) {
      if ((await item.getText()) === text) {
        await item.click();
        return;
      }
    }
    throw new Error(`Menu item absent: ${text}`);
  },
  async confirmNext() {
    // Test-only counterpart of accepting a native confirm dialog. The suite
    // only operates its own temporary projects; OS dialog chrome is not a claim.
    await browser.execute(() => {
      const original = window.confirm;
      window.confirm = () => {
        window.confirm = original;
        return true;
      };
    });
  },
  async promptNext(value) {
    // Test-only counterpart of answering a native prompt (a temporary project).
    await browser.execute((answer) => {
      const original = window.prompt;
      window.prompt = () => {
        window.prompt = original;
        return answer;
      };
    }, value);
  },
  async click(q) {
    await (await $(q)).click();
  },
  async fill(q, value) {
    await (await $(q)).setValue(value);
  },
  async select(q, value) {
    // WKWebView's WebDriver option click does not reach React's onChange; set
    // the real control's value and fire the change a user's pick would.
    await browser.execute(
      (query, next) => {
        const element = document.querySelector(query) as HTMLSelectElement | null;
        if (!element) throw new Error(`Select absent: ${query}`);
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
        setter?.call(element, next);
        element.dispatchEvent(new Event('change', { bubbles: true }));
      },
      q,
      value
    );
  },
  async dragTo(source, destination) {
    await browser.execute(`return (${treeDragSource})(arguments[0]);`, { source, destination });
  },
  async screenshot(path) {
    await browser.saveScreenshot(path);
  },
};
async function until(check: () => Promise<boolean> | boolean, timeout = 15000) {
  const start = performance.now();
  while (performance.now() - start < timeout) {
    if (await check()) return performance.now() - start;
    await sleep(20);
  }
  throw new Error(`Condition absent after ${timeout} ms`);
}
/** A read that answers `null` instead of throwing — a driver hiccup on a busy
 *  window is not the same as the thing being absent. */
async function reads(p: Surface, q: string, frame = false): Promise<string | null> {
  try {
    return await p.read(q, frame);
  } catch {
    return null;
  }
}
async function gesture(p: Surface, q: string, op: string, value: ProbeArgument = null) {
  const result = await p.probe(q, op, value);
  if (!result || result.error)
    throw new Error(`DOM gesture ${op} on ${q}: ${result?.error ?? 'target absent'}`);
}
async function openCanvas(p: Surface, rel: string) {
  if ((await p.read(`[data-testid="canvas-frame"][data-path=".design/${rel}"]`)) === null)
    await p.click(selector(`canvas-row-${slug(rel.replace(/\.tsx$/, ''))}`));
  await until(async () => !!(await p.probe('body'))?.visible);
}
async function observeAll(
  all: Surface[],
  id: string,
  start: number,
  predicate: (p: Surface) => Promise<boolean>,
  persisted?: (p: Surface) => boolean
) {
  const observations = await Promise.all(
    all.map(async (p) => {
      const timings: { observedMs?: number; persistedMs?: number } = {};
      let visibleError: string | undefined;
      let persistenceError: string | undefined;
      await Promise.all([
        until(() => predicate(p))
          .then(() => {
            timings.observedMs = performance.now() - start;
          })
          .catch((error) => {
            visibleError = String(error);
          }),
        persisted
          ? until(() => persisted(p))
              .then(() => {
                timings.persistedMs = performance.now() - start;
              })
              .catch((error) => {
                persistenceError = String(error);
              })
          : Promise.resolve(),
      ]);
      return {
        receiver: p.name,
        status: visibleError || persistenceError ? 'fail' : 'pass',
        ...timings,
        visibleError,
        persistenceError,
        error:
          [
            visibleError && `UI: ${visibleError}`,
            persistenceError && `Persistence: ${persistenceError}`,
          ]
            .filter(Boolean)
            .join('; ') || undefined,
      };
    })
  );
  // A first visible effect is not enough: a stale projection can revert it
  // while another participant is still pending. Preserve first-effect times,
  // then take a fresh final snapshot before allowing the next author to act.
  const finalObservations = await Promise.all(
    all.map(async (p, i) => {
      const first = observations[i];
      try {
        const finalVisible = await predicate(p);
        const finalPersisted = persisted ? persisted(p) : null;
        return {
          ...first,
          finalVisible,
          finalPersisted,
          status:
            first.status === 'pass' && finalVisible && finalPersisted !== false ? 'pass' : 'fail',
        };
      } catch (error) {
        return { ...first, status: 'fail', finalError: String(error) };
      }
    })
  );
  for (const p of all) {
    await p.screenshot(join(run.out, `${id}-${p.name}.png`));
    if (id.startsWith('L06')) {
      const rel = id.startsWith('L06-ui-text') ? 'ui/SurfaceText.tsx' : 'ui/home.tsx';
      const path = join(p.root, '.design', rel);
      if (existsSync(path)) writeFileSync(join(run.out, `${id}-${p.name}.tsx`), readFileSync(path));
      writeFileSync(
        join(run.out, `${id}-${p.name}-render.json`),
        JSON.stringify(
          {
            heading: await p.probe('h1'),
            shellError: await p.read(selector('canvas-load-error')),
          },
          null,
          2
        )
      );
    }
    if (id.startsWith('L14-upload'))
      writeFileSync(
        join(run.out, `${id}-${p.name}-render.json`),
        JSON.stringify(await p.probe('[data-mediaref-player] video'), null, 2)
      );
    if (id.startsWith('L09') || id.startsWith('L12-upload') || id.startsWith('L14-upload')) {
      const path = join(p.root, '.design', notesSidecar);
      if (existsSync(path))
        writeFileSync(join(run.out, `${id}-${p.name}.annotations.svg`), readFileSync(path));
    }
  }
  return {
    status: finalObservations.every((r) => r.status === 'pass') ? 'pass' : 'fail',
    observations: finalObservations,
  };
}
function stickyDisk(p: Surface, id: string | undefined) {
  if (!id || !/^s_[a-z0-9]+$/i.test(id)) throw new Error('Missing or unexpected fixture stroke ID');
  const path = join(p.root, '.design', notesSidecar);
  if (!existsSync(path)) return null;
  // Bounded assertion for the known sticky serializer, not a general SVG parser.
  return (
    readFileSync(path, 'utf8').match(new RegExp(`<g data-id="${id}"[^>]*>[\\s\\S]*?</g>`))?.[0] ??
    null
  );
}
function imageDisk(p: Surface, id: string | undefined) {
  if (!id || !/^s_[a-z0-9]+$/i.test(id)) throw new Error('Missing image fixture ID');
  const path = join(p.root, '.design', notesSidecar);
  if (!existsSync(path)) return null;
  return (
    readFileSync(path, 'utf8')
      .match(/<image\b[^>]*>/g)
      ?.find((node) => node.includes(`data-id="${id}"`)) ?? null
  );
}
function shapeDisk(p: Surface, id: string | undefined) {
  if (!id || !/^s_[a-z0-9]+$/i.test(id)) throw new Error('Missing shape fixture ID');
  const path = join(p.root, '.design', notesSidecar);
  if (!existsSync(path)) return null;
  return (
    readFileSync(path, 'utf8')
      .match(/<(?:rect|ellipse|polygon)\b[^>]*>/g)
      ?.find((node) => node.includes(`data-id="${id}"`)) ?? null
  );
}
function drawingDisk(p: Surface, id: string | undefined) {
  if (!id || !/^s_[a-z0-9]+$/i.test(id)) throw new Error('Missing drawing fixture ID');
  const path = join(p.root, '.design', notesSidecar);
  if (!existsSync(path)) return null;
  // Known drawing serializers: path, flat group, or standalone text/tspans.
  const source = readFileSync(path, 'utf8');
  return (
    source.match(new RegExp(`<path data-id="${id}"[^>]*>`))?.[0] ??
    source.match(new RegExp(`<g data-id="${id}"[^>]*>[\\s\\S]*?</g>`))?.[0] ??
    source.match(new RegExp(`<text data-id="${id}"[^>]*>[\\s\\S]*?</text>`))?.[0] ??
    null
  );
}
class Unexercised extends Error {}

/**
 * Resize handles are positioned by a requestAnimationFrame loop. A native
 * window WebKit is not rendering — the screen is locked, the window hidden —
 * runs no animation frames, so they never appear. That is the row not being
 * exercised, not the product failing: say so, and let the original failure
 * stand otherwise.
 */
async function unlessNotRendering(from: Surface, error: unknown): Promise<never> {
  if (from.name === 'native') {
    const frames = await browser.execute(
      () =>
        new Promise<string>((done) => {
          let fired = false;
          requestAnimationFrame(() => {
            fired = true;
            done(`fired (${document.visibilityState})`);
          });
          setTimeout(() => !fired && done(`paused (${document.visibilityState})`), 1500);
        })
    );
    if (frames.startsWith('paused'))
      throw new Unexercised(
        `the native window is not rendering (animation frames ${frames}) — rerun with the screen unlocked`
      );
  }
  throw error;
}
function record(row: Record<string, unknown>) {
  rows.push(row);
  writeFileSync(
    join(run.out, 'surface-results.json'),
    JSON.stringify({ version: 1, baselineComplete: false, rows }, null, 2)
  );
  console.log(`[surface] ${row.id} ${row.direction ?? ''}: ${row.status}`);
}
async function check(
  id: string,
  direction: string,
  body: () => Promise<Record<string, unknown>>,
  context: Record<string, unknown> = {}
) {
  if (run.only?.length && !run.only.some((prefix: string) => id.startsWith(prefix))) {
    record({ id, direction, ...context, status: 'not-run', reason: 'Excluded by --only' });
    return;
  }
  try {
    currentCase = { id, direction, ...context };
    record({ id, direction, ...context, status: 'pass', ...(await body()) });
  } catch (error) {
    record({
      id,
      direction,
      ...context,
      status: error instanceof Unexercised ? 'not-run' : 'fail',
      error: String(error),
    });
  } finally {
    currentCase = null;
  }
}
function bytes(root: string, rel: string) {
  return readFileSync(join(root, '.design', rel));
}
/**
 * Every eligible design file at `root` → its hash: canvases, their meta and
 * annotations, and (with `assets`) the media. A `.meta.json` carries
 * per-machine keys that never sync by design (`META_LOCAL_KEYS` in
 * apps/studio/sync/codec.ts): the shared part must match byte-for-byte, those
 * keys must not. Runtime state and conflict copies are excluded.
 */
function eligibleInventory(root: string, assets = false) {
  const META_LOCAL_KEYS = ['viewport', 'last_modified', 'syncable'];
  const shared = (name: string, bytes: Buffer): Buffer | string => {
    if (!name.endsWith('.meta.json')) return bytes;
    try {
      const meta = JSON.parse(bytes.toString('utf8')) as Record<string, unknown>;
      for (const k of META_LOCAL_KEYS) delete meta[k];
      return JSON.stringify(meta);
    } catch {
      return bytes;
    }
  };
  const out = new Map<string, string>();
  const walk = (dir: string, rel: string, match: RegExp) => {
    if (!existsSync(dir)) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('_') || e.name.startsWith('.')) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(join(dir, e.name), r, match);
      else if (match.test(e.name) && !/-conflict-/.test(e.name))
        out.set(
          r,
          createHash('sha256')
            .update(shared(e.name, readFileSync(join(dir, e.name))))
            .digest('hex')
        );
    }
  };
  walk(join(root, '.design', 'ui'), 'ui', /\.(tsx|meta\.json|annotations\.svg)$/);
  if (assets) walk(join(root, '.design', 'assets'), 'assets', /\.(png|jpe?g|svg|mp4|webm)$/);
  return out;
}
/** Paths whose hash differs between two inventories (either side missing counts). */
function inventoryDiff(a: Map<string, string>, b: Map<string, string>) {
  const paths = new Set([...a.keys(), ...b.keys()]);
  return [...paths].filter((rel) => a.get(rel) !== b.get(rel));
}
/** Every canvas source and annotations sidecar at `p` that names `asset`. */
function referencesTo(p: { name: string; root: string }, asset: string) {
  const design = join(p.root, '.design');
  const sources = [
    ...readdirSync(join(design, 'ui'))
      .filter((f) => f.endsWith('.tsx'))
      .map((f) => `ui/${f}`),
    ...readdirSync(design).filter((f) => f.endsWith('.annotations.svg')),
  ];
  return sources
    .filter((rel) => readFileSync(join(design, rel), 'utf8').includes(asset))
    .map((rel) => `${p.name}:${rel}`);
}
async function receivers(
  id: string,
  from: Surface,
  all: Surface[],
  q: string,
  start: number,
  rel: string
) {
  return Promise.all(
    all
      .filter((p) => p !== from)
      .map(async (to) => {
        const result: Record<string, unknown> = { receiver: to.name };
        try {
          await until(async () => (await to.read(q)) !== null);
          result.visibleMs = performance.now() - start;
          result.diskExists = existsSync(join(to.root, '.design', rel));
          await to.screenshot(join(run.out, `${id}-${from.name}-to-${to.name}.png`));
          result.status = result.diskExists ? 'pass' : 'fail';
        } catch (error) {
          result.status = 'fail';
          result.error = String(error);
          await to.screenshot(join(run.out, `${id}-${from.name}-to-${to.name}-failed.png`));
        }
        return result;
      })
  );
}

describe('multiplayer surface baseline (real hub + WKWebView + independent peer)', () => {
  it('observes already-open receiving UIs without refresh', async () => {
    // @wdio/tauri-service 1.1 re-checks window focus before every find/click by
    // asking `window.__TAURI__.core.invoke` for window states. The studio page
    // carries no global Tauri object, so each check waited out a 5 s timeout —
    // every native command paid it, and a three-row run no longer fit 15
    // minutes. This app has one window: name it once, and the service stops
    // re-deciding (an explicit switch suppresses the auto-focus).
    await (browser as unknown as { tauri?: { switchWindow(label: string): Promise<void> } }).tauri
      ?.switchWindow('main')
      .catch((error: unknown) => console.warn(`[surface] window pin failed: ${String(error)}`));
    const chromiumBrowser = await chromium.launch({ headless: true });
    const hubPage = await chromiumBrowser.newPage({ viewport: { width: 1440, height: 1000 } });
    const peerPage = await chromiumBrowser.newPage({ viewport: { width: 1440, height: 1000 } });
    const indexAttempts: Array<Record<string, unknown>> = [];
    for (const [name, page] of [
      ['hub', hubPage],
      ['peer', peerPage],
    ] as const) {
      if (run.startupIndexFailures) {
        let failures = 0;
        await page.route('**/_index-data', async (route) => {
          const injected = failures < run.startupIndexFailures;
          if (injected) failures++;
          indexAttempts.push({ participant: name, at: Date.now(), injected });
          writeFileSync(
            join(run.out, 'startup-index-attempts.json'),
            JSON.stringify(indexAttempts, null, 2)
          );
          if (injected)
            await route.fulfill({
              status: 502,
              contentType: 'text/plain',
              body: 'Fixture: index temporarily unavailable',
            });
          else await route.continue();
        });
      }
      const log = (event: Record<string, unknown>) =>
        appendFileSync(
          join(run.out, `${name}-browser-events.jsonl`),
          `${JSON.stringify({ atMs: performance.now(), case: currentCase, ...event })}\n`
        );
      const route = (url: string) => {
        try {
          const u = new URL(url);
          if (!['http:', 'https:'].includes(u.protocol)) return u.protocol;
          return `${u.origin}${u.pathname}`;
        } catch {
          return 'non-URL';
        }
      };
      page.on('pageerror', (error) => log({ kind: 'page-error', message: error.message }));
      // Shell warnings name refused writes (`[/_api/…] <reason>`); bounded text
      // only — never page content.
      page.on('console', (message) => {
        if (message.type() === 'warning' || message.type() === 'error')
          log({ kind: `console-${message.type()}`, message: message.text().slice(0, 300) });
      });
      page.on('requestfailed', (request) =>
        log({
          kind: 'request-failed',
          route: route(request.url()),
          error: request.failure()?.errorText,
        })
      );
      page.on('response', (response) => {
        if (response.status() >= 400)
          log({ kind: 'http-error', route: route(response.url()), status: response.status() });
      });
      page.on('framenavigated', (frame) =>
        log({
          kind: 'frame-navigation',
          shell: frame === page.mainFrame(),
          route: route(frame.url()),
        })
      );
    }
    const probeScript = readFileSync(
      new URL('../../src-tauri/src/e2e-frame-probe.js', import.meta.url),
      'utf8'
    );
    await hubPage.addInitScript(probeScript);
    await peerPage.addInitScript(probeScript);
    const all = [web('hub', run.roots.hub, hubPage), native, web('peer', run.roots.peer, peerPage)];
    /** Fresh copies of the project opened during the run (L20, L24) — kept
     *  running to the end, so the final parity holds them to the same bar. */
    const freshRoots: string[] = [];
    const lifecycle = (route: string) =>
      run.peerLifecycle
        ? fetch(`${run.peerLifecycle}${route}`, { method: 'POST' }).then(async (r) => {
            const body = (await r.json()) as Record<string, unknown>;
            if (!r.ok) throw new Error(`${route}: ${JSON.stringify(body)}`);
            return body;
          })
        : Promise.reject(new Unexercised('This run has no lifecycle control for desktop B.'));
    /** Open a fresh copy of the project and a browser page on it. */
    const openFresh = async () => {
      const fresh = (await lifecycle('/fresh')) as { root: string; port: number };
      freshRoots.push(fresh.root);
      const page = await chromiumBrowser.newPage({ viewport: { width: 1440, height: 1000 } });
      await page.addInitScript(probeScript);
      await page.goto(`http://127.0.0.1:${fresh.port}/`);
      return { ...fresh, surface: web(`fresh-${freshRoots.length}`, fresh.root, page), page };
    };
    try {
      // The webview is a Tauri page only once it reached the sidecar; asking
      // before that raced the app's boot (and failed whenever it lost).
      const nativeUrl = await waitForSidecar();
      if (!(await isNativeShell())) throw new Error('Native participant is not a Tauri webview');
      // A fixed window, so a run never depends on whatever size the e2e
      // profile last remembered (1280×800 by default vs a restored 1690×1388
      // changed which selection chrome fit on screen).
      await browser.setWindowSize(1690, 1300).catch(() => {});
      const nativeInfo = JSON.parse(
        readFileSync(join(native.root, '.design/_server.json'), 'utf8')
      );
      if (new URL(nativeUrl).port !== String(nativeInfo.port))
        throw new Error('Native app opened the wrong sidecar');
      await hubPage.goto(`${run.hub}/studio/signin`);
      await hubPage.locator('input[name=email]').fill('designer-b@local.test');
      await hubPage.locator('input[name=password]').fill('surface-test-password');
      await hubPage.getByRole('button', { name: 'Sign in', exact: true }).click();
      await peerPage.goto(`http://127.0.0.1:${run.peerPort}/`);
      for (const p of all) {
        try {
          await until(async () => (await p.read(selector('canvas-row-ui-home'))) !== null, 60000);
        } catch (error) {
          const diagnostic: Record<string, unknown> = { participant: p.name, error: String(error) };
          try {
            diagnostic.shell = (await p.read('body'))?.slice(0, 12000);
            diagnostic.canvasError = await p.read(selector('canvas-load-error'));
            await p.screenshot(join(run.out, `bootstrap-${p.name}-failed.png`));
          } catch (captureError) {
            diagnostic.captureError = String(captureError);
          }
          writeFileSync(
            join(run.out, `bootstrap-${p.name}-failed.json`),
            JSON.stringify(diagnostic, null, 2)
          );
          throw new Error(`Bootstrap ${p.name}: home canvas row absent. ${String(error)}`);
        }
      }
      record({
        id: 'bootstrap.participants',
        status: 'pass',
        nativeUrl,
        roots: run.roots,
        roles: ['member', 'member', 'member'],
        transport: ['hub browser', 'bundled WKWebView', 'independent source sidecar'],
        noWatch: run.watch === 'control',
        notesProfile: run.notes ?? 'isolated',
        browsers: {
          chromium: chromiumBrowser.version(),
          native: await browser.execute(() => ({
            userAgent: navigator.userAgent,
            width: innerWidth,
            height: innerHeight,
            devicePixelRatio,
          })),
          web: await hubPage.evaluate(() => ({
            userAgent: navigator.userAgent,
            width: innerWidth,
            height: innerHeight,
            devicePixelRatio,
          })),
        },
      });
      if (run.startupIndexFailures) {
        for (const participant of ['hub', 'peer']) {
          const attempts = indexAttempts.filter((attempt) => attempt.participant === participant);
          record({
            id: 'L01.index-auto-recovery',
            direction: participant,
            status:
              attempts.filter((attempt) => attempt.injected).length === run.startupIndexFailures &&
              attempts.some((attempt) => !attempt.injected)
                ? 'pass'
                : 'fail',
            attempts,
            note: 'Browser fixture injects initial 502s; tree must recover within the unchanged bootstrap deadline without focus/refresh. Native boots normally.',
          });
        }
      }
      // Dismiss explicit onboarding chrome only, before timed actions.
      for (const p of [hubPage, peerPage]) {
        for (const label of ['Got it', 'Dismiss']) {
          const button = p.getByRole('button', { name: label, exact: true });
          if (await button.count()) await button.click();
        }
      }
      for (const p of all) {
        await openCanvas(p, 'ui/home.tsx');
        await until(async () => (await p.read('h1', true)) === 'Local cell smoke', 30000);
        await p.screenshot(join(run.out, `initial-${p.name}.png`));
      }
      record({
        id: 'bootstrap.render',
        status: 'pass',
        receiverUI: true,
        note: 'Hard assertion inside all three canvas documents, including native WKWebView.',
      });
      // L06 external editor is deliberately a filesystem gesture. Record it
      // separately from UI source editing; no direct API substitutes for UI.
      for (const from of all) {
        await check('L06.external-save', `${from.name}-to-peers`, async () => {
          const rel = 'ui/home.tsx';
          const before = bytes(from.root, rel).toString();
          const title = `Surface edit from ${from.name}`;
          const replacement = before.replace(/<h1>[^<]*<\/h1>/, `<h1>${title}</h1>`);
          if (replacement === before) throw new Error('Fixture heading not found');
          const start = performance.now();
          writeFileSync(join(from.root, '.design', rel), replacement);
          const observations = await Promise.all(
            all.map(async (to) => {
              const observeStart = performance.now();
              try {
                await until(async () => (await to.read('h1', true)) === title);
                const renderedMs = performance.now() - start;
                const equal = bytes(to.root, rel).equals(Buffer.from(replacement));
                return {
                  receiver: to.name,
                  renderedMs,
                  observationWindowMs: performance.now() - observeStart,
                  sourceSha256: createHash('sha256').update(bytes(to.root, rel)).digest('hex'),
                  status: equal ? 'pass' : 'fail',
                };
              } catch (error) {
                return { receiver: to.name, status: 'fail', error: String(error) };
              }
            })
          );
          for (const to of all)
            await to.screenshot(join(run.out, `L06-${from.name}-to-${to.name}.png`));
          return {
            status: observations.every((o) => o.status === 'pass') ? 'pass' : 'fail',
            stimulus: 'external editor write',
            observations,
          };
        });
      }
      for (const from of all) {
        await check('L06.atomic-editor-save', `${from.name}-to-peers`, async () => {
          const rel = 'ui/home.tsx';
          const source = bytes(from.root, rel).toString();
          const title = `Atomic editor save from ${from.name}`;
          const updated = source.replace(/<h1>[^<]*<\/h1>/, `<h1>${title}</h1>`);
          if (updated === source) throw new Error('Fixture heading not found');
          const temporary = join(from.root, '.design/ui/.surface-editor-save.tmp');
          writeFileSync(temporary, updated);
          const start = performance.now();
          renameSync(temporary, join(from.root, '.design', rel));
          return {
            stimulus: 'external editor atomic filesystem rename',
            ...(await observeAll(
              all,
              `L06-atomic-${from.name}`,
              start,
              async (p) => (await p.read('h1', true)) === title,
              (p) => bytes(p.root, rel).equals(Buffer.from(updated))
            )),
          };
        });
      }
      for (let sample = 1; sample <= run.samples; sample++) {
        for (const from of all) {
          await check(
            'L06.ui-text-edit',
            `${from.name}-to-peers`,
            async () => {
              const rel = 'ui/SurfaceText.tsx';
              for (const p of all) await openCanvas(p, rel);
              for (const p of all) await until(async () => (await p.read('h1', true)) !== null);
              const before = bytes(from.root, rel).toString();
              await until(async () => !!(await from.probe(selector('palette-mode-edit')))?.visible);
              await gesture(from, selector('palette-mode-edit'), 'click');
              const editor = 'h1[contenteditable="plaintext-only"]';
              // Double-click drills the real selection hierarchy before entering
              // the leaf editor, matching the existing native text-edit scenario.
              for (let level = 0; level < 12; level++) {
                if ((await from.probe(editor))?.visible) break;
                await gesture(from, 'h1', 'doubleClick');
                await sleep(50);
              }
              if (!(await from.probe(editor))?.visible)
                throw new Error('Heading editor did not open through the UI');
              const title = `UI edited by ${from.name} sample ${sample}`;
              const expected = before.replace(/<h1>[^<]*<\/h1>/, `<h1>${title}</h1>`);
              if (expected === before) throw new Error('Fixture heading not found');
              writeFileSync(
                join(run.out, `L06-ui-text-${from.name}-${sample}-expected.tsx`),
                expected
              );
              await gesture(from, editor, 'editText', title);
              const start = performance.now();
              await gesture(from, editor, 'key', { key: 'Enter' });
              return {
                stimulus: 'canvas leaf editor, DOM text input and Enter',
                ...(await observeAll(
                  all,
                  `L06-ui-text-${from.name}-${sample}`,
                  start,
                  async (p) => (await p.read('h1', true)) === title,
                  (p) => bytes(p.root, rel).equals(Buffer.from(expected))
                )),
              };
            },
            { sample }
          );
        }
      }
      // T5 / audit P1 #5 — personal CSS undo must not overwrite a teammate's
      // newer value. Real inspector knob + real Cmd+Z in the canvas; the oracle
      // is every participant's source file and the author's own notice.
      // Only an enabled knob means the heading itself is the selection.
      const weight = 'select[aria-label="font-weight"]:not(:disabled)';
      const weightIn = (p: Surface, rel: string, value: string) =>
        new RegExp(`fontWeight:\\s*"${value}"`).test(bytes(p.root, rel).toString());
      const selectHeading = async (p: Surface) => {
        await until(async () => !!(await p.probe(selector('palette-mode-edit')))?.visible);
        await gesture(p, selector('palette-mode-edit'), 'click');
        // Same real selection path as the text lane: clicks drill the hierarchy
        // until the inspector offers the heading's knobs.
        for (let level = 0; level < 6 && (await p.read(weight)) === null; level++) {
          await gesture(p, 'h1', level === 0 ? 'click' : 'doubleClick');
          await sleep(150);
        }
        if ((await p.read(weight)) === null) {
          await p.screenshot(join(run.out, `L18-select-${p.name}-no-inspector.png`));
          throw new Error(
            `Inspector knob absent after selecting the heading (panel: ${
              (await p.read(selector('inspector-panel'))) === null ? 'closed' : 'open'
            })`
          );
        }
      };
      for (const [i, from] of all.entries()) {
        const other = all[(i + 1) % all.length] as Surface;
        await check(
          'L18.css-undo.peer-value-kept',
          `${from.name}-after-${other.name}`,
          async () => {
            const rel = 'ui/SurfaceText.tsx';
            for (const p of all) await openCanvas(p, rel);
            for (const p of all) await until(async () => (await p.read('h1', true)) !== null);
            await selectHeading(from);
            // Three distinct values: what the undo would restore, the author's
            // edit, and the teammate's. A teammate value equal to the restore
            // target would make the undo a correct no-op, not a conflict.
            const weights = ['300', '400', '500', '600', '700', '800'];
            const restore = weights.find((v) => weightIn(from, rel, v)) ?? null;
            const [mine, theirs] = weights.filter((v) => v !== restore);
            await from.select(weight, mine as string);
            await until(() => all.every((p) => weightIn(p, rel, mine as string)));
            await selectHeading(other);
            await other.select(weight, theirs as string);
            await until(() => all.every((p) => weightIn(p, rel, theirs as string)));
            const start = performance.now();
            await gesture(from, 'body', 'key', { key: 'z', meta: true });
            // A refused undo changes nothing, so hold the observation window open
            // long enough for a wrong write to have propagated everywhere.
            let toldMs: number | null = null;
            const told = await until(
              async () => ((await from.read('body')) ?? '').includes('changed by someone else'),
              8000
            )
              .then(() => {
                toldMs = performance.now() - start;
                return true;
              })
              .catch(() => false);
            await sleep(3000);
            const kept = all.map((p) => ({
              receiver: p.name,
              peerValueKept: weightIn(p, rel, theirs as string),
            }));
            for (const p of all)
              await p.screenshot(
                join(run.out, `L18-css-undo-${from.name}-after-${other.name}-${p.name}.png`)
              );
            return {
              status: told && kept.every((k) => k.peerValueKept) ? 'pass' : 'fail',
              authorToldMs: toldMs,
              observations: kept,
            };
          }
        );
        await check('L18.css-undo.own-value', from.name, async () => {
          const rel = 'ui/SurfaceText.tsx';
          await selectHeading(from);
          const before =
            ['300', '400', '500', '600', '700', '800'].find((v) => weightIn(from, rel, v)) ?? null;
          const next = before === '500' ? '600' : '500';
          await from.select(weight, next);
          await until(() => all.every((p) => weightIn(p, rel, next)));
          const start = performance.now();
          await gesture(from, 'body', 'key', { key: 'z', meta: true });
          return {
            stimulus: 'inspector font-weight, then Cmd+Z by the same author',
            ...(await observeAll(
              all,
              `L18-css-undo-own-${from.name}`,
              start,
              async (p) => (before ? weightIn(p, rel, before) : !weightIn(p, rel, next)),
              (p) => (before ? weightIn(p, rel, before) : !weightIn(p, rel, next))
            )),
          };
        });
      }
      // L06 property and attribute edits through the inspector's Advanced
      // section — the hatches a designer uses for anything the named knobs do
      // not cover. Typed into the real fields; a click on another field blurs
      // the value field, which is what commits it (Enter does too, but a
      // WebDriver key does not reach an element outside the canvas frame).
      const openAdvanced = async (p: Surface) => {
        const header = selector('inspector-section-advanced');
        await until(async () => (await p.read(header)) !== null);
        if ((await p.read(`${header}[aria-expanded="true"]`)) === null) await p.click(header);
        await until(async () => (await p.read(`${header}[aria-expanded="true"]`)) !== null);
        // The section animates open; a field is typeable once it has a box.
        await sleep(400);
      };
      let advancedEdit = 0;
      for (const from of all) {
        await check('L06.css-property-edit', `${from.name}-to-peers`, async () => {
          const rel = 'ui/SurfaceText.tsx';
          for (const p of all) await openCanvas(p, rel);
          for (const p of all) await until(async () => (await p.read('h1', true)) !== null);
          await selectHeading(from);
          await openAdvanced(from);
          const value = `${++advancedEdit + 2}px`;
          const written = (p: Surface) =>
            new RegExp(`outlineOffset:\\s*"${value}"`).test(bytes(p.root, rel).toString());
          await from.fill('input[aria-label="custom property name"]', 'outline-offset');
          await from.fill('input[aria-label="custom property value"]', value);
          const start = performance.now();
          await from.click('input[aria-label="custom attribute name"]');
          await until(() => written(from));
          return {
            stimulus: 'inspector Advanced → Add CSS property (outline-offset), committed on blur',
            ...(await observeAll(
              all,
              `L06-css-property-${from.name}`,
              start,
              async (p) => !!(await p.probe(`h1[style*="outline-offset: ${value}"]`))?.visible,
              // Live, not a snapshot: this canvas is a busy one, so the
              // author's own file may still be settling other rows' changes.
              (p) => written(p) && bytes(p.root, rel).equals(bytes(from.root, rel))
            )),
          };
        });
        await check('L06.attribute-edit', `${from.name}-to-peers`, async () => {
          const rel = 'ui/SurfaceText.tsx';
          for (const p of all) await openCanvas(p, rel);
          for (const p of all) await until(async () => (await p.read('h1', true)) !== null);
          await selectHeading(from);
          await openAdvanced(from);
          const note = `note from ${from.name} ${++advancedEdit}`;
          const written = (p: Surface) =>
            bytes(p.root, rel).toString().includes(`data-surface-note="${note}"`);
          await from.fill('input[aria-label="custom attribute name"]', 'data-surface-note');
          await from.fill('input[aria-label="custom attribute value"]', note);
          const start = performance.now();
          await from.click('input[aria-label="custom property name"]');
          await until(() => written(from));
          return {
            stimulus:
              'inspector Advanced → Add HTML attribute (data-surface-note), committed on blur',
            ...(await observeAll(
              all,
              `L06-attribute-${from.name}`,
              start,
              async (p) => !!(await p.probe(`h1[data-surface-note="${note}"]`))?.visible,
              (p) => written(p) && bytes(p.root, rel).equals(bytes(from.root, rel))
            )),
          };
        });
      }
      // First-class EMPTY folders. Never hide missing directory propagation by
      // creating a child canvas inside them (the old harness did that).
      for (const from of all) {
        await check('L01.empty-folder.create', `${from.name}-to-peers`, async () => {
          if ((await from.read(selector('tree-new-folder'))) === null)
            return {
              status: 'unsupported',
              reason: 'New folder control is absent for this participant.',
            };
          const name = `Surface-${from.name}`;
          await from.click(selector('tree-new-folder'));
          await from.fill('[aria-label="New folder name"]', name);
          const start = performance.now();
          await from.click('[aria-label="Create folder"]');
          const q = selector(`tree-folder-ui-${slug(name)}`);
          await until(async () => (await from.read(q)) !== null);
          const path = join(from.root, '.design/ui', name);
          const entries = readdirSync(path);
          if (
            entries.some((name) => name !== '.gitkeep') ||
            (entries.includes('.gitkeep') && readFileSync(join(path, '.gitkeep')).length !== 0)
          )
            throw new Error('Created folder contains user content');
          const observations = await receivers('L01-create', from, all, q, start, `ui/${name}`);
          return {
            status: observations.every((o) => o.status === 'pass') ? 'pass' : 'fail',
            observations,
          };
        });
      }
      for (const from of all) {
        await check('L01.empty-folder.rename', `${from.name}-to-peers`, async () => {
          // The folder L01.empty-folder.create made; renamed in place.
          const name = `Surface-${from.name}`;
          const renamed = `Surface-${from.name}-renamed`;
          const q = selector(`tree-folder-ui-${slug(name)}`);
          const renamedQ = selector(`tree-folder-ui-${slug(renamed)}`);
          for (const p of all)
            if ((await p.read(q)) === null || !existsSync(join(p.root, '.design/ui', name)))
              throw new Unexercised(`Rename needs the created folder at ${p.name}`);
          await from.hover(q);
          await from.click(selector(`tree-row-menu-ui-${slug(name)}`));
          const menu = await from.read('[role="menu"]');
          await from.screenshot(join(run.out, `L01-folder-menu-${from.name}.png`));
          if (!menu?.includes('Rename folder')) {
            await from.click('.st-sb-title');
            throw new Error('Folder menu has no Rename folder');
          }
          await from.promptNext(renamed);
          const start = performance.now();
          await from.menu('Rename folder');
          return observeAll(
            all,
            `L01-empty-rename-${from.name}`,
            start,
            async (p) => (await p.read(q)) === null && (await p.read(renamedQ)) !== null,
            (p) =>
              !existsSync(join(p.root, '.design/ui', name)) &&
              existsSync(join(p.root, '.design/ui', renamed))
          );
        });
        await check('L01.empty-folder.move', `${from.name}-to-peers`, async () => {
          const name = `EmptyMove-${from.name}`;
          const dest = `EmptyDestination-${from.name}`;
          const source = `ui/${name}`;
          const target = `ui/${dest}/${name}`;
          const sourceQ = selector(`tree-folder-${slug(source)}`);
          const destQ = selector(`tree-folder-ui-${slug(dest)}`);
          for (const p of all) {
            if ((await p.read(sourceQ)) === null || !existsSync(join(p.root, '.design', source)))
              throw new Unexercised(`Seeded empty source absent at ${p.name}`);
            if ((await p.read(`${destQ}[aria-expanded="false"]`)) !== null) await p.click(destQ);
          }
          const start = performance.now();
          await from.dragTo(sourceQ, destQ);
          return observeAll(
            all,
            `L01-empty-move-${from.name}`,
            start,
            async (p) =>
              (await p.read(sourceQ)) === null &&
              (await p.read(selector(`tree-folder-${slug(target)}`))) !== null,
            (p) =>
              !existsSync(join(p.root, '.design', source)) &&
              existsSync(join(p.root, '.design', target)) &&
              readdirSync(join(p.root, '.design', target)).every((n) => n === '.gitkeep')
          );
        });
        await check('L01.empty-folder.delete', `${from.name}-to-peers`, async () => {
          const name = `EmptyDelete-${from.name}`;
          const rel = `ui/${name}`;
          const q = selector(`tree-folder-${slug(rel)}`);
          for (const p of all)
            if ((await p.read(q)) === null || !existsSync(join(p.root, '.design', rel)))
              throw new Unexercised(`Delete requires the pre-existing folder at ${p.name}`);
          await from.hover(q);
          await from.click(selector(`tree-row-menu-${slug(rel)}`));
          await from.confirmNext();
          const start = performance.now();
          await from.menu('Delete folder');
          return observeAll(
            all,
            `L01-empty-delete-${from.name}`,
            start,
            async (p) => (await p.read(q)) === null,
            (p) => !existsSync(join(p.root, '.design', rel))
          );
        });
      }
      for (const from of all) {
        await check('L04.canvas.create.tree', `${from.name}-to-peers`, async () => {
          const name = `SurfaceBoard-${from.name}`;
          await from.click('[aria-label="New blank brief board"]');
          await from.fill('[aria-label="New brief board name"]', name);
          const start = performance.now();
          await from.click('[aria-label="Create brief board"]');
          const q = selector(`canvas-row-ui-${slug(name)}`);
          await until(async () => (await from.read(q)) !== null);
          const observations = await receivers('L04-create', from, all, q, start, `ui/${name}.tsx`);
          return {
            status: observations.every((o) => o.status === 'pass') ? 'pass' : 'fail',
            observations,
            renderStatus: 'not-run',
            note: 'Tree arrival measured. New-canvas deep render is a separate required check.',
          };
        });
      }
      for (const from of all) {
        const name = `SurfaceBoard-${from.name}`;
        const oldRel = `ui/${name}.tsx`;
        await check('L04.canvas.open-and-render', `${from.name}-created`, async () => {
          const observations = [];
          for (const to of all) {
            await until(
              async () => (await to.read(selector(`canvas-row-ui-${slug(name)}`))) !== null
            );
            await openCanvas(to, oldRel);
            await until(
              async () => (await to.read('[data-dc-screen="brief"]', true))?.includes(name) === true
            );
            observations.push({ receiver: to.name, status: 'pass' });
          }
          return { observations };
        });
      }
      for (const from of all) {
        const name = `SurfaceMove-${from.name}`;
        const destination = `CanvasDestination-${from.name}`;
        const oldRel = `ui/${name}.tsx`;
        const movedRel = `ui/${destination}/${name}.tsx`;
        const oldRow = selector(`canvas-row-${slug(oldRel.replace(/\.tsx$/, ''))}`);
        const movedRow = selector(`canvas-row-${slug(movedRel.replace(/\.tsx$/, ''))}`);
        const destinationRow = selector(`tree-folder-ui-${slug(destination)}`);
        await check('L04.canvas.move-with-open-receivers', `${from.name}-to-peers`, async () => {
          // These sources and destinations predate boot on every participant.
          // No L01 folder creation or L04 new-canvas delivery is a prerequisite.
          const expected = bytes(from.root, oldRel);
          for (const to of all) {
            if (
              (await to.read(oldRow)) === null ||
              (await to.read(destinationRow)) === null ||
              !existsSync(join(to.root, '.design', oldRel)) ||
              !bytes(to.root, oldRel).equals(expected) ||
              existsSync(join(to.root, '.design', movedRel))
            )
              throw new Unexercised(
                `Move requires the original canvas and empty destination at ${to.name}`
              );
            if ((await to.read(`${destinationRow}[aria-expanded="false"]`)) !== null)
              await to.click(destinationRow);
            await openCanvas(to, oldRel);
            await until(
              async () => (await to.read('[data-dc-screen="brief"]', true))?.includes(name) === true
            );
          }
          await from.hover(selector(`canvas-row-ui-${slug(name)}`));
          await from.click(selector(`tree-row-menu-ui-${slug(name)}`));
          await from.menu('Move to…');
          const start = performance.now();
          await from.menu(`ui/${destination}`);
          return observeAll(
            all,
            `L04-move-${from.name}-to`,
            start,
            async (to) =>
              (await to.read(oldRow)) === null &&
              (await to.read(movedRow)) !== null &&
              (await to.read(`[data-testid="canvas-frame"][data-path=".design/${movedRel}"]`)) !==
                null &&
              (await to.read('[data-dc-screen="brief"]', true))?.includes(name) === true,
            (to) =>
              existsSync(join(to.root, '.design', movedRel)) &&
              !existsSync(join(to.root, '.design', oldRel)) &&
              bytes(to.root, movedRel).equals(expected)
          );
        });
        await check('L04.canvas.delete-with-open-receivers', `${from.name}-to-peers`, async () => {
          // Never call absent→absent a successful delete.
          for (const to of all) {
            if (
              !existsSync(join(to.root, '.design', movedRel)) ||
              (await to.read(movedRow)) === null
            )
              throw new Unexercised(`Delete-after-move precondition missing at ${to.name}`);
            await until(
              async () =>
                (await to.read(`[data-testid="canvas-frame"][data-path=".design/${movedRel}"]`)) !==
                null
            );
          }
          await from.hover(selector(`canvas-row-ui-${slug(destination)}-${slug(name)}`));
          await from.confirmNext();
          const start = performance.now();
          await from.click(`[aria-label="Delete canvas ${name}"]`);
          return observeAll(
            all,
            `L04-delete-${from.name}-to`,
            start,
            async (to) =>
              (await to.read(movedRow)) === null &&
              (await to.read(oldRow)) === null &&
              (await to.read(`[data-testid="canvas-frame"][data-path=".design/${movedRel}"]`)) ===
                null &&
              (await to.read(`[data-testid="canvas-frame"][data-path=".design/${oldRel}"]`)) ===
                null,
            (to) =>
              !existsSync(join(to.root, '.design', movedRel)) &&
              !existsSync(join(to.root, '.design', oldRel))
          );
        });
      }
      // An independent fixture lets delete run even when the move contract
      // failed. Opening it on each receiver is preparation, never recovery.
      for (const from of all) {
        await check('L04.canvas.delete-independent', `${from.name}-to-peers`, async () => {
          const name = `SurfaceDelete-${from.name}`;
          const rel = `ui/${name}.tsx`;
          for (const p of all) {
            if (!existsSync(join(p.root, '.design', rel)))
              throw new Error(`Missing delete fixture at ${p.name}`);
            await openCanvas(p, rel);
            await until(async () => (await p.read('h1', true)) === name);
          }
          await from.hover(selector(`canvas-row-ui-${slug(name)}`));
          await from.confirmNext();
          const start = performance.now();
          await from.click(`[aria-label="Delete canvas ${name}"]`);
          return observeAll(
            all,
            `L04-independent-delete-${from.name}`,
            start,
            async (p) =>
              (await p.read(selector(`canvas-row-ui-${slug(name)}`))) === null &&
              (await p.read(`[data-testid="canvas-frame"][data-path=".design/${rel}"]`)) === null,
            (p) => !existsSync(join(p.root, '.design', rel))
          );
        });
      }
      for (const from of all) {
        const name = `SurfaceShapes-${from.name}`;
        notesSidecar = `ui-${slug(name)}.annotations.svg`;
        const kinds = [
          ['square', 'Square', 'rect'],
          ['rounded', 'Rounded square', 'rect'],
          ['circle', 'Circle', 'ellipse'],
          ['diamond', 'Diamond', 'polygon'],
          ['triangle', 'Triangle', 'polygon'],
          ['triangle-down', 'Triangle down', 'polygon'],
        ];
        for (const [kind, label, tool] of kinds) {
          let shapeId: string | undefined;
          const q = () => `[data-id="${shapeId}"]`;
          const snapshot = async () =>
            Promise.all(
              all.map(async (p) => {
                const shape = await p.probe(q());
                if (!shape?.visible || !shape.rect || !shapeDisk(p, shapeId))
                  throw new Unexercised(`Shape precondition absent at ${p.name}`);
                return shape.rect;
              })
            );
          await check(`L09.shape-${kind}.create`, `${from.name}-to-peers`, async () => {
            for (const p of all) {
              await openCanvas(p, `ui/${name}.tsx`);
              await until(async () => (await p.read('h1', true)) === 'Surface shapes baseline');
              await until(async () => !!(await p.probe(selector('palette-mode-edit')))?.visible);
            }
            await gesture(from, selector('palette-mode-edit'), 'click');
            const shapeButton = '[aria-label^="Shape (R)"]';
            await gesture(from, shapeButton, 'click');
            await until(
              async () => !!(await from.probe(`${shapeButton}[aria-pressed="true"]`))?.visible
            );
            await gesture(from, shapeButton, 'click');
            await until(async () => !!(await from.probe('[aria-label="Shape type"]'))?.visible);
            await gesture(from, `[role="menuitemradio"][aria-label="${label}"]`, 'click');
            const before = new Set(
              (await from.probe('[data-tool][data-id]'))?.matches?.map((m) => m.id)
            );
            const start = performance.now();
            await gesture(from, '.dc-annot-input', 'pointer', { x: 0.35, y: 0.3, dx: 110, dy: 80 });
            await until(async () => {
              shapeId =
                (await from.probe(`[data-tool="${tool}"][data-id]`))?.matches?.find(
                  (m) => m.id && !before.has(m.id)
                )?.id ?? undefined;
              return !!shapeId && !!shapeDisk(from, shapeId);
            });
            const svg = shapeDisk(from, shapeId);
            if (tool === 'rect') {
              const radius = Number(svg?.match(/\brx="([^"]+)"/)?.[1] ?? 0);
              if ((kind === 'rounded' && radius <= 0) || (kind === 'square' && radius !== 0))
                throw new Error('Rectangle corner radius does not match the selected shape kind');
            }
            if (tool === 'polygon' && !svg?.includes(`data-shape="${kind}"`))
              throw new Error('The inserted polygon is a different shape kind');
            return observeAll(
              all,
              `L09-shape-${kind}-create-${from.name}`,
              start,
              async (p) => !!(await p.probe(q()))?.visible,
              (p) => shapeDisk(p, shapeId) === svg
            );
          });
          await check(`L09.shape-${kind}.move`, `${from.name}-to-peers`, async () => {
            if (!shapeId) throw new Unexercised('Shape creation did not establish an ID');
            const before = await snapshot();
            const old = shapeDisk(from, shapeId);
            await gesture(from, selector('palette-mode-edit'), 'click');
            const start = performance.now();
            await gesture(from, q(), 'pointer', { dx: 65, dy: 35 });
            return observeAll(
              all,
              `L09-shape-${kind}-move-${from.name}`,
              start,
              async (p) => {
                const r = (await p.probe(q()))?.rect;
                const prior = before[all.indexOf(p)];
                return !!r && Math.abs(r.x - prior.x) > 10 && Math.abs(r.y - prior.y) > 5;
              },
              (p) =>
                shapeDisk(from, shapeId) !== old &&
                shapeDisk(p, shapeId) === shapeDisk(from, shapeId)
            );
          });
          await check(`L09.shape-${kind}.resize`, `${from.name}-to-peers`, async () => {
            if (!shapeId) throw new Unexercised('Shape creation did not establish an ID');
            const before = await snapshot();
            const old = shapeDisk(from, shapeId);
            await gesture(from, q(), 'pointer');
            const handle = '.dc-annot-resize-handle[data-corner="se"]';
            await until(async () => !!(await from.probe(handle))?.visible).catch(async (error) => {
              await from.screenshot(join(run.out, `L09-${kind}-no-handle-${from.name}.png`));
              return unlessNotRendering(from, error);
            });
            const start = performance.now();
            await gesture(from, handle, 'pointer', { dx: 45, dy: 45 });
            return observeAll(
              all,
              `L09-shape-${kind}-resize-${from.name}`,
              start,
              async (p) => {
                const r = (await p.probe(q()))?.rect;
                const prior = before[all.indexOf(p)];
                return !!r && r.width > prior.width + 10 && r.height > prior.height + 10;
              },
              (p) =>
                shapeDisk(from, shapeId) !== old &&
                shapeDisk(p, shapeId) === shapeDisk(from, shapeId)
            );
          });
          await check(`L09.shape-${kind}.delete`, `${from.name}-to-peers`, async () => {
            if (!shapeId) throw new Unexercised('Shape creation did not establish an ID');
            await snapshot();
            await gesture(from, selector('palette-mode-edit'), 'click');
            await gesture(from, q(), 'pointer');
            const start = performance.now();
            await gesture(from, 'body', 'key', { key: 'Backspace' });
            return observeAll(
              all,
              `L09-shape-${kind}-delete-${from.name}`,
              start,
              async (p) => (await p.probe(q())) === null,
              (p) => shapeDisk(p, shapeId) === null
            );
          });
          // Undo brings the deleted shape back for everyone; redo takes it
          // away again — the author's own history, travelling as actions.
          for (const [action, restores] of [
            ['undo', true],
            ['redo', false],
          ] as const) {
            await check(`L09.shape-${kind}.${action}`, `${from.name}-to-peers`, async () => {
              if (!shapeId) throw new Unexercised('Shape creation did not establish an ID');
              for (const p of all)
                if (!!(await p.probe(q())) === restores)
                  throw new Unexercised(
                    `${action} needs the propagated previous step at ${p.name}`
                  );
              const start = performance.now();
              await gesture(from, 'body', 'key', { key: 'z', meta: true, shift: !restores });
              return observeAll(
                all,
                `L09-shape-${kind}-${action}-${from.name}`,
                start,
                async (p) => !!(await p.probe(q()))?.visible === restores,
                (p) => (shapeDisk(p, shapeId) !== null) === restores
              );
            });
          }
        }
      }
      for (const from of all) {
        for (const [kind, label, tool] of [
          ['pen', 'Pen', 'pen'],
          ['highlighter', 'Highlighter', 'pen'],
          ['arrow', 'Arrow', 'arrow'],
          ['text', 'Text', 'text'],
          ['section', 'Section', 'section'],
        ]) {
          const name = `SurfaceDrawing-${kind}-${from.name}`;
          notesSidecar = `ui-${slug(name)}.annotations.svg`;
          let drawingId: string | undefined;
          const q = () => `[data-id="${drawingId}"]`;
          const geometryQ = () => (kind === 'section' ? `${q()} > rect` : q());
          const snapshot = async () =>
            Promise.all(
              all.map(async (p) => {
                if (!drawingId) throw new Unexercised('Drawing creation did not establish an ID');
                const stroke = await p.probe(geometryQ());
                if (!stroke?.visible || !stroke.rect || !drawingDisk(p, drawingId))
                  throw new Unexercised(`Drawing precondition absent at ${p.name}`);
                return stroke.rect;
              })
            );
          await check(`L09.${kind}.create`, `${from.name}-to-peers`, async () => {
            for (const p of all) {
              await openCanvas(p, `ui/${name}.tsx`);
              await until(async () => (await p.read('h1', true)) === 'Surface drawing baseline');
              await until(async () => !!(await p.probe(selector('palette-mode-edit')))?.visible);
            }
            await gesture(from, selector('palette-mode-edit'), 'click');
            const button = `[aria-label^="${label} ("]`;
            await gesture(from, button, 'click');
            await until(
              async () => !!(await from.probe(`${button}[aria-pressed="true"]`))?.visible
            );
            const before = new Set(
              (await from.probe('[data-tool][data-id]'))?.matches?.map((m) => m.id)
            );
            const start = performance.now();
            await gesture(
              from,
              '.dc-annot-input',
              'pointer',
              kind === 'text' ? { x: 0.35, y: 0.16 } : { x: 0.35, y: 0.3, dx: 110, dy: 80 }
            );
            if (kind === 'text') {
              const editor = '[aria-label="Edit text"]';
              await until(async () => !!(await from.probe(editor))?.visible);
              await gesture(from, editor, 'editText', `Text annotation from ${from.name}`);
              await gesture(from, editor, 'key', { key: 'Enter', meta: true });
            }
            await until(async () => {
              drawingId =
                (await from.probe(`[data-tool="${tool}"][data-id]`))?.matches?.find(
                  (m) => m.id && !before.has(m.id)
                )?.id ?? undefined;
              return !!drawingId && !!drawingDisk(from, drawingId);
            });
            const svg = drawingDisk(from, drawingId);
            if ((kind === 'highlighter') !== !!svg?.includes('data-highlighter="1"'))
              throw new Error('Persisted highlighter mode does not match the selected tool');
            return observeAll(
              all,
              `L09-${kind}-create-${from.name}`,
              start,
              async (p) => !!(await p.probe(q()))?.visible,
              (p) => drawingDisk(p, drawingId) === svg
            );
          });
          if (kind === 'text' || kind === 'section') {
            await check(`L09.${kind}.edit-text`, `${from.name}-to-peers`, async () => {
              await snapshot();
              await gesture(from, selector('palette-mode-edit'), 'click');
              await gesture(from, q(), 'doubleClick');
              const editor = '[aria-label="Edit text"]';
              await until(async () => !!(await from.probe(editor))?.visible);
              const text = `Edited ${kind} by ${from.name}`;
              await gesture(from, editor, 'editText', text);
              const start = performance.now();
              await gesture(from, editor, 'key', { key: 'Enter', meta: true });
              return observeAll(
                all,
                `L09-${kind}-edit-text-${from.name}`,
                start,
                async (p) => (await p.read(q(), true))?.includes(text) === true,
                (p) =>
                  !!drawingDisk(p, drawingId)?.includes(text) &&
                  drawingDisk(p, drawingId) === drawingDisk(from, drawingId)
              );
            });
          }
          for (const action of ['move', 'resize'] as const) {
            await check(`L09.${kind}.${action}`, `${from.name}-to-peers`, async () => {
              const before = await snapshot();
              const old = drawingDisk(from, drawingId);
              await gesture(from, selector('palette-mode-edit'), 'click');
              let target = q();
              if (action === 'resize') {
                await gesture(from, q(), 'pointer');
                if (kind === 'text') {
                  const handles = await from.probe('.dc-annot-resize-handle');
                  await from.screenshot(join(run.out, `L09-text-resize-controls-${from.name}.png`));
                  if (handles?.visible)
                    throw new Error(
                      'Standalone text now exposes resize handles; implement the new UI'
                    );
                  return {
                    status: 'unsupported',
                    reason:
                      'Standalone text has no drag-resize handles in this baseline; font-size controls are a separate case.',
                  };
                }
                target = `.dc-annot-resize-handle[data-corner="${kind === 'arrow' ? 'ep2' : 'se'}"]`;
                await until(async () => !!(await from.probe(target))?.visible).catch((error) =>
                  unlessNotRendering(from, error)
                );
              }
              const start = performance.now();
              await gesture(
                from,
                target,
                'pointer',
                action === 'move' ? { dx: 65, dy: 35 } : { dx: 45, dy: 45 }
              );
              return observeAll(
                all,
                `L09-${kind}-${action}-${from.name}`,
                start,
                async (p) => {
                  const r = (await p.probe(geometryQ()))?.rect;
                  const prior = before[all.indexOf(p)];
                  return (
                    !!r &&
                    (action === 'move'
                      ? Math.abs(r.x - prior.x) > 10 && Math.abs(r.y - prior.y) > 5
                      : r.width > prior.width + 10 && r.height > prior.height + 10)
                  );
                },
                (p) =>
                  drawingDisk(from, drawingId) !== old &&
                  drawingDisk(p, drawingId) === drawingDisk(from, drawingId)
              );
            });
          }
          await check(`L09.${kind}.delete`, `${from.name}-to-peers`, async () => {
            await snapshot();
            await gesture(from, selector('palette-mode-edit'), 'click');
            await gesture(from, q(), 'pointer');
            const start = performance.now();
            await gesture(from, 'body', 'key', { key: 'Backspace' });
            return observeAll(
              all,
              `L09-${kind}-delete-${from.name}`,
              start,
              async (p) => (await p.probe(q())) === null,
              (p) => drawingDisk(p, drawingId) === null
            );
          });
          for (const [action, restores] of [
            ['undo', true],
            ['redo', false],
          ] as const) {
            await check(`L09.${kind}.${action}`, `${from.name}-to-peers`, async () => {
              if (!drawingId) throw new Unexercised('Creation did not establish an ID');
              for (const p of all)
                if (!!(await p.probe(q())) === restores)
                  throw new Unexercised(
                    `${action} needs the propagated previous step at ${p.name}`
                  );
              const start = performance.now();
              await gesture(from, 'body', 'key', { key: 'z', meta: true, shift: !restores });
              return observeAll(
                all,
                `L09-${kind}-${action}-${from.name}`,
                start,
                async (p) => !!(await p.probe(q()))?.visible === restores,
                (p) => (drawingDisk(p, drawingId) !== null) === restores
              );
            });
          }
        }
      }
      for (const from of all) {
        let strokeId: string | undefined;
        const notesCanvas = run.notes === 'shared' ? 'SurfaceMedia' : `SurfaceNotes-${from.name}`;
        notesSidecar = `ui-${slug(notesCanvas)}.annotations.svg`;
        const editor = '[aria-label="Edit sticky note text"]';
        await check('L09.sticky.create', `${from.name}-to-peers`, async () => {
          for (const p of all) {
            // A failed delete/undo in one direction must not leave overlapping
            // strokes under the next direction's resize/selection gestures.
            await openCanvas(p, `ui/${notesCanvas}.tsx`);
            await until(async () => (await p.read('h1', true)) === 'Surface media baseline');
            await gesture(p, selector('palette-mode-edit'), 'click');
          }
          const before = new Set(
            (await from.probe('[data-tool="sticky"][data-id]'))?.matches?.map((m) => m.id)
          );
          await gesture(from, '[aria-label^="Sticky ("]', 'click');
          await until(async () => !!(await from.probe('.dc-annot-input'))?.visible);
          const start = performance.now();
          await gesture(from, '.dc-annot-input', 'pointer', { x: 0.3, y: 0.3, dx: 130, dy: 100 });
          await until(async () => {
            strokeId =
              (await from.probe('[data-tool="sticky"][data-id]'))?.matches?.find(
                (m) => m.id && !before.has(m.id)
              )?.id ?? undefined;
            return !!strokeId;
          });
          return {
            strokeId,
            stimulus: 'synthetic DOM pointer gesture through real annotation UI',
            ...(await observeAll(
              all,
              `L09-sticky-create-${from.name}`,
              start,
              async (p) => !!(await p.probe(`[data-id="${strokeId}"]`))?.visible,
              (p) => stickyDisk(p, strokeId) !== null
            )),
          };
        });
        await check('L09.sticky.edit-text', `${from.name}-to-peers`, async () => {
          if (!strokeId) throw new Unexercised('Create did not produce a sticky ID');
          await until(async () => !!(await from.probe(editor))?.visible);
          const text = `Multiplayer note from ${from.name}`;
          await gesture(from, editor, 'editText', text);
          const start = performance.now();
          await gesture(from, editor, 'key', { key: 'Enter' });
          return {
            strokeId,
            ...(await observeAll(
              all,
              `L09-sticky-edit-${from.name}`,
              start,
              async (p) => (await p.read(`[data-id="${strokeId}"]`, true))?.includes(text) === true,
              (p) => stickyDisk(p, strokeId)?.includes(text) === true
            )),
          };
        });
        await check('L09.sticky.move', `${from.name}-to-peers`, async () => {
          if (!strokeId) throw new Unexercised('Create did not produce a sticky ID');
          const q = `[data-id="${strokeId}"]`;
          const before = await Promise.all(
            all.map(async (p) => {
              const result = await p.probe(q);
              if (!result?.visible || !result.rect) throw new Error(`Sticky absent at ${p.name}`);
              return result.rect;
            })
          );
          await gesture(from, selector('palette-mode-edit'), 'click');
          const oldDisk = stickyDisk(from, strokeId);
          const start = performance.now();
          await gesture(from, q, 'pointer', { dx: 80, dy: 35 });
          return observeAll(
            all,
            `L09-sticky-move-${from.name}`,
            start,
            async (p) => {
              const rect = (await p.probe(q))?.rect;
              const previous = before[all.indexOf(p)];
              return (
                !!rect && Math.abs(rect.x - previous.x) > 10 && Math.abs(rect.y - previous.y) > 5
              );
            },
            (p) =>
              stickyDisk(from, strokeId) !== oldDisk &&
              stickyDisk(p, strokeId) === stickyDisk(from, strokeId)
          );
        });
        await check('L09.sticky.resize', `${from.name}-to-peers`, async () => {
          if (!strokeId) throw new Unexercised('Create did not produce a sticky ID');
          const q = `[data-id="${strokeId}"]`;
          await gesture(from, q, 'pointer');
          const handle = '.dc-annot-resize-handle[data-corner="se"]';
          await until(async () => !!(await from.probe(handle))?.visible).catch((error) =>
            unlessNotRendering(from, error)
          );
          const before = await Promise.all(
            all.map(async (p) => {
              const r = await p.probe(q);
              if (!r?.visible || !r.rect)
                throw new Error(`Resize precondition absent at ${p.name}`);
              return r.rect;
            })
          );
          const oldDisk = stickyDisk(from, strokeId);
          const start = performance.now();
          await gesture(from, handle, 'pointer', { dx: 60, dy: 60 });
          return observeAll(
            all,
            `L09-sticky-resize-${from.name}`,
            start,
            async (p) => {
              const rect = (await p.probe(q))?.rect;
              return !!rect && rect.width > before[all.indexOf(p)].width + 10;
            },
            (p) =>
              stickyDisk(from, strokeId) !== oldDisk &&
              stickyDisk(p, strokeId) === stickyDisk(from, strokeId)
          );
        });
        await check('L09.sticky.paper-color', `${from.name}-to-peers`, async () => {
          if (!strokeId) throw new Unexercised('Create did not produce a sticky ID');
          await gesture(from, `[data-id="${strokeId}"]`, 'pointer');
          const color = '#f7c5c0';
          const button = `[aria-label="Annotation properties"] [aria-label="Sticky color ${color}"]`;
          await until(async () => !!(await from.probe(button))?.visible);
          const start = performance.now();
          await gesture(from, button, 'click');
          return observeAll(
            all,
            `L09-sticky-color-${from.name}`,
            start,
            async (p) =>
              !!(await p.probe(`[data-id="${strokeId}"] path[fill="${color}"]`))?.visible,
            (p) => stickyDisk(p, strokeId)?.includes(`fill="${color}"`) === true
          );
        });
        await check('L09.sticky.delete', `${from.name}-to-peers`, async () => {
          if (!strokeId) throw new Unexercised('Create did not produce a sticky ID');
          const q = `[data-id="${strokeId}"]`;
          for (const p of all)
            if (!(await p.probe(q))?.visible)
              throw new Error(`Delete precondition absent at ${p.name}`);
          await gesture(from, selector('palette-mode-edit'), 'click');
          await gesture(from, q, 'pointer');
          const start = performance.now();
          await gesture(from, 'body', 'key', { key: 'Backspace' });
          return observeAll(
            all,
            `L09-sticky-delete-${from.name}`,
            start,
            async (p) => (await p.probe(q)) === null,
            (p) => stickyDisk(p, strokeId) === null
          );
        });
        await check('L09.sticky.undo-delete', `${from.name}-to-peers`, async () => {
          if (!strokeId) throw new Unexercised('Create did not produce a sticky ID');
          const q = `[data-id="${strokeId}"]`;
          for (const p of all) {
            if ((await p.probe(q)) || stickyDisk(p, strokeId) !== null)
              throw new Unexercised(
                `Undo requires a propagated delete; sticky remains at ${p.name}`
              );
          }
          const start = performance.now();
          await gesture(from, 'body', 'key', { key: 'z', meta: true });
          return observeAll(
            all,
            `L09-sticky-undo-${from.name}`,
            start,
            async (p) =>
              (await p.read(q, true))?.includes(`Multiplayer note from ${from.name}`) === true,
            (p) => stickyDisk(p, strokeId)?.includes(`Multiplayer note from ${from.name}`) === true
          );
        });
        await check('L09.sticky.redo-delete', `${from.name}-to-peers`, async () => {
          if (!strokeId) throw new Unexercised('Create did not produce a sticky ID');
          const q = `[data-id="${strokeId}"]`;
          for (const p of all)
            if (!(await p.probe(q))?.visible)
              throw new Unexercised(`Undo precondition absent at ${p.name}`);
          const start = performance.now();
          await gesture(from, 'body', 'key', { key: 'z', meta: true, shift: true });
          return observeAll(
            all,
            `L09-sticky-redo-${from.name}`,
            start,
            async (p) => (await p.probe(q)) === null,
            (p) => stickyDisk(p, strokeId) === null
          );
        });
      }
      for (const from of all) {
        const name = `SurfaceDrawing-eraser-${from.name}`;
        notesSidecar = `ui-${slug(name)}.annotations.svg`;
        let eraseId: string | undefined;
        let originalSvg: string | null = null;
        const q = () => `[data-id="${eraseId}"]`;
        await check('L09.eraser.erase-stroke', `${from.name}-to-peers`, async () => {
          for (const p of all) {
            await openCanvas(p, `ui/${name}.tsx`);
            await until(async () => (await p.read('h1', true)) === 'Surface drawing baseline');
            await until(async () => !!(await p.probe(selector('palette-mode-edit')))?.visible);
          }
          await gesture(from, selector('palette-mode-edit'), 'click');
          await gesture(from, '[aria-label^="Pen ("]', 'click');
          await until(
            async () => !!(await from.probe('[aria-label^="Pen ("][aria-pressed="true"]'))?.visible
          );
          await gesture(from, '.dc-annot-input', 'pointer', { x: 0.35, y: 0.3, dx: 110, dy: 80 });
          await until(async () => {
            eraseId =
              (await from.probe('[data-tool="pen"][data-id]'))?.matches?.[0]?.id ?? undefined;
            return !!eraseId && !!drawingDisk(from, eraseId);
          });
          originalSvg = drawingDisk(from, eraseId);
          for (const p of all)
            await until(
              async () => !!(await p.probe(q()))?.visible && drawingDisk(p, eraseId) === originalSvg
            );
          const stroke = (await from.probe(q()))?.rect;
          await gesture(from, '[aria-label^="Eraser ("]', 'click');
          await until(
            async () =>
              !!(await from.probe('[aria-label^="Eraser ("][aria-pressed="true"]'))?.visible
          );
          const input = (await from.probe('.dc-annot-input'))?.rect;
          if (!stroke || !input?.width || !input.height)
            throw new Unexercised('Eraser target geometry unavailable');
          const start = performance.now();
          await gesture(from, '.dc-annot-input', 'pointer', {
            x: (stroke.x + stroke.width / 2 - input.x) / input.width,
            y: (stroke.y + stroke.height / 2 - input.y) / input.height,
          });
          return observeAll(
            all,
            `L09-eraser-delete-${from.name}`,
            start,
            async (p) => (await p.probe(q())) === null,
            (p) => drawingDisk(p, eraseId) === null
          );
        });
        await check('L09.eraser.undo', `${from.name}-to-peers`, async () => {
          if (!eraseId || !originalSvg) throw new Unexercised('No erased fixture stroke');
          for (const p of all)
            if ((await p.probe(q())) || drawingDisk(p, eraseId) !== null)
              throw new Unexercised(
                `Undo requires a propagated erase; stroke remains at ${p.name}`
              );
          const start = performance.now();
          await gesture(from, 'body', 'key', { key: 'z', meta: true });
          return observeAll(
            all,
            `L09-eraser-undo-${from.name}`,
            start,
            async (p) => !!(await p.probe(q()))?.visible,
            (p) => drawingDisk(p, eraseId) === originalSvg
          );
        });
        await check('L09.eraser.redo', `${from.name}-to-peers`, async () => {
          if (!eraseId || !originalSvg) throw new Unexercised('No erased fixture stroke');
          for (const p of all)
            if (!(await p.probe(q()))?.visible || drawingDisk(p, eraseId) !== originalSvg)
              throw new Unexercised(`Redo requires propagated undo; stroke absent at ${p.name}`);
          const start = performance.now();
          await gesture(from, 'body', 'key', { key: 'z', meta: true, shift: true });
          return observeAll(
            all,
            `L09-eraser-redo-${from.name}`,
            start,
            async (p) => (await p.probe(q())) === null,
            (p) => drawingDisk(p, eraseId) === null
          );
        });
      }
      for (const from of all) {
        const name = `SurfaceUpload-${from.name}`;
        notesSidecar = `ui-${slug(name)}.annotations.svg`;
        let imageId: string | undefined;
        let assetRel: string | undefined;
        const input = run.media.uploads?.[from.name];
        await check('L12.upload-png.create', `${from.name}-to-peers`, async () => {
          if (!input) throw new Unexercised('Upload input fixture absent');
          for (const p of all) {
            await openCanvas(p, `ui/${name}.tsx`);
            await until(async () => (await p.read('h1', true)) === 'Surface upload baseline');
            await until(async () => !!(await p.probe(selector('palette-mode-edit')))?.visible);
            if ((await p.probe('image[data-tool="image"]')) !== null)
              throw new Unexercised(`Upload requires a clean image fixture at ${p.name}`);
          }
          const payload = readFileSync(input.path);
          const start = performance.now();
          await gesture(from, 'body', 'dropFile', {
            name: `from-${from.name}.png`,
            type: 'image/png',
            base64: payload.toString('base64'),
          });
          await until(async () => {
            const uploaded = await from.probe('image[data-tool="image"]');
            imageId = uploaded?.matches?.[0]?.id ?? undefined;
            const svg = imageId ? imageDisk(from, imageId) : null;
            assetRel = svg?.match(/\bhref="(assets\/[^"]+)"/)?.[1];
            return !!imageId && !!assetRel && !!uploaded?.visible;
          });
          if (!assetRel || assetRel.includes('..'))
            throw new Error('Invalid upload asset reference');
          const rel = assetRel;
          const observations = await observeAll(
            all,
            `L12-upload-create-${from.name}`,
            start,
            async (p) => {
              const image = await p.probe(`image[data-id="${imageId}"]`);
              return (
                !!image?.visible &&
                image.width === 8 &&
                image.height === 8 &&
                image.pixel?.join(',') === input.pixel.join(',')
              );
            },
            (p) =>
              imageDisk(p, imageId)?.includes(`href="${rel}"`) === true &&
              existsSync(join(p.root, '.design', rel)) &&
              createHash('sha256').update(bytes(p.root, rel)).digest('hex') === input.sha256
          );
          return {
            ...observations,
            imageId,
            assetRel,
            sha256: input.sha256,
            stimulus:
              'File/DataTransfer drop through actual canvas upload handler; input absent from project before gesture',
          };
        });
        for (const brightness of [0.25, 0]) {
          const op = brightness ? 'brightness' : 'reset-adjustments';
          await check(`L13.photo.${op}`, `${from.name}-to-peers`, async () => {
            if (!imageId || !assetRel)
              throw new Unexercised('Photo editing requires the uploaded image');
            const q = `image[data-id="${imageId}"]`;
            for (const p of all)
              if (!(await p.probe(q))?.visible)
                throw new Unexercised(`Photo not rendered at ${p.name}`);
            await until(async () => (await from.read(selector('photo-knobs'))) !== null);
            await from.photoTrace();
            const editRel = assetRel.replace(/\.png$/, '.photo.json');
            const start = performance.now();
            if (brightness) {
              await from.fill('.st-cp-num input[aria-label="Brightness"]', String(brightness));
              await from.click('.st-cp-num input[aria-label="Contrast"]');
            } else {
              await from.click('[aria-label="reset Adjustments section"]');
            }
            const result = await observeAll(
              all,
              `L13-photo-${op}-${from.name}`,
              start,
              async (p) => {
                const image = await p.probe(q);
                if (!image?.visible || !image.pixel) return false;
                return brightness
                  ? image.pixel[0] > input.pixel[0] + 10
                  : image.pixel.every((v, i) => Math.abs(v - input.pixel[i]) <= 3);
              },
              (p) => {
                const path = join(p.root, '.design', editRel);
                if (!existsSync(path)) return false;
                const edit = JSON.parse(readFileSync(path, 'utf8'));
                return (edit.adjustments?.brightness ?? 0) === brightness;
              }
            );
            for (const p of all) {
              const path = join(p.root, '.design', editRel);
              if (existsSync(path))
                writeFileSync(
                  join(run.out, `L13-${op}-${from.name}-${p.name}.photo.json`),
                  readFileSync(path)
                );
              writeFileSync(
                join(run.out, `L13-${op}-${from.name}-${p.name}-render.json`),
                JSON.stringify(await p.probe(q), null, 2)
              );
            }
            writeFileSync(
              join(run.out, `L13-${op}-${from.name}-requests.json`),
              JSON.stringify(await from.photoTrace(), null, 2)
            );
            return result;
          });
        }
        // L13 — every photo control the panel exposes, driven through the real
        // panel, each a separate step from the author's current edit. Two
        // oracles: every participant persisted the same `.photo.json` (with the
        // expected field), and every participant renders the same pixel as the
        // author — plus, where the control must visibly change the corner
        // pixel, the author's render changed.
        {
          const editRel = () => (assetRel ?? '').replace(/\.png$/, '.photo.json');
          const editOf = (p: Surface): Record<string, unknown> | null => {
            const path = join(p.root, '.design', editRel());
            if (!assetRel || !existsSync(path)) return null;
            try {
              return JSON.parse(readFileSync(path, 'utf8'));
            } catch {
              return null;
            }
          };
          const at = (edit: Record<string, unknown> | null, path: string): unknown =>
            path
              .split('.')
              .reduce<unknown>(
                (o, k) =>
                  o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined,
                edit
              );
          // A number field commits on blur. Moving focus to ANOTHER field is
          // what blurs it everywhere: a click on plain text does in Chromium,
          // not in WKWebView (the native rows never committed).
          const setNumber = async (label: string, value: number) => {
            await from.fill(`.st-cp-num input[aria-label="${label}"]`, String(value));
            const other = label === 'Brightness' ? 'Contrast' : 'Brightness';
            await from.click(`.st-cp-num input[aria-label="${other}"]`);
          };
          const steps: Array<{
            id: string;
            act: () => Promise<void>;
            field: string;
            value: unknown;
            changes: boolean;
          }> = [
            ...(
              [
                ['contrast', 'Contrast', 0.5],
                ['saturation', 'Saturation', -0.6],
                ['exposure', 'Exposure', 0.5],
                ['hue', 'Hue', 90],
                ['sepia', 'Sepia', 0.8],
                ['grayscale', 'Grayscale', 1],
                ['invert', 'Invert', 1],
              ] as const
            ).flatMap(([key, label, value]) => [
              {
                id: `L13.photo.${key}`,
                act: () => setNumber(label, value),
                field: `adjustments.${key}`,
                value,
                changes: true,
              },
              {
                id: `L13.photo.${key}-reset`,
                act: () => from.click('[aria-label="reset Adjustments section"]'),
                field: `adjustments.${key}`,
                value: undefined,
                changes: true,
              },
            ]),
            {
              id: 'L13.photo-control.duotone-on',
              act: () => from.click('input[aria-label="Duotone on"]'),
              field: 'duotone.enabled',
              value: true,
              changes: true,
            },
            {
              id: 'L13.photo-control.duotone-intensity',
              act: () => setNumber('Duotone intensity', 0.5),
              field: 'duotone.intensity',
              value: 0.5,
              changes: true,
            },
            {
              id: 'L13.photo-control.duotone-off',
              act: () => from.click('input[aria-label="Duotone on"]'),
              field: 'duotone.enabled',
              value: false,
              changes: true,
            },
            {
              id: 'L13.photo-control.grain-on',
              act: () => from.click('input[aria-label="Grain on"]'),
              field: 'grain.enabled',
              value: true,
              changes: false,
            },
            {
              id: 'L13.photo-control.grain-amount',
              act: () => setNumber('Grain amount', 0.8),
              field: 'grain.amount',
              value: 0.8,
              changes: false,
            },
            {
              id: 'L13.photo-control.grain-size',
              act: () => setNumber('Grain size', 4),
              field: 'grain.size',
              value: 4,
              changes: false,
            },
            {
              id: 'L13.photo-control.grain-off',
              act: () => from.click('input[aria-label="Grain on"]'),
              field: 'grain.enabled',
              value: false,
              changes: false,
            },
            {
              id: 'L13.photo-control.pattern-on',
              act: () => from.click('input[aria-label="Pattern on"]'),
              field: 'pattern.enabled',
              value: true,
              changes: false,
            },
            ...['grid', 'lines', 'diagonal', 'crosshatch', 'dots'].map((type) => ({
              id: `L13.pattern-type.${type}`,
              act: () => from.select('select[aria-label="Pattern type"]', type),
              field: 'pattern.type',
              value: type,
              changes: false,
            })),
            ...['multiply', 'screen', 'overlay', 'soft-light', 'normal'].map((blend) => ({
              id: `L13.pattern-blend.${blend}`,
              act: () => from.select('select[aria-label="Pattern blend"]', blend),
              field: 'pattern.blend',
              value: blend,
              changes: false,
            })),
            {
              id: 'L13.photo-control.pattern-scale',
              act: () => setNumber('Pattern scale', 2),
              field: 'pattern.scale',
              value: 2,
              changes: false,
            },
            {
              id: 'L13.photo-control.pattern-opacity',
              act: () => setNumber('Pattern opacity', 0.9),
              field: 'pattern.opacity',
              value: 0.9,
              changes: false,
            },
            {
              id: 'L13.photo-control.pattern-off',
              act: () => from.click('input[aria-label="Pattern on"]'),
              field: 'pattern.enabled',
              value: false,
              changes: false,
            },
            // The corner pixel: vignette darkens it, radial reveal clears it;
            // edge fade keeps it cleared, so only the data can show that one.
            ...(['vignette', 'radial-reveal', 'edge-fade'] as const).map((preset) => ({
              id: `L13.mask-preset.${preset}`,
              act: () => from.select('select[aria-label="Mask preset"]', preset),
              field: 'mask.preset',
              value: preset,
              changes: preset !== 'edge-fade',
            })),
            {
              id: 'L13.photo-control.mask-strength',
              act: () => setNumber('Mask strength', 1),
              field: 'mask.strength',
              value: 1,
              changes: false,
            },
            {
              id: 'L13.mask-preset.none',
              act: () => from.select('select[aria-label="Mask preset"]', 'none'),
              field: 'mask.preset',
              value: 'none',
              changes: true,
            },
          ];
          for (const step of steps) {
            await check(step.id, `${from.name}-to-peers`, async () => {
              if (!imageId || !assetRel)
                throw new Unexercised('Photo editing requires the uploaded image');
              const q = `image[data-id="${imageId}"]`;
              for (const p of all)
                if (!(await p.probe(q))?.visible)
                  throw new Unexercised(`Photo not rendered at ${p.name}`);
              await until(async () => (await from.read(selector('photo-knobs'))) !== null).catch(
                () => {
                  throw new Unexercised('The photo panel is not open for the author');
                }
              );
              // Each participant against ITS OWN render before the step: WebKit
              // and Chromium may round a blend differently, but each must show
              // the change.
              const before = await Promise.all(all.map(async (p) => (await p.probe(q))?.pixel));
              const start = performance.now();
              await step.act();
              const moved = (a?: number[], b?: number[]) =>
                !!a && !!b && a.some((v, i) => Math.abs(v - (b[i] ?? v)) > 3);
              return observeAll(
                all,
                `${step.id.replace(/\./g, '-')}-${from.name}`,
                start,
                async (p) => {
                  const now = await p.probe(q);
                  if (!now?.visible) return false;
                  return step.changes ? moved(now.pixel, before[all.indexOf(p)]) : true;
                },
                (p) => {
                  const edit = editOf(p);
                  return (
                    at(edit, step.field) === step.value &&
                    JSON.stringify(edit) === JSON.stringify(editOf(from))
                  );
                }
              );
            });
          }
        }
        // L13 — an edited photo that is moved stays edited everywhere;
        // the photo's own undo and redo (Cmd+Z / Cmd+Shift+Z with the Photo
        // tab showing) take the adjustment off and put it back for everyone.
        // Crop and transform are not controls this editor has.
        await check('L13.photo.crop-transform', `${from.name}-to-peers`, async () => ({
          status: 'unsupported',
          reason:
            'The Photo tab offers adjustments, effects, mask and background removal; there is no crop or transform control to drive.',
        }));
        {
          const q = () => `image[data-id="${imageId}"]`;
          const editRel = () => (assetRel ?? '').replace(/\.png$/, '.photo.json');
          const brightnessOf = (p: Surface) => {
            const path = join(p.root, '.design', editRel());
            if (!existsSync(path)) return 0;
            return JSON.parse(readFileSync(path, 'utf8')).adjustments?.brightness ?? 0;
          };
          const bright = async (p: Surface) => {
            const image = await p.probe(q());
            return (
              !!image?.visible && !!image.pixel && image.pixel[0] > (input?.pixel[0] ?? 0) + 10
            );
          };
          await check('L13.photo.move-keeps-edit', `${from.name}-to-peers`, async () => {
            if (!imageId || !assetRel || !input)
              throw new Unexercised('Photo requires the uploaded image');
            await until(async () => (await from.read(selector('photo-knobs'))) !== null);
            await from.fill('.st-cp-num input[aria-label="Brightness"]', '0.4');
            await from.click('.st-cp-num input[aria-label="Contrast"]');
            await until(() => all.every((p) => brightnessOf(p) === 0.4), 30000);
            for (const p of all) await until(async () => bright(p), 30000);
            const before = await Promise.all(all.map(async (p) => (await p.probe(q()))?.rect));
            const start = performance.now();
            await gesture(from, selector('palette-mode-edit'), 'click');
            await gesture(from, q(), 'pointer', { dx: 60, dy: 30 });
            return observeAll(
              all,
              `L13-move-keeps-edit-${from.name}`,
              start,
              async (p) => {
                const r = (await p.probe(q()))?.rect;
                const b = before[all.indexOf(p)];
                return !!r && !!b && Math.abs(r.x - b.x) > 10 && (await bright(p));
              },
              (p) => brightnessOf(p) === 0.4
            );
          });
          await check('L13.photo.undo', `${from.name}-to-peers`, async () => {
            if (!imageId || !assetRel || !input)
              throw new Unexercised('Photo requires the uploaded image');
            if (!all.every((p) => brightnessOf(p) === 0.4))
              throw new Unexercised('Undo needs the adjustment everywhere');
            // The photo's own history lives in the shell: select it so the
            // Photo tab is the one showing, then the shortcut.
            await gesture(from, q(), 'pointer');
            await until(async () => (await from.read(selector('photo-knobs'))) !== null);
            await from.click('.st-cp-num input[aria-label="Contrast"]');
            const start = performance.now();
            await from.press('Meta+z');
            return observeAll(
              all,
              `L13-photo-undo-${from.name}`,
              start,
              async (p) => !(await bright(p)) && !!(await p.probe(q()))?.visible,
              (p) => brightnessOf(p) !== 0.4
            );
          });
          await check('L13.photo.redo', `${from.name}-to-peers`, async () => {
            if (!imageId || !assetRel || !input)
              throw new Unexercised('Photo requires the uploaded image');
            if (all.some((p) => brightnessOf(p) === 0.4))
              throw new Unexercised('Redo needs the undone adjustment everywhere');
            await from.click('.st-cp-num input[aria-label="Contrast"]');
            const start = performance.now();
            await from.press('Meta+Shift+z');
            return observeAll(
              all,
              `L13-photo-redo-${from.name}`,
              start,
              bright,
              (p) => brightnessOf(p) === 0.4
            );
          });
        }
        // L12 replace — the image's own "Replace…" (annotation context menu)
        // opens the media picker; picking the project's seeded photo re-points
        // the image. Every participant shows the new pixels.
        await check('L12.upload-png.replace', `${from.name}-to-peers`, async () => {
          if (!imageId || !assetRel)
            throw new Unexercised('Upload did not establish an image reference');
          const q = `image[data-id="${imageId}"]`;
          const next = 'assets/surface-pattern.png';
          for (const p of all)
            if (!(await p.probe(q))?.visible)
              throw new Unexercised(`Image not rendered before replace at ${p.name}`);
          await gesture(from, selector('palette-mode-edit'), 'click');
          await gesture(from, q, 'contextMenu');
          const replace = '.dc-context-menu [data-action="replace"]';
          await until(async () => !!(await from.probe(replace))?.visible);
          await gesture(from, replace, 'click');
          const cell = '[aria-label="Choose media"] .st-ap-cell[title^="surface-pattern.png"]';
          await until(async () => (await from.read(cell)) !== null);
          const start = performance.now();
          await from.click(cell);
          const result = await observeAll(
            all,
            `L12-replace-${from.name}`,
            start,
            async (p) => {
              const image = await p.probe(q);
              return (
                !!image?.visible &&
                image.width === 8 &&
                image.height === 8 &&
                image.pixel?.join(',') === '111,159,21,255'
              );
            },
            (p) =>
              imageDisk(p, imageId)?.includes(`href="${next}"`) === true &&
              imageDisk(p, imageId) === imageDisk(from, imageId)
          );
          // What each participant shows once everything has settled — a
          // render that went back while the file moved on is a divergence,
          // not a slow arrival.
          await sleep(3000);
          const settled = await Promise.all(
            all.map(async (p) => {
              const image = await p.probe(q);
              return {
                receiver: p.name,
                pixel: image?.pixel?.join(',') ?? null,
                href: image?.href ?? null,
                disk: imageDisk(p, imageId)?.match(/href="([^"]+)"/)?.[1] ?? null,
              };
            })
          );
          return {
            stimulus: 'annotation context menu → Replace… → media picker → seeded photo',
            ...result,
            settled,
          };
        });
        // L12 delete unreferenced — after the replace nothing points at the
        // upload any more; deleting its file (Finder, an editor) removes it
        // everywhere, and the image that moved on keeps rendering.
        await check('L12.asset.delete-unreferenced', `${from.name}-to-peers`, async () => {
          if (!imageId || !assetRel) throw new Unexercised('No uploaded asset');
          const doomed = assetRel;
          const q = `image[data-id="${imageId}"]`;
          for (const p of all)
            if (!existsSync(join(p.root, '.design', doomed)))
              throw new Unexercised(`Upload absent before delete at ${p.name}`);
          const referenced = all.flatMap((p) => referencesTo(p, doomed));
          if (referenced.length)
            throw new Unexercised(`Upload still referenced: ${referenced.join(', ')}`);
          const start = performance.now();
          rmSync(join(from.root, '.design', doomed));
          return {
            stimulus: 'filesystem delete of an unreferenced uploaded image',
            ...(await observeAll(
              all,
              `L12-delete-unreferenced-${from.name}`,
              start,
              async (p) => {
                const image = await p.probe(q);
                return !!image?.visible && image.pixel?.join(',') === '111,159,21,255';
              },
              (p) =>
                !existsSync(join(p.root, '.design', doomed)) &&
                existsSync(join(p.root, '.design/assets/surface-pattern.png'))
            )),
          };
        });
        await check('L12.upload-png.remove-reference', `${from.name}-to-peers`, async () => {
          if (!imageId || !assetRel)
            throw new Unexercised('Upload did not establish an image reference');
          const q = `image[data-id="${imageId}"]`;
          for (const p of all)
            if (!(await p.probe(q))?.visible || !imageDisk(p, imageId))
              throw new Unexercised(
                `Image must be rendered and persisted before deletion at ${p.name}`
              );
          await gesture(from, selector('palette-mode-edit'), 'click');
          await gesture(from, q, 'pointer');
          const start = performance.now();
          await gesture(from, 'body', 'key', { key: 'Backspace' });
          return {
            ...(await observeAll(
              all,
              `L12-upload-remove-${from.name}`,
              start,
              async (p) => (await p.probe(q)) === null,
              (p) => imageDisk(p, imageId) === null
            )),
            note: 'Removes the canvas reference; blob retention/GC and history are separate required cases.',
          };
        });
      }
      // Blob fixtures exist only at the hub at setup. Navigation opens the
      // scenario once; subsequent media assertions never reload it.
      for (const from of all) {
        const name = `SurfaceDrawing-video-${from.name}`;
        notesSidecar = `ui-${slug(name)}.annotations.svg`;
        const input = run.media.videoUploads?.[from.name];
        let videoId: string | undefined;
        let assetRel: string | undefined;
        const q = () => `[data-id="${videoId}"][data-tool="mediaref"]`;
        const player = '[data-mediaref-player] video';
        await check('L14.upload-video.create', `${from.name}-to-peers`, async () => {
          if (!input) throw new Unexercised('Missing external video input fixture');
          for (const p of all) {
            await openCanvas(p, `ui/${name}.tsx`);
            await until(async () => (await p.read('h1', true)) === 'Surface drawing baseline');
            if ((await p.probe('[data-tool="mediaref"]')) !== null)
              throw new Unexercised(`Video intake requires an empty fixture at ${p.name}`);
          }
          const start = performance.now();
          await gesture(from, 'body', 'dropFile', {
            name: `upload-${from.name}.mp4`,
            type: 'video/mp4',
            base64: readFileSync(input.path).toString('base64'),
          });
          await until(async () => {
            videoId =
              (await from.probe('[data-tool="mediaref"][data-id]'))?.matches?.[0]?.id ?? undefined;
            const svg = videoId ? drawingDisk(from, videoId) : null;
            assetRel = svg?.match(/\bdata-src="(assets\/[^"]+)"/)?.[1];
            return !!videoId && !!assetRel;
          });
          if (!assetRel || assetRel.includes('..'))
            throw new Error('Invalid uploaded video reference');
          const rel = assetRel;
          return {
            videoId,
            note: 'Visible reference/player and bytes only; decoded playback is a separate required case.',
            assetRel,
            sha256: input.sha256,
            ...(await observeAll(
              all,
              `L14-upload-create-${from.name}`,
              start,
              async (p) => {
                const video = await p.probe(player);
                // The product uses preload=metadata. Reference visibility and
                // blob persistence do not certify decoding; the mandatory
                // play-and-seek case below requests actual playback first.
                return !!video?.visible && !!(await p.probe(q()))?.visible;
              },
              (p) =>
                !!drawingDisk(p, videoId)?.includes(`data-src="${rel}"`) &&
                existsSync(join(p.root, '.design', rel)) &&
                createHash('sha256').update(bytes(p.root, rel)).digest('hex') === input.sha256
            )),
          };
        });
        await check('L14.upload-video.play-and-seek', `${from.name}-to-peers`, async () => {
          if (!videoId || !assetRel)
            throw new Unexercised('Video upload did not establish a reference');
          const observations = [];
          for (const p of all) {
            try {
              if (!(await p.probe(q()))?.visible || !(await p.probe(player))?.visible)
                throw new Error('Uploaded video/player absent');
              // Start through the normal player action; seeking metadata-only
              // video before playback does not require WebKit to decode a frame.
              await gesture(p, player, 'play');
              await until(async () => ((await p.probe(player))?.time ?? 0) > 0.5);
              await gesture(p, player, 'pause');
              await gesture(p, player, 'seek', 0.2);
              await until(async () => {
                const video = await p.probe(player);
                return (
                  !video?.seeking &&
                  (video?.pixel?.[0] ?? 0) > 220 &&
                  (video?.pixel?.[2] ?? 255) < 30
                );
              });
              const red = await p.probe(player);
              await gesture(p, player, 'play');
              await until(async () => ((await p.probe(player))?.time ?? 0) > 0.5);
              await gesture(p, player, 'pause');
              await gesture(p, player, 'seek', 1.4);
              await until(async () => {
                const video = await p.probe(player);
                return (
                  !video?.seeking &&
                  (video?.pixel?.[2] ?? 0) > 220 &&
                  (video?.pixel?.[0] ?? 255) < 30
                );
              });
              observations.push({
                receiver: p.name,
                status: 'pass',
                red,
                blue: await p.probe(player),
              });
            } catch (error) {
              observations.push({
                receiver: p.name,
                status: 'fail',
                error: String(error),
                video: await p.probe(player),
              });
            }
            await p.screenshot(join(run.out, `L14-upload-play-${from.name}-${p.name}.png`));
          }
          return {
            status: observations.every((o) => o.status === 'pass') ? 'pass' : 'fail',
            observations,
            note: 'Playback and playhead are local viewer actions, not shared persistent mutations.',
          };
        });
        // L14 replace — the video's own Replace… (annotation context menu →
        // media picker) re-points it at the project's seeded clip; every
        // participant's player loads that clip and decodes it.
        await check('L14.upload-video.replace', `${from.name}-to-peers`, async () => {
          if (!videoId || !assetRel)
            throw new Unexercised('Video upload did not establish a reference');
          const next = 'assets/surface-colors.mp4';
          for (const p of all)
            if (!(await p.probe(q()))?.visible)
              throw new Unexercised(`Video not rendered before replace at ${p.name}`);
          await gesture(from, selector('palette-mode-edit'), 'click');
          await gesture(from, `${q()} > text`, 'contextMenu');
          const replace = '.dc-context-menu [data-action="replace"]';
          await until(async () => !!(await from.probe(replace))?.visible);
          await gesture(from, replace, 'click');
          const cell = '[aria-label="Choose media"] .st-ap-cell[title^="surface-colors.mp4"]';
          await until(async () => (await from.read(cell)) !== null);
          const start = performance.now();
          await from.click(cell);
          const playing = `[data-mediaref-player] video[src*="surface-colors.mp4"]`;
          return {
            stimulus: 'annotation context menu → Replace… → media picker → seeded clip',
            ...(await observeAll(
              all,
              `L14-replace-${from.name}`,
              start,
              async (p) => {
                const video = await p.probe(playing);
                return !!video?.visible && video.width === 160 && video.height === 90;
              },
              (p) =>
                drawingDisk(p, videoId)?.includes(`data-src="${next}"`) === true &&
                drawingDisk(p, videoId) === drawingDisk(from, videoId)
            )),
          };
        });
        // L14 delete unreferenced — nothing points at the upload after the
        // replace; deleting its file removes it everywhere and the clip that
        // replaced it keeps playing.
        await check('L14.asset.delete-unreferenced', `${from.name}-to-peers`, async () => {
          if (!videoId || !assetRel) throw new Unexercised('No uploaded video');
          const doomed = assetRel;
          for (const p of all)
            if (!existsSync(join(p.root, '.design', doomed)))
              throw new Unexercised(`Upload absent before delete at ${p.name}`);
          const referenced = all.flatMap((p) => referencesTo(p, doomed));
          if (referenced.length)
            throw new Unexercised(`Upload still referenced: ${referenced.join(', ')}`);
          const start = performance.now();
          rmSync(join(from.root, '.design', doomed));
          return {
            stimulus: 'filesystem delete of an unreferenced uploaded video',
            ...(await observeAll(
              all,
              `L14-delete-unreferenced-${from.name}`,
              start,
              async (p) =>
                !!(
                  await p.probe(`[data-mediaref-player] video[src*="surface-colors.mp4"]`)
                )?.visible,
              (p) =>
                !existsSync(join(p.root, '.design', doomed)) &&
                existsSync(join(p.root, '.design/assets/surface-colors.mp4'))
            )),
          };
        });
        await check('L14.upload-video.remove-reference', `${from.name}-to-peers`, async () => {
          if (!videoId) throw new Unexercised('Video upload did not establish an ID');
          for (const p of all)
            if (!(await p.probe(q()))?.visible || !drawingDisk(p, videoId))
              throw new Unexercised(`Video reference absent before deletion at ${p.name}`);
          await gesture(from, selector('palette-mode-edit'), 'click');
          await gesture(from, `${q()} > text`, 'pointer');
          const start = performance.now();
          await gesture(from, 'body', 'key', { key: 'Backspace' });
          return observeAll(
            all,
            `L14-upload-remove-${from.name}`,
            start,
            async (p) => (await p.probe(q())) === null && (await p.probe(player)) === null,
            (p) => drawingDisk(p, videoId) === null
          );
        });
      }
      for (const p of all) {
        await check('L12.seeded-photo.arrival-and-decode', `hub-to-${p.name}`, async () => {
          await openCanvas(p, 'ui/SurfaceMedia.tsx');
          const q = selector('surface-photo');
          await until(async () => {
            const image = await p.probe(q);
            return (
              !!image?.visible &&
              image.width === 8 &&
              image.height === 8 &&
              image.pixel?.join(',') === '111,159,21,255'
            );
          }, 30000);
          const image = await p.probe(q);
          const file = bytes(p.root, 'assets/surface-pattern.png');
          const sha256 = createHash('sha256').update(file).digest('hex');
          if (sha256 !== run.media['surface-pattern.png'].sha256)
            throw new Error('Downloaded image differs from the fixture');
          await p.screenshot(join(run.out, `L12-decoded-${p.name}.png`));
          return { image, sha256, stimulus: 'hub-seeded asset, not a UI upload' };
        });
        await check('L14.seeded-video.play-and-seek', `hub-to-${p.name}`, async () => {
          await openCanvas(p, 'ui/SurfaceMedia.tsx');
          const q = selector('surface-video');
          await until(async () => {
            const video = await p.probe(q);
            return !!video?.visible && video.width === 160 && video.height === 90;
          }, 30000);
          await p.probe(q, 'pause');
          await p.probe(q, 'seek', 0.2);
          await until(async () => {
            const video = await p.probe(q);
            return (
              !video?.seeking && (video?.pixel?.[0] ?? 0) > 220 && (video?.pixel?.[2] ?? 255) < 30
            );
          });
          const red = await p.probe(q);
          await p.probe(q, 'play');
          await until(async () => ((await p.probe(q))?.time ?? 0) > 0.5);
          await p.probe(q, 'pause');
          await p.probe(q, 'seek', 1.4);
          await until(async () => {
            const video = await p.probe(q);
            return (
              !video?.seeking && (video?.pixel?.[2] ?? 0) > 220 && (video?.pixel?.[0] ?? 255) < 30
            );
          });
          const blue = await p.probe(q);
          const sha256 = createHash('sha256')
            .update(bytes(p.root, 'assets/surface-colors.mp4'))
            .digest('hex');
          if (sha256 !== run.media['surface-colors.mp4'].sha256)
            throw new Error('Downloaded video differs from the fixture');
          await p.screenshot(join(run.out, `L14-decoded-${p.name}.png`));
          return {
            red,
            blue,
            sha256,
            stimulus: 'hub-seeded MP4; playback advances and seek changes decoded pixels',
          };
        });
      }
      // T22/S19 — a designer in a narrow browser window (phone width): the page
      // never scrolls sideways, the project's canvases are reachable, the save
      // status is on screen.
      await check('L22.narrow-browser-layout', 'designer-at-hub', async () => {
        const credentials = JSON.parse(readFileSync(run.identities['designer-a'], 'utf8'));
        const credential = credentials.hubs[`http://127.0.0.1:${run.port}`];
        const page = await chromiumBrowser.newPage({ viewport: { width: 400, height: 860 } });
        try {
          await page.context().addCookies([
            {
              name: 'maude_studio',
              value: credential.token,
              url: run.hub,
              httpOnly: true,
              sameSite: 'Lax',
            },
          ]);
          await page.goto(`${run.hub}/`);
          await page.waitForSelector('[data-testid="menubar"]', { timeout: 60000 });
          await page.waitForTimeout(1500);
          // A string, not a function: esbuild's __name helper does not exist in
          // the page (the same reason tree-drag.js is read verbatim).
          const layout = (await page.evaluate(`(() => {
            const visible = (q) => {
              const el = document.querySelector(q);
              if (!el) return false;
              const r = el.getBoundingClientRect();
              return r.width > 0 && r.height > 0 && r.left < window.innerWidth && r.right > 0;
            };
            return {
              innerWidth: window.innerWidth,
              scrollWidth: document.documentElement.scrollWidth,
              canvasRowVisible: visible('[data-testid^="canvas-row-"]'),
              syncStatusVisible: visible('.st-sb-sync'),
            };
          })()`)) as {
            innerWidth: number;
            scrollWidth: number;
            canvasRowVisible: boolean;
            syncStatusVisible: boolean;
          };
          return {
            status:
              layout.scrollWidth <= layout.innerWidth + 1 &&
              layout.canvasRowVisible &&
              layout.syncStatusVisible
                ? 'pass'
                : 'fail',
            ...layout,
          };
        } finally {
          await page.screenshot({ path: join(run.out, 'L22-narrow-browser.png') });
          await page.close();
        }
      });
      await check('L22.viewer.read-only-ui', 'viewer-at-hub', async () => {
        const credentials = JSON.parse(readFileSync(run.identities.viewer, 'utf8'));
        const credential = credentials.hubs[`http://127.0.0.1:${run.port}`];
        const page = await chromiumBrowser.newPage({
          viewport: { width: 1440, height: 1000 },
        });
        try {
          // Browser sessions use the same scoped token store via an HttpOnly
          // cookie. A bearer header alone deliberately does not sign in the UI.
          // Fixture provisioning only: the real invitation flow is a separate case.
          await page.context().addCookies([
            {
              name: 'maude_studio',
              value: credential.token,
              url: run.hub,
              httpOnly: true,
              sameSite: 'Lax',
            },
          ]);
          await page.addInitScript(probeScript);
          await page.goto(`${run.hub}/`);
          const viewer = web('viewer', run.roots.hub, page);
          await until(
            async () => (await viewer.read(selector('canvas-row-ui-surfacemedia'))) !== null,
            60000
          );
          await openCanvas(viewer, 'ui/SurfaceMedia.tsx');
          await until(async () => (await viewer.read('h1', true)) === 'Surface media baseline');
          const controls = [];
          for (const q of [selector('tree-new-folder'), '[aria-label="New blank brief board"]']) {
            const element = page.locator(q);
            const writable =
              (await element.count()) > 0 &&
              (await element.isVisible()) &&
              (await element.isEnabled());
            controls.push({ selector: q, writable });
            if (writable) throw new Error(`Viewer offered a writable control: ${q}`);
          }
          if ((await viewer.probe('[aria-label^="Sticky ("]'))?.visible)
            throw new Error('Viewer offered a writable annotation tool');
          const before = bytes(viewer.root, 'ui/SurfaceMedia.tsx');
          // The frame may re-render between the read above and the gesture
          // (a hot-swap landing for this canvas); aim again rather than call a
          // heading that is momentarily between renders "absent". The claim —
          // a viewer cannot edit — is unchanged by trying the gesture again.
          for (let attempt = 1; ; attempt++) {
            try {
              await until(async () => !!(await viewer.probe('h1'))?.visible, 10000);
              await gesture(viewer, 'h1', 'doubleClick');
              break;
            } catch (error) {
              if (attempt >= 3 || !/target absent/.test(String(error))) throw error;
            }
          }
          await sleep(100);
          if ((await viewer.probe('h1[contenteditable]'))?.visible)
            throw new Error('Viewer entered the source editor');
          if (!bytes(viewer.root, 'ui/SurfaceMedia.tsx').equals(before))
            throw new Error('Viewer gesture changed source');
          return {
            controls,
            auth: 'fixture-provisioned viewer-scoped browser session cookie',
            note: 'Visible read-only UI; does not certify invitation or server-side write rejection.',
          };
        } finally {
          await page.screenshot({ path: join(run.out, 'L22-viewer-read-only.png') });
          writeFileSync(
            join(run.out, 'L22-viewer-page.json'),
            JSON.stringify(
              {
                url: page.url(),
                title: await page.title(),
                visibleText: (await page.locator('body').innerText()).slice(0, 8000),
              },
              null,
              2
            )
          );
          await page.close();
        }
      });
      for (const p of all) {
        await check('L05.reclick-active-canvas', p.name, async () => {
          await openCanvas(p, 'ui/SurfaceMedia.tsx');
          await until(async () => (await p.read('h1', true)) === 'Surface media baseline');
          const start = performance.now();
          await p.click(selector('canvas-row-ui-surfacemedia'));
          try {
            // Same-path open does not navigate the existing iframe. Observe
            // beyond the shell's 15s load cap to expose a spurious load error.
            while (performance.now() - start < 17000) {
              const error = await p.read(selector('canvas-load-error'));
              if (error !== null)
                throw new Error(`Already-rendered canvas became blocked: ${error}`);
              await sleep(100);
            }
            if ((await p.read('h1', true)) !== 'Surface media baseline')
              throw new Error('Canvas no longer visibly rendered');
            return { observationWindowMs: performance.now() - start };
          } finally {
            await p.screenshot(join(run.out, `L05-reclick-active-${p.name}.png`));
          }
        });
      }
      // ── Plan T31 — structured UI operations, races and final parity ─────
      // Setup is a filesystem gesture on the author (like L06); every oracle is
      // the OTHER participants' visible UI and disk.
      const seedCanvas = async (from: Surface, rel: string, body: string) => {
        writeFileSync(join(from.root, '.design', rel), body);
        await until(
          () =>
            all.every(
              (p) =>
                existsSync(join(p.root, '.design', rel)) &&
                readFileSync(join(p.root, '.design', rel), 'utf8') === body
            ),
          30000
        );
      };
      // Inside a DesignCanvas artboard, like every real canvas: the tool
      // palette (edit mode) and the inspector only exist there.
      const elementCanvas = (title: string) =>
        `import { DesignCanvas, DCArtboard } from '@maude/canvas-lib';\nexport default function SurfaceEl() {\n  return (\n    <DesignCanvas>\n      <DCArtboard id="el" label="Element" width={600} height={400}>\n        <section style={{ padding: 24 }}>\n          <h1 style={{ fontWeight: "400" }}>${title}</h1>\n          <p>Kept paragraph</p>\n        </section>\n      </DCArtboard>\n    </DesignCanvas>\n  );\n}\n`;
      const headings = async (p: Surface) => (await p.probe('h1'))?.matches?.length ?? 0;
      const count = (p: Surface, rel: string, needle: string) =>
        (readFileSync(join(p.root, '.design', rel), 'utf8').match(new RegExp(needle, 'g')) ?? [])
          .length;
      const openSeeded = async (rel: string, title: string, id: string) => {
        for (const p of all) {
          const row = selector(`canvas-row-${slug(rel.replace(/\.tsx$/, ''))}`);
          try {
            // A canvas that arrived by the project's own sync: its row first.
            await until(async () => (await p.read(row)) !== null, 30000);
            await openCanvas(p, rel);
            await until(async () => (await p.read('h1', true)) === title, 30000);
          } catch (error) {
            await p.screenshot(join(run.out, `${id}-open-${p.name}-failed.png`));
            throw new Error(`${p.name}: ${String(error)}`);
          }
        }
      };
      // L04 — rename in place and duplicate, through the file tree's own row
      // menu. Receivers keep the canvas open: their tab follows the rename.
      const rowOf = (rel: string) => selector(`canvas-row-${slug(rel.replace(/\.tsx$/, ''))}`);
      const frameOf = (rel: string) => `[data-testid="canvas-frame"][data-path=".design/${rel}"]`;
      // L05 — switch away and back: while the others look at another canvas,
      // one person changes the first; switching back shows the change at once,
      // in the one tab it already had — no stale render, no second tab.
      {
        const away = 'ui/SurfaceSwitchAway.tsx';
        const back = 'ui/SurfaceSwitchBack.tsx';
        const pages: Record<string, Page | undefined> = { hub: hubPage, peer: peerPage };
        const frames = async (p: Surface, rel: string) =>
          pages[p.name]
            ? await (pages[p.name] as Page).locator(frameOf(rel)).count()
            : (await browser.$$(frameOf(rel))).length;
        let seeded = false;
        for (const [i, from] of all.entries()) {
          await check(
            'L05.switch-away-and-back',
            `${from.name}-edits-while-others-away`,
            async () => {
              if (!seeded) {
                await seedCanvas(all[0] as Surface, back, elementCanvas('Switch back v0'));
                await seedCanvas(all[0] as Surface, away, elementCanvas('Away'));
                seeded = true;
              }
              const others = all.filter((p) => p !== from);
              for (const p of all) {
                await until(async () => (await p.read(rowOf(back))) !== null, 30000);
                await until(async () => (await p.read(rowOf(away))) !== null, 30000);
                await openCanvas(p, back);
              }
              for (const p of others) {
                await openCanvas(p, away);
                await until(async () => (await p.read('h1', true)) === 'Away');
              }
              const title = `Switch back v${i + 1} by ${from.name}`;
              const body = elementCanvas(title);
              writeFileSync(join(from.root, '.design', back), body);
              await until(
                () => others.every((p) => bytes(p.root, back).toString() === body),
                30000
              );
              const start = performance.now();
              for (const p of others) await openCanvas(p, back);
              const shown = await observeAll(
                others,
                `L05-switch-back-${from.name}`,
                start,
                async (p) => (await p.read('h1', true)) === title
              );
              const tabs = await Promise.all(
                others.map(async (p) => ({ participant: p.name, frames: await frames(p, back) }))
              );
              // The canvas rebuilds when its source changes, so the one-shot
              // final sample can land inside a reload. Settling is not a
              // revert: re-read, and say that it settled.
              const settled: string[] = [];
              if (shown.status !== 'pass') {
                for (const p of others) {
                  if ((await p.read('h1', true)) === title) continue;
                  await until(async () => (await p.read('h1', true)) === title, 10000)
                    .then(() => settled.push(p.name))
                    .catch(() => {});
                }
              }
              const wrong = (
                await Promise.all(
                  others.map(async (p) => ((await p.read('h1', true)) === title ? null : p.name))
                )
              ).filter(Boolean);
              return {
                ...shown,
                status: wrong.length === 0 && tabs.every((t) => t.frames === 1) ? 'pass' : 'fail',
                tabs,
                ...(settled.length ? { settledAfterReload: settled } : {}),
                ...(wrong.length ? { notShowing: wrong } : {}),
              };
            }
          );
        }
      }
      for (const from of all) {
        const rel = `ui/SurfaceRen-${from.name}.tsx`;
        const renamed = `ui/SurfaceRen-${from.name}-renamed.tsx`;
        const body = elementCanvas(`Rename ${from.name}`);
        await check('L04.canvas.rename', `${from.name}-to-peers`, async () => {
          await seedCanvas(from, rel, body);
          await openSeeded(rel, `Rename ${from.name}`, `L04-rename-${from.name}`);
          await from.hover(rowOf(rel));
          await from.click(selector(`tree-row-menu-${slug(rel.replace(/\.tsx$/, ''))}`));
          await from.promptNext(`SurfaceRen-${from.name}-renamed`);
          const start = performance.now();
          await from.menu('Rename…');
          return observeAll(
            all,
            `L04-rename-${from.name}`,
            start,
            async (p) =>
              (await p.read(rowOf(rel))) === null &&
              (await p.read(rowOf(renamed))) !== null &&
              (await p.read(frameOf(renamed))) !== null &&
              (await p.read('h1', true)) === `Rename ${from.name}`,
            (p) =>
              !existsSync(join(p.root, '.design', rel)) &&
              existsSync(join(p.root, '.design', renamed)) &&
              readFileSync(join(p.root, '.design', renamed), 'utf8') === body
          );
        });
        const dupRel = `ui/SurfaceDup-${from.name}.tsx`;
        const copyRel = `ui/SurfaceDup-${from.name} copy.tsx`;
        const dupBody = elementCanvas(`Duplicate ${from.name}`);
        await check('L04.canvas.duplicate', `${from.name}-to-peers`, async () => {
          await seedCanvas(from, dupRel, dupBody);
          for (const p of all)
            await until(async () => (await p.read(rowOf(dupRel))) !== null, 30000);
          await from.hover(rowOf(dupRel));
          await from.click(selector(`tree-row-menu-${slug(dupRel.replace(/\.tsx$/, ''))}`));
          const start = performance.now();
          await from.menu('Duplicate');
          const result = await observeAll(
            all,
            `L04-duplicate-${from.name}`,
            start,
            async (p) =>
              (await p.read(rowOf(copyRel))) !== null && (await p.read(rowOf(dupRel))) !== null,
            (p) =>
              existsSync(join(p.root, '.design', copyRel)) &&
              readFileSync(join(p.root, '.design', copyRel), 'utf8') === dupBody &&
              readFileSync(join(p.root, '.design', dupRel), 'utf8') === dupBody
          );
          // The copy opens and renders on a receiver, independently of the original.
          const receiver = all.find((p) => p !== from) as Surface;
          await openCanvas(receiver, copyRel);
          await until(
            async () => (await receiver.read('h1', true)) === `Duplicate ${from.name}`,
            30000
          );
          return result;
        });
      }
      // L02 — populated, nested folders: create a nested hierarchy through the
      // tree (folder + "New folder here"), put a canvas with its meta and its
      // whiteboard inside, then move the whole hierarchy, rename it and delete
      // the subtree — every descendant and sidecar follows, nothing ghosts.
      const folderRow = (dir: string) => selector(`tree-folder-${slug(dir)}`);
      const expand = async (p: Surface, dir: string) => {
        if ((await p.read(`${folderRow(dir)}[aria-expanded="false"]`)) !== null)
          await p.click(folderRow(dir));
      };
      const annotationsOf = (rel: string) =>
        `${slug(rel.replace(/\.tsx$/, '')).replace(/-+$/, '')}.annotations.svg`;
      const has = (p: Surface, rel: string) => existsSync(join(p.root, '.design', rel));
      for (const from of all) {
        const top = `Tree-${from.name}`;
        const dest = `NestDest-${from.name}`;
        let base = `ui/${top}`;
        const inner = () => `${base}/Leaf/Inner.tsx`;
        const innerBody = elementCanvas(`Nested ${from.name}`);
        await check('L02.nested.create', `${from.name}-to-peers`, async () => {
          // Destination for the later move, seeded like any fixture folder.
          mkdirSync(join(from.root, '.design/ui', dest), { recursive: true });
          writeFileSync(join(from.root, '.design/ui', dest, '.gitkeep'), '');
          await from.click(selector('tree-new-folder'));
          await from.fill('[aria-label="New folder name"]', top);
          await from.click('[aria-label="Create folder"]');
          await until(async () => (await from.read(folderRow(base))) !== null);
          await from.hover(folderRow(base));
          await from.click(selector(`tree-row-menu-${slug(base)}`));
          await from.promptNext('Leaf');
          await from.menu('New folder here');
          await until(() => has(from, `${base}/Leaf`));
          const start = performance.now();
          writeFileSync(join(from.root, '.design', inner()), innerBody);
          writeFileSync(
            join(from.root, '.design', inner().replace(/\.tsx$/, '.meta.json')),
            JSON.stringify({ title: 'Inner', kind: 'web' })
          );
          // A whiteboard with a mark on it: an empty wrapper is not content.
          writeFileSync(
            join(from.root, '.design', annotationsOf(inner())),
            '<svg xmlns="http://www.w3.org/2000/svg"><rect data-id="s_nest1" data-tool="rect" x="10" y="10" width="40" height="30" fill="none" stroke="#111"/></svg>'
          );
          return observeAll(
            all,
            `L02-create-${from.name}`,
            start,
            async (p) => {
              await expand(p, base);
              await expand(p, `${base}/Leaf`);
              return (await p.read(rowOf(inner()))) !== null;
            },
            (p) =>
              has(p, inner()) &&
              has(p, inner().replace(/\.tsx$/, '.meta.json')) &&
              has(p, annotationsOf(inner())) &&
              has(p, `ui/${dest}`)
          );
        });
        await check('L02.nested.move', `${from.name}-to-peers`, async () => {
          if (all.some((p) => !has(p, inner()) || !has(p, `ui/${dest}`)))
            throw new Unexercised('Move needs the nested hierarchy and its destination everywhere');
          const before = { canvas: inner(), annotations: annotationsOf(inner()) };
          for (const p of all) await expand(p, 'ui');
          const start = performance.now();
          await from.dragTo(folderRow(base), folderRow(`ui/${dest}`));
          base = `ui/${dest}/${top}`;
          return observeAll(
            all,
            `L02-move-${from.name}`,
            start,
            async (p) => (await p.read(folderRow(`ui/${top}`))) === null,
            (p) =>
              has(p, inner()) &&
              has(p, inner().replace(/\.tsx$/, '.meta.json')) &&
              has(p, annotationsOf(inner())) &&
              !has(p, before.canvas) &&
              !has(p, before.annotations) &&
              readFileSync(join(p.root, '.design', inner()), 'utf8') === innerBody
          );
        });
        await check('L02.nested.rename', `${from.name}-to-peers`, async () => {
          if (all.some((p) => !has(p, inner())))
            throw new Unexercised('Rename needs the moved hierarchy everywhere');
          const oldBase = base;
          const oldInner = inner();
          // Wherever the hierarchy is now (moved, or still in place when the
          // move row could not run): the rename keeps its parent.
          const parent = base.split('/').slice(0, -1).join('/');
          await expand(from, parent);
          await until(async () => (await from.read(folderRow(base))) !== null);
          await from.hover(folderRow(base));
          await from.click(selector(`tree-row-menu-${slug(base)}`));
          await from.promptNext(`${top}-renamed`);
          const start = performance.now();
          await from.menu('Rename folder');
          base = `${parent}/${top}-renamed`;
          return observeAll(
            all,
            `L02-rename-${from.name}`,
            start,
            async (p) => {
              await expand(p, parent);
              return (
                (await p.read(folderRow(oldBase))) === null &&
                (await p.read(folderRow(base))) !== null
              );
            },
            (p) =>
              has(p, inner()) &&
              has(p, annotationsOf(inner())) &&
              !has(p, oldInner) &&
              !has(p, annotationsOf(oldInner)) &&
              readFileSync(join(p.root, '.design', inner()), 'utf8') === innerBody
          );
        });
        await check('L02.nested.delete-subtree', `${from.name}-to-peers`, async () => {
          if (all.some((p) => !has(p, inner())))
            throw new Unexercised('Delete needs the hierarchy everywhere');
          const doomed = {
            dir: base,
            canvas: inner(),
            meta: inner().replace(/\.tsx$/, '.meta.json'),
            annotations: annotationsOf(inner()),
          };
          await expand(from, base.split('/').slice(0, -1).join('/'));
          await from.hover(folderRow(base));
          await from.click(selector(`tree-row-menu-${slug(base)}`));
          await from.confirmNext();
          const start = performance.now();
          await from.menu('Delete folder');
          return observeAll(
            all,
            `L02-delete-${from.name}`,
            start,
            async (p) =>
              (await p.read(folderRow(doomed.dir))) === null &&
              (await p.read(rowOf(doomed.canvas))) === null,
            (p) =>
              !has(p, doomed.canvas) &&
              !has(p, doomed.meta) &&
              !has(p, doomed.annotations) &&
              !has(p, doomed.dir)
          );
        });
      }
      // L11 — comments, through the canvas's own comment tool and thread card:
      // create a pinned thread, reply, resolve, reopen, delete. Receivers keep
      // the canvas open; the oracle is their pin/thread UI and comments on disk.
      const commentsOf = (p: Surface, rel: string) => {
        try {
          const raw = JSON.parse(
            readFileSync(
              join(p.root, '.design', '_comments', `${slug(rel.replace(/\.tsx$/, ''))}.json`),
              'utf8'
            )
          );
          return (Array.isArray(raw) ? raw : (raw.comments ?? [])) as Array<{
            id: string;
            text: string;
            status?: string;
            thread?: Array<{ body: string }>;
          }>;
        } catch {
          return [];
        }
      };
      const pin = (id: string) => `[data-comment-pin="${id}"]`;
      const openThread = async (p: Surface, id: string) => {
        if ((await p.probe('.cm-thread'))?.visible) return;
        await gesture(p, pin(id), 'click');
        await until(async () => !!(await p.probe('.cm-thread'))?.visible);
      };
      for (const from of all) {
        const rel = `ui/SurfaceComments-${from.name}.tsx`;
        const text = `Comment from ${from.name}`;
        const reply = `Reply from ${from.name}`;
        // The thread keeps its id when its author edits the text.
        let threadId: string | null = null;
        const idOf = () =>
          (threadId ??= commentsOf(from, rel).find((c) => c.text === text)?.id ?? null);
        await check('L11.comment.create', `${from.name}-to-peers`, async () => {
          await seedCanvas(from, rel, elementCanvas(`Comments ${from.name}`));
          await openSeeded(rel, `Comments ${from.name}`, `L11-${from.name}`);
          await gesture(from, '.dc-tool-palette button[aria-label^="Comment"]', 'click');
          await gesture(from, 'h1', 'pointer');
          await until(
            async () => !!(await from.probe('[aria-label="Comment body"]'))?.visible
          ).catch(async (error) => {
            await from.screenshot(join(run.out, `L11-composer-${from.name}-failed.png`));
            throw error;
          });
          await gesture(from, '[aria-label="Comment body"]', 'fill', text);
          const start = performance.now();
          await gesture(from, '.cm-composer .cm-btn--primary', 'click');
          return observeAll(
            all,
            `L11-create-${from.name}`,
            start,
            async (p) => {
              const id = commentsOf(p, rel).find((c) => c.text === text)?.id;
              return !!id && !!(await p.probe(pin(id)))?.visible;
            },
            (p) => commentsOf(p, rel).some((c) => c.text === text)
          );
        });
        await check('L11.comment.reply', `${from.name}-to-peers`, async () => {
          const id = idOf();
          if (!id || all.some((p) => !commentsOf(p, rel).some((c) => c.id === id)))
            throw new Unexercised('Reply needs the thread on every participant');
          await openThread(from, id);
          await gesture(from, '[aria-label="Reply"]', 'fill', reply);
          const start = performance.now();
          await gesture(from, '.cm-thread__reply-actions .cm-btn--primary', 'click');
          return observeAll(
            all,
            `L11-reply-${from.name}`,
            start,
            async (p) => {
              if (
                !commentsOf(p, rel)
                  .find((c) => c.id === id)
                  ?.thread?.some((r) => r.body === reply)
              )
                return false;
              await openThread(p, id);
              return ((await p.read('.cm-thread', true)) ?? '').includes(reply);
            },
            (p) =>
              !!commentsOf(p, rel)
                .find((c) => c.id === id)
                ?.thread?.some((r) => r.body === reply)
          );
        });
        // The author corrects their own comment in place: the new text
        // replaces the old on every canvas and disk, the thread keeps its reply.
        await check('L11.comment.edit', `${from.name}-to-peers`, async () => {
          const id = idOf();
          if (!id || all.some((p) => !commentsOf(p, rel).some((c) => c.id === id)))
            throw new Unexercised('Edit needs the thread on every participant');
          await openThread(from, id);
          await until(async () => !!(await from.probe(selector('comment-edit')))?.visible).catch(
            () => {
              throw new Error('The author is not offered Edit on their own comment');
            }
          );
          await gesture(from, selector('comment-edit'), 'click');
          const edited = `Edited by ${from.name}`;
          await until(async () => !!(await from.probe('[aria-label="Edit comment"]'))?.visible);
          await gesture(from, '[aria-label="Edit comment"]', 'fill', edited);
          const start = performance.now();
          await gesture(from, selector('comment-edit-save'), 'click');
          return observeAll(
            all,
            `L11-edit-${from.name}`,
            start,
            async (p) => {
              const c = commentsOf(p, rel).find((x) => x.id === id);
              if (c?.text !== edited) return false;
              await openThread(p, id);
              return ((await p.read('.cm-thread', true)) ?? '').includes(edited);
            },
            (p) => {
              const c = commentsOf(p, rel).find((x) => x.id === id);
              return c?.text === edited && !!c.thread?.some((r) => r.body === reply);
            }
          );
        });
        const statusOf = (p: Surface, id: string) =>
          commentsOf(p, rel).find((c) => c.id === id)?.status ?? 'open';
        // Resolve from the thread card. A resolved thread leaves the canvas (its
        // pin is hidden by default) and stays listed under Resolved.
        await check('L11.comment.resolve', `${from.name}-to-peers`, async () => {
          const id = idOf();
          if (!id) throw new Unexercised('resolve needs the thread');
          await openThread(from, id);
          const button = '.cm-thread__actions .cm-btn--primary';
          if (!((await from.read(button, true)) ?? '').includes('Resolve'))
            throw new Error('Thread offers no ✓ Resolve');
          const start = performance.now();
          await gesture(from, button, 'click');
          return observeAll(
            all,
            `L11-resolve-${from.name}`,
            start,
            async (p) =>
              statusOf(p, id) === 'resolved' && (await p.probe(pin(id)))?.visible !== true,
            (p) => statusOf(p, id) === 'resolved'
          );
        });
        // Reopen from the Comments panel — the one place a resolved thread is
        // reachable. It comes back onto every canvas.
        await check('L11.comment.reopen', `${from.name}-to-peers`, async () => {
          const id = idOf();
          if (!id || statusOf(from, id) !== 'resolved')
            throw new Unexercised('reopen needs a resolved thread');
          await from.click(selector('dock-tab-comments'));
          await from.click(selector('comment-filter-resolved'));
          const reopen = `${selector(`comment-item-${id}`)} [aria-label="Reopen"]`;
          await until(async () => (await from.read(reopen)) !== null);
          const start = performance.now();
          await from.click(reopen);
          return observeAll(
            all,
            `L11-reopen-${from.name}`,
            start,
            async (p) => statusOf(p, id) === 'open' && !!(await p.probe(pin(id)))?.visible,
            (p) => statusOf(p, id) === 'open'
          );
        });
        await check('L11.comment.delete', `${from.name}-to-peers`, async () => {
          const id = idOf();
          if (!id) throw new Unexercised('Delete needs the thread');
          await openThread(from, id);
          const start = performance.now();
          await gesture(from, '.cm-thread__actions .cm-btn--danger', 'click');
          return observeAll(
            all,
            `L11-delete-${from.name}`,
            start,
            async (p) => (await p.probe(pin(id)))?.visible !== true,
            (p) => !commentsOf(p, rel).some((c) => c.id === id)
          );
        });
      }
      // L03 — a supporting file beside the canvases (a note): created and edited
      // the way an editor saves it, then renamed, moved and deleted from the
      // tree's own ⋯ menu. The oracle is every receiver's tree row and bytes.
      for (const from of all) {
        // An image beside the canvases — shown in the tree by default (a
        // markdown note is shown only with "show hidden files").
        let rel = `ui/Notes-${from.name}.png`;
        const dest = `NoteDest-${from.name}`;
        const fileRow = (r: string) => selector(`file-row-${slug(r)}`);
        const bytesOf = (p: Surface, r: string) =>
          existsSync(join(p.root, '.design', r))
            ? readFileSync(join(p.root, '.design', r)).toString('base64')
            : null;
        // Two different, valid 1×1 PNGs (the second is a real re-save).
        const png1 =
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
        const png2 =
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
        const body1 = png1;
        const body2 = png2;
        await check('L03.file.create', `${from.name}-to-peers`, async () => {
          mkdirSync(join(from.root, '.design/ui', dest), { recursive: true });
          writeFileSync(join(from.root, '.design/ui', dest, '.gitkeep'), '');
          const start = performance.now();
          writeFileSync(join(from.root, '.design', rel), Buffer.from(body1, 'base64'));
          return observeAll(
            all,
            `L03-create-${from.name}`,
            start,
            async (p) => (await p.read(fileRow(rel))) !== null,
            (p) => bytesOf(p, rel) === body1 && existsSync(join(p.root, '.design/ui', dest))
          );
        });
        await check('L03.file.edit', `${from.name}-to-peers`, async () => {
          if (all.some((p) => bytesOf(p, rel) !== body1))
            throw new Unexercised('Edit needs the note everywhere');
          const start = performance.now();
          writeFileSync(join(from.root, '.design', rel), Buffer.from(body2, 'base64'));
          return observeAll(
            all,
            `L03-edit-${from.name}`,
            start,
            async () => true,
            (p) => bytesOf(p, rel) === body2
          );
        });
        await check('L03.file.rename', `${from.name}-to-peers`, async () => {
          if (all.some((p) => bytesOf(p, rel) !== body2))
            throw new Unexercised('Rename needs the edited note everywhere');
          const old = rel;
          const next = `ui/Notes-${from.name}-renamed.png`;
          await from.hover(fileRow(old));
          await from.click(selector(`tree-row-menu-${slug(old)}`));
          await from.promptNext(`Notes-${from.name}-renamed`);
          const start = performance.now();
          await from.menu('Rename…');
          rel = next;
          return observeAll(
            all,
            `L03-rename-${from.name}`,
            start,
            async (p) =>
              (await p.read(fileRow(old))) === null && (await p.read(fileRow(next))) !== null,
            (p) => bytesOf(p, old) === null && bytesOf(p, next) === body2
          );
        });
        await check('L03.file.move', `${from.name}-to-peers`, async () => {
          if (all.some((p) => bytesOf(p, rel) !== body2))
            throw new Unexercised('Move needs the note everywhere');
          const old = rel;
          const next = `ui/${dest}/${old.split('/').pop()}`;
          await from.hover(fileRow(old));
          await from.click(selector(`tree-row-menu-${slug(old)}`));
          await from.menu('Move to…');
          const start = performance.now();
          await from.menu(`ui/${dest}`);
          rel = next;
          return observeAll(
            all,
            `L03-move-${from.name}`,
            start,
            async (p) => (await p.read(fileRow(old))) === null,
            (p) => bytesOf(p, old) === null && bytesOf(p, next) === body2
          );
        });
        await check('L03.file.delete', `${from.name}-to-peers`, async () => {
          if (all.some((p) => bytesOf(p, rel) !== body2))
            throw new Unexercised('Delete needs the note everywhere');
          const doomed = rel;
          await expand(from, `ui/${dest}`);
          await until(async () => (await from.read(fileRow(doomed))) !== null);
          await from.hover(fileRow(doomed));
          await from.click(selector(`tree-row-menu-${slug(doomed)}`));
          await from.confirmNext();
          const start = performance.now();
          await from.menu('Delete');
          return observeAll(
            all,
            `L03-delete-${from.name}`,
            start,
            async (p) => (await p.read(fileRow(doomed))) === null,
            (p) => bytesOf(p, doomed) === null
          );
        });
      }
      // L09 context controls — every annotation property the toolbar offers,
      // driven through the toolbar itself on seeded annotations. Two oracles:
      // every participant's annotations sidecar is byte-identical to the
      // author's and differs from before the step; every participant's own
      // render of the target changed (each against itself, so WebKit and
      // Chromium never have to agree on markup).
      for (const from of all) {
        const name = `SurfaceCtx-${from.name}`;
        const rel = `ui/${name}.tsx`;
        const sidecar = `ui-${slug(name)}.annotations.svg`;
        notesSidecar = sidecar; // the evidence dump (observeAll) copies this one
        const disk = (p: Surface) => {
          const path = join(p.root, '.design', sidecar);
          return existsSync(path) ? readFileSync(path, 'utf8') : null;
        };
        const ids = {
          rect: 's_ctxrect',
          text: 's_ctxtext',
          arrow: 's_ctxarrow',
          g1: 's_ctxg1',
          g2: 's_ctxg2',
          g3: 's_ctxg3',
        };
        const rectOf = (id: string, x: number, y: number, w = 100, h = 70) =>
          `<rect data-id="${id}" data-tool="rect" stroke="#1f1f1f" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" fill="#e7e7e7" x="${x}" y="${y}" width="${w}" height="${h}"/>`;
        const seeded =
          `<svg xmlns="http://www.w3.org/2000/svg" data-mdcc-annotations="1">` +
          rectOf(ids.rect, 40, 120) +
          `<text data-id="${ids.text}" data-tool="text" x="40" y="240" data-font-size="14" fill="#1f1f1f" text-anchor="start" dominant-baseline="hanging">Formatted text</text>` +
          `<g data-id="${ids.arrow}" data-tool="arrow" stroke="#1f1f1f" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" fill="none"><line x1="200" y1="130" x2="320" y2="190"/><polyline points="302.3,186.8 320,190 311.5,174.1" fill="#1f1f1f"/></g>` +
          // Three sizes and uneven gaps, so every align/distribute action
          // below moves something whatever ran before it.
          rectOf(ids.g1, 380, 120, 40, 30) +
          rectOf(ids.g2, 450, 170, 60, 50) +
          rectOf(ids.g3, 600, 260, 80, 70) +
          `</svg>`;
        let ready = false;
        await check('L09.context-controls.seed', `${from.name}-to-peers`, async () => {
          await seedCanvas(from, rel, elementCanvas(`Context ${from.name}`));
          // The way an agent's `maude design annotate` writes them: through
          // the author's own studio, not onto the sidecar (a file event on an
          // annotations sidecar is never proposed — the collab room is its
          // second writer).
          const put = async (b: { file: string; svg: string; base: string }) => {
            const r = await fetch('/_api/annotations', {
              method: 'PUT',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(b),
            });
            return r.status;
          };
          const body = { file: `.design/${rel}`, svg: seeded, base: '' };
          const status =
            from === native
              ? await browser.execute(put, body)
              : await (from.name === 'hub' ? hubPage : peerPage).evaluate(put, body);
          if (status >= 300) throw new Error(`annotations PUT answered ${status}`);
          await until(() => all.every((p) => disk(p)?.includes(ids.g3) === true), 30000).catch(
            () => {
              throw new Unexercised('The seeded annotations did not reach everyone');
            }
          );
          await openSeeded(rel, `Context ${from.name}`, `L09-ctx-open-${from.name}`);
          const start = performance.now();
          const result = await observeAll(
            all,
            `L09-ctx-seed-${from.name}`,
            start,
            async (p) =>
              (
                await Promise.all(Object.values(ids).map((id) => p.probe(`[data-id="${id}"]`)))
              ).every((r) => !!r?.visible),
            (p) => disk(p) === disk(from)
          );
          ready = result.status === 'pass';
          return result;
        });
        const toolbar = '[aria-label="Annotation properties"]';
        const select = async (targets: string[]) => {
          await gesture(from, selector('palette-mode-edit'), 'click');
          for (const [i, id] of targets.entries())
            await gesture(
              from,
              `[data-id="${id}"]`,
              'pointer',
              i > 0 ? { shift: true } : undefined
            );
          await until(async () => !!(await from.probe(toolbar))?.visible, 15000);
        };
        const inToolbar = (q: string) => `${toolbar} ${q}`;
        const step = (
          id: string,
          targets: string[],
          act: () => Promise<void>,
          expectDisk?: (svg: string) => boolean,
          // Group/ungroup change the data, not how the members render.
          renders = true
        ) =>
          check(id, `${from.name}-to-peers`, async () => {
            if (!ready) throw new Unexercised('Context controls need the seeded annotations');
            await select(targets);
            const markupOf = async (p: Surface) =>
              (await Promise.all(targets.map((t) => p.probe(`[data-id="${t}"]`))))
                .map((r) => r?.markup ?? '')
                .join('\n');
            const before = await Promise.all(all.map(markupOf));
            const beforeDisk = disk(from);
            const start = performance.now();
            await act();
            return observeAll(
              all,
              `${id.replace(/\./g, '-')}-${from.name}`,
              start,
              async (p) =>
                renders
                  ? (await markupOf(p)) !== before[all.indexOf(p)]
                  : (await Promise.all(targets.map((t) => p.probe(`[data-id="${t}"]`)))).every(
                      (r) => !!r?.visible
                    ),
              (p) => {
                const svg = disk(p);
                return (
                  !!svg &&
                  svg !== beforeDisk &&
                  svg === disk(from) &&
                  (expectDisk ? expectDisk(svg) : true)
                );
              }
            );
          });
        const click = (q: string) => () => gesture(from, inToolbar(q), 'click');
        const pick = (menu: string, trigger: string, item: string) => async () => {
          await gesture(from, inToolbar(trigger), 'click');
          await until(
            async () =>
              !!(await from.probe(inToolbar(`[role="menu"][aria-label="${menu}"]`)))?.visible
          );
          await gesture(
            from,
            inToolbar(`[role="menu"][aria-label="${menu}"] [aria-label="${item}"]`),
            'click'
          );
        };
        const r = [ids.rect];
        await step(
          'L09.context-control.thick-stroke',
          r,
          click('[aria-label="Thick stroke"]'),
          (s) => new RegExp(`data-id="${ids.rect}"[^>]*stroke-width="6"`).test(s)
        );
        await step('L09.context-control.thin-stroke', r, click('[aria-label="Thin stroke"]'), (s) =>
          new RegExp(`data-id="${ids.rect}"[^>]*stroke-width="3"`).test(s)
        );
        await step('L09.context-control.dashed-line', r, click('[aria-label="Dashed line"]'));
        await step(
          'L09.context-control.color',
          r,
          click('[aria-label="Color"] button[aria-pressed="false"]')
        );
        await step('L09.context-control.swatch-target', r, async () => {
          await gesture(
            from,
            inToolbar('[aria-label="Swatch target"] button:nth-child(2)'),
            'click'
          );
          await gesture(
            from,
            inToolbar(
              '[aria-label="Color"] button[aria-pressed="false"]:not([aria-label="No fill"])'
            ),
            'click'
          );
        });
        await step('L09.context-control.no-fill', r, async () => {
          await gesture(
            from,
            inToolbar('[aria-label="Swatch target"] button:nth-child(2)'),
            'click'
          );
          await gesture(from, inToolbar('[aria-label="No fill"]'), 'click');
        });
        const t = [ids.text];
        for (const [control, label] of [
          ['bold', 'Bold'],
          ['italic', 'Italic'],
          ['strikethrough', 'Strikethrough'],
          ['underline', 'Underline'],
          ['bulleted-list', 'Bulleted list'],
          ['numbered-list', 'Numbered list'],
        ] as const)
          await step(`L09.context-control.${control}`, t, click(`[aria-label="${label}"]`));
        for (const [value, label] of [
          ['center', 'Align center'],
          ['right', 'Align right'],
          ['left', 'Align left'],
        ] as const)
          await step(
            `L09.text-align.${value}`,
            t,
            pick('Text alignment', '[aria-label^="Text alignment:"]', label)
          );
        await step(
          'L09.context-control.font-size',
          t,
          async () => {
            await gesture(from, inToolbar('[aria-label^="Font size:"]'), 'click');
            await until(
              async () =>
                !!(await from.probe(inToolbar('[role="menu"][aria-label="Font size"]')))?.visible
            );
            await gesture(
              from,
              inToolbar('[role="menu"][aria-label="Font size"] button:nth-child(3)'),
              'click'
            );
          },
          (s) => new RegExp(`data-id="${ids.text}"[^>]*data-font-size="24"`).test(s)
        );
        await step(
          'L09.context-control.custom-font-size-in-pixels',
          t,
          async () => {
            await gesture(from, inToolbar('[aria-label^="Font size:"]'), 'click');
            const input = inToolbar('[aria-label="Custom font size in pixels"]');
            await until(async () => !!(await from.probe(input))?.visible);
            await gesture(from, input, 'fill', '40');
            await gesture(from, input, 'key', { key: 'Enter' });
          },
          (s) => new RegExp(`data-id="${ids.text}"[^>]*data-font-size="40"`).test(s)
        );
        const a = [ids.arrow];
        for (const [value, label] of [
          ['none', 'None'],
          ['line', 'Line'],
          ['triangle-outline', 'Triangle (outline)'],
          ['circle', 'Circle'],
          ['diamond', 'Diamond'],
          ['triangle', 'Triangle'],
        ] as const)
          await step(
            `L09.arrow-head.${value}`,
            a,
            pick('End arrowhead', '[aria-label^="End arrowhead:"]', label)
          );
        await step(
          'L09.arrow-head.start-diamond',
          a,
          pick('Start arrowhead', '[aria-label^="Start arrowhead:"]', 'Diamond')
        );
        for (const [value, label] of [
          ['curved', 'Curved'],
          ['elbow', 'Elbow'],
          ['straight', 'Straight'],
        ] as const)
          await step(
            `L09.arrow-line.${value}`,
            a,
            pick('Line type', '[aria-label^="Line type:"]', label)
          );
        const g = [ids.g1, ids.g2, ids.g3];
        for (const [value, label] of [
          ['dist-h', 'Distribute horizontal spacing'],
          ['dist-v', 'Distribute vertical spacing'],
          ['left', 'Align left'],
          ['h-center', 'Align horizontal centers'],
          ['right', 'Align right'],
          ['top', 'Align top'],
          ['v-center', 'Align vertical centers'],
          ['bottom', 'Align bottom'],
        ] as const)
          await step(
            `L09.selection-align.${value}`,
            g,
            pick('Align and distribute', '[aria-label="Align and distribute"]', label)
          );
        await step(
          'L09.context-control.group-selection',
          g,
          click('[aria-label="Group selection"]'),
          undefined,
          false
        );
        await step(
          'L09.context-control.ungroup-selection',
          g,
          click('[aria-label="Ungroup selection"]'),
          undefined,
          false
        );
        await check(
          'L09.context-control.delete-selected-annotations',
          `${from.name}-to-peers`,
          async () => {
            if (!ready) throw new Unexercised('Context controls need the seeded annotations');
            await select([ids.rect]);
            const start = performance.now();
            await gesture(from, inToolbar('[aria-label="Delete selected annotations"]'), 'click');
            return observeAll(
              all,
              `L09-ctx-delete-${from.name}`,
              start,
              async (p) => (await p.probe(`[data-id="${ids.rect}"]`)) === null,
              (p) => disk(p)?.includes(ids.rect) === false && disk(p)?.includes(ids.text) === true
            );
          }
        );
      }
      // L17 — one media file, several references: two canvases show the same
      // image; removing it from one keeps the other (and the file); renaming or
      // deleting a file a canvas still uses is refused, naming that canvas,
      // and nothing changes anywhere.
      for (const from of all) {
        const png = `ui/SharedRef-${from.name}.png`;
        const pngBytes = Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
          'base64'
        );
        const a = `ui/SharedA-${from.name}.tsx`;
        const b = `ui/SharedB-${from.name}.tsx`;
        const withImg = (title: string, img: boolean) =>
          `import { DesignCanvas, DCArtboard } from '@maude/canvas-lib';\nexport default function Shared() {\n  return (\n    <DesignCanvas>\n      <DCArtboard id="shared" label="Shared" width={400} height={240}>\n        <section style={{ padding: 24 }}>\n          <h1 style={{ fontWeight: "400" }}>${title}</h1>\n${img ? `          <img src="/.design/${png}" alt="shared" width={40} height={40} />\n` : ''}        </section>\n      </DCArtboard>\n    </DesignCanvas>\n  );\n}\n`;
        const onDisk = (p: Surface, r: string) => existsSync(join(p.root, '.design', r));
        const shown = async (p: Surface) => {
          const img = await p.probe('img[alt="shared"]');
          return !!img?.visible && (img.width ?? 0) > 0 && img.complete === true;
        };
        const fileRowOf = (r: string) => selector(`file-row-${slug(r)}`);
        await check('L17.shared-asset.two-references', `${from.name}-to-peers`, async () => {
          writeFileSync(join(from.root, '.design', png), pngBytes);
          await until(() => all.every((p) => onDisk(p, png)), 30000).catch(() => {
            throw new Unexercised('the shared image did not reach everyone');
          });
          await seedCanvas(from, b, withImg(`Shared B ${from.name}`, true));
          await seedCanvas(from, a, withImg(`Shared A ${from.name}`, true));
          const start = performance.now();
          await openSeeded(a, `Shared A ${from.name}`, `L17-open-a-${from.name}`);
          return observeAll(
            all,
            `L17-two-refs-${from.name}`,
            start,
            shown,
            (p) => onDisk(p, png) && onDisk(p, a) && onDisk(p, b)
          );
        });
        await check('L17.shared-asset.remove-one-instance', `${from.name}-to-peers`, async () => {
          if (all.some((p) => !onDisk(p, a) || !onDisk(p, b)))
            throw new Unexercised('both referencing canvases must exist everywhere');
          const start = performance.now();
          writeFileSync(join(from.root, '.design', a), withImg(`Shared A ${from.name}`, false));
          const removed = await observeAll(
            all,
            `L17-remove-one-${from.name}`,
            start,
            async (p) => (await p.probe('img[alt="shared"]')) === null,
            (p) =>
              !readFileSync(join(p.root, '.design', a), 'utf8').includes('SharedRef') &&
              readFileSync(join(p.root, '.design', b), 'utf8').includes('SharedRef') &&
              onDisk(p, png)
          );
          // …and the other canvas still shows it, everywhere.
          await openSeeded(b, `Shared B ${from.name}`, `L17-open-b-${from.name}`);
          const kept = await Promise.all(
            all.map((p) =>
              until(() => shown(p), 15000).then(
                () => true,
                () => false
              )
            )
          );
          return {
            ...removed,
            status: removed.status === 'pass' && kept.every(Boolean) ? 'pass' : 'fail',
            otherCanvasStillShows: Object.fromEntries(all.map((p, i) => [p.name, kept[i]])),
          };
        });
        for (const [verb, item] of [
          ['rename', 'Rename…'],
          ['delete', 'Delete'],
        ] as const) {
          await check(`L17.in-use-asset.${verb}-refused`, `${from.name}-to-peers`, async () => {
            if (all.some((p) => !onDisk(p, png)))
              throw new Unexercised('the shared image must exist everywhere');
            await until(async () => (await from.read(fileRowOf(png))) !== null, 15000);
            await from.hover(fileRowOf(png));
            await from.click(selector(`tree-row-menu-${slug(png)}`));
            if (verb === 'rename') await from.promptNext(`SharedRef-${from.name}-renamed`);
            else await from.confirmNext();
            await from.menu(item);
            let said = '';
            await until(async () => {
              said = (await from.read('body')) ?? '';
              return said.includes('is used by');
            }, 15000).catch(() => {});
            await sleep(3000);
            const intact = all.every(
              (p) =>
                onDisk(p, png) &&
                !onDisk(p, `ui/SharedRef-${from.name}-renamed.png`) &&
                readFileSync(join(p.root, '.design', png)).equals(pngBytes)
            );
            return {
              status:
                said.includes('is used by') && said.includes(`SharedB-${from.name}`) && intact
                  ? 'pass'
                  : 'fail',
              refusalNamesCanvas: said.includes(`SharedB-${from.name}`),
              fileIntactEverywhere: intact,
            };
          });
        }
      }
      // L19 — presence is ephemeral: everyone on the same canvas sees the
      // others (no duplicates), a moving cursor and a selection; leaving drops
      // the person; a camera move stays on its own machine and never becomes
      // project content.
      {
        const rel = 'ui/SurfacePresence.tsx';
        const people = '.dc-participants .dc-participant:not(.dc-participant--agent)';
        const count = async (p: Surface, q: string) => (await p.probe(q))?.matches?.length ?? 0;
        await check('L19.presence.join', 'all', async () => {
          await seedCanvas(all[0] as Surface, rel, elementCanvas('Presence'));
          const start = performance.now();
          await openSeeded(rel, 'Presence', 'L19-join');
          return observeAll(
            all,
            'L19-join',
            start,
            async (p) => (await count(p, people)) === all.length - 1
          );
        });
        for (const from of all) {
          await check('L19.cursor.move', `${from.name}-to-peers`, async () => {
            const others = all.filter((p) => p !== from);
            const start = performance.now();
            // A mouse passing over the canvas — no button, so nothing is
            // selected or dragged while the cursor travels.
            await gesture(from, 'p', 'hover', { dx: 40, dy: 10 });
            return observeAll(
              others,
              `L19-cursor-${from.name}`,
              start,
              async (p) => (await count(p, '.dc-cursor')) >= 1
            );
          });
          await check('L19.selection.shown', `${from.name}-to-peers`, async () => {
            const others = all.filter((p) => p !== from);
            await gesture(from, selector('palette-mode-edit'), 'click');
            const start = performance.now();
            // A press, not a bare click event: the canvas selects on pointerdown.
            await gesture(from, 'h1', 'pointer');
            return observeAll(
              others,
              `L19-select-${from.name}`,
              start,
              async (p) => (await count(p, '.dc-peer-selection')) >= 1
            );
          });
        }
        await check('L19.camera.stays-local', 'all', async () => {
          const from = all[0] as Surface;
          const contentBefore = all.map((p) => readFileSync(join(p.root, '.design', rel), 'utf8'));
          const metaPath = (p: Surface) =>
            join(p.root, '.design', rel.replace(/\.tsx$/, '.meta.json'));
          const metaBefore = all.map((p) =>
            existsSync(metaPath(p)) ? readFileSync(metaPath(p), 'utf8') : null
          );
          const viewPath = (p: Surface) =>
            join(
              p.root,
              '.design',
              '_canvas-state',
              `${slug(rel.replace(/\.tsx$/, ''))}.view.json`
            );
          const viewsBefore = all.map((p) =>
            existsSync(viewPath(p)) ? readFileSync(viewPath(p), 'utf8') : null
          );
          // A real pan: drag the empty canvas with the hand tool.
          await gesture(from, '.dc-tool-palette button[aria-label^="Hand"]', 'click');
          await gesture(from, '.dc-canvas', 'pointer', { x: 0.05, y: 0.5, dx: 120, dy: 60 });
          await sleep(3000);
          const leaked = all
            .filter((p) => p !== from)
            .filter(
              (p) =>
                (existsSync(viewPath(p)) ? readFileSync(viewPath(p), 'utf8') : null) !==
                viewsBefore[all.indexOf(p)]
            )
            .map((p) => p.name);
          const contentChanged = all.some(
            (p, i) => readFileSync(join(p.root, '.design', rel), 'utf8') !== contentBefore[i]
          );
          const metaChanged = all.some(
            (p, i) =>
              (existsSync(metaPath(p)) ? readFileSync(metaPath(p), 'utf8') : null) !== metaBefore[i]
          );
          await gesture(from, selector('palette-mode-edit'), 'click');
          return {
            status: leaked.length === 0 && !contentChanged && !metaChanged ? 'pass' : 'fail',
            viewChangedAt: leaked,
            contentChanged,
            metaChanged,
          };
        });
        // Leaving is CLOSING the canvas: every open tab keeps its frame (and
        // its presence) alive the way a background browser tab does, so
        // switching to another canvas is not leaving this one. Each surface
        // leaves in turn — the paths differ (a browser on the hub's own studio,
        // a desktop, the peer desktop).
        for (const from of all) {
          await check('L19.presence.leave', `${from.name}-leaves`, async () => {
            const others = all.filter((p) => p !== from);
            await openSeeded(rel, 'Presence', `L19-leave-open-${from.name}`);
            await until(
              async () =>
                (await Promise.all(others.map((p) => count(p, people)))).every(
                  (n) => n === all.length - 1
                ),
              30000
            ).catch(() => {
              throw new Unexercised('not everyone was on the canvas before leaving');
            });
            await from.click(selector('menu-file'));
            const start = performance.now();
            await from.menu('Close canvas');
            return observeAll(
              others,
              `L19-leave-${from.name}`,
              start,
              async (p) => (await count(p, people)) === all.length - 2
            );
          });
        }
        // L19 reconnect — desktop B's network drops while everyone is on the
        // canvas, then comes back. Nobody is left with a ghost or a double of
        // B, and B's cursor moves for the others again.
        await check('L19.presence.reconnect', 'peer-reconnects', async () => {
          const peer = all.find((p) => p.name === 'peer');
          const control = run.peerProxy as string | undefined;
          if (!peer || !control)
            throw new Unexercised('This run has no toggle proxy in front of desktop B.');
          const others = all.filter((p) => p !== peer);
          await openSeeded(rel, 'Presence', 'L19-reconnect-open');
          await until(
            async () =>
              (await Promise.all(all.map((p) => count(p, people)))).every(
                (n) => n === all.length - 1
              ),
            30000
          ).catch(() => {
            throw new Unexercised('not everyone was on the canvas before the drop');
          });
          await fetch(`${control}/offline`, { method: 'POST' });
          let droppedMs: number | null = null;
          const t0 = performance.now();
          try {
            await until(
              async () =>
                (await Promise.all(others.map((p) => count(p, people)))).every(
                  (n) => n === all.length - 2
                ),
              60000
            ).then(() => {
              droppedMs = performance.now() - t0;
            });
          } catch {
            /* a presence that outlives the drop is reported, not failed here */
          }
          const start = performance.now();
          await fetch(`${control}/online`, { method: 'POST' });
          const back = await observeAll(
            all,
            'L19-reconnect',
            start,
            async (p) => (await count(p, people)) === all.length - 1
          );
          // Moving again after the return: the others see B's cursor.
          await gesture(peer, 'p', 'hover', { dx: 30, dy: 5 });
          const cursor = await observeAll(
            others,
            'L19-reconnect-cursor',
            performance.now(),
            async (p) => (await count(p, '.dc-cursor')) >= 1
          );
          const doubles = await Promise.all(
            all.map(async (p) => ({ participant: p.name, people: await count(p, people) }))
          );
          return {
            status: back.status === 'pass' && cursor.status === 'pass' ? 'pass' : 'fail',
            droppedMs,
            presence: back.observations,
            cursor: cursor.observations,
            finalPeople: doubles,
          };
        });
      }
      // L20 — one desktop drops off the network (its hub link is cut, its own
      // app keeps running): it edits offline while the others keep working,
      // then reconnects. Its change arrives everywhere, theirs arrives at it,
      // without a refresh, a duplicate or a conflict.
      {
        const peer = all.find((p) => p.name === 'peer');
        const hubSide = all.find((p) => p.name === 'hub');
        const nativeSide = all.find((p) => p.name === 'native');
        const control = run.peerProxy as string | undefined;
        const mine = 'ui/SurfaceOffline.tsx';
        const theirs = 'ui/SurfaceOffline-theirs.tsx';
        // `existsSync` then `readFileSync` is a race, and this row runs inside
        // the exact window that loses it: the restarted peer is catching up on
        // a DELETION, so the file can vanish between the two calls and the read
        // throws ENOENT on a canvas the oracle only wanted to prove was gone.
        // Absent is the answer either way.
        const text = (p: Surface, r: string) => {
          try {
            return readFileSync(join(p.root, '.design', r), 'utf8');
          } catch {
            return null;
          }
        };
        const syncState = (p: Surface) => {
          try {
            return JSON.parse(readFileSync(join(p.root, '.design', '_sync.json'), 'utf8'))
              .state as string;
          } catch {
            return null;
          }
        };
        await check('L20.offline.edit-then-catch-up', 'peer-offline', async () => {
          if (!peer || !hubSide || !nativeSide || !control)
            return {
              status: 'unsupported',
              reason: 'This run has no toggle proxy in front of desktop B.',
            };
          const base = elementCanvas('Offline base');
          await seedCanvas(hubSide, mine, base);
          // The two categories that ride existing roads — a photo edit (a
          // file-plane sidecar) and a timeline cut (canvas source) — mutated
          // offline too, so no persistent surface is left unexercised. Their
          // subjects exist everywhere BEFORE the cable is pulled.
          const cutRel = 'ui/SurfaceOfflineCut.tsx';
          const cutSource = readFileSync(
            new URL('../fixtures/project/.design/ui/Cut.tsx', import.meta.url),
            'utf8'
          );
          const clipsIn = (p: Surface) =>
            (text(p, cutRel)?.match(/<TransitionSeries\.Sequence\b/g) ?? []).length;
          await seedCanvas(hubSide, cutRel, cutSource);
          const pattern = readFileSync(
            join(hubSide.root, '.design', 'assets', 'surface-pattern.png')
          );
          const photoRel = `assets/${createHash('sha256').update(pattern).digest('hex').slice(0, 8)}.png`;
          const photoEditRel = photoRel.replace(/\.png$/, '.photo.json');
          writeFileSync(join(hubSide.root, '.design', photoRel), pattern);
          await until(
            () =>
              text(peer, cutRel) === cutSource &&
              existsSync(join(peer.root, '.design', photoRel)) &&
              existsSync(join(nativeSide.root, '.design', photoRel)),
            90000
          );
          await fetch(`${control}/offline`, { method: 'POST' });
          try {
            await until(() => syncState(peer) === 'offline', 60000);
            const offlineBody = elementCanvas('Edited offline by peer');
            writeFileSync(join(peer.root, '.design', mine), offlineBody);
            // NOT ONLY THE SOURCE. The contract asks for each persistent
            // surface mutated while disconnected, and this row used to move
            // exactly one: a canvas body. An offline session that only proves
            // text catches up says nothing about the plane that travels
            // differently — the file plane's own CAS journal, which carries
            // media on a polled lane rather than in the canvas document.
            //
            // Annotations are NOT added here, and the reason is worth keeping:
            // a raw `.annotations.svg` write is not an import path. That
            // sidecar is the projection of the canvas document's annotations
            // lane, fed by the drawing tools; writing the file by hand while
            // offline produced a file every receiver ignored, which the row
            // then reported as a lost annotation. Mutating annotations offline
            // needs a real gesture on a disconnected peer — still owed, and
            // recorded as such in `surface-requirements.mjs`.
            // AND THE ANNOTATIONS LANE, through the drawing tool rather than
            // the sidecar. The peer's studio is up the whole time — only its
            // link to the hub is cut — so a sticky drawn here is an ordinary
            // offline annotation, and the product writes the sidecar itself at
            // whatever path it uses.
            const notesRel = `ui-${slug(mine.replace(/^ui\//, '').replace(/\.tsx$/, ''))}.annotations.svg`;
            let offlineStroke: string | undefined;
            await openCanvas(peer, mine);
            // The palette is part of the canvas chrome: clicking for it before
            // the canvas has rendered finds nothing. Wait for the body this
            // very row just wrote.
            await until(
              async () => (await peer.read('h1', true)) === 'Edited offline by peer',
              30000
            );
            await gesture(peer, selector('palette-mode-edit'), 'click');
            await gesture(peer, '[aria-label^="Sticky ("]', 'click');
            await until(async () => !!(await peer.probe('.dc-annot-input'))?.visible, 30000);
            await gesture(peer, '.dc-annot-input', 'pointer', { x: 0.3, y: 0.3, dx: 130, dy: 100 });
            await until(async () => {
              offlineStroke =
                (await peer.probe('[data-tool="sticky"][data-id]'))?.matches?.[0]?.id ?? undefined;
              return !!offlineStroke;
            }, 30000);
            const drewOffline = (p2: Surface) =>
              (() => {
                try {
                  return readFileSync(join(p2.root, '.design', notesRel), 'utf8').includes(
                    `data-id="${offlineStroke}"`
                  );
                } catch {
                  return false;
                }
              })();
            if (!drewOffline(peer))
              throw new Error('the offline sticky never reached the peer’s own disk');
            // AND A COMMENT, which travels on a lane of its own (S24). Same
            // reasoning as the sticky: the tool is the input, the JSON under
            // `_comments/` is the projection each receiver writes for itself.
            const offlineComment = 'Left a note while cut off';
            const commentsOf = (p2: Surface) => {
              try {
                const raw = JSON.parse(
                  readFileSync(
                    join(
                      p2.root,
                      '.design',
                      '_comments',
                      `${slug(mine.replace(/\.tsx$/, ''))}.json`
                    ),
                    'utf8'
                  )
                );
                return JSON.stringify(Array.isArray(raw) ? raw : (raw.comments ?? []));
              } catch {
                return '';
              }
            };
            await gesture(peer, '.dc-tool-palette button[aria-label^="Comment"]', 'click');
            await gesture(peer, 'h1', 'pointer');
            await until(
              async () => !!(await peer.probe('[aria-label="Comment body"]'))?.visible,
              30000
            );
            await gesture(peer, '[aria-label="Comment body"]', 'fill', offlineComment);
            await gesture(peer, '.cm-composer .cm-btn--primary', 'click');
            await until(() => commentsOf(peer).includes(offlineComment), 30000);
            const offlineAsset = 'assets/offline-by-peer.png';
            const assetBytes = Buffer.alloc(96 * 1024);
            for (let k = 0; k < assetBytes.length; k += 4096)
              assetBytes.writeUInt32LE((k * 2654435761) >>> 0, k);
            mkdirSync(join(peer.root, '.design/assets'), { recursive: true });
            writeFileSync(join(peer.root, '.design', offlineAsset), assetBytes);
            const assetSha = createHash('sha256').update(assetBytes).digest('hex');
            // A PHOTO EDIT, through the route the Photo panel saves with.
            const photoPut = await fetch(
              `http://127.0.0.1:${run.peerPort}/_api/photo-edit?asset=${encodeURIComponent(photoRel)}`,
              {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ adjustments: { brightness: 0.2 } }),
              }
            );
            if (!photoPut.ok)
              throw new Error(`the offline photo edit was refused: ${photoPut.status}`);
            const brightened = (p: Surface) => {
              try {
                return (
                  JSON.parse(readFileSync(join(p.root, '.design', photoEditRel), 'utf8'))
                    .adjustments?.brightness === 0.2
                );
              } catch {
                return false;
              }
            };
            if (!brightened(peer))
              throw new Error('the offline photo edit never reached the peer’s disk');
            // A TIMELINE CUT, in the shell's Timeline panel: the playhead into
            // the second clip, ⌘B — the gesture L15 uses, on a peer cut off.
            await openCanvas(peer, cutRel);
            if ((await peer.count(selector('timeline-panel'))) === 0)
              await peer.press('Meta+Shift+T');
            await until(async () => (await peer.count(selector('timeline-panel'))) > 0, 15000);
            await until(
              async () => (await peer.count('[data-testid^="timeline-seq-"]')) === 3,
              30000
            );
            await peer.click(selector('timeline-readout'));
            await peer.press('Escape');
            await peer.press('Home');
            await peer.press('.');
            for (let i = 0; i < 10; i++) await peer.press('ArrowRight');
            await peer.press('Meta+b');
            await until(() => clipsIn(peer) === 4, 30000);
            const cutBody = text(peer, cutRel);
            // L22 — the peer's own status tells the truth while cut off: not
            // "synced", but offline with the change kept.
            let statusWhileOffline = '';
            await until(async () => {
              statusWhileOffline = (await peer.read('.st-sb-sync')) ?? '';
              return /offline|saving|queued|not reachable/i.test(statusWhileOffline);
            }, 30000);
            if (/\bsynced\b/i.test(statusWhileOffline))
              throw new Error(`Offline peer claimed synced: ${statusWhileOffline}`);
            const theirsBody = elementCanvas('Made while peer was away');
            writeFileSync(join(nativeSide.root, '.design', theirs), theirsBody);
            await until(() => text(hubSide, theirs) === theirsBody, 30000);
            await sleep(2000);
            if (text(hubSide, mine) !== base || clipsIn(hubSide) !== 3 || brightened(hubSide))
              throw new Error('An offline edit reached the hub while cut off');
            const start = performance.now();
            await fetch(`${control}/online`, { method: 'POST' });
            return {
              offlineState: 'offline',
              statusWhileOffline: statusWhileOffline.slice(0, 120),
              ...(await observeAll(
                all,
                'L20-catch-up',
                start,
                async (p) => (await p.read(rowOf(theirs))) !== null,
                (p) =>
                  text(p, mine) === offlineBody &&
                  text(p, theirs) === theirsBody &&
                  // Four planes, everywhere — the canvas source, the annotation
                  // the peer drew while cut off, the comment it left, and the
                  // asset's bytes by hash through the file plane.
                  drewOffline(p) &&
                  commentsOf(p).includes(offlineComment) &&
                  existsSync(join(p.root, '.design', offlineAsset)) &&
                  createHash('sha256')
                    .update(readFileSync(join(p.root, '.design', offlineAsset)))
                    .digest('hex') === assetSha &&
                  // …and the two that ride those roads: the photo's edit and
                  // the timeline's cut.
                  brightened(p) &&
                  text(p, cutRel) === cutBody
              )),
            };
          } finally {
            await fetch(`${control}/online`, { method: 'POST' }).catch(() => {});
          }
        });
        // L21 — a structural change and an edit to the same canvas at once:
        // desktop B edits while cut off, desktop A deletes or moves the canvas
        // from its tree, then B reconnects. The outcome must be one the whole
        // project agrees on, and B's edit is either kept or B is told — never
        // silently dropped.
        const notices = (p: Surface) => {
          try {
            return (
              JSON.parse(readFileSync(join(p.root, '.design', '_sync.json'), 'utf8')).notices ?? []
            ).map((n: { id?: string; text?: string }) =>
              `${n.id ?? ''} ${n.text ?? ''}`.trim()
            ) as string[];
          } catch {
            return [];
          }
        };
        const offlineThen = async <T>(edit: () => Promise<T> | T) => {
          if (!peer || !control) throw new Error('no toggle proxy');
          await fetch(`${control}/offline`, { method: 'POST' });
          await until(() => syncState(peer) === 'offline', 60000);
          return edit();
        };
        await check('L21.delete-versus-edit', 'native-deletes-peer-edits', async () => {
          if (!peer || !hubSide || !nativeSide || !control)
            return {
              status: 'unsupported',
              reason: 'This run has no toggle proxy in front of desktop B.',
            };
          const rel = 'ui/SurfaceDelEdit.tsx';
          await seedCanvas(hubSide, rel, elementCanvas('Delete versus edit'));
          await openSeeded(rel, 'Delete versus edit', 'L21-del-edit');
          const edited = elementCanvas('Edited by peer while the canvas was deleted');
          try {
            await offlineThen(() => writeFileSync(join(peer.root, '.design', rel), edited));
            await nativeSide.hover(rowOf(rel));
            await nativeSide.confirmNext();
            await nativeSide.click('[aria-label="Delete canvas SurfaceDelEdit"]');
            await until(() => [hubSide, nativeSide].every((p) => text(p, rel) === null), 30000);
            const start = performance.now();
            await fetch(`${control}/online`, { method: 'POST' });
            // Settle: every copy agrees, and the peer's edit is kept or named.
            let outcome = 'undecided';
            await until(async () => {
              const copies = all.map((p) => text(p, rel));
              if (copies.every((c) => c === null)) outcome = 'deleted';
              else if (copies.every((c) => c === edited)) outcome = 'edit-kept';
              else return false;
              return syncState(peer) !== 'offline';
            }, 60000).catch(() => {});
            await sleep(3000);
            const copies = all.map((p) => ({ receiver: p.name, present: text(p, rel) !== null }));
            const told = notices(peer);
            const shown = (await peer.read('.st-sb-sync')) ?? '';
            for (const p of all) {
              await p.screenshot(join(run.out, `L21-del-edit-${p.name}.png`));
              const sync = join(p.root, '.design', '_sync.json');
              if (existsSync(sync))
                writeFileSync(
                  join(run.out, `L21-del-edit-${p.name}-sync.json`),
                  readFileSync(sync)
                );
            }
            const agreed =
              copies.every((c) => c.present === copies[0]?.present) && outcome !== 'undecided';
            const editAccounted =
              outcome === 'edit-kept' ||
              told.some((n) => /SurfaceDelEdit|surfacedeledit/i.test(n)) ||
              /review|conflict|attention|kept/i.test(shown);
            return {
              status: agreed && editAccounted ? 'pass' : 'fail',
              outcome,
              settledMs: performance.now() - start,
              copies,
              peerNotices: told.slice(0, 5),
              peerStatus: shown.slice(0, 160),
            };
          } finally {
            await fetch(`${control}/online`, { method: 'POST' }).catch(() => {});
          }
        });
        await check('L21.move-during-edit', 'native-moves-peer-edits', async () => {
          if (!peer || !hubSide || !nativeSide || !control)
            return {
              status: 'unsupported',
              reason: 'This run has no toggle proxy in front of desktop B.',
            };
          const rel = 'ui/SurfaceMoveEdit.tsx';
          const moved = 'ui/MoveEditDest/SurfaceMoveEdit.tsx';
          mkdirSync(join(hubSide.root, '.design/ui/MoveEditDest'), { recursive: true });
          await seedCanvas(hubSide, 'ui/MoveEditDest/Anchor.tsx', elementCanvas('Anchor'));
          await seedCanvas(hubSide, rel, elementCanvas('Move during edit'));
          await openSeeded(rel, 'Move during edit', 'L21-move-edit');
          const edited = elementCanvas('Edited by peer while the canvas moved');
          try {
            await offlineThen(() => writeFileSync(join(peer.root, '.design', rel), edited));
            await nativeSide.hover(rowOf(rel));
            await nativeSide.click(selector('tree-row-menu-ui-surfacemoveedit'));
            await nativeSide.menu('Move to…');
            await nativeSide.menu('ui/MoveEditDest');
            await until(
              () =>
                [hubSide, nativeSide].every(
                  (p) => text(p, rel) === null && text(p, moved) !== null
                ),
              30000
            );
            const start = performance.now();
            await fetch(`${control}/online`, { method: 'POST' });
            let outcome = 'undecided';
            await until(async () => {
              const at = all.map((p) => [text(p, rel), text(p, moved)]);
              if (at.every(([o, m]) => o === null && m === edited)) outcome = 'edit-followed-move';
              else if (at.every(([o, m]) => o === edited && m === null)) outcome = 'move-undone';
              else if (at.every(([o, m]) => o === edited && m !== null && m !== edited))
                outcome = 'edit-kept-beside-move';
              else return false;
              return (await peer.read(rowOf(moved))) !== null || outcome !== 'edit-followed-move';
            }, 60000).catch(() => {});
            await sleep(3000);
            const told = notices(peer);
            const shown = (await peer.read('.st-sb-sync')) ?? '';
            const layout = all.map((p) => ({
              receiver: p.name,
              old: text(p, rel) === null ? 'absent' : text(p, rel) === edited ? 'edited' : 'other',
              moved:
                text(p, moved) === null ? 'absent' : text(p, moved) === edited ? 'edited' : 'other',
            }));
            for (const p of all) {
              await p.screenshot(join(run.out, `L21-move-edit-${p.name}.png`));
              const sync = join(p.root, '.design', '_sync.json');
              if (existsSync(sync))
                writeFileSync(
                  join(run.out, `L21-move-edit-${p.name}-sync.json`),
                  readFileSync(sync)
                );
            }
            return {
              // A move and a content edit are independent: the edit follows the
              // canvas, and nobody is handed a conflict for it.
              status:
                outcome === 'edit-followed-move' &&
                !told.some((n) => n.startsWith('source-conflict-ui-surfacemoveedit'))
                  ? 'pass'
                  : 'fail',
              outcome,
              settledMs: performance.now() - start,
              layout,
              peerNotices: told.slice(0, 5),
              peerStatus: shown.slice(0, 160),
            };
          } finally {
            await fetch(`${control}/online`, { method: 'POST' }).catch(() => {});
          }
        });
        await check('L21.folder-move-during-edit', 'native-renames-folder-peer-edits', async () => {
          if (!peer || !hubSide || !nativeSide || !control)
            return {
              status: 'unsupported',
              reason: 'This run has no toggle proxy in front of desktop B.',
            };
          const rel = 'ui/FolderEdit/Card.tsx';
          const moved = 'ui/FolderEdit-renamed/Card.tsx';
          mkdirSync(join(hubSide.root, '.design/ui/FolderEdit'), { recursive: true });
          await seedCanvas(hubSide, rel, elementCanvas('Folder move during edit'));
          await openSeeded(rel, 'Folder move during edit', 'L21-folder-edit');
          const edited = elementCanvas('Edited by peer while its folder was renamed');
          try {
            await offlineThen(() => writeFileSync(join(peer.root, '.design', rel), edited));
            await expand(nativeSide, 'ui');
            await nativeSide.hover(folderRow('ui/FolderEdit'));
            await nativeSide.click(selector('tree-row-menu-ui-folderedit'));
            await nativeSide.promptNext('FolderEdit-renamed');
            await nativeSide.menu('Rename folder');
            await until(
              () =>
                [hubSide, nativeSide].every(
                  (p) => text(p, rel) === null && text(p, moved) !== null
                ),
              30000
            );
            const start = performance.now();
            await fetch(`${control}/online`, { method: 'POST' });
            let settled = false;
            await until(
              () =>
                (settled = all.every((p) => text(p, rel) === null && text(p, moved) === edited)),
              60000
            ).catch(() => {});
            const layout = all.map((p) => ({
              receiver: p.name,
              old: text(p, rel) === null ? 'absent' : text(p, rel) === edited ? 'edited' : 'other',
              moved:
                text(p, moved) === null ? 'absent' : text(p, moved) === edited ? 'edited' : 'other',
            }));
            const told = notices(peer).filter((n) => n.startsWith('source-conflict-ui-folderedit'));
            for (const p of all) {
              await p.screenshot(join(run.out, `L21-folder-edit-${p.name}.png`));
              const sync = join(p.root, '.design', '_sync.json');
              if (existsSync(sync))
                writeFileSync(
                  join(run.out, `L21-folder-edit-${p.name}-sync.json`),
                  readFileSync(sync)
                );
            }
            return {
              status: settled && told.length === 0 ? 'pass' : 'fail',
              outcome: settled ? 'edit-followed-folder' : 'diverged-or-held',
              settledMs: performance.now() - start,
              layout,
              peerConflicts: told,
            };
          } finally {
            await fetch(`${control}/online`, { method: 'POST' }).catch(() => {});
          }
        });
        // L20 — desktop B is QUIT (its studio process stops) while the others
        // keep working: a canvas made, one edited, one deleted, a folder made;
        // and B's own disk is edited by an editor while the app is closed.
        // Reopened, B catches up on everything without a manual repair, and
        // what was edited on its disk reaches the others.
        await check('L20.restart.catch-up', 'peer-quit-and-reopened', async () => {
          if (!peer || !hubSide || !nativeSide) throw new Unexercised('Missing participants');
          const edited = 'ui/SurfaceRestartEdit.tsx';
          const doomed = 'ui/SurfaceRestartDelete.tsx';
          const own = 'ui/SurfaceRestartOwn.tsx';
          const created = 'ui/SurfaceWhileClosed.tsx';
          const folder = 'ui/ClosedFolder';
          await seedCanvas(hubSide, edited, elementCanvas('Restart edit v1'));
          await seedCanvas(hubSide, doomed, elementCanvas('Restart delete'));
          await seedCanvas(hubSide, own, elementCanvas('Restart own v1'));
          await lifecycle('/peer/stop');
          const createdBody = elementCanvas('Made while B was closed');
          const editedBody = elementCanvas('Restart edit v2 while B was closed');
          const ownBody = elementCanvas('Edited on B while B was closed');
          writeFileSync(join(nativeSide.root, '.design', created), createdBody);
          writeFileSync(join(hubSide.root, '.design', edited), editedBody);
          await until(async () => (await nativeSide.read(rowOf(doomed))) !== null, 30000);
          await nativeSide.hover(rowOf(doomed));
          await nativeSide.confirmNext();
          await nativeSide.click('[aria-label="Delete canvas SurfaceRestartDelete"]');
          mkdirSync(join(nativeSide.root, '.design', folder), { recursive: true });
          writeFileSync(join(nativeSide.root, '.design', folder, '.gitkeep'), '');
          writeFileSync(join(peer.root, '.design', own), ownBody);
          await until(
            () =>
              text(hubSide, created) === createdBody &&
              text(nativeSide, edited) === editedBody &&
              text(hubSide, doomed) === null &&
              existsSync(join(hubSide.root, '.design', folder)),
            30000
          );
          const start = performance.now();
          await lifecycle('/peer/start');
          await peerPage.goto(`http://127.0.0.1:${run.peerPort}/`);
          const observations = await observeAll(
            all,
            'L20-restart',
            start,
            async (p) =>
              (await p.read(rowOf(created))) !== null && (await p.read(rowOf(doomed))) === null,
            (p) =>
              text(p, created) === createdBody &&
              text(p, edited) === editedBody &&
              text(p, doomed) === null &&
              text(p, own) === ownBody &&
              existsSync(join(p.root, '.design', folder))
          );
          return {
            stimulus: 'desktop B studio stopped, project changed, B reopened',
            ...observations,
          };
        });
        // L22 — a credential that EXPIRES, walked end to end in one stimulus:
        // the hub refuses it, the peer files the refusal as one it cannot
        // retry its way out of, its own shell says so instead of "synced",
        // nothing it edits meanwhile reaches anyone — and once it is signed in
        // again, that edit arrives everywhere. Each hop is also pinned on its
        // own (tokens / auth-reasons / sync-runtime tests, team-project step
        // 8); this is the one place they meet.
        await check('L22.auth-expiry', 'peer-credential-expires', async () => {
          if (!peer || !hubSide || !nativeSide || !control)
            throw new Unexercised('Missing participants or the toggle proxy');
          const rel = 'ui/SurfaceExpiry.tsx';
          const seeded = elementCanvas('Expiry v1');
          await seedCanvas(hubSide, rel, seeded);
          await until(() => text(peer, rel) === seeded, 60000);
          const reply = await (
            await fetch(`${run.peerLifecycle}/peer/credential/expire`, { method: 'POST' })
          ).json();
          if (reply.expired !== 1)
            throw new Error(`the credential did not expire: ${JSON.stringify(reply)}`);
          // A credential is asked for when a connection is made. Cut the link
          // and restore it, as a sleeping laptop does, so the peer presents it.
          await fetch(`${control}/offline`, { method: 'POST' });
          await until(() => syncState(peer) === 'offline', 60000).catch(() => {});
          await fetch(`${control}/online`, { method: 'POST' });
          const whileExpired = elementCanvas('Edited on B with an expired credential');
          writeFileSync(join(peer.root, '.design', rel), whileExpired);
          // Hop 2 — the peer's own record: refused, for the reason that means
          // "sign in again", not "try later".
          let reasons: string[] = [];
          await until(() => {
            try {
              const s = JSON.parse(readFileSync(join(peer.root, '.design', '_sync.json'), 'utf8'));
              reasons = (s.items ?? [])
                .filter((i: { state: string }) => i.state === 'auth-rejected')
                .map((i: { reason?: string }) => String(i.reason ?? ''));
              return reasons.includes('invalid-token');
            } catch {
              return false;
            }
          }, 120000);
          // Hop 3 — the shell says it, where the person looks.
          if ((await peer.read(selector('open-sync'))) !== null) {
            const pressed = await peerPage
              .locator(selector('open-sync'))
              .getAttribute('aria-pressed')
              .catch(() => null);
            if (pressed !== 'true') await peer.click(selector('open-sync'));
          }
          await until(async () => (await peer.read('.sp-note-dot.is-refused')) !== null, 60000);
          const statusWhileRefused = (await peer.read('.st-sb-sync')) ?? '';
          if (/\bsynced\b/i.test(statusWhileRefused))
            throw new Error(`A refused peer claimed synced: ${statusWhileRefused}`);
          // Hop 4 — nothing from the refused peer reached anyone.
          await sleep(3000);
          if (text(hubSide, rel) !== seeded || text(nativeSide, rel) !== seeded)
            throw new Error('An edit made with an expired credential reached the project');
          // Signed in again: the edit it kept arrives everywhere.
          const start = performance.now();
          await fetch(`${run.peerLifecycle}/peer/credential/renew`, { method: 'POST' });
          await peerPage.goto(`http://127.0.0.1:${run.peerPort}/`);
          const observations = await observeAll(
            all,
            'L22-auth-expiry',
            start,
            async (p) => (await p.read(rowOf(rel))) !== null,
            (p) => text(p, rel) === whileExpired
          );
          return {
            stimulus: 'desktop B credential expired on the hub, link bounced, B signed in again',
            refusedAs: [...new Set(reasons)],
            statusWhileRefused: statusWhileRefused.slice(0, 120),
            ...observations,
          };
        });
        // L05 — reopen after a restart: the canvas each person had open comes
        // back open, showing what changed while they were gone — one tab, no
        // load error, no stale render. Desktop B quits and reopens; the cloud
        // browser reloads.
        await check('L05.reopen-after-restart', 'peer-and-browser', async () => {
          if (!peer || !hubSide || !nativeSide) throw new Unexercised('Missing participants');
          const rel = 'ui/SurfaceReopen.tsx';
          await seedCanvas(hubSide, rel, elementCanvas('Reopen v1'));
          await openSeeded(rel, 'Reopen v1', 'L05-reopen');
          await lifecycle('/peer/stop');
          const body = elementCanvas('Reopen v2 while closed');
          writeFileSync(join(nativeSide.root, '.design', rel), body);
          await until(() => text(hubSide, rel) === body, 30000);
          const start = performance.now();
          await lifecycle('/peer/start');
          await peerPage.reload();
          await hubPage.reload();
          const reopened = [peer, hubSide];
          const shown = await observeAll(
            reopened,
            'L05-reopen',
            start,
            async (p) =>
              (await p.read(frameOf(rel))) !== null &&
              (await p.read('h1', true)) === 'Reopen v2 while closed' &&
              (await p.read(selector('canvas-load-error'))) === null
          );
          const tabs = [
            { participant: 'peer', frames: await peerPage.locator(frameOf(rel)).count() },
            { participant: 'hub', frames: await hubPage.locator(frameOf(rel)).count() },
          ];
          return {
            ...shown,
            status: shown.status === 'pass' && tabs.every((t) => t.frames === 1) ? 'pass' : 'fail',
            tabs,
          };
        });
        // L20 — a fresh third copy: a new machine opens the project with
        // nothing on disk. It receives every canvas, folder and media file the
        // project holds, byte for byte, and shows them.
        await check('L20.fresh-third-copy', 'new-machine', async () => {
          if (!nativeSide) throw new Unexercised('Missing participants');
          const start = performance.now();
          const fresh = await openFresh();
          await until(
            async () => (await fresh.surface.read(selector('canvas-row-ui-home'))) !== null,
            60000
          );
          let diff: string[] = [];
          const converged = await until(() => {
            diff = inventoryDiff(
              eligibleInventory(nativeSide.root, true),
              eligibleInventory(fresh.root, true)
            );
            return diff.length === 0;
          }, 120000)
            .then(() => true)
            .catch(() => false);
          const convergedMs = performance.now() - start;
          await openCanvas(fresh.surface, 'ui/SurfaceMedia.tsx');
          const rendered = await until(async () => {
            const image = await fresh.surface.probe(selector('surface-photo'));
            return (
              (await fresh.surface.read('h1', true)) === 'Surface media baseline' &&
              !!image?.visible
            );
          }, 30000)
            .then(() => true)
            .catch(() => false);
          await fresh.page.screenshot({ path: join(run.out, 'L20-fresh-copy.png') });
          return {
            status: converged && rendered ? 'pass' : 'fail',
            files: eligibleInventory(fresh.root, true).size,
            convergedMs,
            rendered,
            differing: diff.slice(0, 20),
          };
        });
      }
      // L22 — an invalid source save is held on the author's machine, visible
      // to them, and never reaches the others; fixing it publishes normally.
      // The status bar names held work "N to review" (the Sync panel lists it).
      const HELD_STATUS = /attention|conflict|invalid|resolve|could not|to review/i;
      for (const from of all) {
        const rel = `ui/SurfaceInvalid-${from.name}.tsx`;
        const good = elementCanvas(`Valid ${from.name}`);
        const fixed = elementCanvas(`Fixed ${from.name}`);
        const text = (p: Surface) => {
          try {
            return readFileSync(join(p.root, '.design', rel), 'utf8');
          } catch {
            return null;
          }
        };
        await check('L22.invalid-candidate.held', `${from.name}-to-peers`, async () => {
          await seedCanvas(from, rel, good);
          const broken = good.replace('</section>', '<section>');
          writeFileSync(join(from.root, '.design', rel), broken);
          // The author is told, in the same status everyone reads — and by
          // name: this canvas's own held notice, not merely "something to
          // review" (another held item in the project would satisfy that).
          const notice = `source-conflict-${slug(rel.replace(/\.tsx$/, ''))}`;
          const named = () => {
            try {
              return (
                JSON.parse(readFileSync(join(from.root, '.design', '_sync.json'), 'utf8'))
                  .notices ?? []
              ).some((n: { id?: string }) => n.id === notice);
            } catch {
              return false;
            }
          };
          let shown = '';
          let toldByName = false;
          await until(async () => {
            shown = (await from.read('.st-sb-sync')) ?? '';
            toldByName = named();
            return HELD_STATUS.test(shown) && toldByName;
          }, 30000).catch(() => {});
          await sleep(3000);
          const leaked = all.filter((p) => p !== from && text(p) !== good).map((p) => p.name);
          const start = performance.now();
          writeFileSync(join(from.root, '.design', rel), fixed);
          const recovered = await observeAll(
            all,
            `L22-invalid-${from.name}`,
            start,
            async () => true,
            (p) => text(p) === fixed
          );
          return {
            ...recovered,
            status:
              leaked.length === 0 &&
              HELD_STATUS.test(shown) &&
              toldByName &&
              recovered.status === 'pass'
                ? 'pass'
                : 'fail',
            authorStatus: shown.slice(0, 160),
            toldByName,
            leakedTo: leaked,
          };
        });
      }
      // L22 — a file the workspace will not take, and a workspace that cannot
      // store for a while. The author is told in the Sync panel and the status
      // bar; nobody else gets a partial file; nothing reads "saved"; and when
      // the workspace can store again the waiting file delivers on its own.
      {
        const statusTitle = async (p: Surface) =>
          ((await p.shell(
            `document.querySelector('.st-sb-sync')?.getAttribute('title') || document.querySelector('.st-sb-sync')?.getAttribute('data-tip') || ''`
          )) as string) ?? '';
        const openSyncPanel = async (p: Surface) => {
          const button = selector('open-sync');
          await until(async () => (await p.read(button)) !== null, 10000);
          if ((await p.read(`${button}[aria-pressed="true"]`)) === null) await p.click(button);
        };
        for (const from of all.filter((p) => p.name !== 'hub')) {
          const rel = `ui/SurfaceHuge-${from.name}.mp4`;
          await check('L22.blocked-file', `${from.name}-to-peers`, async () => {
            const path = join(from.root, '.design', rel);
            // 110 MB of zeros under a video's name: its size is the one thing
            // the workspace's ceiling (100 MB in this run) judges.
            writeFileSync(path, '');
            truncateSync(path, 110_000_000);
            try {
              await openSyncPanel(from);
              let told = false;
              await until(
                async () => (await from.read(selector('sync-blocked-too-large'))) !== null,
                120000
              )
                .then(() => {
                  told = true;
                })
                .catch(() => {});
              const status = (await from.read('.st-sb-sync')) ?? '';
              await sleep(3000);
              const leaked = all
                .filter((p) => p !== from && existsSync(join(p.root, '.design', rel)))
                .map((p) => p.name);
              await from.screenshot(join(run.out, `L22-blocked-${from.name}.png`));
              const title = await statusTitle(from);
              // Removing the file ends the matter: the notice clears.
              rmSync(path, { force: true });
              let cleared = false;
              await until(
                async () => (await from.read(selector('sync-blocked-too-large'))) === null,
                60000
              )
                .then(() => {
                  cleared = true;
                })
                .catch(() => {});
              return {
                status:
                  told && leaked.length === 0 && HELD_STATUS.test(status) && cleared
                    ? 'pass'
                    : 'fail',
                toldInSyncPanel: told,
                authorStatus: status.slice(0, 160),
                authorStatusTitle: title.slice(0, 300),
                clearedAfterRemoval: cleared,
                leakedTo: leaked,
              };
            } finally {
              rmSync(path, { force: true });
            }
          });
          const folder = `ui/SurfaceStorage-${from.name}`;
          const file = `${folder}/held.png`;
          await check('L22.unavailable-storage', `${from.name}-to-peers`, async () => {
            const input = run.media.uploads?.[from.name];
            if (!input) throw new Unexercised('No image fixture');
            const hubSide = all.find((p) => p.name === 'hub') as Surface;
            mkdirSync(join(hubSide.root, '.design', folder), { recursive: true });
            writeFileSync(join(hubSide.root, '.design', folder, '.gitkeep'), '');
            await until(() => all.every((p) => existsSync(join(p.root, '.design', folder))), 30000);
            // The workspace's disk refuses writes in that folder.
            const hubFolder = join(hubSide.root, '.design', folder);
            chmodSync(hubFolder, 0o555);
            let waitingShown = '';
            try {
              writeFileSync(join(from.root, '.design', file), readFileSync(input.path));
              await until(async () => {
                waitingShown = (await from.read('.st-sb-sync')) ?? '';
                const n = /(\d+)\s*\/\s*(\d+) files/.exec(waitingShown);
                return HELD_STATUS.test(waitingShown) || (!!n && Number(n[1]) < Number(n[2]));
              }, 60000).catch(() => {});
              await sleep(3000);
              const titleWhileDown = await statusTitle(from);
              const syncWhileDown = join(from.root, '.design', '_sync.json');
              if (existsSync(syncWhileDown))
                writeFileSync(
                  join(run.out, `L22-storage-${from.name}-sync-while-down.json`),
                  readFileSync(syncWhileDown)
                );
              // The Sync panel names the file that could not be delivered.
              await openSyncPanel(from);
              let panelSays = '';
              // (By name: the panel may list other files too — a project's
              // code module this copy declines shows there as well.)
              await until(async () => {
                panelSays = (await from.read(selector('sync-delivery-attention'))) ?? '';
                return panelSays.includes('held.png');
              }, 60000).catch(() => {});
              const leakedWhileDown = all
                .filter((p) => p !== from && existsSync(join(p.root, '.design', file)))
                .map((p) => p.name);
              // The disk takes writes again: the waiting file delivers itself —
              // on its next attempt, which a failing path spaces out (5 s,
              // doubling, jittered), so the window is minutes, not seconds.
              chmodSync(hubFolder, 0o755);
              const start = performance.now();
              const landed = (p: Surface) =>
                existsSync(join(p.root, '.design', file)) &&
                createHash('sha256').update(bytes(p.root, file)).digest('hex') === input.sha256;
              let recoveredMs: number | null = null;
              await until(() => all.every(landed), 180000)
                .then(() => {
                  recoveredMs = performance.now() - start;
                })
                .catch(() => {});
              // The status bar must not read complete: either it asks for
              // attention or it counts the file that has not arrived.
              const counted = /(\d+)\s*\/\s*(\d+) files/.exec(waitingShown);
              const incomplete =
                HELD_STATUS.test(waitingShown) ||
                (!!counted && Number(counted[1]) < Number(counted[2]));
              const told = incomplete && panelSays.includes('held.png');
              return {
                status:
                  recoveredMs !== null && leakedWhileDown.length === 0 && told ? 'pass' : 'fail',
                recoveredMs,
                landedAt: all.filter(landed).map((p) => p.name),
                authorStatusWhileDown: waitingShown.slice(0, 160),
                authorStatusTitleWhileDown: titleWhileDown.slice(0, 300),
                syncPanelWhileDown: panelSays.slice(0, 300),
                leakedWhileDown,
              };
            } finally {
              chmodSync(hubFolder, 0o755);
            }
          });
        }
      }
      // L12 / L14 — a photo and a video moved into a folder and renamed from
      // the tree. Every copy holds the whole object at its new name and none
      // at the old; a canvas that names the new path decodes it on every
      // participant (so nothing serves a stale copy under the old name).
      {
        const kinds = [
          { lane: 'L12', ext: 'png', input: (n: string) => run.media.uploads?.[n] },
          { lane: 'L14', ext: 'mp4', input: (n: string) => run.media.videoUploads?.[n] },
        ] as const;
        for (const [k, kind] of kinds.entries()) {
          const from = all[k % all.length] as Surface;
          const name = `SurfaceMedia${kind.ext.toUpperCase()}-${from.name}`;
          const dest = `SurfaceMediaDest-${kind.ext}`;
          const original = `ui/${name}.${kind.ext}`;
          const movedRel = `ui/${dest}/${name}.${kind.ext}`;
          const renamedRel = `ui/${dest}/${name}-renamed.${kind.ext}`;
          const fileRow = (r: string) => selector(`file-row-${slug(r)}`);
          const hashAt = (p: Surface, r: string) =>
            existsSync(join(p.root, '.design', r))
              ? createHash('sha256').update(bytes(p.root, r)).digest('hex')
              : null;
          const input = kind.input(from.name);
          await check(`${kind.lane}.asset.move-rename`, `${from.name}-to-peers`, async () => {
            if (!input) throw new Unexercised('No media fixture');
            const hubSide = all.find((p) => p.name === 'hub') as Surface;
            mkdirSync(join(hubSide.root, '.design/ui', dest), { recursive: true });
            writeFileSync(join(hubSide.root, '.design/ui', dest, '.gitkeep'), '');
            writeFileSync(join(hubSide.root, '.design', original), readFileSync(input.path));
            await until(() => all.every((p) => hashAt(p, original) === input.sha256), 60000);
            for (const p of all) await expand(p, `ui/${dest}`).catch(() => {});
            await until(async () => (await from.read(fileRow(original))) !== null, 30000);
            await from.hover(fileRow(original));
            await from.click(selector(`tree-row-menu-${slug(original)}`));
            await from.menu('Move to…');
            await from.menu(`ui/${dest}`);
            await until(() => all.every((p) => hashAt(p, movedRel) === input.sha256), 30000);
            await expand(from, `ui/${dest}`);
            await until(async () => (await from.read(fileRow(movedRel))) !== null, 30000);
            await from.hover(fileRow(movedRel));
            await from.click(selector(`tree-row-menu-${slug(movedRel)}`));
            await from.promptNext(`${name}-renamed`);
            const start = performance.now();
            await from.menu('Rename…');
            const landed = await observeAll(
              all,
              `${kind.lane}-move-rename-${from.name}`,
              start,
              async (p) => (await p.read(fileRow(original))) === null,
              (p) =>
                hashAt(p, renamedRel) === input.sha256 &&
                hashAt(p, movedRel) === null &&
                hashAt(p, original) === null
            );
            // A canvas naming the new path decodes it everywhere.
            const viewer = `ui/SurfaceMediaView-${kind.ext}-${from.name}.tsx`;
            const tag =
              kind.ext === 'png'
                ? `<img data-testid="surface-moved-media" src="/.design/${renamedRel}" width={64} height={64} alt="" />`
                : `<video data-testid="surface-moved-media" src="/.design/${renamedRel}" width={160} height={90} muted playsInline preload="auto" />`;
            await seedCanvas(
              from,
              viewer,
              elementCanvas(`Moved ${kind.ext} ${from.name}`).replace(
                '<p>Kept paragraph</p>',
                `<p>Kept paragraph</p>\n          ${tag}`
              )
            );
            await openSeeded(
              viewer,
              `Moved ${kind.ext} ${from.name}`,
              `${kind.lane}-view-${from.name}`
            );
            const decoded = await Promise.all(
              all.map(async (p) => {
                try {
                  await until(async () => {
                    const m = await p.probe(selector('surface-moved-media'));
                    return (
                      !!m?.visible &&
                      (kind.ext === 'png'
                        ? (m.width ?? 0) > 0
                        : (m.readyState ?? 0) >= 1 && (m.width ?? 0) > 0)
                    );
                  }, 30000);
                  return { participant: p.name, decoded: true };
                } catch {
                  return {
                    participant: p.name,
                    decoded: false,
                    media: await p.probe(selector('surface-moved-media')),
                  };
                }
              })
            );
            return {
              ...landed,
              status: landed.status === 'pass' && decoded.every((d) => d.decoded) ? 'pass' : 'fail',
              decoded,
            };
          });
        }
      }
      // L10 — image stickers on the whiteboard: add from the Stickers picker,
      // move, resize, remove. The oracle is the receivers' decoded <image>, the
      // sidecar on disk and the sticker's asset bytes (which removal keeps).
      for (const from of all) {
        const rel = `ui/SurfaceStickers-${from.name}.tsx`;
        const sidecar = `${slug(rel.replace(/\.tsx$/, ''))}.annotations.svg`;
        const node = (p: Surface, id: string) => {
          const path = join(p.root, '.design', sidecar);
          if (!existsSync(path)) return null;
          return (
            readFileSync(path, 'utf8')
              .match(/<image\b[^>]*>/g)
              ?.find((n) => n.includes(`data-id="${id}"`)) ?? null
          );
        };
        const hrefOf = (svgNode: string | null) =>
          /href="([^"]+)"/.exec(svgNode ?? '')?.[1] ?? null;
        const q = (id: string) => `[data-id="${id}"]`;
        const decoded = async (p: Surface, id: string) => {
          const r = await p.probe(`image[data-id="${id}"], [data-id="${id}"] image`);
          return !!r?.visible && (r.width ?? 0) > 0;
        };
        let id: string | undefined;
        await check('L10.sticker.add', `${from.name}-to-peers`, async () => {
          await seedCanvas(from, rel, elementCanvas(`Stickers ${from.name}`));
          await openSeeded(rel, `Stickers ${from.name}`, `L10-${from.name}`);
          await gesture(from, selector('palette-mode-edit'), 'click');
          const before = new Set(
            (await from.probe('[data-tool="image"][data-id]'))?.matches?.map((m) => m.id)
          );
          await gesture(from, '.dc-tool-palette button[aria-label="Stickers"]', 'click');
          const firstSticker =
            '[aria-label="Stickers"] .st-sp-body > div:first-child .st-sp-cell:first-child';
          await until(async () => (await from.read(firstSticker)) !== null, 15000);
          const start = performance.now();
          await from.click(firstSticker).catch(async (error) => {
            if ((await from.read('[aria-label="Stickers"] [aria-label="Close"]')) !== null)
              await from.click('[aria-label="Stickers"] [aria-label="Close"]');
            throw error;
          });
          await until(async () => {
            id =
              (await from.probe('[data-tool="image"][data-id]'))?.matches?.find(
                (m) => m.id && !before.has(m.id)
              )?.id ?? undefined;
            return !!id;
          });
          const sid = id as string;
          return {
            strokeId: sid,
            ...(await observeAll(
              all,
              `L10-add-${from.name}`,
              start,
              (p) => decoded(p, sid),
              (p) => {
                const href = hrefOf(node(p, sid));
                return !!href && existsSync(join(p.root, '.design', href));
              }
            )),
          };
        });
        await check('L10.sticker.move', `${from.name}-to-peers`, async () => {
          if (!id) throw new Unexercised('Add did not produce a sticker');
          const sid = id;
          const before = await Promise.all(all.map(async (p) => (await p.probe(q(sid)))?.rect));
          const oldDisk = node(from, sid);
          const start = performance.now();
          await gesture(from, q(sid), 'pointer', { dx: 70, dy: 40 });
          return observeAll(
            all,
            `L10-move-${from.name}`,
            start,
            async (p) => {
              const r = (await p.probe(q(sid)))?.rect;
              const b = before[all.indexOf(p)];
              return !!r && !!b && Math.abs(r.x - b.x) > 10;
            },
            (p) => node(from, sid) !== oldDisk && node(p, sid) === node(from, sid)
          );
        });
        await check('L10.sticker.resize', `${from.name}-to-peers`, async () => {
          if (!id) throw new Unexercised('Add did not produce a sticker');
          const sid = id;
          await gesture(from, q(sid), 'pointer');
          const handle = '.dc-annot-resize-handle[data-corner="se"]';
          await until(async () => !!(await from.probe(handle))?.visible).catch(async (error) => {
            await from.screenshot(join(run.out, `L10-no-handle-${from.name}.png`));
            return unlessNotRendering(from, error);
          });
          const before = await Promise.all(all.map(async (p) => (await p.probe(q(sid)))?.rect));
          const oldDisk = node(from, sid);
          const start = performance.now();
          await gesture(from, handle, 'pointer', { dx: 50, dy: 50 });
          return observeAll(
            all,
            `L10-resize-${from.name}`,
            start,
            async (p) => {
              const r = (await p.probe(q(sid)))?.rect;
              const b = before[all.indexOf(p)];
              return !!r && !!b && r.width > b.width + 10;
            },
            (p) => node(from, sid) !== oldDisk && node(p, sid) === node(from, sid)
          );
        });
        // Replace — the sticker's own Replace… (annotation context menu →
        // media picker) swaps its picture for the project's seeded photo.
        await check('L10.sticker.replace', `${from.name}-to-peers`, async () => {
          if (!id) throw new Unexercised('Add did not produce a sticker');
          const sid = id;
          const next = 'assets/surface-pattern.png';
          await gesture(from, selector('palette-mode-edit'), 'click');
          await gesture(from, q(sid), 'contextMenu');
          const replace = '.dc-context-menu [data-action="replace"]';
          await until(async () => !!(await from.probe(replace))?.visible);
          await gesture(from, replace, 'click');
          const cell = '[aria-label="Choose media"] .st-ap-cell[title^="surface-pattern.png"]';
          await until(async () => (await from.read(cell)) !== null);
          const start = performance.now();
          await from.click(cell);
          return observeAll(
            all,
            `L10-replace-${from.name}`,
            start,
            async (p) => {
              const r = await p.probe(`image[data-id="${sid}"], [data-id="${sid}"] image`);
              return !!r?.visible && r.pixel?.join(',') === '111,159,21,255';
            },
            (p) => hrefOf(node(p, sid)) === next && node(p, sid) === node(from, sid)
          );
        });
        await check('L10.sticker.remove', `${from.name}-to-peers`, async () => {
          if (!id) throw new Unexercised('Add did not produce a sticker');
          const sid = id;
          const asset = hrefOf(node(from, sid));
          await gesture(from, q(sid), 'pointer');
          const start = performance.now();
          await gesture(from, 'body', 'key', { key: 'Backspace' });
          return observeAll(
            all,
            `L10-remove-${from.name}`,
            start,
            async (p) => (await p.probe(q(sid))) === null,
            // Removing the sticker does not delete the project's asset.
            (p) => node(p, sid) === null && !!asset && existsSync(join(p.root, '.design', asset))
          );
        });
      }
      // L08 — artboards: add (Edit menu), rename (double-click the name), move
      // (drag the name), remove (select + Backspace). Receivers keep the canvas
      // open; the oracle is their rendered artboard chrome and the source/meta.
      const boardsCanvas = (title: string) =>
        `import { DesignCanvas, DCArtboard } from '@maude/canvas-lib';\nexport default function SurfaceBoards() {\n  return (\n    <DesignCanvas>\n      <DCArtboard id="main" label="Main" width={480} height={320}>\n        <h1 style={{ padding: 24 }}>${title}</h1>\n      </DCArtboard>\n    </DesignCanvas>\n  );\n}\n`;
      const boardLabel = (id: string) => `[data-dc-screen="${id}"] .dc-artboard-label`;
      for (const from of all) {
        const rel = `ui/SurfaceBoards-${from.name}.tsx`;
        const src = (p: Surface) => readFileSync(join(p.root, '.design', rel), 'utf8');
        const addedId = (p: Surface) =>
          /<DCArtboard id="([^"]+)" label="Mobile"/.exec(src(p))?.[1] ?? null;
        await check('L08.artboard.add', `${from.name}-to-peers`, async () => {
          await seedCanvas(from, rel, boardsCanvas(`Boards ${from.name}`));
          await openSeeded(rel, `Boards ${from.name}`, `L08-${from.name}`);
          await from.menu('Edit');
          const start = performance.now();
          await from.menu('New artboard: Mobile');
          return observeAll(
            all,
            `L08-add-${from.name}`,
            start,
            async (p) => {
              const id = addedId(p);
              return !!id && ((await p.read(boardLabel(id), true)) ?? '').includes('Mobile');
            },
            (p) => addedId(p) !== null && src(p).includes('label="Main"')
          );
        });
        await check('L08.artboard.rename', `${from.name}-to-peers`, async () => {
          const id = addedId(from);
          if (!id || all.some((p) => addedId(p) !== id))
            throw new Unexercised('Rename needs the added artboard on every participant');
          await gesture(from, boardLabel(id), 'doubleClick');
          await until(async () => !!(await from.probe(selector(`artboard-rename-${id}`)))?.visible);
          await gesture(from, selector(`artboard-rename-${id}`), 'fill', `Phone ${from.name}`);
          const start = performance.now();
          await gesture(from, selector(`artboard-rename-${id}`), 'key', { key: 'Enter' });
          return observeAll(
            all,
            `L08-rename-${from.name}`,
            start,
            async (p) =>
              ((await p.read(boardLabel(id), true)) ?? '').includes(`Phone ${from.name}`),
            (p) => src(p).includes(`id="${id}" label="Phone ${from.name}"`)
          );
        });
        await check('L08.artboard.move', `${from.name}-to-peers`, async () => {
          const id = /<DCArtboard id="([^"]+)" label="Phone/.exec(src(from))?.[1];
          if (!id) throw new Unexercised('Move needs the renamed artboard');
          const gap = async (p: Surface) => {
            const a = (await p.probe(boardLabel(id)))?.rect as { left: number } | undefined;
            const b = (await p.probe(boardLabel('main')))?.rect as { left: number } | undefined;
            return a && b ? a.left - b.left : null;
          };
          const before = new Map<string, number | null>();
          for (const p of all) before.set(p.name, await gap(p));
          const metaX = (p: Surface) => {
            try {
              const meta = JSON.parse(
                readFileSync(join(p.root, '.design', rel.replace(/\.tsx$/, '.meta.json')), 'utf8')
              );
              return (
                (meta.layout?.artboards ?? []).find((r: { id: string }) => r.id === id)?.x ?? null
              );
            } catch {
              return null;
            }
          };
          const beforeX = metaX(from);
          const start = performance.now();
          await gesture(from, boardLabel(id), 'pointer', { dx: 160, dy: 40 });
          return observeAll(
            all,
            `L08-move-${from.name}`,
            start,
            async (p) => {
              const g = await gap(p);
              const b = before.get(p.name);
              return g !== null && b !== null && b !== undefined && Math.abs(g - b) > 20;
            },
            (p) => {
              const x = metaX(p);
              return x !== null && x !== beforeX && x === metaX(from);
            }
          );
        });
        await check('L08.artboard.remove', `${from.name}-to-peers`, async () => {
          const id = /<DCArtboard id="([^"]+)" label="Phone/.exec(src(from))?.[1];
          if (!id) throw new Unexercised('Remove needs the renamed artboard');
          await gesture(from, boardLabel(id), 'click');
          await sleep(200);
          const start = performance.now();
          await gesture(from, 'body', 'key', { key: 'Backspace' });
          return observeAll(
            all,
            `L08-remove-${from.name}`,
            start,
            async (p) =>
              (await p.read(boardLabel(id), true)) === null &&
              ((await p.read(boardLabel('main'), true)) ?? '').includes('Main'),
            (p) => !src(p).includes(`id="${id}"`) && src(p).includes('label="Main"')
          );
        });
      }
      for (const from of all) {
        const rel = `ui/SurfaceEl-${from.name}.tsx`;
        await check('L07.element.duplicate', `${from.name}-to-peers`, async () => {
          await seedCanvas(from, rel, elementCanvas(`Element ${from.name}`));
          await openSeeded(rel, `Element ${from.name}`, `L07-${from.name}`);
          await selectHeading(from);
          const start = performance.now();
          await gesture(from, 'body', 'key', { key: 'd', meta: true });
          return observeAll(
            all,
            `L07-duplicate-${from.name}`,
            start,
            async (p) =>
              (await headings(p)) === 2 && (await p.read('p', true)) === 'Kept paragraph',
            (p) => count(p, rel, '<h1') === 2 && count(p, rel, 'Kept paragraph') === 1
          );
        });
        await check('L07.element.insert', `${from.name}-to-peers`, async () => {
          // The palette's "+ Element → Text" appends to the active artboard.
          const texts = (p: Surface) => count(p, rel, '<p\\b');
          const before = all.map((p) => texts(p));
          await gesture(from, selector('palette-mode-edit'), 'click');
          await gesture(from, '[aria-label="Insert element — Div, Text, or Image"]', 'click');
          await until(
            async () =>
              !!(await from.probe('[aria-label="Insert element"] [role="menuitem"]'))?.visible
          );
          const start = performance.now();
          await gesture(from, '.dc-tp-insert-popover button:nth-of-type(2)', 'click');
          return observeAll(
            all,
            `L07-insert-${from.name}`,
            start,
            async (p) => ((await p.probe('.dc-artboard-body p'))?.matches?.length ?? 0) >= 2,
            (p) => texts(p) === (before[all.indexOf(p)] as number) + 1 && count(p, rel, '<h1') === 2
          );
        });
        await check('L07.element.delete', `${from.name}-to-peers`, async () => {
          for (const p of all)
            if (count(p, rel, '<h1') !== 2)
              throw new Unexercised(`Delete needs the duplicated heading at ${p.name}`);
          await selectHeading(from);
          // The insert above left its new text selected: pick the heading.
          for (
            let n = 0;
            n < 6 && !((await from.read('.st-sb-sel .val')) ?? '').includes(`Element ${from.name}`);
            n++
          ) {
            await gesture(from, 'h1', n === 0 ? 'click' : 'doubleClick');
            await sleep(150);
          }
          // Act on what the designer sees: the heading named in the selection
          // chip, on a canvas that has stopped re-rendering the duplicate.
          await until(async () => {
            const chip = await from.read('.st-sb-sel .val');
            if (!chip?.includes(`Element ${from.name}`) || (await headings(from)) !== 2)
              return false;
            await sleep(300);
            return (await headings(from)) === 2 && !!(await from.read('.st-sb-sel .val'));
          });
          // The drill above double-clicks, which can open the heading's text
          // editor (`plaintext-only`): Delete then edits text at the caret
          // instead of removing the element. Leave the editor first — the
          // selection stays.
          const editing = async () =>
            !!(
              await from.probe('[contenteditable]:not([contenteditable="false"])').catch(() => null)
            )?.visible;
          for (let n = 0; n < 3 && (await editing()); n++) {
            await gesture(from, 'body', 'key', { key: 'Escape' });
            await sleep(150);
          }
          const before = {
            chip: await from.read('.st-sb-sel .val').catch(() => null),
            textEditing: await editing(),
          };
          const start = performance.now();
          await gesture(from, 'body', 'key', { key: 'Delete' });
          const result = await observeAll(
            all,
            `L07-delete-${from.name}`,
            start,
            async (p) =>
              (await headings(p)) === 1 && (await p.read('p', true)) === 'Kept paragraph',
            (p) => count(p, rel, '<h1') === 1 && count(p, rel, 'Kept paragraph') === 1
          );
          return result.status === 'pass'
            ? result
            : {
                ...result,
                beforeDelete: before,
                afterDelete: {
                  chip: await from.read('.st-sb-sel .val').catch(() => null),
                  authorHeadings: await headings(from).catch(() => null),
                  authorSourceHeadings: count(from, rel, '<h1'),
                },
              };
        });
        // Resize through the element's own corner handle: the width/height it
        // writes land in the source everywhere and every render grows.
        await check('L07.element.resize', `${from.name}-to-peers`, async () => {
          for (const p of all)
            if (count(p, rel, '<h1') !== 1)
              throw new Unexercised(`Resize needs the single heading at ${p.name}`);
          await selectHeading(from);
          const handle = '.dc-el-resize-handle[data-corner="se"]';
          await until(async () => !!(await from.probe(handle))?.visible).catch((error) =>
            unlessNotRendering(from, error)
          );
          const before = await Promise.all(all.map(async (p) => (await p.probe('h1'))?.rect));
          const oldSrc = readFileSync(join(from.root, '.design', rel), 'utf8');
          const start = performance.now();
          await gesture(from, handle, 'pointer', { dx: -60, dy: 40 });
          return observeAll(
            all,
            `L07-resize-${from.name}`,
            start,
            async (p) => {
              const r = (await p.probe('h1'))?.rect;
              const b = before[all.indexOf(p)];
              return !!r && !!b && Math.abs(r.height - b.height) > 10;
            },
            (p) => {
              const s = readFileSync(join(p.root, '.design', rel), 'utf8');
              return (
                s !== oldSrc &&
                // FRACTIONAL PIXELS ARE THE NORMAL CASE. A drag commits the
                // measured box, and a measured box is `94.28px` far more often
                // than `94px` — so `\d+px` rejected a resize that had
                // travelled correctly to every copy. The row read as a lost
                // edit for as long as it ran, which was the first time.
                /<h1[^>]*height:\s*"\d+(?:\.\d+)?px"/.test(s) &&
                s === readFileSync(join(from.root, '.design', rel), 'utf8')
              );
            }
          );
        });
        // Reorder: drag the selected heading below the paragraph in the
        // canvas itself (the drop commits the new order to the source).
        await check('L07.element.move-reorder', `${from.name}-to-peers`, async () => {
          const order = (p: Surface) => {
            const s = readFileSync(join(p.root, '.design', rel), 'utf8');
            return s.indexOf('<h1') < s.indexOf('Kept paragraph') ? 'h1-first' : 'p-first';
          };
          for (const p of all)
            if (order(p) !== 'h1-first' || count(p, rel, '<h1') !== 1)
              throw new Unexercised(`Reorder needs heading-then-paragraph at ${p.name}`);
          // From a clean slate: after the previous row's write the canvas
          // remounts and restores its selection a beat later, so a stale
          // inspector must not stand in for a real selection.
          await gesture(from, 'body', 'key', { key: 'Escape' });
          await sleep(300);
          await selectHeading(from);
          // The heading ALONE — the inspector also offers weight on the
          // section around it, and dragging that moves the whole section.
          const chip = async () => (await from.read('.st-sb-sel .val')) ?? '';
          for (
            let n = 0;
            n < 6 &&
            !((await chip()).includes(`Element ${from.name}`) && !(await chip()).includes('Kept'));
            n++
          ) {
            await gesture(from, 'h1', 'doubleClick');
            await sleep(200);
          }
          if (!(await chip()).includes(`Element ${from.name}`) || (await chip()).includes('Kept'))
            throw new Unexercised(
              `Could not select the heading alone (selection: ${await chip()})`
            );
          // The CANVAS must hold it too (its halo sits on the heading) and keep
          // it: a clear still travelling from the Escape above must land first.
          const haloOnHeading = async () => {
            const halo = (await from.probe('.dc-cv-halo--selected'))?.rect;
            const head = (await from.probe('h1'))?.rect;
            return (
              !!halo &&
              !!head &&
              Math.abs(halo.y - head.y) < 12 &&
              Math.abs(halo.height - head.height) < 16
            );
          };
          await until(async () => {
            if (!(await haloOnHeading())) return false;
            await sleep(1000);
            return haloOnHeading();
          }, 15000).catch(() => {
            throw new Unexercised('The canvas did not keep the heading selected');
          });
          const h = (await from.probe('h1'))?.rect;
          const para = (await from.probe('.dc-artboard-body p'))?.rect;
          if (!h || !para) throw new Unexercised('Heading or paragraph not rendered');
          const start = performance.now();
          const dy = para.y + para.height * 0.9 - (h.y + h.height / 2);
          // A browser gets a real pointer; the native lane the frame probe.
          if (!(await from.canvasDrag?.('h1', 0, dy, 700)))
            await gesture(from, 'h1', 'pointer', { dx: 0, dy, hold: 600 });
          await from.screenshot(join(run.out, `L07-reorder-dropped-${from.name}.png`));
          const selText = await from.read('.st-sb-sel');
          const h1 = await from.probe('h1');
          writeFileSync(
            join(run.out, `L07-reorder-diag-${from.name}.json`),
            JSON.stringify(
              {
                selection: selText,
                h1: h1?.markup?.slice(0, 300),
                h1Count: h1?.matches?.length,
                chipIdMatches:
                  (
                    await from.probe(
                      `[data-cd-id="${/data-cd-id="([^"]+)"/.exec(selText ?? '')?.[1]}"]`
                    )
                  )?.matches?.length ?? 0,
              },
              null,
              2
            )
          );
          return observeAll(
            all,
            `L07-reorder-${from.name}`,
            start,
            async (p) => {
              const hh = (await p.probe('h1'))?.rect;
              const pp = (await p.probe('.dc-artboard-body p'))?.rect;
              return !!hh && !!pp && pp.y < hh.y;
            },
            (p) => order(p) === 'p-first' && count(p, rel, '<h1') === 1
          );
        });
      }
      // L08 — artboard resize through its own corner handle: the numeric
      // width/height props change in the source everywhere; every render agrees.
      for (const from of all) {
        const rel = `ui/SurfaceBoardSize-${from.name}.tsx`;
        const size = (p: Surface) =>
          /<DCArtboard id="main"[^>]*width=\{(\d+)\}[^>]*height=\{(\d+)\}/
            .exec(readFileSync(join(p.root, '.design', rel), 'utf8'))
            ?.slice(1)
            .join('x') ?? null;
        await check('L08.artboard.resize', `${from.name}-to-peers`, async () => {
          await seedCanvas(from, rel, boardsCanvas(`Board size ${from.name}`));
          await openSeeded(rel, `Board size ${from.name}`, `L08-size-${from.name}`);
          await gesture(from, selector('palette-mode-edit'), 'click');
          // The artboard itself (its empty area), not its name: the name
          // selects it for board actions, the body for the resize handles.
          await gesture(from, '[data-dc-screen="main"] .dc-artboard-body', 'pointer', {
            x: 0.92,
            y: 0.92,
          });
          const handle = '.dc-el-resize-handle[data-corner="se"]';
          await until(async () => !!(await from.probe(handle))?.visible).catch(async (error) => {
            await from.screenshot(join(run.out, `L08-resize-no-handle-${from.name}.png`));
            const handles = (await from.probe('.dc-el-resize-handle'))?.matches?.length ?? 0;
            // The handles are placed by animation frames — a window that is
            // not rendering (a locked screen) never shows them. Say the row
            // was not exercised rather than call it a failure.
            return unlessNotRendering(
              from,
              new Error(`${String(error)} — resize handles in the frame: ${handles}`)
            );
          });
          // WORLD width, not rendered width. The canvas fits its content to
          // the viewport, so an artboard that genuinely grew comes back the
          // same rendered size — the native participant failed this row in all
          // three directions, including as the author of its own resize, while
          // its inspector plainly read the new W and H.
          const before = await Promise.all(
            all.map(async (p) => (await p.probe('[data-dc-screen="main"]', 'worldRect'))?.worldRect)
          );
          const start = performance.now();
          await gesture(from, handle, 'pointer', { dx: 80, dy: 60 });
          return observeAll(
            all,
            `L08-resize-${from.name}`,
            start,
            async (p) => {
              const r = (await p.probe('[data-dc-screen="main"]', 'worldRect'))?.worldRect;
              const b = before[all.indexOf(p)];
              return !!r && !!b && r.width > b.width + 20;
            },
            (p) => size(p) !== null && size(p) !== '480x320' && size(p) === size(from)
          );
        });
      }
      // L21 — two people set the SAME property at once. Acceptance order
      // wins (T24): every participant converges on one value, nobody is
      // handed a conflict, and the other paragraph is untouched.
      for (const [i, from] of all.entries()) {
        const other = all[(i + 1) % all.length] as Surface;
        const rel = `ui/SurfaceRace-${from.name}.tsx`;
        await check('L21.same-property-race', `${from.name}-and-${other.name}`, async () => {
          await seedCanvas(from, rel, elementCanvas(`Race ${from.name}`));
          await openSeeded(rel, `Race ${from.name}`, `L21-${from.name}`);
          await selectHeading(from);
          await selectHeading(other);
          const start = performance.now();
          await Promise.all([from.select(weight, '300'), other.select(weight, '800')]);
          const settled = await until(() => {
            const vals = all.map((p) => readFileSync(join(p.root, '.design', rel), 'utf8'));
            return (
              vals.every((v) => v === vals[0]) &&
              /fontWeight:\s*"(300|800)"/.test(vals[0] as string)
            );
          }, 30000)
            .then(() => true)
            .catch(() => false);
          const conflicts = all.map((p) => {
            try {
              const sync = JSON.parse(readFileSync(join(p.root, '.design', '_sync.json'), 'utf8'));
              return (sync.notices ?? []).some((n: { id?: string }) =>
                String(n.id ?? '').startsWith(`source-conflict-ui-surfacerace-${slug(from.name)}`)
              );
            } catch {
              return false;
            }
          });
          const winner = /fontWeight:\s*"(300|800)"/.exec(
            readFileSync(join(from.root, '.design', rel), 'utf8')
          )?.[1];
          for (const p of all)
            await p.screenshot(join(run.out, `L21-race-${from.name}-${p.name}.png`));
          return {
            status: settled && conflicts.every((c) => !c) ? 'pass' : 'fail',
            convergedMs: settled ? performance.now() - start : null,
            winner,
            conflictNotices: conflicts,
          };
        });
      }
      // L21 — independent edits at the same moment: one person retitles the
      // heading in its leaf editor while another restyles the paragraph from
      // the inspector. Both changes survive everywhere, nobody gets a conflict.
      const selectEl = async (p: Surface, q: string) => {
        await gesture(p, selector('palette-mode-edit'), 'click');
        for (let level = 0; level < 6; level++) {
          const chip = (await p.read('.st-sb-sel .val')) ?? '';
          if ((await p.read(weight)) !== null && chip.includes('Kept paragraph')) return;
          await gesture(p, q, level === 0 ? 'click' : 'doubleClick');
          await sleep(150);
        }
        if ((await p.read(weight)) === null)
          throw new Error(`Inspector knob absent after selecting ${q} at ${p.name}`);
      };
      for (const [i, from] of all.entries()) {
        const other = all[(i + 1) % all.length] as Surface;
        const rel = `ui/SurfaceIndependent-${from.name}.tsx`;
        await check('L21.independent-edits', `${from.name}-and-${other.name}`, async () => {
          await seedCanvas(from, rel, elementCanvas(`Independent ${from.name}`));
          await openSeeded(rel, `Independent ${from.name}`, `L21-ind-${from.name}`);
          await selectEl(other, 'p');
          await gesture(from, selector('palette-mode-edit'), 'click');
          const editor = 'h1[contenteditable="plaintext-only"]';
          for (let level = 0; level < 12 && !(await from.probe(editor))?.visible; level++) {
            await gesture(from, 'h1', 'doubleClick');
            await sleep(50);
          }
          if (!(await from.probe(editor))?.visible) throw new Error('Heading editor did not open');
          const title = `Retitled by ${from.name}`;
          await gesture(from, editor, 'editText', title);
          const start = performance.now();
          await Promise.all([
            gesture(from, editor, 'key', { key: 'Enter' }),
            other.select(weight, '700'),
          ]);
          const src = (p: Surface) => readFileSync(join(p.root, '.design', rel), 'utf8');
          return observeAll(
            all,
            `L21-independent-${from.name}`,
            start,
            async (p) => (await p.read('h1', true)) === title,
            (p) =>
              src(p).includes(`>${title}</h1>`) &&
              /<p\b[^>]*fontWeight:\s*"700"[^>]*>Kept paragraph<\/p>/.test(src(p)) &&
              src(p) === src(from)
          );
        });
      }
      // L15 — a video composition's timeline, cut in the shell's Timeline
      // panel: every participant has the panel open on the same composition;
      // one person splits a clip at the playhead (⌘B), deletes one (Delete,
      // ripple), undoes and redoes (⌘Z / ⌘⇧Z). Every copy's source and every
      // participant's own timeline show the same cut.
      {
        const cutSource = readFileSync(
          new URL('../fixtures/project/.design/ui/Cut.tsx', import.meta.url),
          'utf8'
        );
        const beats = (p: Surface) => p.count('[data-testid^="timeline-seq-"]');
        const sequencesIn = (p: Surface, rel: string) =>
          existsSync(join(p.root, '.design', rel))
            ? (
                readFileSync(join(p.root, '.design', rel), 'utf8').match(
                  /<TransitionSeries\.Sequence\b/g
                ) ?? []
              ).length
            : -1;
        const openTimeline = async (p: Surface) => {
          if ((await p.count(selector('timeline-panel'))) === 0) await p.press('Meta+Shift+T');
          await until(async () => (await p.count(selector('timeline-panel'))) > 0, 15000);
        };
        // Keys go to the shell, not the canvas frame: focus a shell control first.
        const focusShell = (p: Surface) => p.click(selector('timeline-readout'));
        for (const from of all) {
          const rel = `ui/SurfaceCut-${from.name}.tsx`;
          // The source after each step, so undo and redo are held to the exact
          // bytes they must restore (a clip count alone cannot tell a redo
          // from a second undo).
          const after: Record<string, string> = {};
          const cut = async (id: string, act: () => Promise<void>, n: number, restores?: string) =>
            check(id, `${from.name}-to-peers`, async () => {
              if (all.some((p) => sequencesIn(p, rel) < 0))
                throw new Unexercised('The composition is not on every participant');
              if (restores && !after[restores])
                throw new Unexercised(`${id} needs ${restores} to have run`);
              const start = performance.now();
              await act();
              const result = await observeAll(
                all,
                `${id.replace(/\./g, '-')}-${from.name}`,
                start,
                async (p) => (await beats(p)) === n,
                (p) =>
                  sequencesIn(p, rel) === n &&
                  bytes(p.root, rel).equals(bytes(from.root, rel)) &&
                  (!restores || bytes(p.root, rel).toString() === after[restores])
              );
              // The cut happened where it was aimed: the first clip keeps its length.
              if (
                id === 'L15.timeline.split' &&
                !/name="beat-one" durationInFrames=\{B1\}/.test(bytes(from.root, rel).toString())
              )
                return {
                  ...result,
                  status: 'fail',
                  error: 'split landed in the first clip, not at the playhead in the second',
                };
              after[id] = bytes(from.root, rel).toString();
              return result;
            });
          // Create: the command palette's "New video…" — a name, a size and a
          // frame rate asked in the shell's own prompt — makes an empty video
          // composition that everyone receives.
          await check('L15.video.create', `${from.name}-to-peers`, async () => {
            const name = `SurfaceVideo-${from.name}`;
            const made = `ui/${name}.tsx`;
            const answer = async (title: RegExp, value: string) => {
              await until(
                async () =>
                  (
                    (await from.shell(
                      `document.querySelector('.st-prompt')?.getAttribute('aria-label') ?? ''`
                    )) as string
                  ).match(title) !== null,
                10000
              );
              await from.fill(selector('shell-prompt-input'), value);
              await from.click(selector('shell-prompt-ok'));
            };
            // WHICH STEP. This row fails only on the hub lane and only in a full
            // run, with nothing but "Condition absent" to go on — four different
            // waits share that message.
            let step = 'focus the shell';
            const focused = await focusShell(from).then(
              () => true,
              () => false
            );
            const search = '[aria-label="Command palette"] input';
            try {
              step = 'open the command palette';
              await from.press('Meta+k');
              await until(async () => (await from.count(search)) > 0, 10000);
              await from.fill(search, 'New video');
              await from.press('Enter');
              step = 'name the video';
              await answer(/^New video name/, name);
              step = 'choose its size';
              await answer(/^Size/, '1280x720');
            } catch (error) {
              await from
                .screenshot(join(run.out, `L15-create-${from.name}-stuck.png`))
                .catch(() => {});
              const prompt = await from
                .shell(`document.querySelector('.st-prompt')?.getAttribute('aria-label') ?? null`)
                .catch(() => 'unreadable');
              const active = await from
                .shell(
                  `(() => { const a = document.activeElement; return a ? a.tagName + (a.getAttribute('data-testid') ? '#' + a.getAttribute('data-testid') : '') : null; })()`
                )
                .catch(() => 'unreadable');
              throw new Error(
                `${String(error)} — at "${step}" (shell focused first: ${focused}; ` +
                  `palette inputs: ${await from.count(search).catch(() => -1)}; prompt: ${prompt}; ` +
                  `active element: ${active})`
              );
            }
            const start = performance.now();
            await answer(/^Frames per second/, '24');
            return observeAll(
              all,
              `L15-create-${from.name}`,
              start,
              async (p) => (await p.read(rowOf(made))) !== null,
              (p) =>
                existsSync(join(p.root, '.design', made)) &&
                /VideoComp/.test(bytes(p.root, made).toString()) &&
                bytes(p.root, made).equals(bytes(from.root, made))
            );
          });
          await check('L15.timeline.open', `${from.name}-created`, async () => {
            await seedCanvas(from, rel, cutSource);
            const start = performance.now();
            for (const p of all) {
              await until(async () => (await p.read(rowOf(rel))) !== null, 30000);
              await openCanvas(p, rel);
              await openTimeline(p);
            }
            return observeAll(
              all,
              `L15-open-${from.name}`,
              start,
              async (p) => (await beats(p)) === 3
            );
          });
          await cut(
            'L15.timeline.split',
            async () => {
              await focusShell(from);
              await from.press('Escape');
              // The playhead into the second clip: to its start (`.` jumps to
              // the next clip boundary), then ten frames on.
              await from.press('Home');
              await from.press('.');
              for (let i = 0; i < 10; i++) await from.press('ArrowRight');
              await from.press('Meta+b');
            },
            4
          );
          await cut(
            'L15.timeline.delete',
            async () => {
              await from.click(selector('timeline-seq-1'));
              await until(async () => (await from.count('.tl-seq-block.is-selected')) === 1, 5000);
              await from.press('Delete');
            },
            3
          );
          await cut(
            'L15.timeline.undo',
            async () => {
              await focusShell(from);
              await from.press('Meta+z');
            },
            4,
            'L15.timeline.split'
          );
          await cut(
            'L15.timeline.redo',
            async () => {
              await focusShell(from);
              await from.press('Meta+Shift+z');
            },
            3,
            'L15.timeline.delete'
          );
          // Insert, edit a clip's property, move: a Title overlay added at the
          // playhead, its text rewritten in the clip inspector, then dragged
          // along the timeline.
          const overlay = (p: Surface) =>
            p.shell(
              `[...document.querySelectorAll('[data-testid^="timeline-seq-"]')].find((b) => /drag to move/.test(b.getAttribute('title') || ''))?.getAttribute('data-testid') ?? ''`
            ) as Promise<string>;
          const overlayTitle = (p: Surface) =>
            p.shell(
              `[...document.querySelectorAll('[data-testid^="timeline-seq-"]')].find((b) => /drag to move/.test(b.getAttribute('title') || ''))?.getAttribute('title') ?? ''`
            ) as Promise<string>;
          await check('L15.timeline.insert', `${from.name}-to-peers`, async () => {
            if (all.some((p) => sequencesIn(p, rel) !== 3))
              throw new Unexercised('Insert needs the three-clip cut everywhere');
            await focusShell(from);
            await from.press('Home');
            const start = performance.now();
            await from.click(selector('timeline-add-title'));
            return observeAll(
              all,
              `L15-insert-${from.name}`,
              start,
              async (p) => (await beats(p)) === 4 && (await overlay(p)) !== '',
              (p) =>
                /<Sequence\b[^>]*from=/.test(bytes(p.root, rel).toString()) &&
                bytes(p.root, rel).equals(bytes(from.root, rel))
            );
          });
          await check('L15.timeline.clip-property', `${from.name}-to-peers`, async () => {
            const block = await overlay(from);
            if (!block) throw new Unexercised('No title overlay to edit');
            const text = `Title by ${from.name}`;
            // A double-click where a person's would land: the inspector opens
            // beside the pointer, on screen.
            await from.shell(`(() => {
              const b = document.querySelector('[data-testid="${block}"]');
              const r = b.getBoundingClientRect();
              b.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
              return true;
            })()`);
            try {
              await until(
                async () => (await from.count(selector('timeline-inspector-text'))) > 0,
                10000
              );
              await from.fill(selector('timeline-inspector-text'), text);
              const start = performance.now();
              await from.click(selector('timeline-inspector-text-apply'));
              return await observeAll(
                all,
                `L15-clip-property-${from.name}`,
                start,
                async (p) => ((await p.read('body', true)) ?? '').includes(text),
                (p) =>
                  bytes(p.root, rel).toString().includes(text) &&
                  bytes(p.root, rel).equals(bytes(from.root, rel))
              );
            } finally {
              // Never leave the inspector over the shell for the next row.
              if ((await from.count(selector('timeline-inspector'))) > 0)
                await from.click('[data-testid="timeline-inspector"] .tlci-x').catch(() => {});
            }
          });
          await check('L15.timeline.move', `${from.name}-to-peers`, async () => {
            const block = await overlay(from);
            if (!block) throw new Unexercised('No title overlay to move');
            const before = bytes(from.root, rel).toString();
            // Evidence: every retime the author's shell sends for this drag.
            await from.shell(`(() => {
              window.__surfaceRetimes = [];
              if (!window.__surfaceFetchWrapped) {
                const f = window.fetch.bind(window);
                window.fetch = (u, o) => {
                  if (String(u).includes('/_api/retime-sequence')) window.__surfaceRetimes.push(o && o.body);
                  return f(u, o);
                };
                window.__surfaceFetchWrapped = true;
              }
              return true;
            })()`);
            const start = performance.now();
            await from.shell(`(async () => {
              const b = document.querySelector('[data-testid="${block}"]');
              const r = b.getBoundingClientRect();
              const at = (x) => ({ bubbles: true, cancelable: true, clientX: x, clientY: r.top + r.height / 2, pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1 });
              b.dispatchEvent(new PointerEvent('pointerdown', at(r.left + 6)));
              await new Promise((d) => setTimeout(d, 80));
              for (let i = 1; i <= 6; i++) {
                window.dispatchEvent(new PointerEvent('pointermove', at(r.left + 6 + i * 15)));
                await new Promise((d) => setTimeout(d, 16));
              }
              window.dispatchEvent(new PointerEvent('pointerup', { ...at(r.left + 96), buttons: 0 }));
              return true;
            })()`);
            await until(() => bytes(from.root, rel).toString() !== before, 15000);
            // Where the author's own file says the clip now starts.
            const movedFrom = /<Sequence\b[^>]*\bfrom=\{(\d+)\}/.exec(
              bytes(from.root, rel).toString()
            )?.[1];
            let expected = '';
            await until(async () => {
              expected = await overlayTitle(from);
              return !!movedFrom && expected.includes(`· ${movedFrom}–`);
            }, 15000);
            const moved = await observeAll(
              all,
              `L15-move-${from.name}`,
              start,
              async (p) => (await overlayTitle(p)) === expected,
              (p) => bytes(p.root, rel).equals(bytes(from.root, rel))
            );
            for (const p of all) {
              const sync = join(p.root, '.design', '_sync.json');
              if (existsSync(sync))
                writeFileSync(
                  join(run.out, `L15-move-${from.name}-${p.name}-sync.json`),
                  readFileSync(sync)
                );
            }
            return {
              movedFrom,
              clip: expected,
              ...moved,
              finalClips: await Promise.all(
                all.map(async (p) => ({ participant: p.name, clip: await overlayTitle(p) }))
              ),
              retimesSent: await from.shell('window.__surfaceRetimes'),
              source: /<Sequence\b[^>]*>/.exec(bytes(from.root, rel).toString())?.[0] ?? null,
            };
          });
          // Trim: drag the first clip's right edge — it retimes the clip.
          await check('L15.timeline.trim', `${from.name}-to-peers`, async () => {
            if (all.some((p) => sequencesIn(p, rel) !== 3))
              throw new Unexercised('Trim needs the three-clip cut everywhere');
            const titleOf = (p: Surface) =>
              p.shell(
                `document.querySelector('[data-testid="timeline-seq-0"]')?.getAttribute('title') ?? ''`
              ) as Promise<string>;
            const before = bytes(from.root, rel).toString();
            const titlesBefore = await Promise.all(all.map((p) => titleOf(p)));
            const start = performance.now();
            // pointerdown on the handle, then the window moves the shell listens
            // to (registered after the press re-renders), then the release.
            await from.shell(`(async () => {
              const h = document.querySelector('[data-testid="timeline-resize-0"]');
              const r = h.getBoundingClientRect();
              const at = (x) => ({ bubbles: true, cancelable: true, clientX: x, clientY: r.top + r.height / 2, pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1 });
              h.dispatchEvent(new PointerEvent('pointerdown', at(r.left + 2)));
              await new Promise((d) => setTimeout(d, 80));
              for (let i = 1; i <= 6; i++) {
                window.dispatchEvent(new PointerEvent('pointermove', at(r.left + 2 + i * 12)));
                await new Promise((d) => setTimeout(d, 16));
              }
              window.dispatchEvent(new PointerEvent('pointerup', { ...at(r.left + 74), buttons: 0 }));
              return true;
            })()`);
            await until(() => bytes(from.root, rel).toString() !== before, 15000);
            // What the author's own timeline now says about the clip.
            let expected = '';
            await until(async () => {
              expected = await titleOf(from);
              return expected !== '' && expected !== titlesBefore[all.indexOf(from)];
            }, 15000);
            writeFileSync(join(run.out, `L15-trim-${from.name}-before.tsx`), before);
            writeFileSync(
              join(run.out, `L15-trim-${from.name}-after.tsx`),
              bytes(from.root, rel).toString()
            );
            return {
              stimulus: 'drag the first clip’s right edge in the shell timeline',
              clip: expected,
              ...(await observeAll(
                all,
                `L15-trim-${from.name}`,
                start,
                async (p) => (await titleOf(p)) === expected,
                (p) => bytes(p.root, rel).equals(bytes(from.root, rel))
              )),
            };
          });
        }
      }
      // T16 — an AI agent's edit is ONE project action. What it writes between
      // its start and its end lands together (L18 AI multi-file group); a run
      // that does not finish publishes nothing until the person decides in the
      // Sync panel (L21 AI abort / publish). The agent speaks the same loopback
      // API a slash command does; a cloud cell's agent is not driven here.
      {
        const src = (p: Surface, r: string) =>
          existsSync(join(p.root, '.design', r))
            ? readFileSync(join(p.root, '.design', r), 'utf8')
            : null;
        const studioUrl = (p: Surface) =>
          p.name === 'native'
            ? `http://127.0.0.1:${JSON.parse(readFileSync(join(p.root, '.design/_server.json'), 'utf8')).port}`
            : `http://127.0.0.1:${run.peerPort}`;
        const agent = async (p: Surface, route: 'start' | 'end', body: Record<string, unknown>) => {
          const r = await fetch(`${studioUrl(p)}/_api/ai/${route}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          });
          if (!r.ok) throw new Error(`ai/${route} at ${p.name}: HTTP ${r.status}`);
          return r.json().catch(() => null);
        };
        const hubToken = () =>
          JSON.parse(readFileSync(run.identities['designer-a'], 'utf8')).hubs[
            `http://127.0.0.1:${run.port}`
          ].token as string;
        const projectHistory = async () =>
          (
            (await (
              await fetch(
                `http://127.0.0.1:${run.port}/api/projects/current/v1/history?limit=200`,
                {
                  headers: { authorization: `Bearer ${hubToken()}` },
                }
              )
            ).json()) as { history: Array<{ kind: string; label: string; effects: unknown[] }> }
          ).history;
        // The toolbar's Sync button (it toggles; pressed = the panel shows).
        const openSync = async (p: Surface) => {
          const button = selector('open-sync');
          await until(async () => (await p.read(button)) !== null, 10000);
          if ((await p.read(`${button}[aria-pressed="true"]`)) === null) await p.click(button);
        };
        for (const from of all.filter((p) => p.name !== 'hub')) {
          const a = `ui/SurfaceAi-${from.name}-a.tsx`;
          const b = `ui/SurfaceAi-${from.name}-b.tsx`;
          await check('L18.ai.multi-file-group', `${from.name}-agent-to-peers`, async () => {
            await seedCanvas(from, a, elementCanvas(`AI A ${from.name}`));
            await seedCanvas(from, b, elementCanvas(`AI B ${from.name}`));
            await openSeeded(a, `AI A ${from.name}`, `L18-ai-${from.name}`);
            const author = `Surface agent ${from.name}`;
            const doneA = elementCanvas(`AI A done ${from.name}`);
            const doneB = elementCanvas(`AI B done ${from.name}`);
            await agent(from, 'start', { file: `.design/${a}`, author });
            writeFileSync(join(from.root, '.design', a), doneA);
            writeFileSync(join(from.root, '.design', b), doneB);
            // Mid-run: nothing of the agent's reaches the others.
            await sleep(2000);
            const early = all
              .filter((p) => p !== from)
              .filter((p) => src(p, a) === doneA || src(p, b) === doneB)
              .map((p) => p.name);
            const start = performance.now();
            await agent(from, 'end', { file: `.design/${a}`, outcome: 'done' });
            const landed = await observeAll(
              all,
              `L18-ai-group-${from.name}`,
              start,
              async (p) => (await p.read('h1', true)) === `AI A done ${from.name}`,
              (p) => src(p, a) === doneA && src(p, b) === doneB
            );
            const label = `${author} edited SurfaceAi-${from.name}-a`;
            const action = (await projectHistory()).find((h) => h.label === label);
            return {
              // `...landed` LAST would overwrite this verdict with its own —
              // the row would then report only whether the edit arrived, and
              // say nothing about the two things it exists to check: that
              // nothing was published before the agent finished, and that the
              // whole multi-file change is ONE ai action with two effects.
              // Same spread-order defect this file has grown three times.
              ...landed,
              status:
                landed.status === 'pass' &&
                early.length === 0 &&
                action?.kind === 'ai' &&
                action.effects.length === 2
                  ? 'pass'
                  : 'fail',
              publishedBeforeEndAt: early,
              action: action
                ? { label: action.label, kind: action.kind, effects: action.effects.length }
                : null,
            };
          });
          for (const choice of ['discard', 'publish'] as const) {
            const c = `ui/SurfaceAi-${from.name}-${choice}.tsx`;
            const title = `AI ${choice} ${from.name}`;
            await check(
              choice === 'discard' ? 'L21.ai.abort-discard' : 'L21.ai.abort-publish',
              `${from.name}-agent`,
              async () => {
                await seedCanvas(from, c, elementCanvas(title));
                await openSeeded(c, title, `L21-ai-${choice}-${from.name}`);
                const accepted = src(from, c);
                const half = elementCanvas(`${title} half done`);
                await agent(from, 'start', { file: `.design/${c}`, author: 'Surface agent' });
                writeFileSync(join(from.root, '.design', c), half);
                await sleep(800);
                await agent(from, 'end', { file: `.design/${c}`, outcome: 'failed' });
                // A failed run is held: nothing reaches the others.
                await sleep(3000);
                const leaked = all
                  .filter((p) => p !== from && src(p, c) !== accepted)
                  .map((p) => p.name);
                const authorKept = src(from, c) === half;
                // The author is told, in the Sync panel, and decides.
                await openSync(from);
                await until(
                  async () => (await from.read(selector('sync-ai-held'))) !== null,
                  20000
                ).catch(async (error) => {
                  await from.screenshot(join(run.out, `L21-ai-${choice}-${from.name}-no-held.png`));
                  const sync = join(from.root, '.design', '_sync.json');
                  if (existsSync(sync))
                    writeFileSync(
                      join(run.out, `L21-ai-${choice}-${from.name}-sync.json`),
                      readFileSync(sync)
                    );
                  throw error;
                });
                const start = performance.now();
                await from.click(selector(`sync-ai-${choice}`));
                const decided = await observeAll(
                  all,
                  `L21-ai-${choice}-${from.name}`,
                  start,
                  async (p) =>
                    (await p.read('h1', true)) ===
                    (choice === 'discard' ? title : `${title} half done`),
                  (p) => src(p, c) === (choice === 'discard' ? accepted : half)
                );
                return {
                  ...decided,
                  status:
                    decided.status === 'pass' && leaked.length === 0 && authorKept
                      ? 'pass'
                      : 'fail',
                  leakedWhileHeld: leaked,
                  authorKept,
                };
              }
            );
          }
        }
        // L18 gesture group — one drag, however many pointer moves it makes,
        // is ONE project action; one Cmd+Z takes the whole drag back, for
        // everyone.
        for (const from of all) {
          const name = `SurfaceGesture-${from.name}`;
          const rel = `ui/${name}.tsx`;
          const sidecar = `ui-${slug(name)}.annotations.svg`;
          const disk = (p: Surface) => src(p, sidecar);
          const svg =
            `<svg xmlns="http://www.w3.org/2000/svg" data-mdcc-annotations="1">` +
            `<rect data-id="s_gesture" data-tool="rect" stroke="#1f1f1f" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" fill="#e7e7e7" x="60" y="140" width="120" height="80"/>` +
            `</svg>`;
          let beforeDrag: string | null = null;
          let dragged = false;
          await check('L18.gesture-group', `${from.name}-to-peers`, async () => {
            await seedCanvas(from, rel, elementCanvas(`Gesture ${from.name}`));
            const put = async (b: { file: string; svg: string; base: string }) =>
              (
                await fetch('/_api/annotations', {
                  method: 'PUT',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify(b),
                })
              ).status;
            const body = { file: `.design/${rel}`, svg, base: '' };
            const status =
              from === native
                ? await browser.execute(put, body)
                : await (from.name === 'hub' ? hubPage : peerPage).evaluate(put, body);
            if (status >= 300) throw new Error(`annotations PUT answered ${status}`);
            await until(() => all.every((p) => disk(p)?.includes('s_gesture') === true), 30000);
            await openSeeded(rel, `Gesture ${from.name}`, `L18-gesture-${from.name}`);
            await until(async () => !!(await from.probe('[data-id="s_gesture"]'))?.visible, 15000);
            beforeDrag = disk(from);
            const seen = new Set((await projectHistory()).map((a) => JSON.stringify(a)));
            await gesture(from, selector('palette-mode-edit'), 'click');
            const start = performance.now();
            // A dozen moves while held, like a hand settling a shape (the probe
            // answers within a second, so the hold stays under it).
            await gesture(from, '[data-id="s_gesture"]', 'pointer', {
              dx: 90,
              dy: 40,
              // A locked screen throttles the native window's timers; there
              // the five moves of the drag itself are the gesture.
              hold: from.name === 'native' ? 0 : 400,
            });
            const moved = await observeAll(
              all,
              `L18-gesture-${from.name}`,
              start,
              async (p) => !!(await p.probe('[data-id="s_gesture"]'))?.visible,
              (p) => disk(p) !== beforeDrag && disk(p) === disk(from)
            );
            await sleep(1500);
            const docSlug = slug(rel.replace(/\.tsx$/, ''));
            const actions = (await projectHistory()).filter(
              (a) =>
                !seen.has(JSON.stringify(a)) &&
                (a.effects as Array<{ doc?: string; lane?: string }>).some(
                  (e) =>
                    (String(e.doc ?? '') === docSlug ||
                      String(e.doc ?? '').endsWith(`/${docSlug}`)) &&
                    e.lane === 'annotations'
                )
            );
            dragged = moved.status === 'pass';
            const fresh = (await projectHistory()).filter((a) => !seen.has(JSON.stringify(a)));
            writeFileSync(
              join(run.out, `L18-gesture-${from.name}-new-actions.json`),
              JSON.stringify(fresh, null, 2)
            );
            return {
              ...moved,
              status: moved.status === 'pass' && actions.length === 1 ? 'pass' : 'fail',
              actionsForTheDrag: actions.length,
            };
          });
          await check('L18.gesture-group.undo', `${from.name}-to-peers`, async () => {
            if (!beforeDrag || !dragged) throw new Unexercised('No drag to undo');
            const start = performance.now();
            await gesture(from, 'body', 'key', { key: 'z', meta: true });
            return observeAll(
              all,
              `L18-gesture-undo-${from.name}`,
              start,
              async (p) => !!(await p.probe('[data-id="s_gesture"]'))?.visible,
              (p) => disk(p) === beforeDrag
            );
          });
        }
      }
      // L18 — project history from the History panel: restore an earlier
      // version (a NEW action, everyone sees it), then undo one's own action
      // while a teammate's later change to the same canvas is kept.
      {
        const rel = 'ui/SurfaceHistory.tsx';
        const version = (title: string, para = 'Kept paragraph') =>
          elementCanvas(title).replace('Kept paragraph', para);
        const src = (p: Surface) => readFileSync(join(p.root, '.design', rel), 'utf8');
        const rowsQ = '[data-testid^="project-history-row-"]';
        const openHistory = async (p: Surface) => {
          // A dock tab TOGGLES: pressing the one already showing closes it.
          if (
            (await p.read(selector('dock-tab-changes'))) !== null &&
            (await p.read(`${selector('dock-tab-changes')}[aria-selected="true"]`)) === null
          )
            await p.click(selector('dock-tab-changes'));
          await until(
            async () =>
              ((await p.probe('body'))?.visible ?? false) && (await p.read(rowsQ)) !== null,
            30000
          );
        };
        const author = all[0] as Surface;
        const teammate = all[1] as Surface;
        await check('L18.history.restore', `${author.name}-to-peers`, async () => {
          const v1 = version('History v1');
          const v2 = version('History v2');
          await seedCanvas(author, rel, v1);
          await openSeeded(rel, 'History v1', 'L18-history');
          writeFileSync(join(author.root, '.design', rel), v2);
          await until(() => all.every((p) => src(p) === v2), 30000);
          await openHistory(author);
          await until(
            async () =>
              (await author.read(
                `.gp-version:nth-of-type(2) [data-testid^="project-history-restore-"]`
              )) !== null,
            30000
          );
          const start = performance.now();
          await author.click(
            `.gp-version:nth-of-type(2) [data-testid^="project-history-restore-"]`
          );
          return observeAll(
            all,
            'L18-restore',
            start,
            async (p) => (await p.read('h1', true)) === 'History v1',
            (p) => src(p) === v1
          );
        });
        await check(
          'L18.history.undo-own-keeps-teammate',
          `${author.name}-with-${teammate.name}`,
          async () => {
            // A cloud browser proposes under the cell's ONE credential, so the
            // project cannot tell one browser editor's action from another's:
            // History names the cell, and personal Undo is withheld there
            // (app.jsx `onUndoAction`, studio-manifest). Known gap — per-person
            // attribution for cloud editors — not a regression.
            if (author.name === 'hub')
              return {
                status: 'unsupported',
                reason:
                  'Cloud browser actions are attributed to the cell credential; personal Undo is not offered in a cloud browser yet.',
              };
            const base = src(author);
            if (!base.includes('History v1'))
              throw new Unexercised('Undo needs the restored canvas');
            const mine = version('History mine');
            const missing = (want: string) =>
              all
                .filter((p) => src(p) !== want)
                .map((p) => p.name)
                .join(', ');
            writeFileSync(join(author.root, '.design', rel), mine);
            await until(() => all.every((p) => src(p) === mine), 30000).catch(() => {
              throw new Error(`the author's edit did not reach: ${missing(mine)}`);
            });
            // The teammate's later, independent change to the same canvas.
            const theirs = version('History mine', 'Paragraph by teammate');
            writeFileSync(join(teammate.root, '.design', rel), theirs);
            await until(() => all.every((p) => src(p) === theirs), 30000).catch(() => {
              throw new Error(`the teammate's edit did not reach: ${missing(theirs)}`);
            });
            await openHistory(author);
            await until(
              async () => (await author.read('[data-testid^="project-history-undo-"]')) !== null,
              30000
            ).catch(() => {
              throw new Error('History offers no Undo for the author’s own action');
            });
            const expected = version('History v1', 'Paragraph by teammate');
            const start = performance.now();
            await author.click('[data-testid^="project-history-undo-"]');
            return observeAll(
              all,
              'L18-undo-own',
              start,
              async (p) =>
                (await p.read('h1', true)) === 'History v1' &&
                (await p.read('p', true)) === 'Paragraph by teammate',
              (p) => src(p) === expected
            );
          }
        );
      }
      // L16 — the design system and the files canvases depend on. A token
      // edited on one machine restyles the canvas that uses it everywhere; a
      // specimen made, edited and removed reaches everyone; a module a canvas
      // imports, edited, re-renders every copy; and a file a canvas still uses
      // cannot be moved out from under it (the author is told who uses it).
      for (const from of all) {
        const css = `system/surface-${from.name}/tokens.css`;
        const rel = `ui/SurfaceTokens-${from.name}.tsx`;
        const canvas = `import '../system/surface-${from.name}/tokens.css';\nimport { DesignCanvas, DCArtboard } from '@maude/canvas-lib';\nexport default function SurfaceTokens() {\n  return (\n    <DesignCanvas>\n      <DCArtboard id="tokens" label="Tokens" width={480} height={240}>\n        <h1 style={{ padding: 24, color: 'var(--surface-accent)' }}>Token heading ${from.name}</h1>\n      </DCArtboard>\n    </DesignCanvas>\n  );\n}\n`;
        const tokens = (rgb: string) => `:root { --surface-accent: ${rgb}; }\n`;
        await check('L16.ds-token.edit', `${from.name}-to-peers`, async () => {
          mkdirSync(join(from.root, '.design', `system/surface-${from.name}`), { recursive: true });
          writeFileSync(join(from.root, '.design', css), tokens('rgb(10, 20, 30)'));
          await until(() => all.every((p) => existsSync(join(p.root, '.design', css))), 30000);
          await seedCanvas(from, rel, canvas);
          await openSeeded(rel, `Token heading ${from.name}`, `L16-tokens-${from.name}`);
          await until(async () => {
            for (const p of all)
              if ((await p.probe('h1'))?.color !== 'rgb(10, 20, 30)') return false;
            return true;
          }, 30000);
          const start = performance.now();
          writeFileSync(join(from.root, '.design', css), tokens('rgb(200, 30, 40)'));
          return observeAll(
            all,
            `L16-token-${from.name}`,
            start,
            async (p) => (await p.probe('h1'))?.color === 'rgb(200, 30, 40)',
            (p) => readFileSync(join(p.root, '.design', css), 'utf8') === tokens('rgb(200, 30, 40)')
          );
        });
        const specimen = `system/smoke/preview/SurfaceSpecimen-${from.name}.tsx`;
        const specimenBody = (title: string) =>
          `import { DesignCanvas, DCArtboard } from '@maude/canvas-lib';\nexport default function Specimen() {\n  return (\n    <DesignCanvas>\n      <DCArtboard id="specimen" label="Specimen" width={360} height={200}>\n        <h1 style={{ padding: 24 }}>${title}</h1>\n      </DCArtboard>\n    </DesignCanvas>\n  );\n}\n`;
        // The DESIGN SYSTEM section of every tree shows the project's design
        // system (a copy learns it from the project) with its specimens.
        const openDsSection = async (p: Surface) => {
          const hd = selector('tree-section-design-system');
          await until(async () => (await p.read(hd)) !== null, 30000);
          if ((await p.read(`${hd}[aria-expanded="false"]`)) !== null) await p.click(hd);
        };
        await check('L16.specimen.create', `${from.name}-to-peers`, async () => {
          for (const p of all) await openDsSection(p);
          mkdirSync(join(from.root, '.design/system/smoke/preview'), { recursive: true });
          const body = specimenBody(`Specimen ${from.name}`);
          const start = performance.now();
          writeFileSync(join(from.root, '.design', specimen), body);
          return observeAll(
            all,
            `L16-specimen-create-${from.name}`,
            start,
            async (p) => (await p.read(rowOf(specimen))) !== null,
            (p) =>
              existsSync(join(p.root, '.design', specimen)) &&
              bytes(p.root, specimen).toString() === body
          );
        });
        await check('L16.specimen.edit', `${from.name}-to-peers`, async () => {
          if (all.some((p) => !existsSync(join(p.root, '.design', specimen))))
            throw new Unexercised('The specimen is not everywhere');
          for (const p of all) {
            await openCanvas(p, specimen);
            await until(async () => (await p.read('h1', true)) === `Specimen ${from.name}`, 30000);
          }
          const body = specimenBody(`Specimen ${from.name} edited`);
          const start = performance.now();
          writeFileSync(join(from.root, '.design', specimen), body);
          return observeAll(
            all,
            `L16-specimen-edit-${from.name}`,
            start,
            async (p) => (await p.read('h1', true)) === `Specimen ${from.name} edited`,
            (p) => bytes(p.root, specimen).toString() === body
          );
        });
        // Removing a specimen is not something the studio does: canvases under
        // the design-system group cannot be deleted through it (api.ts
        // deleteCanvas — "never the design system"), the DS tree offers no
        // delete, and a file deleted outside the app is not a project deletion
        // (the project's copy comes back). Recorded, not faked.
        await check('L16.specimen.remove', `${from.name}-to-peers`, async () => ({
          status: 'unsupported',
          reason:
            'Design-system canvases cannot be deleted through the studio (deleteCanvas refuses the design-system group; the DS tree has no delete), and an outside deletion is not a project deletion.',
        }));
        const moduleRel = `system/smoke/surface-label-${from.name}.ts`;
        const moduleCanvas = `ui/SurfaceModule-${from.name}.tsx`;
        // A code module (.ts/.js) a canvas imports reaches another desktop only
        // through the per-hub consent recorded at link time (DDR-217 file door
        // owner gate + the receiver's codeModulesAllowed); the product has no
        // control to give that consent, so a module edit stays on its author.
        void moduleRel;
        void moduleCanvas;
        await check('L16.module.edit', `${from.name}-to-peers`, async () => ({
          status: 'unsupported',
          reason:
            'Code modules travel only to a copy whose person consented at link time (DDR-217); there is no consent control yet, so a module edit does not reach a teammate’s desktop.',
        }));
        // Moving a file a canvas still uses: refused, with the user named —
        // nobody is left with a broken canvas.
        const dep = `ui/SurfaceDep-${from.name}.png`;
        const depCanvas = `ui/SurfaceDepUser-${from.name}.tsx`;
        const depDest = `SurfaceDepDest-${from.name}`;
        await check('L16.dependency.move-refused', `${from.name}-to-peers`, async () => {
          const input = run.media.uploads?.[from.name];
          if (!input) throw new Unexercised('No image fixture');
          mkdirSync(join(from.root, '.design/ui', depDest), { recursive: true });
          writeFileSync(join(from.root, '.design/ui', depDest, '.gitkeep'), '');
          writeFileSync(join(from.root, '.design', dep), readFileSync(input.path));
          await until(() => all.every((p) => existsSync(join(p.root, '.design', dep))), 30000);
          await seedCanvas(
            from,
            depCanvas,
            `import { DesignCanvas, DCArtboard } from '@maude/canvas-lib';\nexport default function SurfaceDepUser() {\n  return (\n    <DesignCanvas>\n      <DCArtboard id="dep" label="Dep" width={480} height={200}>\n        <h1 style={{ padding: 24 }}>Dependency ${from.name}</h1>\n        <img data-testid="surface-dep" src="/.design/ui/SurfaceDep-${from.name}.png" width={64} height={64} alt="" />\n      </DCArtboard>\n    </DesignCanvas>\n  );\n}\n`
          );
          await openSeeded(depCanvas, `Dependency ${from.name}`, `L16-dep-${from.name}`);
          const fileRow = selector(`file-row-${slug(dep)}`);
          await until(async () => (await from.read(fileRow)) !== null, 30000);
          await from.hover(fileRow);
          await from.click(selector(`tree-row-menu-${slug(dep)}`));
          await from.menu('Move to…');
          await from.menu(`ui/${depDest}`);
          // The author is told which canvas uses it.
          let told = '';
          await until(async () => {
            told = (await from.read('body')) ?? '';
            return told.includes(`SurfaceDepUser-${from.name}`) && /used by/i.test(told);
          }, 15000).catch(() => {});
          await sleep(3000);
          const kept = all.map((p) => ({
            participant: p.name,
            atOriginal: existsSync(join(p.root, '.design', dep)),
            movedCopy: existsSync(
              join(p.root, '.design/ui', depDest, `SurfaceDep-${from.name}.png`)
            ),
          }));
          const rendered = await Promise.all(
            all.map(async (p) => {
              const image = await p.probe(selector('surface-dep'));
              return !!image?.visible && (image.width ?? 0) > 0;
            })
          );
          return {
            status:
              /used by/i.test(told) &&
              kept.every((k) => k.atOriginal && !k.movedCopy) &&
              rendered.every(Boolean)
                ? 'pass'
                : 'fail',
            authorTold: /used by/i.test(told),
            kept,
            rendered,
          };
        });
      }
      // L23 — assets moved and deleted safely while work goes on: one person
      // keeps retitling a canvas, a second moves an image into a folder from
      // the tree, a third deletes an image nobody uses. Everything converges,
      // no edit is lost, nothing is left half-moved.
      await check('L23.assets.move-and-delete-during-edits', 'all', async () => {
        const [hubSide, nativeSide, peer] = ['hub', 'native', 'peer'].map(
          (n) => all.find((p) => p.name === n) as Surface
        );
        const rel = 'ui/SurfaceAssetsBusy.tsx';
        const dest = 'SurfaceAssetsDest';
        const moving = 'ui/SurfaceAssetMove.png';
        const doomed = 'ui/SurfaceAssetDrop.png';
        const moved = `ui/${dest}/SurfaceAssetMove.png`;
        const png = (i: number) =>
          readFileSync(run.media.uploads[['hub', 'native', 'peer'][i] as string].path);
        const hashOf = (b: Buffer) => createHash('sha256').update(b).digest('hex');
        mkdirSync(join(hubSide.root, '.design/ui', dest), { recursive: true });
        writeFileSync(join(hubSide.root, '.design/ui', dest, '.gitkeep'), '');
        writeFileSync(join(hubSide.root, '.design', moving), png(0));
        writeFileSync(join(hubSide.root, '.design', doomed), png(1));
        await seedCanvas(hubSide, rel, elementCanvas('Busy 0'));
        await until(
          () =>
            all.every(
              (p) =>
                existsSync(join(p.root, '.design', moving)) &&
                existsSync(join(p.root, '.design', doomed)) &&
                existsSync(join(p.root, '.design/ui', dest))
            ),
          60000
        );
        await openSeeded(rel, 'Busy 0', 'L23-assets');
        const fileRow = (r: string) => selector(`file-row-${slug(r)}`);
        for (const p of [peer, hubSide])
          await until(
            async () => (await p.read(fileRow(p === peer ? moving : doomed))) !== null,
            30000
          );
        const start = performance.now();
        const edits = (async () => {
          for (let i = 1; i <= 6; i++) {
            writeFileSync(join(nativeSide.root, '.design', rel), elementCanvas(`Busy ${i}`));
            await sleep(700);
          }
        })();
        const move = (async () => {
          await peer.hover(fileRow(moving));
          await peer.click(selector(`tree-row-menu-${slug(moving)}`));
          await peer.menu('Move to…');
          await peer.menu(`ui/${dest}`);
        })();
        const del = (async () => {
          await hubSide.hover(fileRow(doomed));
          await hubSide.click(selector(`tree-row-menu-${slug(doomed)}`));
          await hubSide.confirmNext();
          await hubSide.menu('Delete');
        })();
        await Promise.all([edits, move, del]);
        const final = elementCanvas('Busy 6');
        const result = await observeAll(
          all,
          'L23-assets',
          start,
          async (p) => (await p.read('h1', true)) === 'Busy 6',
          (p) =>
            readFileSync(join(p.root, '.design', rel), 'utf8') === final &&
            !existsSync(join(p.root, '.design', moving)) &&
            existsSync(join(p.root, '.design', moved)) &&
            hashOf(bytes(p.root, moved)) === hashOf(png(0)) &&
            !existsSync(join(p.root, '.design', doomed))
        );
        return {
          ...result,
          stimulus: 'retitle ×6 on native, tree move on peer, tree delete on the hub — together',
        };
      });
      // L23 — a mixed loaded session: people keep editing and switching
      // canvases while media keeps arriving. Every edit must reach every
      // other open canvas within budget, media must not starve edits, every
      // media file must land everywhere, and nothing may grow without bound.
      await check('L23.mixed-session', 'all', async () => {
        const soakMs = (run as { soakMs?: number }).soakMs ?? 120_000;
        const a = 'ui/SurfaceSoak-a.tsx';
        const b = 'ui/SurfaceSoak-b.tsx';
        await seedCanvas(all[0] as Surface, b, elementCanvas('Soak B'));
        await seedCanvas(all[0] as Surface, a, elementCanvas('Soak 0'));
        await openSeeded(a, 'Soak 0', 'L23-open');
        const latencies: number[] = [];
        const misses: string[] = [];
        const missDetail: Array<Record<string, unknown>> = [];
        const media: Array<{ rel: string; sha: string }> = [];
        const startedAt = performance.now();
        const rss = () => {
          try {
            const lines = readFileSync(join(run.out, 'resource-samples.jsonl'), 'utf8')
              .trim()
              .split('\n');
            const last = JSON.parse(lines[lines.length - 1] ?? '{}');
            return (last.processes ?? []).reduce(
              (n: number, p: { rssKiB?: number }) => n + (p.rssKiB ?? 0),
              0
            );
          } catch {
            return 0;
          }
        };
        const rssStart = rss();
        let i = 0;
        while (performance.now() - startedAt < soakMs) {
          i += 1;
          const author = all[i % all.length] as Surface;
          // Media arriving from someone else, every few edits (file plane).
          if (i % 3 === 0) {
            const src = all[(i + 1) % all.length] as Surface;
            const blob = Buffer.alloc(384 * 1024);
            for (let k = 0; k < blob.length; k += 4096)
              blob.writeUInt32LE((Math.random() * 2 ** 32) >>> 0, k);
            const rel = `assets/soak-${i}.png`;
            mkdirSync(join(src.root, '.design/assets'), { recursive: true });
            writeFileSync(join(src.root, '.design', rel), blob);
            media.push({ rel, sha: createHash('sha256').update(blob).digest('hex') });
          }
          // Someone switches away and back (the canvas must stay live for them).
          if (i % 4 === 0) {
            const switcher = all[(i + 2) % all.length] as Surface;
            await openCanvas(switcher, b).catch(() => {});
            await openCanvas(switcher, a).catch(() => {});
          }
          const title = `Soak ${i} by ${author.name}`;
          const t0 = performance.now();
          writeFileSync(join(author.root, '.design', a), elementCanvas(title));
          const seen = await Promise.all(
            all
              .filter((p) => p !== author)
              .map((p) =>
                // A window that is not rendering (a locked screen) runs its
                // timers slowly; give the native one room rather than calling
                // a throttled repaint a missed edit.
                until(
                  async () => (await reads(p, 'h1', true)) === title,
                  p.name === 'native' ? 45000 : 15000
                ).then(
                  () => performance.now() - t0,
                  async (error) => {
                    // A window that stopped painting did not miss the edit; it
                    // was never in a position to show one. Declining is the
                    // rule everywhere else in this file, and a soak that runs
                    // for minutes is the likeliest row to meet a screen that
                    // locked halfway through.
                    await unlessNotRendering(p, error).catch((e) => {
                      if (e instanceof Unexercised) throw e;
                    });
                    // WHICH HALF MISSED. "Not visible" is two different
                    // defects: the bytes never reached this copy (sync), or
                    // they did and the open canvas never showed them (render).
                    // The row used to record only the symptom, and the same
                    // miss recurred in three runs without saying which.
                    const onDisk = (() => {
                      try {
                        return readFileSync(join(p.root, '.design', a), 'utf8').includes(title);
                      } catch {
                        return false;
                      }
                    })();
                    // Is the canvas this edit targets the ACTIVE one? The
                    // testid is carried only by the active tab's frame.
                    const activeIsTarget = await p
                      .read(`[data-testid="canvas-frame"][data-path=".design/${a}"]`)
                      .then((r) => r !== null)
                      .catch(() => null);
                    const shownNow = (await reads(p, 'h1', true).catch(() => null)) ?? null;
                    missDetail.push({
                      edit: title,
                      at: p.name,
                      bytesOnDisk: onDisk,
                      targetCanvasActive: activeIsTarget,
                      shownTitle: shownNow,
                    });
                    await p
                      .screenshot(join(run.out, `L23-miss-${slug(title)}-${p.name}.png`))
                      .catch(() => {});
                    misses.push(`${title} @ ${p.name}`);
                    return null;
                  }
                )
              )
          );
          for (const ms of seen) if (ms !== null) latencies.push(ms);
          await sleep(1500);
        }
        // Every media file everywhere, byte-identical.
        const mediaMissing: string[] = [];
        await until(
          () =>
            media.every((m) =>
              all.every((p) => {
                const path = join(p.root, '.design', m.rel);
                return (
                  existsSync(path) &&
                  createHash('sha256').update(readFileSync(path)).digest('hex') === m.sha
                );
              })
            ),
          120000
        ).catch(() => {
          for (const m of media)
            for (const p of all) {
              const path = join(p.root, '.design', m.rel);
              if (!existsSync(path)) mediaMissing.push(`${m.rel} @ ${p.name}`);
            }
        });
        const sorted = [...latencies].sort((x, y) => x - y);
        const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? null;
        const rssEnd = rss();
        const growth = rssStart ? rssEnd / rssStart : null;
        return {
          status:
            misses.length === 0 &&
            mediaMissing.length === 0 &&
            (p95 ?? 0) < 5000 &&
            (growth ?? 1) < 3
              ? 'pass'
              : 'fail',
          soakMs,
          edits: i,
          mediaFiles: media.length,
          editVisibleMs: {
            p50: sorted[Math.floor(sorted.length / 2)] ?? null,
            p95,
            max: sorted.at(-1) ?? null,
          },
          misses,
          missDetail,
          mediaMissing,
          rssKiB: { start: rssStart, end: rssEnd, growth },
        };
      });
      // L24 — fresh reopen: desktop B quits and reopens, the cloud browser
      // reloads, and one more new machine opens the project. Each shows the
      // project again, and the new copy matches, media included.
      await check('L24.fresh-reopen', 'all', async () => {
        const nativeSide = all.find((p) => p.name === 'native') as Surface;
        await lifecycle('/peer/stop');
        await lifecycle('/peer/start');
        await peerPage.goto(`http://127.0.0.1:${run.peerPort}/`);
        await hubPage.reload();
        const fresh = await openFresh();
        const notShown: Array<Record<string, unknown>> = [];
        const shown = await Promise.all(
          [...all, fresh.surface].map((p) =>
            // A copy opening this late pulls a project of a hundred canvases
            // and its media before its tree can list them.
            until(
              async () => (await reads(p, selector('canvas-row-ui-home'))) !== null,
              300000
            ).then(
              () => ({ participant: p.name, shown: true }),
              async (error) => {
                await p
                  .screenshot(join(run.out, `L24-reopen-${p.name}-not-shown.png`))
                  .catch(() => {});
                // WHY it was not shown, before deciding anything. Three
                // different things read the same from the outside: the canvas
                // is not on this copy, it is there and the tree does not list
                // it, or this participant's driver stopped answering at all —
                // which `reads()` deliberately reports as absent.
                const onDisk = existsSync(join(p.root, '.design', 'ui/home.tsx'));
                let driverAnswers: boolean | null = null;
                try {
                  await p.read('body');
                  driverAnswers = true;
                } catch {
                  driverAnswers = false;
                }
                const rowsListed = await reads(p, '[data-testid^="canvas-row-"]');
                notShown.push({
                  participant: p.name,
                  homeOnDisk: onDisk,
                  driverAnswers,
                  treeListsAnyCanvas: rowsListed !== null,
                });
                // A window that stopped painting did not fail this row, it
                // declined to judge it — the same rule the rAF-placed rows
                // already follow. Without this a locked screen MANUFACTURES a
                // failure here, and an invented failure is worse than a gap.
                await unlessNotRendering(p, error).catch((e) => {
                  if (e instanceof Unexercised) throw e;
                });
                return { participant: p.name, shown: false };
              }
            )
          )
        );
        let diff: string[] = [];
        // A copy of a project this size pulls a hundred and sixty files
        // through a capped, polled lane: minutes, not seconds.
        const converged = await until(() => {
          diff = inventoryDiff(
            eligibleInventory(nativeSide.root, true),
            eligibleInventory(fresh.root, true)
          );
          return diff.length === 0;
        }, 600000)
          .then(() => true)
          .catch(() => false);
        return {
          status: converged && shown.every((s) => s.shown) ? 'pass' : 'fail',
          shown,
          notShown,
          files: eligibleInventory(fresh.root, true).size,
          differing: diff.slice(0, 20),
        };
      });
      // L24 — final parity: every eligible design file hashes the same on
      // every participant (runtime state and conflict copies excluded).
      await check('L24.final-parity', 'all', async () => {
        await sleep(5000);
        const maps = [
          ...all.map((p) => [p.name, eligibleInventory(p.root)] as const),
          ...freshRoots.map((r, i) => [`fresh-${i + 1}`, eligibleInventory(r)] as const),
        ];
        const paths = new Set(maps.flatMap(([, m]) => [...m.keys()]));
        const mismatches: Array<Record<string, unknown>> = [];
        for (const rel of paths) {
          const hashes = Object.fromEntries(maps.map(([n, m]) => [n, m.get(rel) ?? null]));
          if (new Set(Object.values(hashes)).size !== 1) mismatches.push({ rel, hashes });
        }
        writeFileSync(
          join(run.out, 'L24-final-parity.json'),
          JSON.stringify({ files: paths.size, mismatches }, null, 2)
        );
        return {
          status: mismatches.length === 0 ? 'pass' : 'fail',
          files: paths.size,
          mismatches: mismatches.slice(0, 20),
        };
      });
    } catch (error) {
      record({ id: 'bootstrap-or-scenario-driver', status: 'fail', error: String(error) });
      throw error;
    } finally {
      // WHAT IS STILL NOT ASSERTED, BY NAME. This used to be 24 identical rows
      // saying the catalogue was incomplete — true, and unusable: a surface
      // with one gap read exactly like a surface with none. Every declared
      // action now points at the rows that assert it
      // (`scripts/dev/sync-e2e/surface-requirements.mjs`), so the only ones
      // left to flag are the actions that point at nothing, and they are
      // flagged on their own surface with their own reason. A surface whose
      // actions are all mapped emits no row here; its coverage is in
      // `coverage-results.json`, per action and per direction.
      const unresolved = unresolvedRequirements() as {
        surface: string;
        action: string;
        reason: string;
      }[];
      const bySurface = new Map<string, { action: string; reason: string }[]>();
      for (const u of unresolved) {
        const list = bySurface.get(u.surface) ?? [];
        list.push({ action: u.action, reason: u.reason });
        bySurface.set(u.surface, list);
      }
      for (const [surface, actions] of bySurface) {
        record({
          id: `${surface}.remaining-variants`,
          status: 'not-run',
          reason: `${actions.length} declared action(s) assert nothing yet: ${actions
            .map((a) => `${a.action} — ${a.reason}`)
            .join(' · ')}`,
        });
      }
      await chromiumBrowser.close();
    }
  });
});
