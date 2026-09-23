#!/usr/bin/env node
// S11 on a deployed backend: history preview of OLD media and restore during
// peer activity, driven through the real browser UI.
//
// Seed (API, like any client): two images through the file plane, a canvas
// that shows the first, then a revision that shows the second. Then the OWNER
// previews the old revision in the browser (both images must decode), designer
// B edits the canvas while the preview is open, and the owner restores the old
// version. Oracle: the restore is a NEW accepted action, a second browser
// (designer A) renders the old image, historical lanes and both objects stay
// readable — also after the backend restarts.
//
//   node s11-browser.mjs --work <selfhost dir> --out <dir> [--restart "<cmd>"]
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBackend } from './backend.mjs';

const REPO = fileURLToPath(new URL('../../../../../', import.meta.url));
const HERE = fileURLToPath(new URL('.', import.meta.url));
const argv = process.argv.slice(2);
const arg = (n) => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : null);
const work = arg('work');
const out = arg('out');
mkdirSync(out, { recursive: true });
const fx = JSON.parse(readFileSync(join(work, 'fixture.json'), 'utf8'));
const sha = (b) => createHash('sha256').update(b).digest('hex');
const tag = randomBytes(3).toString('hex');
const name = `F3MediaHistory${tag}`;
const doc = `ui-${name.toLowerCase()}`;
const rel = `ui/${name}.tsx`;
const source = (key, label) =>
  `import { DesignCanvas, DCArtboard } from '@maude/canvas-lib';\n` +
  `export default function ${name}() {\n` +
  `  return <DesignCanvas><DCArtboard id="media" label="Media history" width={600} height={400}>\n` +
  `    <h1>${label}</h1><img src="/assets/${key}" alt="${label}" width={400} height={240} />\n` +
  `  </DCArtboard></DesignCanvas>;\n}\n`;

let B = await loadBackend('selfhost', { work });
const images = ['from-hub.png', 'from-native.png'].map((f) => {
  const bytes = readFileSync(join(HERE, 'fixtures', f));
  const sha256 = sha(bytes);
  return { bytes, sha256, key: `${sha256.slice(0, 8)}.png` };
});
for (const img of images) {
  const r = await fetch(`${fx.url}/api/file/assets/${img.key}`, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${B.tokens.a.token}`,
      'content-type': 'image/png',
      'x-maude-expect-hash': 'none',
      'x-maude-content-sha256': img.sha256,
    },
    body: img.bytes,
  });
  assert.ok([200, 201, 409].includes(r.status), `asset PUT ${r.status}`);
}
const oldSrc = source(images[0].key, 'Old media');
const newSrc = source(images[1].key, 'New media');
const accept = async (who, ops) => {
  const r = await B.propose(who, ops, { label: 'S11 media history fixture' });
  assert.equal(r.status, 200, `proposal ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  return r.body;
};
const created = await accept('a', [{ op: 'doc.create', doc, path: rel, lanes: { html: oldSrc } }]);
const replaced = await accept('a', [{ op: 'lane.replace', doc, lane: 'html', base: sha(oldSrc), content: newSrc }]);

const { chromium } = createRequire(join(REPO, 'package.json'))('@playwright/test');
const browser = await chromium.launch();
const signIn = async (user) => {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await page.goto(`${fx.browserUrl}/studio/signin`);
  await page.locator('input[name=email]').fill(user.email);
  await page.locator('input[name=password]').fill(user.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.locator(`[data-testid="canvas-row-ui-${name.toLowerCase()}"]`).click({ timeout: 60000 });
  return page;
};
const decoded = (frameLoc, alt) =>
  frameLoc.locator(`img[alt="${alt}"]`).evaluate((img) => img.complete && img.naturalWidth > 0);
const result = { doc, revisions: { created: created.revision, replaced: replaced.revision } };
try {
  const owner = await signIn(fx.users.owner);
  const teammate = await signIn(fx.users.a);
  const live = (p) => p.frameLocator('[data-testid="canvas-frame"]');
  await live(teammate).locator('img[alt="New media"]').waitFor({ timeout: 60000 });
  if ((await owner.locator('[data-testid="open-changes"][aria-pressed="true"]').count()) === 0)
    await owner.locator('[data-testid="open-changes"]').click();
  await owner.locator(`[data-testid="project-history-preview-${created.revision}"]`).click({ timeout: 30000 });
  await owner.locator('[data-testid="history-preview-version"]').waitFor();
  await owner.locator('[data-testid="history-preview-version"]').selectOption(`r${created.revision}`);
  const saved = owner.frameLocator('iframe[title="Saved version"]');
  const current = owner.frameLocator('iframe[title="Your version (now)"]');
  await saved.locator('img[alt="Old media"]').waitFor({ timeout: 30000 });
  await current.locator('img[alt="New media"]').waitFor({ timeout: 30000 });
  await owner.waitForTimeout(500);
  result.preview = {
    oldImageDecoded: await decoded(saved, 'Old media'),
    currentImageDecoded: await decoded(current, 'New media'),
  };
  await owner.screenshot({ path: join(out, 'owner-preview.png') });
  // Peer activity while the preview is open.
  const peer = await accept('b', [
    { op: 'lane.replace', doc, lane: 'html', base: sha(newSrc), content: newSrc.replace('New media</h1>', 'New media, peer note</h1>') },
  ]);
  result.revisions.peer = peer.revision;
  owner.once('dialog', (d) => d.accept());
  await owner.locator('[data-testid="history-preview-restore"]').click();
  await owner.locator('[data-testid="history-preview-restore"]').waitFor({ state: 'detached', timeout: 30000 });
  await live(teammate).locator('img[alt="Old media"]').waitFor({ timeout: 60000 });
  result.teammateRendersRestored = await decoded(live(teammate), 'Old media');
  await teammate.screenshot({ path: join(out, 'teammate-after-restore.png') });
  await owner.screenshot({ path: join(out, 'owner-after-restore.png') });
} finally {
  await browser.close();
}
const check = async () => {
  const d = await B.doc(doc, 'owner');
  const history = (await B.history('owner', 40)).filter((h) => h.effects?.some((e) => e.doc === doc));
  const past = {};
  for (const [rev, src] of [
    [result.revisions.created, oldSrc],
    [result.revisions.replaced, newSrc],
  ]) {
    const lane = await B.api('owner', `lane?doc=${doc}&lane=html&rev=${rev}`);
    past[rev] = lane.status === 200 && lane.body.body === src && lane.body.hash === sha(src);
  }
  const assets = {};
  for (const img of images) {
    const r = await fetch(`${fx.url}/assets/${img.key}`, { headers: { authorization: `Bearer ${B.tokens.owner.token}` } });
    assets[img.key] = r.status === 200 && sha(Buffer.from(await r.arrayBuffer())) === img.sha256;
  }
  return {
    currentIsOldSource: d.source === oldSrc,
    head: d.revision,
    newest: { revision: history[0]?.revision, kind: history[0]?.kind, actor: history[0]?.actor },
    peerRevisionKeptInHistory: history.some((h) => h.revision === result.revisions.peer),
    historicalLanesReadable: past,
    assetsReadable: assets,
  };
};
result.after = await check();
if (arg('restart')) {
  execSync(arg('restart'), { stdio: 'ignore' });
  B = await loadBackend('selfhost', { work });
  result.afterRestart = await check();
}
const ok = (c) =>
  c.currentIsOldSource &&
  c.newest.kind === 'history.restore' &&
  // Known limitation, not asserted away: a workspace browser's actions are
  // committed through the cell's loopback credential (the surface matrix
  // records L18.history.undo-own-keeps-teammate as unsupported for the same
  // reason). Either the person or that credential — never someone else.
  [fx.users.owner.email, 'cell-loopback-sync'].includes(c.newest.actor) &&
  c.peerRevisionKeptInHistory &&
  Object.values(c.historicalLanesReadable).every(Boolean) &&
  Object.values(c.assetsReadable).every(Boolean);
result.attribution =
  result.after.newest.actor === fx.users.owner.email
    ? 'restoring person'
    : 'cell loopback credential (known limitation: workspace-browser actions are not attributed to the person)';
result.status =
  result.preview?.oldImageDecoded &&
  result.preview?.currentImageDecoded &&
  result.teammateRendersRestored &&
  ok(result.after) &&
  (!result.afterRestart || ok(result.afterRestart))
    ? 'pass'
    : 'fail';
writeFileSync(join(out, 's11-browser.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
process.exitCode = result.status === 'pass' ? 0 : 1;
