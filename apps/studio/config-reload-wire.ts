// Config hot-reload wiring — `/design:setup-ds` (or a hand edit) rewrites
// `.design/config.json` mid-session; without a re-read the server keeps
// serving the boot snapshot and a newly added canvas group (`system`) never
// reaches /_index-data. On change: swap ctx.cfg in place (reloadConfig) and
// let the caller react (canvas-list refresh, `config-updated` to shells).
// RCA: .ai/logs/rca/issue-ds-scaffold-files-not-in-filetree-stale-config.md
//
// 2.0.5 (#205): a cell's studio child has no file watcher, so it never sees
// `fs:json`; the hub's journal heal announces a peer's write as `fs:any`
// only (sync/cell-file-events.ts). Listening on `fs:json` alone left a cell
// judging design-system boards with the config it booted with. Both events
// share ONE debounce, so a watcher's `fs:json` + `fs:any` pair (or a watcher
// event plus a heal event) for the same write reloads once.

import { type Context, reloadConfig } from './context.ts';

export const CONFIG_RELOAD_DEBOUNCE_MS = 150;

export interface ConfigReloadWire {
  /** Drop a pending reload and stop listening. */
  stop(): void;
}

function isConfigJson(rel: unknown): boolean {
  return typeof rel === 'string' && rel.replace(/\\/g, '/').replace(/^\/+/, '') === 'config.json';
}

export function wireConfigReload(
  ctx: Context,
  opts: { onReloaded?: () => void; debounceMs?: number } = {}
): ConfigReloadWire {
  const debounceMs = opts.debounceMs ?? CONFIG_RELOAD_DEBOUNCE_MS;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const onEvent = (rel: unknown) => {
    if (!isConfigJson(rel)) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (!reloadConfig(ctx)) return;
      opts.onReloaded?.();
    }, debounceMs);
  };
  const offJson = ctx.bus.on('fs:json', onEvent);
  const offAny = ctx.bus.on('fs:any', onEvent);
  return {
    stop() {
      if (timer) clearTimeout(timer);
      timer = null;
      offJson();
      offAny();
    },
  };
}
