// Errors and recovery — S11.17 (C37). A handler TABLE (V2-2.5): the lead mounts it in routes/index.ts.
//
//   GET  /_api/diagnostics/last-work   { lastWorkAt }  — the crash line's "Your work up to 14:05 is here.":
//        the time of this person's newest accepted action, read from the project's home (the local
//        kernel's store under `_state/`, or the linked hub's history). null when there is none.
//   GET  /_api/diagnostics/disk        { full, held, since } — the write hold (sync/write-hold.ts): the
//        status word says Not saved + "This Mac is out of space — …" while anything is held.
//   POST /_api/diagnostics/disk-retry  { landed, held, full } — Retry: try every held write now.
//   POST /_api/diagnostics/save-hold-flush { landed } — p8-a1-save-hold: the page that made saves held
//        behind an AI call is closing; they land now (ai/save-hold.ts `flushFiles`).
//
// MAIN ORIGIN ONLY (no canvas allowlist): the times are this person's, and Retry writes the project.
// A read-only session may read both GETs (its own window shows the same status); Retry writes canvas
// files and is refused read-only, like every other write.

import { type SaveHold, saveHold } from '../ai/save-hold.ts';
import { sourceHold, type WriteHold } from '../sync/write-hold.ts';
import type { RouteSpec } from './table.ts';

const json = (status: number, body: unknown) => Response.json(body, { status });

/** The one read the crash line needs from a project home (local kernel or hub runtime). */
export interface LastWorkRuntime {
  acceptedHistory?(q: {
    limit?: number;
    mine?: boolean;
  }): Promise<ReadonlyArray<{ committedAt?: number | null }> | null>;
}

export interface DiagnosticsRouteDeps {
  control: () => LastWorkRuntime | object | null | undefined;
  /** default: the studio's one hold */
  hold?: WriteHold;
  /** a hub that does not answer in time is "no time known", never a hung relaunch (default 2 s) */
  timeoutMs?: number;
  /** default: the studio's save hold (p8-a1-save-hold) */
  saveHold?: Pick<SaveHold, 'flushFiles'>;
}

/** This person's newest accepted action, in ms — null when the home has none or does not answer. */
export async function lastWorkAt(
  rt: LastWorkRuntime | null | undefined,
  timeoutMs = 2_000
): Promise<number | null> {
  if (!rt?.acceptedHistory) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const rows = await Promise.race([
      rt.acceptedHistory({ limit: 1, mine: true }),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
    const at = rows?.[0]?.committedAt;
    return typeof at === 'number' && Number.isFinite(at) && at > 0 ? at : null;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function createDiagnosticsRoutes(deps: DiagnosticsRouteDeps): RouteSpec[] {
  const hold = () => deps.hold ?? sourceHold();
  return [
    {
      method: 'GET',
      path: '/_api/diagnostics/last-work',
      origin: 'main',
      readOnly: 'allowed',
      handle: async () =>
        json(200, {
          lastWorkAt: await lastWorkAt(
            deps.control() as LastWorkRuntime | null | undefined,
            deps.timeoutMs
          ),
        }),
    },
    {
      method: 'GET',
      path: '/_api/diagnostics/disk',
      origin: 'main',
      readOnly: 'allowed',
      handle: () => json(200, hold().status()),
    },
    {
      method: 'POST',
      path: '/_api/diagnostics/disk-retry',
      origin: 'main',
      readOnly: 'refused',
      handle: async () => {
        const r = await hold().retry();
        return json(200, { ...r, full: r.held > 0 });
      },
    },
    {
      // p8-a1-save-hold — the page that made held saves is closing (`pagehide` beacon,
      // client/v2/shell/save-hold-notice.js): land them now, as the person's. Body `{ files }` (text/plain
      // JSON, design-root-relative); only files that ARE held move, anything else is ignored.
      method: 'POST',
      path: '/_api/diagnostics/save-hold-flush',
      origin: 'main',
      readOnly: 'refused',
      handle: async (req) => {
        let files: string[] = [];
        try {
          const b = JSON.parse((await req.text()).slice(0, 64 * 1024)) as { files?: unknown };
          if (Array.isArray(b.files))
            files = b.files.filter((f): f is string => typeof f === 'string').slice(0, 256);
        } catch {
          return json(400, { error: 'body is { files: string[] }' });
        }
        const landed = await (deps.saveHold ?? saveHold()).flushFiles(files);
        return json(200, { landed });
      },
    },
  ];
}
