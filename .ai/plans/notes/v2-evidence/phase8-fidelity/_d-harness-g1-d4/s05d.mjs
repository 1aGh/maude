import { g1 } from './fx3.mjs';
export const fixture = g1;
const D = '05';
let MODE = 'solo'; // 'arriving' | 'offline'
const PENDING = [
  'ui/2026/combine/Combine-kampan.tsx', 'ui/2026/combine/Combine-letak.tsx', 'ui/2026/combine/Combine-invite.tsx',
  'ui/2026/social/Story-01.tsx', 'ui/club-web/Homepage.tsx', 'ui/print/Dres-2027.tsx',
].map((path) => ({ path, name: path.split('/').pop().replace('.tsx', ''), state: MODE === 'offline' ? 'not-local' : 'arriving' }));
export async function setup(page) {
  await page.route('**/_api/sync/availability*', async (route) => {
    const url = new URL(route.request().url());
    const pend = PENDING.map((p) => ({ ...p, state: MODE === 'offline' ? 'not-local' : 'arriving' }));
    const body = MODE === 'solo'
      ? { v: 1, phase: 'solo', done: 11, total: 11, pending: [], project: 'Alligators brand' }
      : MODE === 'arriving'
        ? { v: 1, phase: 'arriving', done: 41, total: 93, pending: pend, project: 'Alligators brand' }
        : { v: 1, phase: 'offline', done: 11, total: 17, pending: pend, project: 'Alligators brand' };
    const want = url.searchParams.get('canvas');
    if (want && MODE !== 'solo') body.canvas = { path: want, state: MODE === 'offline' ? 'not-local' : 'arriving' };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}
export async function run(h) {
  const { page, sleep, ctx } = h;
  await h.open('ui-smoke', 2500);
  await h.click('panel-icon-left').catch(() => {});
  MODE = 'arriving';
  await page.reload();
  await sleep(3500);
  await h.step(`${D}/es-arriving`, 'The cloud copy has not arrived yet (availability intercepted: arriving, 41 of 93)', 'route-intercept GET /_api/sync/availability → phase arriving; the open canvas answers arriving', async () => {});
  MODE = 'offline';
  await page.reload().catch(() => {});
  await sleep(3500);
  await h.step(`${D}/es-offline-uncached`, 'Offline, canvas never downloaded (availability intercepted: offline / not-local)', 'route-intercept GET /_api/sync/availability → phase offline; the open canvas answers not-local', async () => {});
  await ctx.setOffline(false);
  MODE = 'solo';
}
