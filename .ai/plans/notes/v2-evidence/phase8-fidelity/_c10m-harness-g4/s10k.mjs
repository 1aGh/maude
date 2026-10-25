import { base } from './fx.mjs';
import { fakeSync } from './s10.mjs';
export const fixture = base;
const D = '10-share-and-collaboration';

// round 7c: co-conflict (the card on the canvas, the Canvases panel folded as the board has it) and co-trashed (panel open: the ghost row)
export async function run(h) {
  const { page, sleep } = h;
  await fakeSync(page, {
    pending: 0,
    conflicts: [{ slug: 'ui-print', id: 's1', file: 'ui/Print.tsx', type: 'sticky', mine: { text: 'Datum je moc malé' }, theirs: { author: { name: 'Jonas' }, text: 'Datum větší, 28 pt' } }],
  });
  await page.reload();
  await sleep(3000);
  await h.open('ui-print', 1500);
  await h.click('panel-fold-left').catch(() => {});
  await sleep(700);
  await h.step('co-conflict', D, 'FAKED GET /_api/sync/conflicts row (sticky changed on two Macs), Canvases panel folded', async () => {
    await page.evaluate(() => window.dispatchEvent(new Event('maude:sync-conflicts-open')));
    await sleep(900);
  });
  await fakeSync(page, { pending: 0, conflicts: [] });
  await page.evaluate(() => { try { localStorage.removeItem('maude-offline-since'); } catch (e) {} });
  await page.route('**/_api/trash', (r) => r.fulfill({ json: { ok: true, items: [{ id: 't1', kind: 'canvas', path: 'ui/Print.tsx', who: 'Tereza', at: Date.now() - 120000, mine: false, name: 'Print' }], canClear: false, seq: 1 } }));
  await page.reload();
  await sleep(3000);
  await h.open('ui-print', 1500);
  await h.click('panel-icon-left').catch(() => {});
  await sleep(900);
  await h.step('co-trashed', D, 'FAKED GET /_api/trash lists the open canvas (Tereza trashed it while this tab was open)', async () => {});
}
