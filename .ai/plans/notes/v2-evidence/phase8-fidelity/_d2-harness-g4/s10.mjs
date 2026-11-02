import { base } from './fx.mjs';
export const fixture = base;
const D = '10-share-and-collaboration';

/** Route interception of the share API (the sheet "asks the project server through /_api/share/*"): a signed-in cloud
 *  project with a hub that holds roles-v2 + links + requests, four people and one pending invite. */
export const fakeShare = async (page, { caps = { invite: true, edit: true }, links = true, extra = {} } = {}) => {
  const people = [
    { id: 'p-me', name: 'Michal', email: 'michal@alligators.cz', role: 'owner', state: 'active' },
    { id: 'p-t', name: 'Tereza', email: 'tereza@alligators.cz', role: 'member', state: 'active' },
    { id: 'p-j', name: 'Jonas', email: 'jonas@alligators.cz', role: 'viewer', state: 'active' },
    { id: 'p-p', name: 'Petra', email: 'petra@gmail.com', role: 'observer', state: 'invited', expiresAt: Date.now() + 5 * 86400000 },
  ];
  const posture = {
    linked: true, reachable: true, hub: 'https://alligators.cloud.maude.sh',
    access: { authority: 'control-plane', roles: ['owner', 'member', 'viewer', 'observer'], scopes: ['project', 'canvas'], links, requests: true },
    you: { invite: caps.invite, email: 'michal@alligators.cz' },
    ...extra,
  };
  await page.route('**/_api/share/posture', (r) => r.fulfill({ json: posture }));
  await page.route('**/_api/share/me', (r) => r.fulfill({ json: { caps, email: 'michal@alligators.cz' } }));
  await page.route('**/_api/share/people**', (r) => r.fulfill({ json: { people } }));
};
export const fakeSync = async (page, { pending = 0, conflicts = [] } = {}) => {
  await page.route('**/_sync-status', (r) => r.fulfill({ json: { linked: true, state: 'online', flash: 'synced', lastSyncAt: Date.now() - 20000 } }));
  await page.route('**/_api/outbox', (r) => r.fulfill({ json: { content: { pending } } }));
  await page.route('**/_api/sync/conflicts', (r) => r.fulfill({ json: { conflicts } }));
};

export async function run(h) {
  const { page, sleep, ctx } = h;
  const closeLeft = async () => { await h.click('panel-fold-left').catch(() => {}); await sleep(500); };
  const comment = async (text, x = 760, y = 420) => {
    await h.click('palette-mode-preview');
    await sleep(900);
    await page.keyboard.press('c');
    await sleep(500);
    await page.mouse.click(x, y);
    await sleep(900);
    await page.keyboard.type(text);
    await sleep(500);
  };
  await h.open('ui-smoke', 1500);
  await closeLeft();
  // ── local project ──
  await h.step('co-local-cloud', D, 'LOCAL project (no cloud): share cluster › Share = the Move-to-cloud offer', async () => { await h.click('share-cluster-share'); });
  await h.esc(2);
  await h.step('co-presence', D, 'share cluster, top right (one face; no peers in the lane — cursors / AI tags / Follow menu not reachable)', async () => {});
  // ── comments (real) ──
  await h.step('co-comment-thread', D, 'Preview › C › click › type (+ Comments panel opened)', async () => {
    await comment('Korektura je hotová, @Te', 900, 520);
    await page.keyboard.press('Meta+Enter');
    await sleep(1500);
    await h.click('share-cluster-comments').catch(() => {});
  });
  await h.click('share-cluster-comments').catch(() => {});
  await h.esc(2);
  // ── video / print comments ──
  await h.open('ui-video', 3000);
  await h.step('co-comment-video', D, 'Preview, comment tool on the video artboard', async () => {
    await h.click('palette-mode-preview');
    await sleep(900);
    await page.keyboard.press('c');
    await sleep(400);
    await page.mouse.click(800, 420);
    await sleep(900);
  });
  await h.esc(3);
  await h.open('ui-print', 2000);
  await h.step('co-comment-print', D, 'Preview, comment tool on the print artboard', async () => {
    await h.click('palette-mode-preview').catch(() => {});
    await sleep(800);
    await page.keyboard.press('c');
    await sleep(400);
    await page.mouse.click(700, 420);
    await sleep(900);
  });
  await h.esc(3);
  // ── FAKED cloud share ──
  await fakeShare(page);
  await fakeSync(page, { pending: 0 });
  await page.reload();
  await sleep(2500);
  await h.open('ui-print', 1500);
  await closeLeft();
  await h.step('co-share-sheet', D, 'FAKED /_api/share/* (cloud, 4 people, 1 invite): share cluster › Share', async () => { await h.click('share-cluster-share'); });
  await h.step('co-share-roles', D, 'FAKED share API: a person’s role menu opened (Jonas)', async () => {
    await page.locator('[data-testid^="share-person-role-"]').nth(2).click().catch(() => {});
    await sleep(600);
  });
  await h.esc(1);
  await h.step('co-share-advanced', D, 'FAKED share API: Advanced fold open', async () => {
    await h.click('share-other-ways-toggle').catch(() => {});
  });
  await h.esc(2);
  // ── offline (fake linked + browser offline) ──
  await fakeSync(page, { pending: 14 });
  await h.open('ui-print', 800);
  await h.click('panel-icon-left').catch(() => {});
  await sleep(600);
  await ctx.setOffline(true);
  await sleep(2500);
  await h.step('co-sync-offline', D, 'FAKED linked project + browser offline + /_api/outbox pending=14: panel foot + cluster word', async () => {});
  await ctx.setOffline(false);
  await sleep(300);
  await h.step('co-sync-back', D, 'FAKED: back online with 14 waiting', async () => { await sleep(1200); }, { notice: true });
  // ── conflict ──
  await fakeSync(page, {
    pending: 0,
    conflicts: [{ slug: 'ui-print', id: 's1', file: 'ui/Print.tsx', type: 'sticky', mine: { text: 'Datum je moc malé' }, theirs: { author: { name: 'Jonas' }, text: 'Datum větší, 28 pt' } }],
  });
  await page.reload();
  await sleep(3000);
  await h.open('ui-print', 1500);
  await h.step('co-conflict', D, 'FAKED GET /_api/sync/conflicts row (sticky changed on two Macs)', async () => {
    await page.evaluate(() => window.dispatchEvent(new Event('maude:sync-conflicts-open')));
    await sleep(900);
  });
  // ── trashed while open: FAKED shared Trash listing says Tereza trashed the open canvas ──
  await fakeSync(page, { pending: 0, conflicts: [] });
  await page.evaluate(() => { try { localStorage.removeItem('maude-offline-since'); } catch (e) {} });
  await page.route('**/_api/trash', (r) => r.fulfill({ json: { ok: true, items: [{ id: 't1', kind: 'canvas', path: 'ui/Print.tsx', who: 'Tereza', at: Date.now() - 120000, mine: false, name: 'Print' }], canClear: false, seq: 1 } }));
  await page.reload();
  await sleep(3000);
  await h.open('ui-print', 1500);
  await h.step('co-trashed', D, 'FAKED GET /_api/trash lists the open canvas (Tereza trashed it while this tab was open)', async () => {});

  // ── a viewer (FAKED GET /_config: readOnly + cloud role) ──
  const fakeConfig = async (pg, patch) => {
    await pg.route('**/_config', async (r) => {
      const res = await r.fetch();
      const j = await res.json();
      await r.fulfill({ response: res, json: { ...j, ...patch } });
    });
  };
  await page.unroute('**/_api/trash').catch(() => {});
  await page.route('**/_api/trash', (r) => r.fulfill({ json: { ok: true, items: [], canClear: false, seq: 2 } }));
  await fakeConfig(page, { readOnly: true, canComment: true, cloud: { dashboardUrl: 'https://app.maude.sh', projectName: 'Alligators brand', user: 'petra@gmail.com', role: 'observer' } });
  await page.reload();
  await sleep(3000);
  await h.open('ui-print', 1500);
  await closeLeft();
  await h.step('co-ask-edit', D, 'FAKED GET /_config: readOnly + cloud.role=observer (Can view)', async () => {});
  await h.step('co-ask-edit-ask', D, 'FAKED viewer: Ask to edit pressed', async () => { await h.click('share-cluster-ask').catch(() => {}); });
  // a browser tab (no Tauri global) on the cloud link
  const ctx2 = await h.browser.newContext({ viewport: { width: 1440, height: 860 }, colorScheme: h.theme });
  await ctx2.addInitScript(`try{const s={'mdcc-theme':'${h.theme}','mdcc-usage-tour-seen':'1','mdcc-collab-tour-seen':'1','mdcc-whatsnew-seen':'99.0.0','maude-mode-hint-seen':'1'};for(const k in s)localStorage.setItem(k,s[k]);}catch(e){}`);
  const p2 = await ctx2.newPage();
  await fakeConfig(p2, { readOnly: true, canComment: true, cloud: { dashboardUrl: 'https://app.maude.sh', projectName: 'Alligators brand', user: 'vojta@alligators.cz', role: 'observer' } });
  await p2.goto(h.url);
  await sleep(3000);
  for (const b of await p2.locator('[data-testid^="notice-"] button.maude-notice-close, [data-testid^="callout-"][data-testid$="-dismiss"]').all()) await b.click({ timeout: 800 }).catch(() => {});
  const row = p2.locator('[data-testid="canvas-row-ui-print"]').first();
  if (await row.count()) await row.click().catch(() => {});
  await sleep(3500);
  await p2.locator('[data-testid="panel-fold-left"]').first().click().catch(() => {});
  await sleep(600);
  await h.step('co-browser-view', D, 'FAKED viewer in a plain browser tab (no Tauri global)', async () => {}, { });
  await p2.screenshot({ path: `${process.cwd()}/.scr/impl/${D}/co-browser-view-${h.theme}.png` });
  await ctx2.close();
  // ── access ended (plain browser tab: the cell door's 401 {reason: access-withdrawn} on the window's own /_health probe) ──
  const ctx3 = await h.browser.newContext({ viewport: { width: 1440, height: 860 }, colorScheme: h.theme });
  await ctx3.addInitScript(`try{const s={'mdcc-theme':'${h.theme}','mdcc-usage-tour-seen':'1','mdcc-collab-tour-seen':'1','mdcc-whatsnew-seen':'99.0.0','maude-mode-hint-seen':'1'};for(const k in s)localStorage.setItem(k,s[k]);}catch(e){}`);
  const p3 = await ctx3.newPage();
  await fakeConfig(p3, { readOnly: true, canComment: true, cloud: { dashboardUrl: 'https://app.maude.sh', projectName: 'Alligators brand', user: 'petra@gmail.com', role: 'observer' } });
  await p3.goto(h.url);
  await sleep(3000);
  await p3.locator('[data-testid="canvas-row-ui-print"]').first().click().catch(() => {});
  await sleep(2500);
  await p3.route('**/_health', (r) => r.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ reason: 'access-withdrawn' }) }));
  await p3.evaluate(() => window.dispatchEvent(new Event('focus')));
  await sleep(2500);
  await p3.screenshot({ path: `${process.cwd()}/.scr/impl/${D}/co-access-ends-${h.theme}.png` });
  console.log('ROW', JSON.stringify({ id: 'co-access-ends', theme: h.theme, how: 'FAKED browser tab: 401 {reason:access-withdrawn} on the /_health refusal probe' }));
  await ctx3.close();
}
