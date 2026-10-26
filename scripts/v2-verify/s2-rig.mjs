#!/usr/bin/env node
// S2.V2 verifier rig (reuses the S1/S5 recipes). Usage:
//   node scripts/v2-verify/s2-rig.mjs setup  <scratch>             fixture project at <scratch>/proj (Site.tsx from s2-site.tpl: 4 web artboards, shared <Home/>)
//   node scripts/v2-verify/s2-rig.mjs reset  <scratch>             rewrite Site.tsx + Site.meta.json (between write probes)
//   node scripts/v2-verify/s2-rig.mjs boot   <scratch> [worktree]  boot studio on :4412 with MAUDE_CANVAS_ORIGIN_SPLIT=0 (foreground)
//   node scripts/v2-verify/s2-rig.mjs chrome                       launch headless Chrome with CDP on :9334 (foreground)
//   node scripts/v2-verify/s2-rig.mjs run    <probe.js> <evidenceDir>  run an async probe body against the open studio page (env S2_SCRATCH = scratch)
// Probe bodies get: page, frame(), shot(name,clip), sleep(ms), ctx, fs + the helpers in PRELUDE below
// (openSite, inspText, openInspector, ab(id), selAb(id), tids(re), ftids(re), frect(sel), ftext(sel), shift(fn), src()).
// Notes: page.mouse.click ignores modifiers -> use shift(fn); enter nested frames with a double-click before shift-clicking siblings.
import { spawn } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '/Users/iagh/git/personal/maude/node_modules/@playwright/test/index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, '../../apps/desktop/e2e/fixtures/project');
const META = {
  title: 'Site',
  platform: 'web',
  designSystem: 'maude',
  kind: 'canvas',
  status: 'draft',
  sections: [{ id: 'site', title: 'Studio site' }],
  artboards: [],
};
export const PORT = Number(process.env.S2_PORT || 4412);
const CDP = Number(process.env.S2_CDP || 9334);
const PRELUDE = `
const openSite = async (canvas = 'ui/Site.tsx') => {
  await page.goto('http://localhost:${PORT}/?open=' + encodeURIComponent(canvas).replace(/%2F/g, '/'));
  await page.evaluate(() => { try { localStorage.setItem('mdcc-whatsnew-seen', '9.9.9'); localStorage.setItem('mdcc-tour-seen', '1'); } catch {} });
  await sleep(4500);
  await page.locator('[aria-label="Dismiss"], [aria-label="Close"]').first().click({ timeout: 500 }).catch(() => {});
};
const inspText = () => page.evaluate(() => (document.querySelector('[data-testid="inspector-panel"]')?.innerText || '(no inspector)').replace(/\\n+/g, ' | '));
const openInspector = async () => {
  if (!(await page.locator('[data-testid="inspector-panel"]').count())) await page.click('[aria-label*="nspector"]', { timeout: 3000 }).catch(() => {});
  await sleep(600);
};
const ab = (id) => frame().locator('[data-dc-screen="' + id + '"]').first();
const selAb = async (id) => { await ab(id).locator('.dc-artboard-label').first().click({ timeout: 3000 }).catch(() => {}); await sleep(700); };
const tids = (re) => page.evaluate((s) => [...document.querySelectorAll('[data-testid]')].map((e) => e.getAttribute('data-testid')).filter((t) => new RegExp(s).test(t)), re.source || re);
const ftids = (re) => frame().evaluate((s) => [...document.querySelectorAll('[data-testid]')].map((e) => e.getAttribute('data-testid')).filter((t) => new RegExp(s).test(t)), re.source || re);
const frect = (sel) => frame().evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); const fr = window.frameElement?.getBoundingClientRect(); return { x: r.left + (fr?.left || 0), y: r.top + (fr?.top || 0), w: r.width, h: r.height }; }, sel);
const ftext = (sel) => frame().evaluate((s) => document.querySelector(s)?.textContent, sel);
const shift = async (fn) => { await page.keyboard.down('Shift'); try { await fn(); } finally { await page.keyboard.up('Shift'); } };
const src = () => fs.readFileSync(process.env.S2_SCRATCH + '/proj/.design/ui/Site.tsx', 'utf8');
`;

function write(scratch) {
  const ui = join(scratch, 'proj/.design/ui');
  mkdirSync(ui, { recursive: true });
  writeFileSync(join(ui, 'Site.tsx'), readFileSync(join(HERE, 's2-site.tpl'), 'utf8'));
  writeFileSync(join(ui, 'Site.meta.json'), JSON.stringify(META, null, 2));
  // the pan/zoom camera is runtime state; a stale one makes the next probe start zoomed in
  rmSync(join(scratch, 'proj/.design/_canvas-state'), { recursive: true, force: true });
}
const [cmd, a, b] = process.argv.slice(2);
if (cmd === 'setup') {
  rmSync(join(a, 'proj'), { recursive: true, force: true });
  cpSync(FIXTURE, join(a, 'proj'), { recursive: true });
  write(a);
  console.log('ok', join(a, 'proj'));
} else if (cmd === 'reset') {
  write(a);
  console.log('reset');
} else if (cmd === 'boot') {
  const wt = b || join(HERE, '../..');
  const p = spawn(
    'bun',
    ['run', 'apps/studio/server.ts', '--root', join(a, 'proj'), '--port', String(PORT)],
    {
      cwd: wt,
      stdio: 'inherit',
      env: {
        ...process.env,
        NO_OPEN: '1',
        MAUDE_NO_AUTOBUILD: '1',
        MAUDE_CANVAS_ORIGIN_SPLIT: '0',
        MAUDE_MACHINE_FILE: join(a, 'machine.json'),
      },
    }
  );
  p.on('exit', (c) => process.exit(c ?? 0));
} else if (cmd === 'chrome') {
  const br = await chromium.launch({ headless: true, args: [`--remote-debugging-port=${CDP}`] });
  const ctxt = await br.newContext({ viewport: { width: 1600, height: 1000 } });
  await ctxt.newPage();
  console.log('chrome up');
  await new Promise(() => {});
} else if (cmd === 'run') {
  const EV = b || join(HERE, '../../.ai/plans/notes/v2-evidence/S2.V2');
  process.env.S2_SCRATCH ||= dirname(a);
  mkdirSync(EV, { recursive: true });
  const br = await chromium.connectOverCDP('http://localhost:' + CDP);
  const ctxt = br.contexts()[0];
  const page = ctxt.pages()[0];
  const frame = () =>
    page.frames().find((f) => f !== page.mainFrame() && /_canvas-shell/.test(f.url())) ||
    page.frames().find((f) => f !== page.mainFrame());
  const shot = async (name, clip) => {
    await page.screenshot({ path: `${EV}/${name}.png`, clip });
    return `${EV}/${name}.png`;
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const fs = await import('node:fs');
  // biome-ignore lint/security/noGlobalEval: local verify rig — compiles our own committed probe file into an async fn
  const fn = eval(
    `(async (page, frame, shot, sleep, ctx, fs) => {${PRELUDE}\n${readFileSync(a, 'utf8')}\n})`
  );
  try {
    const r = await fn(page, frame, shot, sleep, ctxt, fs);
    if (r !== undefined) console.log(typeof r === 'string' ? r : JSON.stringify(r, null, 1));
  } catch (e) {
    console.log('ERR', String(e.message).slice(0, 300));
  }
  await br.close().catch(() => {});
  process.exit(0);
}
