// The ONE resolver for this machine's Maude Cloud account file (`cloud.json`).
//
// V2-3.4 (old T9) — an account profile is env: the desktop shell spawns a tab's server with
// `MAUDE_CLOUD_CONFIG` pointing into `~/.config/maude/profiles/<id>/`. Every reader and writer
// (cloud/endpoints.ts sign-in / sign-out / attach, cloud/renew.ts) resolves through here, per
// call, so a profile can never be half-applied — the bug a second private copy of this function
// would invite. The hubs.json twin is `hubsConfigPath()` in sync/hubs-config.ts.
//
// Unset ⇒ `~/.config/maude/cloud.json` (profile `default`). Deliberately NOT XDG-aware, unlike
// hubs.json: that is the location every existing install already has, and the shell names
// non-default profiles explicitly.

import { homedir } from 'node:os';
import { join } from 'node:path';

export function cloudConfigPath(): string {
  return process.env.MAUDE_CLOUD_CONFIG || join(homedir(), '.config', 'maude', 'cloud.json');
}

const normCloud = (s: string): string | null => {
  try {
    const u = new URL(s);
    return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`;
  } catch {
    return null;
  }
};

/**
 * The device token in a parsed `cloud.json` — but only for the control plane that issued it
 * (V2-3.10 W4). A file records the `url` it signed in against, and every reader sends its token
 * to the process-global `cloudUrl()`. With profiles, a token minted by one control plane must
 * never travel to whatever `MAUDE_CLOUD_URL` the app was launched with, so a file whose `url` is
 * not `base` (or that names none) reads as signed out.
 */
export function boundCloudToken(parsed: unknown, base: string): string | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const { url, token } = parsed as { url?: unknown; token?: unknown };
  if (typeof token !== 'string' || !token || typeof url !== 'string') return null;
  const want = normCloud(base);
  return want !== null && normCloud(url) === want ? token : null;
}
