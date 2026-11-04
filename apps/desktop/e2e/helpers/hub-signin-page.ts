import { request } from 'node:http';

import { browser } from '@wdio/globals';

/**
 * Issue #204 — the app owns no login method for a team server: Sign in asks Rust to open the hub's
 * OWN page in the system browser (`open_team_server_signin`), which an e2e cannot drive. These helpers
 * take the page URL the webview asked for and walk the browser's hops themselves.
 */

/** In the focused webview: answer `open_team_server_signin` by keeping the URL instead of a browser. */
export async function captureTeamServerSignIn(): Promise<void> {
  await browser.execute(() => {
    const core = (
      window as unknown as {
        __TAURI__: { core: { invoke: (cmd: string, args?: unknown) => Promise<unknown> } };
      }
    ).__TAURI__.core;
    const w = window as unknown as { __e2eHubSignInWrapped?: boolean; __e2eHubSignIn?: string };
    if (w.__e2eHubSignInWrapped) return;
    w.__e2eHubSignInWrapped = true;
    const real = core.invoke.bind(core);
    core.invoke = (cmd: string, args?: unknown) => {
      if (cmd === 'open_team_server_signin') {
        w.__e2eHubSignIn = (args as { url?: string } | undefined)?.url;
        return Promise.resolve();
      }
      return real(cmd, args);
    };
  });
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
 */
function navigate(href: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request(
      href,
      {
        method: 'GET',
        headers: {
          accept: 'text/html',
          'sec-fetch-mode': 'navigate',
          'sec-fetch-dest': 'document',
          'sec-fetch-site': 'cross-site',
        },
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode ?? 0));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

/**
 * What the system browser does on the hub's page, as requests: GET the page (it sets the signed
 * desktop-request cookie), POST its form with that cookie — the sign-in form, or with `inviteKey`
 * the invite form (`/join`) — then navigate the hand-off link back to the app's loopback return.
 */
export async function signInOnHubPage(
  pageUrl: string,
  email: string,
  password: string,
  inviteKey?: string
): Promise<void> {
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
  const back = await navigate(href);
  if (back !== 200) throw new Error(`the app's return answered ${back}`);
}
