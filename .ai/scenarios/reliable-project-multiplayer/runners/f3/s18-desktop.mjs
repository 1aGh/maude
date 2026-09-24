#!/usr/bin/env node
// S18 on a deployed backend: the desktop's own status bar tells the truth.
// A real desktop studio (sidecar) linked to the hub, read in a browser exactly
// where a person reads it — the hub-sync chip's label and its title — in five
// states: synced; offline with queued work; a refused draft; a media file the
// project cannot take; the hub unable to persist. Oracle: only the settled
// state says "synced", every other one names the problem and what to do, and
// the state returns to synced once the cause is gone.
//
//   node s18-desktop.mjs --work <selfhost dir> --scratch <dir> --out <dir>
//   (the hub must run with MAUDE_MAX_PROJECT_FILE_BYTES=100000000)
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canvasSource, loadBackend } from './backend.mjs';
import { startDesktop, startProxy, until } from './desktop.mjs';

const REPO = fileURLToPath(new URL('../../../../../', import.meta.url));
const argv = process.argv.slice(2);
const arg = (n) => argv[argv.indexOf(`--${n}`) + 1];
const work = arg('work');
const scratch = arg('scratch');
const out = arg('out');
mkdirSync(scratch, { recursive: true });
mkdirSync(out, { recursive: true });
const fx = JSON.parse(readFileSync(join(work, 'fixture.json'), 'utf8'));
assert.equal(fx.extraEnv?.MAUDE_MAX_PROJECT_FILE_BYTES, '100000000', 'hub file ceiling for the media state');
const tag = randomBytes(3).toString('hex');
const B = await loadBackend('selfhost', { work });
const name = `F3Status${tag}`;
const doc = `ui-${name.toLowerCase()}`;
const rel = `ui/${name}.tsx`;
const src = canvasSource(name, 'Status title');
assert.equal((await B.propose('b', [{ op: 'doc.create', doc, path: rel, lanes: { html: src } }])).status, 200);
const port = fx.port;
const proxy = await startProxy({ listen: port + 90, target: port, control: port + 91 });
const A = await startDesktop({
  root: join(scratch, `desktop-status-${tag}`),
  port: port + 100,
  hubUrl: `http://127.0.0.1:${port + 90}`,
  token: fx.sessions.a.token,
  role: fx.sessions.a.role,
  name: 'desktop-status',
});
const { chromium } = createRequire(join(REPO, 'package.json'))('@playwright/test');
const browser = await chromium.launch();
const states = {};
try {
  await until(() => A.read(rel) === src, 'desktop pulled the canvas', 90000);
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await page.goto(A.url);
  const chip = page.locator('.st-sb-sync');
  await chip.waitFor({ timeout: 60000 });
  const read = async () => ({
    label: (await chip.locator('.val').textContent())?.trim(),
    title: (await chip.locator('.val').getAttribute('title')) ?? '',
  });
  const capture = async (key, want, ms = 90000) => {
    const seen = await until(async () => {
      const r = await read();
      return want(r) ? r : null;
    }, `status for ${key}`, ms, 500);
    states[key] = { ...seen, raw: await A.status() };
    await page.screenshot({ path: join(out, `s18-${key}.png`) });
    return seen;
  };
  await capture('synced', (r) => r.label === 'synced');

  await proxy.offline();
  A.write(rel, src.replace('Status title<', 'Status title offline<'));
  await capture('offline-queued', (r) => /offline/.test(r.label));
  await proxy.online();
  await capture('back-online', (r) => r.label === 'synced', 120000);

  A.write(rel, A.read(rel).replace('</h1>', '</h2>'));
  await capture('refused-draft', (r) => r.label !== 'synced' && /review|refused/.test(r.label));
  // Resolve it the way a person does: the chip opens Sync, the notice's
  // Resolve opens the dialog, and the project's version is taken.
  await chip.click();
  await page.locator(`[data-testid="sync-resolve-${doc}"]`).click({ timeout: 30000 });
  await page.locator('[data-testid="source-conflict-use-theirs"]').click({ timeout: 30000 });
  await page.locator('[data-testid="source-conflict-panel"]').waitFor({ state: 'detached', timeout: 30000 });
  await page.keyboard.press('Escape');
  await capture('draft-resolved', (r) => r.label === 'synced', 120000);

  // A video the project cannot take (a real media class — a `.bin` is not a
  // project file at all, so "synced" would be the truth for it).
  const big = join(A.design, 'ui', `F3TooLarge${tag}.mp4`);
  writeFileSync(big, '');
  truncateSync(big, 110_000_000);
  await capture('media-too-large', (r) => r.label !== 'synced' && /review|refused|blocked/.test(`${r.label} ${r.title}`), 120000);
  rmSync(big);
  await capture('media-removed', (r) => r.label === 'synced', 120000);

  // The hub cannot persist: one folder of its checkout refuses writes (the
  // local matrix's L22 does the same). A file the desktop adds there must be
  // told as waiting — never "synced" — and deliver itself once writes return.
  const folder = `ui/F3Storage${tag}`;
  mkdirSync(join(A.design, folder), { recursive: true });
  writeFileSync(join(A.design, folder, '.gitkeep'), '');
  const hubFolder = join(work, 'repo', '.design', folder);
  await until(() => existsSync(hubFolder), 'the folder reached the hub checkout', 90000);
  const image = readFileSync(fileURLToPath(new URL('./fixtures/from-hub.png', import.meta.url)));
  chmodSync(hubFolder, 0o555);
  try {
    writeFileSync(join(A.design, folder, 'held.png'), image);
    await capture(
      'hub-cannot-persist',
      (r) => r.label !== 'synced' && (/review|held|attention|waiting/.test(`${r.label} ${r.title}`) || /\d+\s*\/\s*\d+/.test(r.label)),
      120000
    );
    states['hub-cannot-persist'].stillNotSyncedAfter20s = await new Promise((done) =>
      setTimeout(async () => done((await read()).label !== 'synced'), 20000)
    );
  } finally {
    chmodSync(hubFolder, 0o755);
  }
  await until(() => existsSync(join(hubFolder, 'held.png')), 'the held file delivered itself', 240000);
  await capture('hub-persists-again', (r) => r.label === 'synced', 240000);
} finally {
  await browser.close();
  writeFileSync(join(out, 'desktop.log'), A.log.replace(/mau_[0-9a-f]+/g, 'mau_<redacted>'));
  await A.stop();
  proxy.stop();
}
const failing = ['offline-queued', 'refused-draft', 'media-too-large', 'hub-cannot-persist'];
const result = {
  doc,
  states: Object.fromEntries(Object.entries(states).map(([k, v]) => [k, { label: v.label, title: v.title }])),
  checks: {
    onlySettledSaysSynced: failing.every((k) => states[k] && states[k].label !== 'synced'),
    failingStatesExplain: failing.every((k) => states[k] && states[k].title.length > 20),
    recoveredEveryTime: ['back-online', 'draft-resolved', 'media-removed', 'hub-persists-again'].every(
      (k) => states[k]?.label === 'synced'
    ),
    persistFailureHeld: states['hub-cannot-persist']?.stillNotSyncedAfter20s === true,
  },
};
result.status = Object.values(result.checks).every(Boolean) ? 'pass' : 'fail';
writeFileSync(join(out, 's18-desktop.json'), JSON.stringify({ ...result, raw: states }, null, 2));
console.log(JSON.stringify(result));
process.exitCode = result.status === 'pass' ? 0 : 1;
