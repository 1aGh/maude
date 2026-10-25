import { base } from './fx.mjs';
export const fixture = base;
const D = '10-share-and-collaboration';
const dismiss = async (p) => { for (const b of await p.locator('[data-testid^="notice-"] button.maude-notice-close, [data-testid^="callout-"][data-testid$="-dismiss"]').all()) await b.click({ timeout: 800 }).catch(() => {}); };
export async function run(h) {
  const { sleep } = h;
  const ctx3 = await h.browser.newContext({ viewport: { width: 1440, height: 860 }, colorScheme: h.theme });
  await ctx3.addInitScript(`try{const s={'mdcc-theme':'${h.theme}','mdcc-usage-tour-seen':'1','mdcc-collab-tour-seen':'1','mdcc-whatsnew-seen':'99.0.0','maude-mode-hint-seen':'1'};for(const k in s)localStorage.setItem(k,s[k]);}catch(e){}`);
  const p3 = await ctx3.newPage();
  await p3.route('**/_config', async (r) => {
    const res = await r.fetch();
    const j = await res.json();
    await r.fulfill({ response: res, json: { ...j, readOnly: true, canComment: true, cloud: { dashboardUrl: 'https://app.maude.sh', projectName: 'Alligators brand', user: 'petra@gmail.com', role: 'observer' } } });
  });
  await p3.goto(h.url);
  await sleep(3500);
  await p3.locator('[data-testid="panel-fold-left"]').first().click().catch(() => {});
  await p3.locator('[data-testid="canvas-row-ui-print"]').first().click().catch(() => {});
  await sleep(2500);
  await dismiss(p3);
  await p3.route('**/_health', (r) => r.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ reason: 'access-withdrawn' }) }));
  await p3.evaluate(() => window.dispatchEvent(new Event('focus')));
  await sleep(2500);
  await dismiss(p3);
  await sleep(500);
  await p3.screenshot({ path: `${process.env.SHOTS_OUT}/co-access-ends-${h.theme}.png` });
  console.log('ROW co-access-ends', h.theme);
  await ctx3.close();
}
