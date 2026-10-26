#!/usr/bin/env node
// V2-8.0 part B — "the CSS change changes nothing you can see": A/B the shell stylesheet in ONE live DOM.
//
//   node scripts/v2-verify/css-ab-rig.mjs (--a <styles.css> | --a-rev <rev>) (--b <styles.css> | --b-rev <rev>)
//        [--out <dir>]
//        [--states home,shell,...] [--themes dark,light] [--keep]
//
// Boots this tree's studio (its built dist/, release) on a scratch copy of the desktop e2e fixture project, and a
// Home server, in a throwaway HOME/XDG with the stub `claude` (no keychain, no real CLI, no real cloud). Every
// request for /_client/styles.css is answered with file A or file B. For each shell state it drives the UI there
// once, then captures the page under A and under B by swapping the <link> in place — same DOM, same moment — so
// the only difference between the two captures is the stylesheet:
//   - a computed-style fingerprint of every element (+ ::before / ::after) of the shell document (canvas
//     iframes do not load styles.css), and the per-property diff of any element that differs;
//   - a viewport screenshot each, pixel-diffed (exact: any channel difference counts).
// Transitions and animations are frozen for both captures. Exit 0 = every reached state identical; 1 = a
// difference (listed); 2 = harness failure. A state the rig cannot reach is reported as "not reached", never
// as identical. The report lands in <out>/report.json + per-state PNGs when they differ.
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stubClaudeEnv } from '../lib/stub-claude.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const studio = join(repo, 'apps/studio');
const require = createRequire(join(studio, 'package.json'));
const playwright = require('playwright');

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
// --a / --b: a built styles.css; --a-rev / --b-rev: bundle client/styles/_index.css as it is at that rev, with
// build.ts's exact Lightning CSS options (release = minified).
function cssAtRev(rev) {
  const dir = mkdtempSync(join(tmpdir(), 'css-ab-rev-'));
  const cmd = ['git', '-C', repo, 'archive', rev, 'apps/studio/client']
    .map((x) => `'${x}'`)
    .join(' ');
  const tar = spawnSync('bash', ['-c', `${cmd} | tar -x -C '${dir}'`], { encoding: 'utf8' });
  if (tar.status !== 0) throw new Error(`archive ${rev}: ${tar.stderr}`);
  const { bundle, browserslistToTargets } = require('lightningcss');
  const { code } = bundle({
    filename: join(dir, 'apps/studio/client/styles/_index.css'),
    minify: true,
    sourceMap: false,
    targets: browserslistToTargets([
      'Chrome >= 110',
      'Safari >= 16',
      'Firefox >= 110',
      'Edge >= 110',
    ]),
    drafts: { customMedia: true },
  });
  rmSync(dir, { recursive: true, force: true });
  return Buffer.from(code).toString('utf8');
}
const cssFor = (n) =>
  opt(`--${n}-rev`) ? cssAtRev(opt(`--${n}-rev`)) : readFileSync(resolve(opt(`--${n}`)), 'utf8');
const cssA = cssFor('a');
const cssB = cssFor('b');
const out = resolve(opt('--out', join(tmpdir(), `css-ab-${Date.now()}`)));
const onlyStates = opt('--states')?.split(',');
const themes = opt('--themes', 'dark,light').split(',');
const keep = args.includes('--keep');
mkdirSync(out, { recursive: true });

const scratch = mkdtempSync(join(tmpdir(), 'maude-css-ab-'));
const home = join(scratch, 'home');
mkdirSync(home, { recursive: true });
const project = join(scratch, 'project');
cpSync(join(repo, 'apps/desktop/e2e/fixtures/project'), project, { recursive: true });
for (const p of ['.design/_state', '.design/_sync.json'])
  rmSync(join(project, p), { recursive: true, force: true });
const cfgPath = join(project, '.design/config.json');
const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
Reflect.deleteProperty(cfg, 'linkedHub');
writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));

const baseEnv = {
  ...process.env,
  HOME: home,
  XDG_CONFIG_HOME: join(home, '.config'),
  MAUDE_UI_PREFS_PATH: join(home, '.config/maude/prefs.json'),
  MAUDE_CLOUD_CONFIG: join(home, '.config/maude/cloud.json'),
  MAUDE_CLOUD_URL: 'http://127.0.0.1:9',
  NO_OPEN: '1',
  MAUDE_NO_AUTOBUILD: '1',
  MAUDE_MACHINE_FILE: join(scratch, 'machine.json'),
  ...stubClaudeEnv(home),
};
const children = [];
const logs = { project: '', home: '' };
function boot(name, argv, env) {
  const c = spawn('bun', ['run', join(studio, 'server.ts'), ...argv], {
    env: { ...baseEnv, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  c.stdout.on('data', (d) => (logs[name] += d));
  c.stderr.on('data', (d) => (logs[name] += d));
  children.push(c);
  return c;
}
async function waitFile(p, ms = 40000) {
  const t0 = Date.now();
  while (!existsSync(p) && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 200));
  if (!existsSync(p)) throw new Error(`no ${p}`);
  // the writer is atomic, but give the JSON a beat
  await new Promise((r) => setTimeout(r, 300));
  return JSON.parse(readFileSync(p, 'utf8'));
}

const port = 4600 + Math.floor(Math.random() * 300);
boot('project', ['--root', project, '--port', String(port)], {});
const homeSecret = randomBytes(32).toString('hex');
const homeInfo = join(scratch, 'home-info.json');
boot('home', ['--home'], {
  MAUDE_HOME_STATE_DIR: join(scratch, 'home-state'),
  MAUDE_INDEX_DIR: join(scratch, 'index'),
  MAUDE_HOME_TOKEN: randomBytes(32).toString('hex'),
  MAUDE_HOME_PAGE_SECRET: homeSecret,
  MAUDE_SHELL_INFO_FILE: homeInfo,
  MAUDE_HOME_PROJECTS_DIR: join(scratch, 'Maude'),
});

// ── in-page helpers ────────────────────────────────────────────────────────────────────────
const FREEZE = `*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important}`;
async function useCss(page, which) {
  await page.evaluate(
    async ([which, freeze]) => {
      if (!document.getElementById('__ab_freeze')) {
        const s = document.createElement('style');
        s.id = '__ab_freeze';
        s.textContent = freeze;
        document.head.appendChild(s);
      }
      const link = [...document.querySelectorAll('link[rel=stylesheet]')].find((l) =>
        l.href.includes('/_client/styles.css')
      );
      if (!link) throw new Error('no styles.css link');
      window.__abN = (window.__abN || 0) + 1;
      const next = link.cloneNode();
      next.href = `/_client/styles.css?ab=${which}&n=${window.__abN}`;
      await new Promise((res, rej) => {
        next.onload = res;
        next.onerror = rej;
        link.after(next);
      });
      link.remove();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    },
    [which, FREEZE]
  );
  await page.waitForTimeout(250);
}
const FINGERPRINT = () => {
  const h = (s) => {
    let x = 2166136261;
    for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 16777619);
    return (x >>> 0).toString(36);
  };
  const path = (el) => {
    const parts = [];
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      const i = e.parentElement ? [...e.parentElement.children].indexOf(e) : 0;
      parts.push(
        `${e.tagName.toLowerCase()}${e.dataset?.testid ? `[${e.dataset.testid}]` : ''}:${i}`
      );
    }
    return parts.reverse().join('>');
  };
  const res = {};
  for (const el of document.querySelectorAll('*')) {
    if (el.id === '__ab_freeze') continue;
    const k = path(el);
    for (const ps of [null, '::before', '::after']) {
      const cs = getComputedStyle(el, ps);
      if (ps && (cs.content === 'none' || cs.content === 'normal')) continue;
      let s = '';
      for (let i = 0; i < cs.length; i++) s += `${cs[i]}:${cs.getPropertyValue(cs[i])};`;
      res[k + (ps || '')] = h(s);
    }
  }
  return res;
};
const PROPS = (keys) => {
  const path = (el) => {
    const parts = [];
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      const i = e.parentElement ? [...e.parentElement.children].indexOf(e) : 0;
      parts.push(
        `${e.tagName.toLowerCase()}${e.dataset?.testid ? `[${e.dataset.testid}]` : ''}:${i}`
      );
    }
    return parts.reverse().join('>');
  };
  const want = new Set(keys);
  const res = {};
  for (const el of document.querySelectorAll('*')) {
    const k = path(el);
    for (const ps of [null, '::before', '::after']) {
      if (!want.has(k + (ps || ''))) continue;
      const cs = getComputedStyle(el, ps);
      const o = { __class: el.getAttribute('class') || '' };
      for (let i = 0; i < cs.length; i++) o[cs[i]] = cs.getPropertyValue(cs[i]);
      res[k + (ps || '')] = o;
    }
  }
  return res;
};
async function capture(page, which) {
  await useCss(page, which);
  const png = await page.screenshot({ animations: 'disabled', caret: 'hide' });
  const fp = await page.evaluate(FINGERPRINT);
  return { png, fp };
}
async function pixelDiff(page, a, b) {
  return page.evaluate(
    async ([a, b]) => {
      const load = (src) =>
        new Promise((res, rej) => {
          const i = new Image();
          i.onload = () => res(i);
          i.onerror = rej;
          i.src = `data:image/png;base64,${src}`;
        });
      const [ia, ib] = await Promise.all([load(a), load(b)]);
      const w = ia.width,
        hh = ia.height;
      if (w !== ib.width || hh !== ib.height)
        return { total: w * hh, diff: w * hh, sizeMismatch: true };
      const c = new OffscreenCanvas(w, hh);
      const x = c.getContext('2d');
      x.drawImage(ia, 0, 0);
      const da = x.getImageData(0, 0, w, hh).data;
      x.clearRect(0, 0, w, hh);
      x.drawImage(ib, 0, 0);
      const db = x.getImageData(0, 0, w, hh).data;
      let diff = 0;
      for (let i = 0; i < da.length; i += 4)
        if (
          da[i] !== db[i] ||
          da[i + 1] !== db[i + 1] ||
          da[i + 2] !== db[i + 2] ||
          da[i + 3] !== db[i + 3]
        )
          diff++;
      return { total: w * hh, diff };
    },
    [a.toString('base64'), b.toString('base64')]
  );
}

// ── states ────────────────────────────────────────────────────────────────────────────────
const tid = (page, id) => page.locator(`[data-testid="${id}"]`).first();
async function leftTab(page, id) {
  const icon = tid(page, 'panel-icon-left');
  const tab = tid(page, `panel-tab-${id}`);
  for (let i = 0; i < 4 && !(await tab.isVisible().catch(() => false)); i++) {
    if (await icon.isVisible().catch(() => false)) await icon.click();
    await page.waitForTimeout(1000);
  }
  await tab.click({ timeout: 5000 });
  await page.waitForTimeout(600);
}
const frame = (page) => page.frameLocator('[data-testid="canvas-frame"] iframe, iframe').first();
const visible = (page, sel, timeout = 10000) =>
  page.locator(sel).first().waitFor({ state: 'visible', timeout });
// The canvas iframe holds focus after a click in it; the shell's key table listens on the shell window.
async function shellKey(page, combo) {
  await page.evaluate(() => {
    document.activeElement?.blur?.();
    document.body.tabIndex = -1;
    document.body.focus();
  });
  await page.keyboard.press(combo);
  await page.waitForTimeout(900);
}
async function openCanvas(page, slug, name) {
  await leftTab(page, 'tree').catch(() => {});
  const row = tid(page, `canvas-row-${slug}`);
  if (await row.isVisible().catch(() => false)) await row.click();
  else {
    // the left panel would not unfold: open it from ⌘K (canvases are rows there too)
    await shellKey(page, 'Meta+k');
    await tid(page, 'palette-input').fill(name);
    await page.waitForTimeout(600);
    await page.keyboard.press('Enter');
  }
  await page.waitForTimeout(500);
  await tid(page, 'canvas-loading')
    .waitFor({ state: 'detached', timeout: 20000 })
    .catch(() => {});
  await frame(page)
    .locator('[data-dc-screen], [data-dc-artboard-label], [data-dc-label]')
    .first()
    .waitFor({ timeout: 20000 });
  // the project pill names the open canvas
  await page
    .locator('[data-testid="project-pill"]', { hasText: name })
    .first()
    .waitFor({ timeout: 10000 });
  await page.waitForTimeout(1200);
}
async function reset(page, url) {
  await page.goto(url);
  await tid(page, 'share-cluster').waitFor({ timeout: 20000 });
  await page.waitForTimeout(1200);
}
const clickArtboardLabel = (page) =>
  frame(page).locator('[data-dc-artboard-label], [data-dc-label]').first().click({ timeout: 8000 });
// [name, drive, the selector that proves the state is on screen]
const STATES = [
  ['home', async (page, u) => page.goto(u.home), '[data-testid="home-root"]'],
  [
    'shell',
    async (page, u) => {
      await reset(page, u.project);
    },
    '[data-testid="share-cluster"]',
  ],
  [
    'canvases-panel',
    async (page, u) => {
      await reset(page, u.project);
      await openCanvas(page, 'ui-smoke', 'Smoke');
      await leftTab(page, 'tree');
    },
    '[data-testid="canvas-list"]',
  ],
  [
    'canvas-edit',
    async (page, u) => {
      await reset(page, u.project);
      await openCanvas(page, 'ui-smoke', 'Smoke');
    },
    '[data-testid="canvas-frame"]',
  ],
  [
    'select-text',
    async (page) => {
      await frame(page).locator('[data-testid="smoke-p"]').click({ timeout: 8000 });
    },
    '[data-testid="inspector-panel"]',
  ],
  [
    'layers',
    async (page) => leftTab(page, 'layers'),
    '[data-testid="layers-panel"], [data-testid="layers-by-artboard"]',
  ],
  ['assets', async (page) => leftTab(page, 'assets'), '[data-testid="assets-panel"]'],
  [
    'select-artboard',
    async (page, u) => {
      await reset(page, u.project);
      await openCanvas(page, 'ui-smoke', 'Smoke');
      await clickArtboardLabel(page);
    },
    '[data-testid="inspector-panel"]',
  ],
  [
    'select-picture',
    async (page, u) => {
      await reset(page, u.project);
      await openCanvas(page, 'ui-export', 'Export');
      await frame(page).locator('img').first().click({ timeout: 8000 });
    },
    '[data-testid="inspector-panel"]',
  ],
  ['palette', async (page) => shellKey(page, 'Meta+k'), '[data-testid="palette-list"]'],
  [
    'export-sheet',
    async (page, u) => {
      await reset(page, u.project);
      await openCanvas(page, 'ui-smoke', 'Smoke');
      await shellKey(page, 'Meta+Shift+E');
    },
    '[data-testid="export-sheet"]',
  ],
  [
    'share-sheet',
    async (page, u) => {
      await reset(page, u.project);
      await openCanvas(page, 'ui-smoke', 'Smoke');
      await tid(page, 'share-cluster-share').click({ timeout: 5000 });
    },
    '[data-testid="share-dialog"]',
  ],
  [
    'settings-general',
    async (page, u) => {
      await reset(page, u.project);
      await shellKey(page, 'Meta+,');
      await tid(page, 'settings-tab-general').click({ timeout: 5000 });
    },
    '[data-testid="settings-sheet"]',
  ],
  [
    'settings-connections',
    async (page) => tid(page, 'settings-tab-connections').click({ timeout: 5000 }),
    '[data-testid="settings-tab-connections"][aria-selected="true"], [data-testid="settings-tab-connections"][aria-current]',
  ],
  [
    'settings-advanced',
    async (page) => tid(page, 'settings-tab-advanced').click({ timeout: 5000 }),
    '[data-testid="settings-tab-advanced"][aria-selected="true"], [data-testid="settings-tab-advanced"][aria-current]',
  ],
  [
    'ai-chat',
    async (page, u) => {
      await reset(page, u.project);
      await openCanvas(page, 'ui-smoke', 'Smoke');
      await shellKey(page, 'Meta+k');
      await tid(page, 'palette-input').fill('make the title bigger');
      await tid(page, 'palette-ask-ai').click({ timeout: 5000 });
    },
    '[data-testid="ai-chat-island"]',
  ],
  [
    'version-history',
    async (page, u) => {
      await reset(page, u.project);
      await openCanvas(page, 'ui-smoke', 'Smoke');
      await shellKey(page, 'Meta+Alt+H');
    },
    '[data-testid="vh-panel"]',
  ],
  [
    'video-timeline',
    async (page, u) => {
      await reset(page, u.project);
      await openCanvas(page, 'ui-video', 'Video');
      await clickArtboardLabel(page);
    },
    '[data-testid="timeline-island"]',
  ],
  [
    'video-timeline-full',
    async (page) => tid(page, 'timeline-size').click({ timeout: 5000 }),
    '[data-testid="timeline-island"][data-size="full"]',
  ],
];

let code = 0;
const report = {
  a: opt('--a-rev') ?? opt('--a'),
  b: opt('--b-rev') ?? opt('--b'),
  aBytes: cssA.length,
  bBytes: cssB.length,
  states: [],
};
let browser;
try {
  const sj = await waitFile(join(project, '.design/_server.json'));
  const hj = await waitFile(homeInfo).catch(() => null);
  const urls = { project: sj.url, home: hj?.url };
  browser = await playwright.chromium.launch();
  for (const theme of themes) {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
      colorScheme: theme,
    });
    await ctx.addInitScript(
      ([secret]) => {
        try {
          localStorage.setItem('maude-theme-auto', '1');
          sessionStorage.setItem('maude-home-page-secret', secret);
        } catch {}
      },
      [homeSecret]
    );
    await ctx.route('**/_client/styles.css*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/css',
        body: /ab=B/.test(route.request().url()) ? cssB : cssA,
      })
    );
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    for (const [name, drive, proof] of STATES) {
      if (onlyStates && !onlyStates.includes(name)) continue;
      const row = { state: name, theme };
      try {
        if (name === 'home' && !urls.home) throw new Error('home server did not boot');
        await drive(page, urls);
        await visible(page, proof, 15000);
        await page.waitForTimeout(1200);
        // A, B, A again: the state counts only when A == A2 (a toast, a cursor blink or a late fetch that
        // moved between captures is the page, not the stylesheet) — retried a few times.
        let A,
          B,
          differing,
          px,
          stable = false;
        for (let attempt = 0; attempt < 5 && !stable; attempt++) {
          if (attempt) await page.waitForTimeout(2500);
          A = await capture(page, 'A');
          B = await capture(page, 'B');
          const A2 = await capture(page, 'A');
          const same = (x, y) =>
            Object.keys(x.fp).length === Object.keys(y.fp).length &&
            Object.keys(x.fp).every((k) => x.fp[k] === y.fp[k]);
          stable = same(A, A2) && (await pixelDiff(page, A.png, A2.png)).diff === 0;
          row.attempts = attempt + 1;
        }
        if (!stable) throw new Error('page never settled (A ≠ A again)');
        const keys = new Set([...Object.keys(A.fp), ...Object.keys(B.fp)]);
        differing = [...keys].filter((k) => A.fp[k] !== B.fp[k]);
        px = await pixelDiff(page, A.png, B.png);
        row.elements = Object.keys(A.fp).length;
        row.styleDiffs = differing.length;
        row.pixelDiff = px.diff;
        row.pixelPct = +((100 * px.diff) / px.total).toFixed(4);
        if (differing.length) {
          await useCss(page, 'A');
          const pa = await page.evaluate(PROPS, differing.slice(0, 40));
          await useCss(page, 'B');
          const pb = await page.evaluate(PROPS, differing.slice(0, 40));
          await useCss(page, 'A');
          row.samples = differing.slice(0, 40).map((k) => {
            const a = pa[k] || {},
              b = pb[k] || {};
            const props = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(
              (p) => a[p] !== b[p]
            );
            return {
              el: k.split('>').slice(-3).join('>'),
              class: a.__class ?? b.__class,
              props: props.slice(0, 12).map((p) => `${p}: ${a[p]} → ${b[p]}`),
            };
          });
        }
        if (differing.length || px.diff) {
          code = 1;
          writeFileSync(join(out, `${name}-${theme}-A.png`), A.png);
          writeFileSync(join(out, `${name}-${theme}-B.png`), B.png);
        } else writeFileSync(join(out, `${name}-${theme}.png`), A.png);
        row.result = differing.length || px.diff ? 'DIFFERENT' : 'identical';
      } catch (e) {
        row.result = 'not reached';
        await page
          .screenshot({ path: join(out, `${name}-${theme}-not-reached.png`) })
          .catch(() => {});
        row.visibleTestids = await page
          .evaluate(() =>
            [...document.querySelectorAll('[data-testid]')]
              .filter((e) => e.getClientRects().length)
              .map((e) => e.dataset.testid)
              .slice(0, 80)
          )
          .catch(() => []);
        row.error = String(e?.message || e).split('\n')[0];
      }
      console.log(
        `${theme.padEnd(5)} ${name.padEnd(22)} ${row.result}${row.elements ? `  (${row.elements} el, ${row.styleDiffs} style diffs, ${row.pixelPct}% px)` : ''}${row.error ? `  ${row.error}` : ''}`
      );
      report.states.push(row);
    }
    report[`pageErrors_${theme}`] = errors.slice(0, 20);
    await ctx.close();
  }
} catch (e) {
  console.error(
    `HARNESS: ${e?.stack || e}\n--- project log ---\n${logs.project.slice(-1500)}\n--- home log ---\n${logs.home.slice(-1500)}`
  );
  code = 2;
} finally {
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 1));
  console.log(`report: ${join(out, 'report.json')}`);
  if (browser) await browser.close().catch(() => {});
  for (const c of children) c.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 500));
  for (const c of children) c.kill('SIGKILL');
  if (!keep) rmSync(scratch, { recursive: true, force: true });
  process.exit(code);
}
