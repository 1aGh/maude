// Shooting lib for the wave-B gate shots. Boots a studio on a scratch project, drives Chromium.
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const REPO = '/Users/iagh/git/personal/maude/.claude/worktrees/agent-ace93bd2b562b89ad';
import { stubClaudeEnv } from '/Users/iagh/git/personal/maude/.claude/worktrees/agent-ace93bd2b562b89ad/scripts/lib/stub-claude.mjs';
export const STUDIO = join(REPO, 'apps/studio');
export const OUT = process.env.SHOTS_OUT;
const require = createRequire(join(STUDIO, 'package.json'));
export const playwright = require('playwright');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const TAURI_STUB = `window.__TAURI__ = { core: { invoke: async (cmd, args) => { (window.__invokes = window.__invokes || []).push([cmd, args]); return null; } }, event: { listen: async () => () => {} } };`;

export function scratchProject(srcDir, keepState = false) {
  const scratch = mkdtempSync(join(tmpdir(), 'maude-wbs-'));
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
  const port = 5300 + Math.floor(Math.random() * 600);
  const home = join(scratch, 'home');
  mkdirSync(join(home, 'xdg', 'maude'), { recursive: true });
  writeFileSync(join(home, 'xdg', 'maude', 'prefs.json'), JSON.stringify({ whatsNewSeen: '99.0.0', ...prefs }));
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

export async function openPage(url, { theme = 'dark', w = 1600, h = 1000, tauri = true, ls = {}, channel = false } = {}) {
  const browser = await playwright.chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: theme });
  if (tauri) await ctx.addInitScript(TAURI_STUB);
  if (tauri && channel) await ctx.addInitScript('window.__TAURI__.core.Channel = class { constructor() { (window.__chs = window.__chs || []).push(this); } };');
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
  const path = join(OUT, name + '.jpg');
  mkdirSync(join(path, '..'), { recursive: true });
  await page.screenshot({ path, type: 'jpeg', quality: 70, clip });
  shots.push({ name, state, how });
  console.log('shot', name);
  return path;
}
