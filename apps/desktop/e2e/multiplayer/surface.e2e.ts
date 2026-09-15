import { createHash } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
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
  color?: string;
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
  promptNext: (value: string) => Promise<void>;
  fill: (q: string, value: string) => Promise<void>;
  select: (q: string, value: string) => Promise<void>;
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
            replies?: Array<{ body: string }>;
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
        const idOf = () => commentsOf(from, rel).find((c) => c.text === text)?.id ?? null;
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
                  ?.replies?.some((r) => r.body === reply)
              )
                return false;
              await openThread(p, id);
              return ((await p.read('.cm-thread', true)) ?? '').includes(reply);
            },
            (p) =>
              !!commentsOf(p, rel)
                .find((c) => c.id === id)
                ?.replies?.some((r) => r.body === reply)
          );
        });
        for (const [action, label, status] of [
          ['resolve', '✓ Resolve', 'resolved'],
          ['reopen', '↺ Reopen', 'open'],
        ] as const) {
          await check(`L11.comment.${action}`, `${from.name}-to-peers`, async () => {
            const id = idOf();
            if (!id) throw new Unexercised(`${action} needs the thread`);
            await openThread(from, id);
            const button = `.cm-thread__actions .cm-btn${status === 'resolved' ? '--primary' : ''}`;
            if (!((await from.read(button, true)) ?? '').includes(label.slice(2)))
              throw new Error(`Thread offers no ${label}`);
            const start = performance.now();
            await gesture(from, button, 'click');
            return observeAll(
              all,
              `L11-${action}-${from.name}`,
              start,
              async (p) =>
                (commentsOf(p, rel).find((c) => c.id === id)?.status ?? 'open') === status &&
                (await p.probe(`${pin(id)}[data-resolved="${status === 'resolved'}"]`)) !== null,
              (p) => (commentsOf(p, rel).find((c) => c.id === id)?.status ?? 'open') === status
            );
          });
        }
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
            await gesture(from, 'p', 'pointer', { dx: 40, dy: 10 });
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
            await gesture(from, 'h1', 'click');
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
        await check('L19.presence.leave', 'all', async () => {
          const from = all[0] as Surface;
          const others = all.filter((p) => p !== from);
          const start = performance.now();
          await openCanvas(from, 'ui/SurfaceText.tsx');
          return observeAll(
            others,
            'L19-leave',
            start,
            async (p) => (await count(p, people)) === all.length - 2
          );
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
        const text = (p: Surface, r: string) =>
          existsSync(join(p.root, '.design', r))
            ? readFileSync(join(p.root, '.design', r), 'utf8')
            : null;
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
          await fetch(`${control}/offline`, { method: 'POST' });
          try {
            await until(() => syncState(peer) === 'offline', 60000);
            const offlineBody = elementCanvas('Edited offline by peer');
            writeFileSync(join(peer.root, '.design', mine), offlineBody);
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
            if (text(hubSide, mine) !== base)
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
                (p) => text(p, mine) === offlineBody && text(p, theirs) === theirsBody
              )),
            };
          } finally {
            await fetch(`${control}/online`, { method: 'POST' }).catch(() => {});
          }
        });
      }
      // L22 — an invalid source save is held on the author's machine, visible
      // to them, and never reaches the others; fixing it publishes normally.
      for (const from of all) {
        const rel = `ui/SurfaceInvalid-${from.name}.tsx`;
        const good = elementCanvas(`Valid ${from.name}`);
        const fixed = elementCanvas(`Fixed ${from.name}`);
        const text = (p: Surface) =>
          existsSync(join(p.root, '.design', rel))
            ? readFileSync(join(p.root, '.design', rel), 'utf8')
            : null;
        await check('L22.invalid-candidate.held', `${from.name}-to-peers`, async () => {
          await seedCanvas(from, rel, good);
          const broken = good.replace('</section>', '<section>');
          writeFileSync(join(from.root, '.design', rel), broken);
          // The author is told, in the same status everyone reads.
          let shown = '';
          await until(async () => {
            shown = (await from.read('.st-sb-sync')) ?? '';
            return /attention|conflict|invalid|resolve|could not/i.test(shown);
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
              /attention|conflict|invalid|resolve|could not/i.test(shown) &&
              recovered.status === 'pass'
                ? 'pass'
                : 'fail',
            authorStatus: shown.slice(0, 160),
            leakedTo: leaked,
          };
        });
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
          await until(async () => !!(await from.probe(handle))?.visible);
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
          const start = performance.now();
          await gesture(from, 'body', 'key', { key: 'Delete' });
          return observeAll(
            all,
            `L07-delete-${from.name}`,
            start,
            async (p) =>
              (await headings(p)) === 1 && (await p.read('p', true)) === 'Kept paragraph',
            (p) => count(p, rel, '<h1') === 1 && count(p, rel, 'Kept paragraph') === 1
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
          if ((await p.read(selector('dock-tab-changes'))) !== null)
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
            const base = src(author);
            if (!base.includes('History v1'))
              throw new Unexercised('Undo needs the restored canvas');
            const mine = version('History mine');
            writeFileSync(join(author.root, '.design', rel), mine);
            await until(() => all.every((p) => src(p) === mine), 30000);
            // The teammate's later, independent change to the same canvas.
            const theirs = version('History mine', 'Paragraph by teammate');
            writeFileSync(join(teammate.root, '.design', rel), theirs);
            await until(() => all.every((p) => src(p) === theirs), 30000);
            await openHistory(author);
            await until(
              async () => (await author.read('[data-testid^="project-history-undo-"]')) !== null,
              30000
            );
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
      // L16 — a design-system token edited on one machine restyles the canvas
      // that uses it on every machine: the dependency travels with the canvas
      // and the receivers re-render against the new revision.
      {
        const from = all[1] as Surface;
        const css = 'system/surface/tokens.css';
        const rel = 'ui/SurfaceTokens.tsx';
        const canvas = `import '../system/surface/tokens.css';\nimport { DesignCanvas, DCArtboard } from '@maude/canvas-lib';\nexport default function SurfaceTokens() {\n  return (\n    <DesignCanvas>\n      <DCArtboard id="tokens" label="Tokens" width={480} height={240}>\n        <h1 style={{ padding: 24, color: 'var(--surface-accent)' }}>Token heading</h1>\n      </DCArtboard>\n    </DesignCanvas>\n  );\n}\n`;
        const tokens = (rgb: string) => `:root { --surface-accent: ${rgb}; }\n`;
        await check('L16.ds-token.edit', `${from.name}-to-peers`, async () => {
          mkdirSync(join(from.root, '.design/system/surface'), { recursive: true });
          writeFileSync(join(from.root, '.design', css), tokens('rgb(10, 20, 30)'));
          await until(() => all.every((p) => existsSync(join(p.root, '.design', css))), 30000);
          await seedCanvas(from, rel, canvas);
          await openSeeded(rel, 'Token heading', 'L16-tokens');
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
      }
      // L24 — final parity: every eligible design file hashes the same on
      // every participant (runtime state and conflict copies excluded).
      await check('L24.final-parity', 'all', async () => {
        const eligible = (root: string) => {
          const out = new Map<string, string>();
          const walk = (dir: string, rel: string) => {
            for (const e of readdirSync(dir, { withFileTypes: true })) {
              if (e.name.startsWith('_') || e.name.startsWith('.')) continue;
              const r = rel ? `${rel}/${e.name}` : e.name;
              if (e.isDirectory()) walk(join(dir, e.name), r);
              else if (
                /\.(tsx|meta\.json|annotations\.svg)$/.test(e.name) &&
                !/-conflict-/.test(e.name)
              )
                out.set(
                  r,
                  createHash('sha256')
                    .update(readFileSync(join(dir, e.name)))
                    .digest('hex')
                );
            }
          };
          walk(join(root, '.design', 'ui'), 'ui');
          return out;
        };
        await sleep(5000);
        const maps = all.map((p) => [p.name, eligible(p.root)] as const);
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
