// Round 11 (p8-r11-10): co-sync-offline + co-sync-back with the outbox's REAL projection.
//
// What is real: the comment (made through the product in Preview), and the project's `_state/outbox/` — written in
// the shape the transaction client keeps one entry per unsent change in (sync/transaction-client.ts), so
// `GET /_api/outbox` (outbox/content.ts) answers byDoc / comments from real files; the Canvases rows, the foot, the
// cluster word and the thread card's "Queued" are all derived from that one answer.
// What is faked (unchanged since round 7): the hub link (`/_sync-status` says linked) and the browser going offline.
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { base } from './fx.mjs';
export const fixture = base;
const D = '10-share-and-collaboration';

const fakeLinked = async (page) => {
  await page.route('**/_sync-status', (r) => r.fulfill({ json: { linked: true, state: 'online', flash: 'synced', lastSyncAt: Date.now() - 20000 } }));
  await page.route('**/_api/sync/conflicts', (r) => r.fulfill({ json: { conflicts: [] } }));
};

/** One outbox file per unsent change: `<createdAt>-<tx id>.json` (the proposal-chain entry). */
function writeOutbox(project, docs, commentsJson) {
  const dir = join(project, '.design/_state/outbox');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const t0 = Date.now() - 86400000;
  docs.forEach(([doc, lane], i) => {
    const id = `tx_r11${String(i).padStart(2, '0')}`;
    const at = t0 + i * 60000;
    const content = lane === 'comments' ? commentsJson : lane === 'html' ? '<x/>' : '[]';
    writeFileSync(
      join(dir, `${at}-${id}.json`),
      JSON.stringify({ transactionId: id, createdAt: at, bytes: content.length, label: `Edit ${doc}`, action: { kind: 'edit', label: `Edit ${doc}`, operations: [{ op: 'lane.replace', doc, lane, content, baseContent: '' }] } })
    );
  });
}

export async function run(h) {
  const { page, sleep, project, ctx } = h;
  await fakeLinked(page);
  await page.reload();
  await sleep(2500);
  await h.open('ui-print', 1500);
  // a comment, through the product (Preview › C › click › type › ⌘↵) — the thread that will wait offline
  await h.click('palette-mode-preview');
  await sleep(900);
  await page.keyboard.press('c');
  await sleep(500);
  await page.mouse.click(1010, 250);
  await sleep(900);
  await page.keyboard.type('Pruh na rukávu sjednotit s helmou.');
  await sleep(500);
  await page.keyboard.press('Meta+Enter');
  await sleep(1800);
  const cfile = join(project, '.design/_comments/ui-print.json');
  const commentsJson = readFileSync(cfile, 'utf8');
  const ids = JSON.parse(commentsJson).map((c) => c.id);
  console.log('COMMENT-IDS', JSON.stringify(ids));
  // the day offline: 14 unsent changes over five canvases (+ the comment) — what a Mac that lost its hub holds
  const docs = [
    ['ui-print', 'html'], ['ui-print', 'html'], ['ui-print', 'annotations'], ['ui-print', 'comments'],
    ['ui-smoke', 'html'], ['ui-smoke', 'annotations'], ['ui-smoke', 'annotations'],
    ['ui-cut', 'html'], ['ui-cut', 'html'], ['ui-cut', 'meta'],
    ['ui-export', 'html'], ['ui-export', 'annotations'],
    ['ui-video', 'html'], ['ui-video', 'meta'],
  ];
  writeOutbox(project, docs, commentsJson);
  await page.evaluate(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    d.setHours(18, 20, 0, 0);
    try { localStorage.setItem('maude-offline-since', String(d.getTime())); } catch (e) {}
  });
  await page.reload();
  await sleep(3500);
  await h.open('ui-print', 800);
  await h.click('panel-icon-left').catch(() => {});
  await sleep(600);
  await h.click('palette-mode-preview').catch(() => {});
  await sleep(900);
  await ctx.setOffline(true);
  await sleep(1500);
  // the pin's thread card: "Queued — sends when this Mac is online."
  const fr = page.frameLocator('[data-testid="canvas-frame"]');
  await fr.locator('.cm-pin').first().click({ timeout: 4000 }).catch(() => console.log('no pin'));
  await sleep(1200);
  console.log('QUEUED', await fr.locator('.cm-queued').count());
  await h.step('co-sync-offline', D, 'FAKED hub link + browser offline; REAL _state/outbox (14 changes, one a comment): "not sent" rows, the foot, the cluster word, the queued comment in its thread card', async () => {});
  // back online: nine of the fourteen have been accepted — the real files are gone, five are still on their way
  await ctx.setOffline(false);
  const dir = join(project, '.design/_state/outbox');
  const names = readdirSync(dir).sort();
  const keep = new Set(names.filter((n) => /r11(03|04|08|09|12)\.json$/.test(n)));
  for (const n of names) if (!keep.has(n)) rmSync(join(dir, n));
  await sleep(300);
  await h.esc(2);
  await sleep(9500); // the outbox is re-read every 8 s
  await h.step('co-sync-back', D, 'FAKED hub link; REAL _state/outbox with 5 of 14 left: "sending" rows, "Sending 14 changes · 9 sent", the toast', async () => {}, { notice: true });
}
