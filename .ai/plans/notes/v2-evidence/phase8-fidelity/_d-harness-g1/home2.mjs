// Home scenes on the project-less Home server with a Tauri stub + route interception.
// usage: node home2.mjs <themes light,dark> [sceneId,sceneId]
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stubClaudeEnv } from '/Users/iagh/git/personal/maude/.claude/worktrees/agent-a1266e1495ea7588d/scripts/lib/stub-claude.mjs';
import { STUDIO, playwright, REPO, sleep } from './lib.mjs';

const OUT = process.env.SHOTS_OUT;
const themes = (process.argv[2] || 'light,dark').split(',');
const only = process.argv[3] ? process.argv[3].split(',') : null;
const SECRET = 'a'.repeat(64);
const STATE = 'b'.repeat(32);
const now = Date.now();
const MIN = 60_000, H = 3_600_000, DAY = 86_400_000;

// thumbnails: four flat pictures
const TH = join(REPO, '.scr/fx-cache/thumbs');
mkdirSync(TH, { recursive: true });
const THUMB_COLORS = { sky: '#9bd6f2', mint: '#c7ecd6', lilac: '#d9c9f2', ink: '#1c2630' };
for (const [k, c] of Object.entries(THUMB_COLORS)) {
  const f = join(TH, k + '.jpg');
  if (!existsSync(f)) execFileSync('magick', ['-size', '480x300', `xc:${c}`, f]);
}

const canvas = (rel, name, o = {}) => ({ rel, name, folder: '', cover: { key: o.cover || 'sky' }, madeByAi: !!o.ai, openedAt: o.opened ?? null, pinnedAt: null });
const P = (pid, name, root, canvases, extra = {}) => ({ pid, state: 'ok', project: { name, root, ...extra }, counts: { canvases: extra.count ?? canvases.length, byKind: {} }, canvases, stale: false });

const STUDIO_P = P('p-studio', 'Studio site', '/Users/you/Maude/Studio site', [
  canvas('ui/Homepage.tsx', 'Homepage', { opened: now - 2 * MIN, cover: 'sky' }),
  canvas('ui/Pricing.tsx', 'Pricing', { opened: now - 3 * H, cover: 'mint' }),
  canvas('ui/Onboarding.tsx', 'Onboarding', { cover: 'sky' }),
  canvas('ui/Mobile-detail.tsx', 'Mobile — detail', { opened: now - 4 * DAY, cover: 'lilac' }),
]);
const GATORS_P = P('p-gators', 'Alligators brand', '/Users/you/Maude/Alligators', [
  canvas('ui/Combine-kampan.tsx', 'Combine-kampan', { opened: now - DAY, cover: 'ink', ai: true }),
], { count: 93 });
const sp = (pid, name, root, place = 'closed', hub = null) => ({ pid, root, name, profile: 'default', place, focused: false, hub, linkedHub: hub ? { url: hub } : undefined });
const PROFILE = { id: 'default', label: 'You', email: 'you@studio.cz' };
const SIGNED = { signedIn: true, profile: 'default', account: { email: 'you@studio.cz' }, projects: [] };

export const SCENES = [
  { id: 'cf-home-prompt', dir: '01', shell: { projects: [sp('p-studio', 'Studio site', STUDIO_P.project.root), sp('p-gators', 'Alligators brand', GATORS_P.project.root)], profiles: [PROFILE], recent: ['p-studio', 'p-gators'], windows: [] }, cloud: SIGNED, index: [STUDIO_P, GATORS_P],
    act: async (page) => { await page.locator('[data-testid="home-ask-input"]').first().fill('A calm landing page for Studio site — hero, three services, a pricing teaser'); await sleep(500); } },
  { id: 'cf-home-prompt.target', dir: '01', shell: null, same: 'cf-home-prompt',
    act: async (page) => { await page.locator('[data-testid="home-ask-input"]').first().fill('A calm landing page for Studio site — hero, three services, a pricing teaser'); await page.locator('[data-testid="home-target-chip"]').first().click(); await sleep(600); } },
  { id: 'ob-first-launch', dir: '02', shell: { projects: [], profiles: [{ id: 'default', label: 'This Mac' }], recent: [], windows: [] }, cloud: { signedIn: false, profile: 'default', projects: [] }, index: [] },
  { id: 'ob-signin-browser', dir: '02', same: 'ob-first-launch', signin: 'pending',
    act: async (page) => { await page.locator('[data-testid="signin-cloud"]').first().click(); await sleep(1800); } },
  { id: 'ob-edge-timeout', dir: '02', same: 'ob-first-launch', signin: 'expired',
    act: async (page) => { await page.locator('[data-testid="signin-cloud"]').first().click(); await sleep(7000); } },
  { id: 'ob-home-new', dir: '02', shell: { projects: [], profiles: [PROFILE], recent: [], windows: [] }, cloud: SIGNED, index: [] },
  { id: 'ob-local-name', dir: '02', same: 'ob-first-launch',
    act: async (page) => { await page.locator('[data-testid="signin-local"]').first().click(); await sleep(900); } },
  { id: 'ob-adv-open', dir: '02', same: 'ob-first-launch',
    act: async (page) => { await page.locator('[data-testid="signin-advanced"]').first().click(); await sleep(800); } },
  { id: 'ob-edge-offline', dir: '02', same: 'ob-first-launch', offlineAfterLoad: true },
  { id: 'ob-home-team', dir: '02', shell: { projects: [], profiles: [PROFILE], recent: [], windows: [] },
    cloud: { signedIn: true, profile: 'default', account: { email: 'you@studio.cz' }, projects: [{ id: 'gators', name: 'Alligators brand', ownerName: 'Tereza', role: 'editor', url: 'https://cloud.maude.sh/h/gators', updatedAt: now - 2 * H }] }, index: [] },
  { id: 'ob-edge-other-mac', dir: '02', shell: { projects: [], profiles: [PROFILE], recent: [], windows: [] },
    cloud: { signedIn: true, profile: 'default', account: { email: 'you@studio.cz' }, projects: [
      { id: 'studio', name: 'Studio site', ownerName: 'You', role: 'owner', url: 'https://cloud.maude.sh/h/studio', updatedAt: now - 30 * MIN },
      { id: 'gators', name: 'Alligators brand', ownerName: 'Tereza', role: 'editor', url: 'https://cloud.maude.sh/h/gators', updatedAt: now - 2 * H }] }, index: [] },
  { id: 'es-home-cloud', dir: '05', same: 'ob-home-new' },
  { id: 'es-home-local', dir: '05', shell: { projects: [sp('p-studio', 'Studio site', STUDIO_P.project.root)], profiles: [{ id: 'default', label: 'This Mac' }], recent: ['p-studio'], windows: [] }, cloud: { signedIn: false, profile: 'default', projects: [] }, index: [{ ...STUDIO_P, canvases: [] , counts: { canvases: 0, byKind: {} } }] },
  { id: 'ob-adv-sheets.hub', dir: '02', same: 'ob-first-launch',
    act: async (page) => { await page.locator('[data-testid="signin-advanced"]').first().click(); await sleep(600); await page.locator('[data-testid="signin-adv-hub"]').first().click(); await sleep(1200); } },
  { id: 'ob-adv-sheets.folder-github', dir: '02', same: 'ob-first-launch',
    act: async (page) => { await page.locator('[data-testid="signin-advanced"]').first().click(); await sleep(600); await page.locator('[data-testid="signin-adv-folder-github"]').first().click(); await sleep(1200); } },
  { id: 'ob-adv-sheets.ai', dir: '02', same: 'ob-first-launch',
    act: async (page) => { await page.locator('[data-testid="signin-advanced"]').first().click(); await sleep(600); await page.locator('[data-testid="signin-adv-ai"]').first().click(); await sleep(1200); } },
  { id: 'ob-adv-sheets.cli', dir: '02', same: 'ob-first-launch',
    act: async (page) => { await page.locator('[data-testid="signin-advanced"]').first().click(); await sleep(600); await page.locator('[data-testid="signin-adv-cli"]').first().click(); await sleep(1200); } },
  { id: 'ob-adv-sheets.figma', dir: '02', same: 'ob-first-launch',
    act: async (page) => { await page.locator('[data-testid="signin-advanced"]').first().click(); await sleep(600); await page.locator('[data-testid="signin-adv-figma"]').first().click(); await sleep(1200); } },
  { id: 'ob-edge-accounts', dir: '02', shell: { projects: [], profiles: [PROFILE], recent: [], windows: [] }, cloud: SIGNED, index: [],
    invite: { projectName: 'Alligators brand', fromName: 'Tereza', email: 'you@work-studio.cz', role: 'member', canvas: { path: 'ui/Combine-kampan.tsx', name: 'Combine-kampan' } } },
  { id: 'ob-invite-landed.join', dir: '02', shell: { projects: [], profiles: [PROFILE], recent: [], windows: [] }, cloud: SIGNED, index: [],
    invite: { projectName: 'Alligators brand', fromName: 'Tereza', email: 'you@studio.cz', role: 'member', canvas: { path: 'ui/Combine-kampan.tsx', name: 'Combine-kampan' } } },
  { id: 'ob-invite-landed.signedout', dir: '02', same: 'ob-first-launch',
    invite: { projectName: 'Alligators brand', fromName: 'Tereza', email: 'you@studio.cz', role: 'member', canvas: { path: 'ui/Combine-kampan.tsx', name: 'Combine-kampan' } } },
  { id: 'ob-edge-whats-new', dir: '02', same: 'es-home-shared', whatsnew: true },
  { id: 'ob-edge-whats-new.menu', dir: '02', same: 'es-home-shared', whatsnew: true,
    act: async (page) => {
      await page.getByText('Home', { exact: true }).first().click({ timeout: 4000 }); await sleep(900);
      await page.getByText('Help', { exact: true }).first().hover({ timeout: 3000 }).catch(() => {}); await sleep(900);
    } },
  { id: 'es-home-shared', dir: '05', shell: { projects: [sp('p-studio', 'Studio site', STUDIO_P.project.root)], profiles: [PROFILE], recent: ['p-studio'], windows: [] }, cloud: SIGNED, index: [STUDIO_P] },
];

const byId = Object.fromEntries(SCENES.map((s) => [s.id, s]));
const resolve = (s) => (s.same ? { ...byId[s.same], ...s, shell: s.shell ?? byId[s.same].shell, cloud: s.cloud ?? byId[s.same].cloud, index: s.index ?? byId[s.same].index } : s);

const scratch = mkdtempSync(join(tmpdir(), 'maude-g1home-'));
const home = join(scratch, 'home');
mkdirSync(join(home, 'xdg', 'maude'), { recursive: true });
const port = 5400 + Math.floor(Math.random() * 300);
const proc = spawn('bun', ['run', join(STUDIO, 'server.ts'), '--home', '--port', String(port)], {
  env: { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, 'xdg'), NO_OPEN: '1', MAUDE_NO_AUTOBUILD: '1', MAUDE_MACHINE_FILE: join(scratch, 'machine.json'), ...stubClaudeEnv(home),
    MAUDE_HOME_PAGE_SECRET: SECRET, MAUDE_HOME_STATE_DIR: join(scratch, 'state'), MAUDE_INDEX_DIR: join(scratch, 'index'), MAUDE_HOME_PROJECTS_DIR: join(scratch, 'projects'), MAUDE_CLOUD_URL: 'http://127.0.0.1:9' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
proc.stdout.on('data', (d) => (log += d));
proc.stderr.on('data', (d) => (log += d));
await sleep(5000);
const url = `http://127.0.0.1:${port}/`;
const browser = await playwright.chromium.launch();
try {
  for (const theme of themes) {
    for (const raw of SCENES) {
      if (only && !only.includes(raw.id)) continue;
      const sc = resolve(raw);
      const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, colorScheme: theme });
      await ctx.addInitScript(`
        const SC = ${JSON.stringify({ shell: sc.shell, invite: sc.invite ? '11111111-1111-1111-1111-111111111111' : null })};
        window.__TAURI__ = { core: { invoke: async (cmd, args) => {
          (window.__invokes = window.__invokes || []).push([cmd, args]);
          if (cmd === 'home_session') return { secret: '${SECRET}' };
          if (cmd === 'shell_state') return SC.shell;
          if (cmd === 'home_cloud_sign_in_prepare') return 'default';
          if (cmd === 'take_pending_invite') return SC.invite;
          return null; } }, event: { listen: async () => () => {} } };
        try { localStorage.setItem('mdcc-theme', '${theme}'); localStorage.setItem('mdcc-whatsnew-seen','99.0.0'); } catch (e) {}`);
      const page = await ctx.newPage();
      const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      await page.route('**/_home/cloud?*', (r) => json(r, sc.cloud));
      await page.route('**/_home/index?*', (r) => json(r, { projects: sc.index || [] }));
      await page.route('**/_home/thumb/**', (r) => { const k = decodeURIComponent(r.request().url().split('/').pop().replace('.jpg', '')); const f = join(TH, (THUMB_COLORS[k] ? k : 'sky') + '.jpg'); return r.fulfill({ status: 200, contentType: 'image/jpeg', body: readFileSync(f) }); });
      await page.route('**/_home/whats-new', (r) => r.request().method() === 'GET' ? json(r, sc.whatsnew ? { version: '1.9.1', seen: '1.8.0', entries: [{ id: 'wn-1', version: '1.9.1', date: '2026-10-22', title: 'A new look: the canvas fills the window', body: '' }] } : { version: '1.9.1', seen: '1.9.1', entries: [] }) : json(r, { ok: true }));
      await page.route('**/_home/invite/peek', (r) => json(r, sc.invite || {}, sc.invite ? 200 : 404));
      await page.route('**/_home/cloud/signin/start', (r) => json(r, { ok: true, userCode: 'WXYZ-1234', state: STATE, expiresIn: 600 }));
      await page.route('**/_home/cloud/signin/poll', (r) => json(r, { status: sc.signin === 'expired' ? 'expired' : 'pending' }));
      await page.route('**/_home/cloud/signin/cancel', (r) => json(r, { ok: true }));
      await page.goto(url);
      await sleep(3500);
      if (sc.offlineAfterLoad) { await ctx.setOffline(true); await page.evaluate(() => window.dispatchEvent(new Event('offline'))); await sleep(1200); }
      if (sc.act) await sc.act(page).catch((e) => console.log('act fail', sc.id, String(e.message).split('\n')[0]));
      const path = join(OUT, sc.dir, `${sc.id}-${theme}.png`);
      mkdirSync(join(OUT, sc.dir), { recursive: true });
      await page.screenshot({ path });
      console.log('shot', sc.dir, sc.id, theme);
      await ctx.close();
    }
  }
} finally {
  await browser.close();
  proc.kill('SIGTERM');
}
process.exit(0);
