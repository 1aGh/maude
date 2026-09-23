// Independent receiving browser for a self-host scenario: the OWNER signs in
// through the hub's real /studio/signin form in Chromium, opens a canvas and
// reads what it renders; the accepted API is asked who made which action.
//   node peer-render.mjs --work <selfhost dir> --canvas ui/Name.tsx --expect "text" --out <dir>
import { fileURLToPath } from 'node:url';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { loadBackend, sha } from './backend.mjs';
const REPO = fileURLToPath(new URL('../../../../../', import.meta.url));

const argv = process.argv.slice(2);
const arg = (n) => argv[argv.indexOf(`--${n}`) + 1];
const work = arg('work');
const rel = arg('canvas');
const expected = arg('expect');
const out = arg('out');
mkdirSync(out, { recursive: true });
const fx = JSON.parse(readFileSync(join(work, 'fixture.json'), 'utf8'));
const B = await loadBackend('selfhost', { work });
const boot = await B.bootstrap('owner');
const d = boot.docs.find((x) => x.path === rel && !x.retired);
if (!d) throw new Error(`${rel} not accepted`);
const blob = await B.api('owner', `blobs/${d.lanes.html.hash}`);
const history = await B.history('owner', 30);
const mine = history.filter((h) => h.actor === fx.users.a.email);

const require = createRequire(join(REPO, 'package.json'));
const { chromium } = require('@playwright/test');
const browser = await chromium.launch();
const result = { canvas: rel, revision: boot.revision, epoch: boot.epoch };
try {
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  await page.goto(`${fx.browserUrl ?? fx.url}/studio/signin`);
  await page.locator('input[name=email]').fill(fx.users.owner.email);
  await page.locator('input[name=password]').fill(fx.users.owner.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const slug = rel.replace(/^ui\//, '').replace(/\.tsx$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const row = page.locator(`[data-testid="canvas-row-ui-${slug}"]`);
  await row.waitFor({ timeout: 60000 });
  await row.click();
  const frame = page.frameLocator('[data-testid="canvas-frame"]');
  try {
    await frame.getByText(expected, { exact: true }).first().waitFor({ timeout: 60000 });
  } catch (error) {
    await page.screenshot({ path: join(out, 'owner-browser-failure.png') });
    result.frameText = (await frame.locator('body').innerText().catch(() => null))?.slice(0, 800) ?? null;
    writeFileSync(join(out, 'peer-render.json'), JSON.stringify({ ...result, status: 'fail', error: String(error).slice(0, 300) }, null, 2));
    throw error;
  }
  result.ownerBrowserRendered = await frame.getByText(expected, { exact: true }).first().textContent();
  await page.screenshot({ path: join(out, 'owner-browser.png') });
} finally {
  await browser.close();
}
result.acceptedSourceHasEdit = blob.status === 200 && blob.body.body.includes(expected);
result.acceptedHash = d.lanes.html.hash;
result.acceptedHashVerified = blob.status === 200 && sha(blob.body.body) === d.lanes.html.hash;
result.designerActions = mine.map((h) => ({ revision: h.revision, label: h.label ?? h.action?.label ?? null }));
result.status =
  result.ownerBrowserRendered === expected && result.acceptedSourceHasEdit && mine.length > 0 ? 'pass' : 'fail';
writeFileSync(join(out, 'peer-render.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
process.exitCode = result.status === 'pass' ? 0 : 1;
