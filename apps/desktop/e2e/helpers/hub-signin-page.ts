import { request } from 'node:http';

import { browser } from '@wdio/globals';

/**
 * Issue #204 — the app owns no login method for a team server: Sign in asks Rust to open the hub's
 * OWN page in the system browser (`open_team_server_signin`), which an e2e cannot drive. These helpers
 * take the page URL the webview asked for and walk the browser's hops themselves.
 */

/**
 * In the focused webview: answer `open_team_server_signin` by keeping the URL instead of a browser.
 *
 * `window.__TAURI__.core` is an `Object.freeze`d module object (Tauri's bundle.global.js), so assigning
 * `core.invoke` was silently ignored: the REAL command ran and opened the hub's page in the person's
 * browser, and the spec saw no URL. The `__TAURI__` object itself is a plain one and every caller
 * (`home-api.js` `shellInvoke`, `github.js` `invoke`) reads `window.__TAURI__.core` at call time, so
 * the wrapper replaces `core` with an unfrozen copy. Throws if the wrap did not take.
 *
 * No arrow function as an object-literal property in the page function: the e2e loader (esbuild,
 * keepNames) wraps it in `__name(…)`, which the page does not define — the assignment then threw a
 * ReferenceError before it ran.
 */
export async function captureTeamServerSignIn(): Promise<void> {
  const wrapped = await browser.execute(function wrapInvoke() {
    type Invoke = (cmd: string, args?: unknown) => Promise<unknown>;
    const tauri = (window as unknown as { __TAURI__: { core: { invoke: Invoke } } }).__TAURI__;
    const w = window as unknown as { __e2eHubSignInWrapped?: boolean; __e2eHubSignIn?: string };
    if (!w.__e2eHubSignInWrapped) {
      const core = tauri.core;
      const real = core.invoke.bind(core);
      const copy = Object.assign({}, core);
      // biome-ignore lint/complexity/useArrowFunction: runs in the page; no loader helper (__name) may wrap it
      copy.invoke = function (cmd: string, args?: unknown) {
        if (cmd === 'open_team_server_signin') {
          w.__e2eHubSignIn = (args as { url?: string } | undefined)?.url;
          return Promise.resolve();
        }
        return real(cmd, args);
      };
      tauri.core = copy;
      w.__e2eHubSignInWrapped = tauri.core === copy;
    }
    return w.__e2eHubSignInWrapped ? 'wrapped' : 'not wrapped';
  });
  if (wrapped !== 'wrapped')
    throw new Error(`could not wrap __TAURI__.core.invoke in this webview (${String(wrapped)})`);
}

/** The page URL the webview last asked Rust to open (after `captureTeamServerSignIn`). */
export async function capturedSignInUrl(): Promise<string> {
  const url = (await browser.execute(
    () => (window as unknown as { __e2eHubSignIn?: string }).__e2eHubSignIn ?? null
  )) as string | null;
  if (!url) throw new Error('the webview asked for no team-server sign-in page');
  return url;
}

/**
 * A browser's top-level navigation to `href`, with its Fetch Metadata. Node's `fetch` overwrites
 * Sec-Fetch-Mode with `cors`; Home's return answers a navigation only, so this uses node:http.
 *
 * This IS the system browser's hop back to the app (2.1.1 T0/T7): a request from this process carries no app
 * session cookie and no `x-maude-api-key` — exactly what a browser the person signs in with holds. The headers it
 * sent come back with the answer, so a spec can assert that.
 */
export function browserReturn(
  href: string
): Promise<{ status: number; body: string; sent: Record<string, string> }> {
  const sent = {
    accept: 'text/html',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-dest': 'document',
    'sec-fetch-site': 'cross-site',
  };
  return new Promise((resolve, reject) => {
    const req = request(href, { method: 'GET', headers: sent }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c: string) => {
        body += c;
      });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body, sent }));
    });
    req.on('error', reject);
    req.end();
  });
}

/**
 * What the system browser does on the hub's page, up to the hand-off: GET the page (it sets the signed
 * desktop-request cookie), POST its form with that cookie — the sign-in form, or with `inviteKey` the invite
 * form (`/join`). Returns the "Go back to Maude" link (the app's loopback return), not yet followed.
 */
export async function handOffFromHubPage(
  pageUrl: string,
  email: string,
  password: string,
  inviteKey?: string
): Promise<string> {
  const page = await fetch(pageUrl, { headers: { accept: 'text/html' } });
  if (page.status !== 200) throw new Error(`the hub page answered ${page.status}`);
  const cookie = (page.headers.getSetCookie?.() ?? [])
    .map((c) => c.split(';')[0])
    .filter((c) => c.startsWith('maude_desktop_signin='))
    .join('; ');
  const origin = new URL(pageUrl).origin;
  const done = await fetch(`${origin}${inviteKey ? '/join' : '/studio/signin'}`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'text/html',
      origin,
      cookie,
    },
    body: new URLSearchParams(
      inviteKey ? { token: inviteKey, email, password } : { email, password }
    ),
  });
  const html = await done.text();
  const href = /<a href="([^"]+)">Go back to Maude<\/a>/.exec(html)?.[1]?.replaceAll('&amp;', '&');
  if (!href) throw new Error(`no hand-off back to the app (${done.status}): ${html.slice(0, 300)}`);
  return href;
}

/** The whole browser leg: the hub's page, its form, and the hop back to the app's loopback return. */
export async function signInOnHubPage(
  pageUrl: string,
  email: string,
  password: string,
  inviteKey?: string
): Promise<void> {
  const href = await handOffFromHubPage(pageUrl, email, password, inviteKey);
  const back = await browserReturn(href);
  if (back.status !== 200)
    throw new Error(`the app's return answered ${back.status}: ${back.body.slice(0, 200)}`);
}
