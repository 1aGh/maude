import { createHash } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from '@playwright/test';
import { $, browser } from '@wdio/globals';
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
  visible: boolean;
  width?: number;
  height?: number;
  pixel?: number[];
  time?: number;
  seeking?: boolean;
  error?: string;
  href?: string;
  matches?: Array<{ id: string | null; tool: string | null }>;
  rect?: { x: number; y: number; width: number; height: number };
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
  fill: (q: string, value: string) => Promise<void>;
  dragTo: (source: string, destination: string) => Promise<void>;
  screenshot: (file: string) => Promise<void>;
  photoTrace: () => Promise<unknown>;
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
      await page.getByRole('menuitem', { name: text, exact: true }).click();
    },
    async confirmNext() {
      page.once('dialog', (dialog) => dialog.accept());
    },
    async click(q) {
      await page.locator(q).click();
    },
    async fill(q, value) {
      await page.locator(q).fill(value);
    },
    async dragTo(source, destination) {
      await page.locator(source).scrollIntoViewIfNeeded();
      await page.locator(destination).scrollIntoViewIfNeeded();
      await page.evaluate(`(${treeDragSource})(${JSON.stringify({ source, destination })})`);
    },
    async screenshot(path) {
      await page.screenshot({ path });
    },
  };
}
const native: Surface = {
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
  async click(q) {
    await (await $(q)).click();
  },
  async fill(q, value) {
    await (await $(q)).setValue(value);
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
    try {
      if (!(await isNativeShell())) throw new Error('Native participant is not a Tauri webview');
      const nativeUrl = await waitForSidecar();
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
        await check('L01.empty-folder.rename', from.name, async () => {
          const name = `EmptyDelete-${from.name}`;
          const q = selector(`tree-folder-ui-${slug(name)}`);
          await from.hover(q);
          await from.click(selector(`tree-row-menu-ui-${slug(name)}`));
          const menu = await from.read('[role="menu"]');
          await from.screenshot(join(run.out, `L01-folder-menu-${from.name}.png`));
          await from.click('.st-sb-title');
          if (!menu?.includes('Delete folder')) throw new Unexercised('Folder action menu absent');
          if (/rename/i.test(menu))
            throw new Error('Rename is exposed; implement its actual gesture');
          return {
            status: 'unsupported',
            menu,
            repairTask: 'T17',
            reason:
              'Current folder menu exposes new/delete, no rename. No create+delete substitute was used.',
          };
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
            await until(async () => !!(await from.probe(handle))?.visible);
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
                await until(async () => !!(await from.probe(target))?.visible);
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
          await until(async () => !!(await from.probe(handle))?.visible);
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
          await gesture(viewer, 'h1', 'doubleClick');
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
    } catch (error) {
      record({ id: 'bootstrap-or-scenario-driver', status: 'fail', error: String(error) });
      throw error;
    } finally {
      for (let i = 1; i <= 24; i++)
        record({
          id: `L${String(i).padStart(2, '0')}.remaining-variants`,
          status: 'not-run',
          reason:
            'Full operation catalogue, media, timing samples and soak still required. Implemented subcases above do not certify the surface.',
        });
      await chromiumBrowser.close();
    }
  });
});
