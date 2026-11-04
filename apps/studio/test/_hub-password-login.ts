// TEST-ONLY. The desktop studio has no team-server login of its own any more (issue #204: the
// hub's own sign-in page, or a pasted access token). Suites that need a stored hub credential for
// a FIXTURE hub (the Node serve-hub.mjs, started with `--users`) get one here by posting the
// fixture user's password straight at the fixture — never through app code, never shipped.

import { saveHubCredential } from '../sync/hub-link.ts';
import { normalizeUrl } from '../sync/hubs-config.ts';

/** Log in as a fixture user and store the minted peer token the way the app stores one
 *  (`HUBS_CONFIG_PATH`, or `hubsConfigPath`). Returns the token. */
export async function storeFixtureHubCredential(
  hubUrl: string,
  email: string,
  password: string,
  hubsConfigPath?: string
): Promise<string> {
  const norm = normalizeUrl(hubUrl);
  const res = await fetch(`${norm}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`fixture hub login failed: HTTP ${res.status}`);
  const body = (await res.json()) as {
    token?: string;
    expiresAt?: number;
    user?: { email?: string; role?: string };
  };
  if (!body.token) throw new Error('fixture hub login returned no token');
  saveHubCredential(
    norm,
    body.token,
    body.user?.role ?? 'member',
    body.expiresAt,
    hubsConfigPath,
    body.user?.email
  );
  return body.token;
}
