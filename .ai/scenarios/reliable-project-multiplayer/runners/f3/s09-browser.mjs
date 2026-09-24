#!/usr/bin/env node
// S09 on a deployed backend, through a real browser's pointer and keyboard:
// every PERSISTENT effect (comment, annotation, artboard layout, source edit)
// becomes an accepted action carrying its transaction; local camera and
// presence never do.
//
//   node s09-browser.mjs --work <selfhost dir> --out <dir>
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBackend } from './backend.mjs';

const REPO = fileURLToPath(new URL('../../../../../', import.meta.url));
const argv = process.argv.slice(2);
const arg = (n) => argv[argv.indexOf(`--${n}`) + 1];
const work = arg('work');
const out = arg('out');
mkdirSync(out, { recursive: true });
const fx = JSON.parse(readFileSync(join(work, 'fixture.json'), 'utf8'));
const sha = (s) => createHash('sha256').update(s).digest('hex');
const tag = randomBytes(3).toString('hex');
const name = `F3Effects${tag}`;
const doc = `ui-${name.toLowerCase()}`;
const src =
  `import { DesignCanvas, DCArtboard } from '@maude/canvas-lib';\n` +
  `export default function ${name}() {\n` +
  `  return <DesignCanvas>\n` +
  `    <DCArtboard id="main" label="Main" width={600} height={400}><h1>Effects ${tag}</h1><p>Body</p></DCArtboard>\n` +
  `  </DesignCanvas>;\n}\n`;
const B = await loadBackend('selfhost', { work });
const made = await B.propose('a', [{ op: 'doc.create', doc, path: `ui/${name}.tsx`, lanes: { html: src } }]);
assert.equal(made.status, 200);
const log = async () => {
  const all = [];
  let after = made.body.revision - 1;
  for (;;) {
    const page = (await B.api('owner', `revisions?after=${after}&limit=200`)).body.revisions ?? [];
    all.push(...page);
    if (page.length < 200) break;
    after = page.at(-1).revision;
  }
  return all;
};
const history = async () => (await B.history('owner', 60)).filter((h) => h.effects?.some((e) => e.doc === doc));
const settle = async (predicate, label, ms = 30000) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await predicate();
    if (v) return v;
    assert.ok(Date.now() < end, label);
    await new Promise((r) => setTimeout(r, 300));
  }
};

const { chromium } = createRequire(join(REPO, 'package.json'))('@playwright/test');
const browser = await chromium.launch();
const result = { doc, steps: {} };
try {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await page.goto(`${fx.browserUrl}/studio/signin`);
  await page.locator('input[name=email]').fill(fx.users.owner.email);
  await page.locator('input[name=password]').fill(fx.users.owner.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.locator(`[data-testid="canvas-row-ui-${name.toLowerCase()}"]`).click({ timeout: 60000 });
  const frame = page.frameLocator('[data-testid="canvas-frame"]');
  await frame.locator('h1').waitFor({ timeout: 60000 });
  const startLog = (await log()).length;

  // Camera + presence: pan, zoom and roam — nothing durable may result.
  const box = await page.locator('[data-testid="canvas-frame"]').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, i % 2 ? 240 : -240);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -300);
  await page.keyboard.up('Control');
  for (let i = 0; i < 20; i++) await page.mouse.move(box.x + 50 + i * 30, box.y + 80 + (i % 5) * 25);
  await page.waitForTimeout(5000);
  const afterCamera = await log();
  result.steps.cameraAndPresence = { newRevisions: afterCamera.length - startLog };

  // A persistent comment through the real comment tool.
  await frame.locator('[data-testid="palette-mode-edit"]').click().catch(() => {});
  await frame.locator('.dc-tool-palette button[aria-label^="Comment"]').click();
  await frame.locator('h1').click();
  await frame.locator('[aria-label="Comment body"]').fill(`S09 comment ${tag}`);
  await frame.locator('.cm-composer .cm-btn--primary').click();
  await settle(async () => (await history()).find((h) => h.effects.some((e) => e.lane === 'comments')), 'comment accepted');

  // A persistent annotation (sticky) through the real annotation tool.
  await page.keyboard.press('Escape');
  await frame.locator('[aria-label^="Sticky ("]').click();
  const input = frame.locator('.dc-annot-input');
  await input.waitFor();
  const ib = await input.boundingBox();
  await page.mouse.move(ib.x + ib.width * 0.3, ib.y + ib.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(ib.x + ib.width * 0.3 + 130, ib.y + ib.height * 0.3 + 100, { steps: 6 });
  await page.mouse.up();
  await settle(async () => (await history()).find((h) => h.effects.some((e) => e.lane === 'annotations')), 'annotation accepted');

  // A persistent artboard layout move.
  await page.keyboard.press('Escape');
  await frame.locator('[data-testid="palette-mode-edit"]').click().catch(() => {});
  const label = frame.locator('[data-dc-screen="main"] .dc-artboard-label');
  const lb = await label.boundingBox();
  await page.mouse.move(lb.x + lb.width / 2, lb.y + lb.height / 2);
  await page.mouse.down();
  await page.mouse.move(lb.x + lb.width / 2 + 160, lb.y + lb.height / 2 + 40, { steps: 8 });
  await page.mouse.up();
  await settle(async () => (await history()).find((h) => h.effects.some((e) => e.lane === 'meta')), 'layout accepted');
  await page.screenshot({ path: join(out, 's09-after-effects.png') });
} finally {
  await browser.close();
}

const revs = await log();
const hist = await history();
const lanesSeen = [...new Set(hist.flatMap((h) => h.effects.filter((e) => e.doc === doc).map((e) => e.lane)))];
const metaLane = (await B.bootstrap('owner')).docs.find((d) => d.doc === doc)?.lanes?.meta;
const meta = metaLane ? (await B.api('owner', `blobs/${metaLane.hash}`)).body.body : '';
result.revisions = revs.length;
result.everyRevisionHasTransaction = revs.every((r) => typeof (r.transactionId ?? r.tx) === 'string');
result.everyActionHasId = hist.every((h) => typeof h.actionId === 'string');
result.lanes = lanesSeen;
result.metaHasNoCamera = !/"viewport"|"camera"|"zoom"\s*:/.test(meta);
result.status =
  result.steps.cameraAndPresence.newRevisions === 0 &&
  result.everyRevisionHasTransaction &&
  result.everyActionHasId &&
  ['html', 'comments', 'annotations', 'meta'].every((l) => lanesSeen.includes(l)) &&
  result.metaHasNoCamera
    ? 'pass'
    : 'fail';
writeFileSync(join(out, 's09-browser.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
process.exitCode = result.status === 'pass' ? 0 : 1;
void sha;
