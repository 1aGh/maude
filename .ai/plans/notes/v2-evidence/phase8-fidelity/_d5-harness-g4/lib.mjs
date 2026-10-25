// Shooting lib for phase-8 fidelity evidence (G4). Boots a studio on a scratch project, drives Chromium.
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// D5: the harness lives at <repo>/.ai/plans/notes/v2-evidence/phase8-fidelity/_d5-harness-g4 — REPO is derived, so it runs from any checkout (the Mac mini slot included)
export const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(HERE, '../../../../../..');
export const { stubClaudeEnv } = await import(pathToFileURL(join(REPO, 'scripts/lib/stub-claude.mjs')).href);
export const STUDIO = join(REPO, 'apps/studio');
export const OUT = process.env.SHOTS_OUT || join(REPO, '.scr/impl');
const require = createRequire(join(STUDIO, 'package.json'));
export const playwright = require('playwright');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const TAURI_STUB = `window.__TAURI__ = { core: { invoke: async (cmd, args) => { (window.__invokes = window.__invokes || []).push([cmd, args]); return null; } }, event: { listen: async () => () => {} } };`;

export function scratchProject(srcDir, keepState = false) {
  const scratch = mkdtempSync(join(tmpdir(), 'maude-g4-'));
  const project = join(scratch, 'project');
  cpSync(srcDir, project, { recursive: true });
  for (const p of keepState ? ['.design/_sync.json', '.design/_server.json'] : ['.design/_state', '.design/_sync.json', '.design/_server.json'])
    rmSync(join(project, p), { recursive: true, force: true });
  const cfgPath = join(project, '.design/config.json');
  if (existsSync(cfgPath)) {
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
    delete cfg.linkedHub;
    writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  }
  return { scratch, project };
}

export async function boot(project, scratch, extraEnv = {}, prefs = {}) {
  const port = await new Promise((res) => { const srv = createServer(); srv.listen(0, '127.0.0.1', () => { const pt = srv.address().port; srv.close(() => res(pt)); }); });
  const home = join(scratch, 'home');
  mkdirSync(join(home, 'xdg', 'maude'), { recursive: true });
  writeFileSync(join(home, 'xdg', 'maude', 'prefs.json'), JSON.stringify(prefs));
  const server = spawn('bun', ['run', join(STUDIO, 'server.ts'), '--root', project, '--port', String(port)], {
    env: {
      ...process.env,
      HOME: home,
      XDG_CONFIG_HOME: join(home, 'xdg'),
      NO_OPEN: '1',
      MAUDE_NO_AUTOBUILD: '1',
      MAUDE_MACHINE_FILE: join(scratch, 'machine.json'),
      ...stubClaudeEnv(home),
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  server.stdout.on('data', (d) => (log += d));
  server.stderr.on('data', (d) => (log += d));
  const sj = join(project, '.design/_server.json');
  const t0 = Date.now();
  while (!existsSync(sj) && Date.now() - t0 < 40000) await sleep(200);
  if (!existsSync(sj)) throw new Error('server did not boot:\n' + log.slice(-2000));
  const { url } = JSON.parse(readFileSync(sj, 'utf8'));
  return { server, url, port, log: () => log, stop: () => server.kill('SIGTERM') };
}

export async function openPage(url, { theme = 'dark', w = 1600, h = 1000, tauri = true, ls = {}, stub = null } = {}) {
  const browser = await playwright.chromium.launch(process.env.SHOT_CHANNEL ? { channel: process.env.SHOT_CHANNEL } : {});
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: theme });
  if (tauri) await ctx.addInitScript(stub || TAURI_STUB);
  const store = { 'mdcc-theme': theme, 'mdcc-usage-tour-seen': '1', 'mdcc-collab-tour-seen': '1', 'mdcc-whatsnew-seen': '99.0.0', 'maude-mode-hint-seen': '1', ...ls };
  await ctx.addInitScript(
    `try{const s=${JSON.stringify(store)};for(const k in s)localStorage.setItem(k,s[k]);}catch(e){}`
  );
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  await page.goto(url);
  return { browser, ctx, page, logs };
}

export const shots = [];
export async function snap(page, name, state = '', how = '', { clip } = {}) {
  const path = join(OUT, name + '.png');
  mkdirSync(join(path, '..'), { recursive: true });
  await page.screenshot({ path, type: 'png', clip });
  shots.push({ name, state, how });
  console.log('shot', name);
  return path;
}
