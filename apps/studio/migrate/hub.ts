// The migrator's view of a linked hub — V2-1.12 §5.5. A hub that advertises
// `format-v2` on `/health` stores the project format and serves
// `POST /api/project-format`; one without it is refused before any write with
// "the team server needs an update" (the contract's answer for an older hub).
//
// The project's SAVE MODE (DDR-241) lives on the same hub, since v1.3.0:
// `GET/POST /api/projects/current/v1/mode` (`hub-integration.mjs`), owner
// (`admin`) only to switch. Update project also moves a legacy project to
// accepted revisions (Michal, decision
// `maude/v2-michal-update-project-switches-legacy-to-accepted`) — the engine
// reads the mode with `mode()` and switches with `setMode()`; this client
// never switches back (a reverse migration keeps accepted revisions).

export interface HubHealth {
  ok: true;
  /** `null` while the hub has not read its store yet */
  formatVersion: number | null;
  capabilities: string[];
  epoch?: number;
  /** the project coordinator's posture (`/health` → `coordinator`), when the hub runs one */
  coordinator?: { mode: string; durable: boolean; ready: boolean };
}

/** `GET …/v1/mode` — the store's own reading (`store-core.mjs` `state()`). */
export interface HubModeState {
  ok: true;
  mode: 'legacy' | 'transactions';
  epoch: number;
  /** T30: switched, and the import of the documents has not finished yet */
  importPending: boolean;
}

export type HubModeFailure = { ok: false; status: number; code?: string };

/** `POST …/v1/mode` — a dry run (preview, nothing persists) or the switch itself. */
export type HubSetModeResult =
  | {
      ok: true;
      dryRun: boolean;
      mode: string;
      epoch: number;
      /** dry run: what the hub says stops the switch (`browser-not-paired`) */
      blockers: string[];
      /** switch: the import is still running (`importPending` / `importResuming`) */
      importPending: boolean;
      /** the documents the import leaves out, as the hub lists them */
      skipped: number;
    }
  | HubModeFailure;

export interface HubFormatClient {
  health(): Promise<HubHealth | { ok: false }>;
  /** `POST /api/project-format` — owner bearer; the `setMode` barrier. */
  setFormat(
    formatVersion: 1 | 2,
    expectEpoch?: number
  ): Promise<{ ok: true; epoch: number } | { ok: false; status: number; code?: string }>;
  /** `GET /api/projects/current/v1/mode` — any member's bearer. */
  mode(): Promise<HubModeState | HubModeFailure>;
  /** `POST /api/projects/current/v1/mode` — owner bearer; `expectEpoch` is the
   *  epoch read AFTER any format flip (the flip advances it — 409 `epoch-stale`). */
  setMode(
    mode: 'transactions',
    expectEpoch: number,
    opts?: { dryRun?: boolean }
  ): Promise<HubSetModeResult>;
}

const MODE_PATH = '/api/projects/current/v1/mode';

const skippedCount = (imported: unknown): number => {
  const s = (imported as { skipped?: unknown } | null)?.skipped;
  return Array.isArray(s) ? s.length : 0;
};

export function createHubFormatClient(
  hub: { url: string; token: string },
  fetchImpl: typeof fetch = fetch
): HubFormatClient {
  const base = hub.url.replace(/\/+$/, '');
  return {
    async health() {
      try {
        const res = await fetchImpl(`${base}/health`, { signal: AbortSignal.timeout(10_000) });
        if (!res.ok) return { ok: false };
        const j = (await res.json()) as {
          formatVersion?: unknown;
          capabilities?: unknown;
          epoch?: unknown;
          coordinator?: { mode?: unknown; durable?: unknown; ready?: unknown } | null;
        };
        const c = j.coordinator;
        return {
          ok: true,
          formatVersion: typeof j.formatVersion === 'number' ? j.formatVersion : null,
          capabilities: Array.isArray(j.capabilities)
            ? j.capabilities.filter((c): c is string => typeof c === 'string')
            : [],
          ...(typeof j.epoch === 'number' ? { epoch: j.epoch } : {}),
          ...(c && typeof c === 'object'
            ? {
                coordinator: {
                  mode: typeof c.mode === 'string' ? c.mode : 'unknown',
                  durable: c.durable === true,
                  ready: c.ready === true,
                },
              }
            : {}),
        };
      } catch {
        return { ok: false };
      }
    },
    async mode() {
      try {
        const res = await fetchImpl(`${base}${MODE_PATH}`, {
          headers: { authorization: `Bearer ${hub.token}` },
          signal: AbortSignal.timeout(10_000),
        });
        const j = (await res.json().catch(() => null)) as {
          mode?: unknown;
          epoch?: unknown;
          importPending?: unknown;
          code?: unknown;
        } | null;
        if (
          res.status === 200 &&
          (j?.mode === 'legacy' || j?.mode === 'transactions') &&
          typeof j.epoch === 'number'
        )
          return { ok: true, mode: j.mode, epoch: j.epoch, importPending: j.importPending === true };
        return {
          ok: false,
          status: res.status,
          ...(typeof j?.code === 'string' ? { code: j.code } : {}),
        };
      } catch {
        return { ok: false, status: 0, code: 'unreachable' };
      }
    },
    async setMode(mode, expectEpoch, opts = {}) {
      const dryRun = opts.dryRun === true;
      try {
        const res = await fetchImpl(`${base}${MODE_PATH}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${hub.token}` },
          body: JSON.stringify({ mode, expectEpoch, ...(dryRun ? { dryRun: true } : {}) }),
          // The switch answers after it imported every document (T30) — a big project takes a
          // while. A timeout is not a refusal: the hub may finish, and the next run reads it.
          signal: AbortSignal.timeout(dryRun ? 30_000 : 180_000),
        });
        const j = (await res.json().catch(() => null)) as {
          mode?: unknown;
          epoch?: unknown;
          blockers?: unknown;
          importPending?: unknown;
          importResuming?: unknown;
          imported?: unknown;
          code?: unknown;
        } | null;
        if (res.status === 200 && j && typeof j.epoch === 'number') {
          return {
            ok: true,
            dryRun,
            mode: typeof j.mode === 'string' ? j.mode : 'unknown',
            epoch: j.epoch,
            blockers: Array.isArray(j.blockers)
              ? j.blockers.filter((b): b is string => typeof b === 'string')
              : [],
            importPending: j.importPending === true || j.importResuming === true,
            skipped: skippedCount(j.imported),
          };
        }
        return {
          ok: false,
          status: res.status,
          ...(typeof j?.code === 'string' ? { code: j.code } : {}),
        };
      } catch {
        return { ok: false, status: 0, code: 'unreachable' };
      }
    },
    async setFormat(formatVersion, expectEpoch) {
      try {
        const res = await fetchImpl(`${base}/api/project-format`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${hub.token}`,
            // this build is a format-2 writer (V2-1.12 §5.4 declaration)
            'x-maude-format': '2',
          },
          body: JSON.stringify({
            formatVersion,
            ...(expectEpoch !== undefined ? { expectEpoch } : {}),
          }),
          signal: AbortSignal.timeout(20_000),
        });
        const j = (await res.json().catch(() => null)) as {
          epoch?: unknown;
          code?: unknown;
        } | null;
        if (res.status === 200 && typeof j?.epoch === 'number') return { ok: true, epoch: j.epoch };
        return {
          ok: false,
          status: res.status,
          ...(typeof j?.code === 'string' ? { code: j.code } : {}),
        };
      } catch {
        return { ok: false, status: 0, code: 'unreachable' };
      }
    },
  };
}
