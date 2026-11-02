// Home (project-less server). usage: node home.mjs [dark,light]
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stubClaudeEnv } from '/Users/iagh/git/personal/maude/.claude/worktrees/wf_74ac1088-f6f-9/scripts/lib/stub-claude.mjs';
import { STUDIO, playwright, shots, sleep, snap } from './lib.mjs';

const themes = (process.argv[2] || 'dark,light').split(',');
const SECRET = 'a'.repeat(64);
for (const theme of themes) {
  const scratch = mkdtempSync(join(tmpdir(), 'maude-wbs-home-'));
  const home = join(scratch, 'home');
  mkdirSync(join(home, 'xdg', 'maude'), { recursive: true });
  const port = 5100 + Math.floor(Math.random() * 300);
  const proc = spawn('bun', ['run', join(STUDIO, 'server.ts'), '--home', '--port', String(port)], {
    env: {
      ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, 'xdg'), NO_OPEN: '1', MAUDE_NO_AUTOBUILD: '1',
      MAUDE_MACHINE_FILE: join(scratch, 'machine.json'), ...stubClaudeEnv(home),
      MAUDE_HOME_PAGE_SECRET: SECRET, MAUDE_HOME_STATE_DIR: join(scratch, 'state'), MAUDE_INDEX_DIR: join(scratch, 'index'),
      MAUDE_HOME_PROJECTS_DIR: join(scratch, 'projects'), MAUDE_CLOUD_URL: 'http://127.0.0.1:9',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  proc.stdout.on('data', (d) => (log += d));
  proc.stderr.on('data', (d) => (log += d));
  await sleep(5000);
  const url = `http://127.0.0.1:${port}/`;
  const probe = await fetch(url, { signal: AbortSignal.timeout(4000) }).then((r) => r.status).catch((e) => String(e));
  console.log('probe', probe, log.slice(-600));
  const browser = await playwright.chromium.launch({ channel: 'chrome' });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, colorScheme: theme });
  await ctx.addInitScript(`
    window.__TAURI__ = { core: { invoke: async (cmd) => {
      if (cmd === 'home_session') return { secret: '${SECRET}' };
      if (cmd === 'shell_state') return { projects: [], profiles: [{ id: 'default', label: 'Michal' }], windows: [] };
      return null; } }, event: { listen: async () => () => {} } };
    try { localStorage.setItem('mdcc-theme', '${theme}'); } catch (e) {}`);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(url);
  await sleep(3500);
  const D = '01-create-flow';
  await snap(page, `${D}/cf-home-prompt-${theme}`, 'Home — one sentence (the prompt, no project yet)', 'project-less Home server, Tauri stub');
  await snap(page, `02-onboarding/ob-first-launch-${theme}`, 'First launch is Home', 'project-less Home server, no projects');
  await snap(page, `05-empty-states/es-home-local-${theme}`, 'Home — no projects yet (empty shelves)', 'project-less Home server, no projects');
  const input = page.locator('[data-testid="home-ask-input"]').first();
  if (await input.count()) {
    await input.fill('A matchday poster for Saturday, big headline, club green');
    await sleep(500);
    await snap(page, `01-create-flow/cf-home-typed-${theme}`, 'Home — the sentence typed, ready to send', 'type into home-ask-input');
  }
  const tgt = page.locator('[data-testid="home-target-chip"]').first();
  if (await tgt.count()) {
    await tgt.click().catch(() => {});
    await sleep(600);
    await snap(page, `01-create-flow/cf-home-target-${theme}`, 'Home — the “starts a new canvas in…” menu', 'click home-target-chip');
  }
  console.log('errs', errs.slice(0, 3).join('|'), log.slice(-200));
  await browser.close();
  proc.kill('SIGTERM');
}
process.exit(0);
