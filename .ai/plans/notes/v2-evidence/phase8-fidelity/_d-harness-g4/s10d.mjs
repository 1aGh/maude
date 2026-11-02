import { base } from './fx.mjs';
export const fixture = base;
const D = '10-share-and-collaboration';
// co-ask-edit with the view-only tip: FAKED /_config readOnly + observer, then a >8 px drag on the artboard body.
export async function run(h) {
  const { page, sleep } = h;
  await page.route('**/_config', async (r) => {
    const res = await r.fetch();
    const j = await res.json();
    await r.fulfill({ response: res, json: { ...j, readOnly: true, canComment: true, cloud: { dashboardUrl: 'https://app.maude.sh', projectName: 'Alligators brand', user: 'petra@gmail.com', role: 'observer' } } });
  });
  await page.reload();
  await sleep(3000);
  await h.open('ui-print', 2000);
  await h.click('panel-fold-left').catch(() => {});
  await sleep(600);
  await page.mouse.move(760, 400);
  await page.mouse.down();
  await page.mouse.move(790, 430, { steps: 6 });
  await sleep(150);
  await h.step('co-ask-edit-tip', D, 'FAKED /_config readOnly + observer; drag >8 px on the artboard (view-only tip)', async () => {});
  await page.mouse.up();
  await sleep(300);
  await h.step('co-ask-edit-rel', D, 'FAKED viewer; tip after the drag released', async () => {});
}
