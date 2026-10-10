// Preloaded by every `bun test` in apps/studio (bunfig.toml). V2-2.9 diagnostics and the V2-2.17
// project index persist to machine caches under ~/.maude; a test — or any server it spawns, which
// inherits process.env — must never write the person's real ones. One throwaway dir per test
// process unless the environment already names its own.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'maude-test-machine-'));
process.env.MAUDE_LOG_DIR ??= join(root, 'logs');
process.env.MAUDE_INDEX_DIR ??= join(root, 'index');
// …and the person's own config under ~/.config/maude (prefs.json, keys.json, hubs.json,
// cloud.json): a canvas or test that POSTs /_api/ui-prefs once rewrote the real prefs.json
// (2026-10-10). XDG_CONFIG_HOME covers every writer that follows the XDG rule; the prefs path is
// pinned too in case a test clears XDG for one server. HOME stays: browser caches live there.
process.env.XDG_CONFIG_HOME ??= join(root, 'config');
process.env.MAUDE_UI_PREFS_PATH ??= join(root, 'config', 'maude', 'prefs.json');
// cloud.json resolves under homedir() directly, not XDG (cloud/endpoints.ts, cloud/renew.ts).
process.env.MAUDE_CLOUD_CONFIG ??= join(root, 'config', 'maude', 'cloud.json');
