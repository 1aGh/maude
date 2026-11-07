// sync/adopt-held.ts — #167 T5.3 item 2: "Adopt as code" for one file the hub holds back.
//
// The hub holds a path as `never` when it was a canvas only because no canvas folders were declared and
// the declaration now makes it code (apps/hub file-manifest.mjs `hubCheckoutClass`). Implicit adoption by
// an owner write was rejected on purpose (decision v2-p8-holds-fix-no-implicit-owner-adoption), so the
// owner's way out is this explicit act: `POST <hub>/api/journal/adopt { path }`. The hub alone decides —
// its own owner gate (403 for anyone else), and it journals the bytes on ITS disk, never ours. This side
// only carries the person's answer and starts a pass so the file arrives at once.

import { isProjectFileShape } from './file-membership.ts';

export interface AdoptHeldDeps {
  hubUrl: string;
  token: () => string | null;
  fetchImpl?: typeof fetch;
  /** Start a pass now (the adopted file syncs without waiting for the next tick). */
  runPass: () => Promise<void> | void;
}

export type AdoptHeldAnswer =
  | { ok: true }
  | { ok: false; reason: 'bad-request' | 'not-owner' | 'not-held' | 'unreachable'; detail: string };

export interface AdoptHeldControl {
  adopt(path: string): Promise<AdoptHeldAnswer>;
}

/** CONTRACT §4 voice: what happened · what is safe · one verb. */
export const ADOPT_NOT_OWNER = 'Only the project owner can keep a held file as code.';
export const ADOPT_NOT_HELD = 'That file isn’t held any more. Nothing changed.';
export const ADOPT_UNREACHABLE =
  'The project’s hub didn’t answer. Nothing changed. Try again in a moment.';

export function createAdoptHeld(deps: AdoptHeldDeps): AdoptHeldControl {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const base = deps.hubUrl.replace(/\/+$/, '');
  return {
    async adopt(path) {
      if (typeof path !== 'string' || !isProjectFileShape(path)) {
        return { ok: false, reason: 'bad-request', detail: 'Name one held file.' };
      }
      let status = 0;
      try {
        const res = await fetchImpl(`${base}/api/journal/adopt`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${deps.token() ?? ''}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ path }),
        });
        status = res.status;
      } catch {
        return { ok: false, reason: 'unreachable', detail: ADOPT_UNREACHABLE };
      }
      if (status === 200) {
        void Promise.resolve(deps.runPass()).catch(() => {});
        return { ok: true };
      }
      if (status === 401 || status === 403) {
        return { ok: false, reason: 'not-owner', detail: ADOPT_NOT_OWNER };
      }
      if (status === 404) return { ok: false, reason: 'not-held', detail: ADOPT_NOT_HELD };
      return { ok: false, reason: 'unreachable', detail: ADOPT_UNREACHABLE };
    },
  };
}
