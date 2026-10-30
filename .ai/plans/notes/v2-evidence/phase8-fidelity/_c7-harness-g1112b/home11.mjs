// Home (project-less server) seeded with 5 projects via MAUDE_INDEX_DIR. usage: node home11.mjs [dark,light]
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stubClaudeEnv } from '../scripts/lib/stub-claude.mjs';
import { REPO, STUDIO, playwright, sleep, snap } from './lib.mjs';

const themes = (process.argv[2] || 'dark,light').split(',');
const SECRET = 'a'.repeat(64);
const seed = JSON.parse(readFileSync(join(REPO, '.scr/home-seed.json'), 'utf8'));
const D = '11-projects-and-navigation';
for (const theme of themes) {
  const scratch = mkdtempSync(join(tmpdir(), 'maude-g4home-'));
  const home = join(scratch, 'home');
  mkdirSync(join(home, 'xdg', 'maude'), { recursive: true });
  const port = 5100 + Math.floor(Math.random() * 300);
  const proc = spawn('bun', ['run', join(STUDIO, 'server.ts'), '--home', '--port', String(port)], {
    env: {
      ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, 'xdg'), NO_OPEN: '1', MAUDE_NO_AUTOBUILD: '1',
      MAUDE_MACHINE_FILE: join(scratch, 'machine.json'), ...stubClaudeEnv(home),
      MAUDE_HOME_PAGE_SECRET: SECRET, MAUDE_HOME_STATE_DIR: join(scratch, 'state'), MAUDE_INDEX_DIR: join(REPO, '.scr/home-idx'),
      MAUDE_HOME_PROJECTS_DIR: join(scratch, 'projects'), MAUDE_CLOUD_URL: 'http://127.0.0.1:9',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  proc.stdout.on('data', (d) => (log += d));
  proc.stderr.on('data', (d) => (log += d));
  await sleep(14000);
  const url = `http://127.0.0.1:${port}/`;
  const projects = seed.map((p, i) => ({ pid: p.pid, root: p.root, name: p.name, profile: i < 3 ? 'work' : 'default', place: i < 2 ? 'tab' : 'closed', focused: false }));
  const shellState = { projects, profiles: [{ id: 'default', label: 'Personal', email: 'you@gmail.com' }, { id: 'work', label: 'Work', email: 'you@work-studio.cz' }], windows: [], recent: seed.map((p) => p.pid) };
  const browser = await playwright.chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 860 }, colorScheme: theme });
  await ctx.addInitScript(`
    window.__TAURI__ = { core: { invoke: async (cmd) => {
      if (cmd === 'home_session') return { secret: '${SECRET}' };
      if (cmd === 'shell_state') return ${JSON.stringify(shellState)};
      return null; } }, event: { listen: async () => () => {} } };
    try { localStorage.setItem('mdcc-theme', '${theme}'); localStorage.setItem('mdcc-whatsnew-seen', '99.0.0'); } catch (e) {}`);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(url);
  await sleep(4500);
  await snap(page, `${D}/pn-home-top-${theme}`, 'Home top (extra frame)', 'project-less Home server + MAUDE_INDEX_DIR seed + Tauri shell_state stub');
  await page.evaluate(() => { for (const el of [document.scrollingElement, ...document.querySelectorAll('*')]) { if (el && el.scrollHeight > el.clientHeight + 40 && getComputedStyle(el).overflowY !== 'visible') el.scrollTop = el.scrollHeight; } window.scrollTo(0, 99999); });
  await sleep(700);
  await snap(page, `${D}/pn-home-${theme}`, 'Home, scrolled', 'project-less Home server + MAUDE_INDEX_DIR seed + Tauri shell_state stub; scrolled to the bottom');
  await page.evaluate(() => { for (const el of [document.scrollingElement, ...document.querySelectorAll('*')]) { if (el) el.scrollTop = 0; } window.scrollTo(0, 0); });
  await page.keyboard.press('Meta+k');
  await sleep(900);
  await snap(page, `${D}/pn-home-search-${theme}`, '⌘K on Home, empty', 'Home, ⌘K');
  await page.keyboard.type('mobil');
  await sleep(900);
  await snap(page, `${D}/pn-home-search-typed-${theme}`, '⌘K on Home, "mobil"', 'Home, ⌘K, typed');
  await page.keyboard.press('Escape');
  await sleep(400);
  console.log('errs', errs.slice(0, 3).join('|'), log.slice(-200));
  await browser.close();
  proc.kill('SIGTERM');
}
process.exit(0);
