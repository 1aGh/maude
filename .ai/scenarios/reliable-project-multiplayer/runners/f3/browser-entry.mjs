// How a browser person reaches the studio on either F3 backend.
//
//   self-host — the hub's own /studio/signin form (email + password);
//   cloud     — the real control-plane path: a signed-in dashboard session
//               (agent-browser profile) → project → "Open in the browser",
//               whose handoff leaves the cell's studio + canvas cookies; those
//               are carried into this Playwright context.
//
// Cloud people: owner → maude-f3-owner, a → maude-f3-designer-b (the second
// designer with a browser profile; on a cloud cell every browser save goes
// through the cell's one credential anyway — rollout runbook).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const CLOUD_SESSION = { owner: 'maude-f3-owner', a: 'maude-f3-designer-b', b: 'maude-f3-designer-b' };
const CLOUD_PERSON = { 'maude-f3-owner': 'owner', 'maude-f3-designer-b': 'designer-b' };

function cloudCookies(fx, who) {
  const session = CLOUD_SESSION[who];
  const ab = (...a) => execFileSync('agent-browser', ['--session', session, ...a], { encoding: 'utf8', timeout: 90000 });
  // "Open in the browser" links to the cell's origin; the cell hands the
  // visitor through the control plane's sign-in and back with its cookies.
  const hosts = [new URL(fx.url).hostname, `canvas-${new URL(fx.url).hostname}`];
  let mine = [];
  // The handoff is a chain of redirects (and a restarted cell first forgets
  // the old cookie): poll for the studio cookie, reopening once or twice.
  for (let attempt = 0; attempt < 3 && !mine.some((c) => c.name === 'maude_studio'); attempt++) {
    ab('open', fx.url);
    ab('wait', '2500');
    // The dashboard session rotates when it is used outside this browser (the
    // runners' token minting presents it too): sign in again through the real
    // form when the handoff lands on it.
    if (/\/login(\b|$)/.test(ab('get', 'url')) && process.env.F3_CLOUD_CREDS) {
      const creds = JSON.parse(readFileSync(process.env.F3_CLOUD_CREDS, 'utf8'));
      const person = CLOUD_PERSON[session];
      ab('fill', '#email', creds[person].email);
      ab('fill', '#password', creds[person].password);
      ab('click', 'button[type=submit]');
      ab('wait', '2500');
      ab('open', fx.url);
    }
    for (let i = 0; i < 15; i++) {
      ab('wait', '1500');
      const all = JSON.parse(ab('cookies', 'get', '--json')).data.cookies;
      mine = all.filter((c) => hosts.includes(c.domain.replace(/^\./, '')));
      if (mine.some((c) => c.name === 'maude_studio') && mine.some((c) => c.name === 'maude_canvas')) break;
    }
  }
  if (!mine.some((c) => c.name === 'maude_studio')) throw new Error(`${session}: no studio cookie after the handoff`);
  return mine.map((c) => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path ?? '/',
    httpOnly: !!c.httpOnly,
    secure: c.secure !== false,
    sameSite: c.sameSite === 'Strict' ? 'Strict' : c.sameSite === 'None' ? 'None' : 'Lax',
    ...(Number.isFinite(c.expires) && c.expires > 0 ? { expires: c.expires } : {}),
  }));
}

/** A signed-in studio page for `who` ('owner' | 'a'). Optional `onSignInPage(page)`. */
export async function openStudio(browser, fx, who, { viewport = { width: 1440, height: 900 }, onSignInPage } = {}) {
  const context = await browser.newContext({ viewport });
  if (fx.backend === 'cloud') {
    await context.addCookies(cloudCookies(fx, who));
    const page = await context.newPage();
    await page.goto(`${fx.url}/`);
    return page;
  }
  const page = await context.newPage();
  const user = fx.users[who];
  await page.goto(`${fx.browserUrl ?? fx.url}/studio/signin`);
  if (onSignInPage) await onSignInPage(page);
  await page.locator('input[name=email]').fill(user.email);
  await page.locator('input[name=password]').fill(user.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  return page;
}
