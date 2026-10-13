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
