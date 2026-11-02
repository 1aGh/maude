// Outbox routes — V2-1.14 §5.10. A handler TABLE, not wired here: the lead
// registers it in the V2-2.5 route table (http.ts stays untouched by lanes).
//
// MAIN ORIGIN ONLY. None of these may appear in `CANVAS_SAFE_API` or in the
// `startCanvasServer` routes map: the record carries personal text (C27), and
// cancel/retry change what leaves this Mac.
//
// There is deliberately NO enqueue route (§4.9): each feature's own route
// decides "send now or queue" and calls `outbox.enqueue` in-process.

import type { Outbox } from '../outbox/index.ts';
import { ID_RE, toView } from '../outbox/index.ts';
import type { RouteSpec } from './table.ts';

export { matchRoute, type RouteSpec } from './table.ts';

const json = (status: number, body: unknown) => Response.json(body, { status });

export function createOutboxRoutes(deps: {
  outbox: Outbox;
  /** accepted-this-session count + the accepted comment ids, when synced */
  contentOpts?: () => Parameters<Outbox['content']>[0];
}): RouteSpec[] {
  const { outbox } = deps;
  const idOrError = (id: string | undefined): Response | null => {
    if (!id) return json(404, { error: 'not-found' });
    // A proposal id names the content lane: work is never cancelled (DDR-241).
    if (/^tx_/.test(id)) return json(403, { error: 'content-lane' });
    if (!ID_RE.test(id)) return json(404, { error: 'not-found' });
    return null;
  };
  return [
    {
      method: 'GET',
      path: '/_api/outbox',
      origin: 'main',
      readOnly: 'allowed',
      handle: () =>
        json(200, {
          seq: outbox.store.seq,
          content: outbox.content(deps.contentOpts?.()),
          intents: outbox.store.views(),
        }),
    },
    {
      method: 'GET',
      path: '/_api/outbox/:id',
      origin: 'main',
      readOnly: 'allowed',
      // The FULL record — for the surface that owns it (the chat, the Share
      // sheet, the Exports panel), never a list.
      handle: (_req, { id }) => {
        const bad = idOrError(id);
        if (bad) return bad;
        const r = outbox.store.get(id as string);
        return r ? json(200, r) : json(404, { error: 'not-found' });
      },
    },
    {
      method: 'POST',
      path: '/_api/outbox/:id/cancel',
      origin: 'main',
      readOnly: 'allowed',
      handle: (_req, { id }) => {
        const bad = idOrError(id);
        if (bad) return bad;
        const r = outbox.store.cancel(id as string);
        if (!r.ok) return json(r.code === 'not-found' ? 404 : 409, { error: r.code });
        return json(200, { state: 'dropped', outcome: 'cancelled', record: toView(r.record) });
      },
    },
    {
      method: 'POST',
      path: '/_api/outbox/:id/retry',
      origin: 'main',
      readOnly: 'refused',
      handle: (_req, { id }) => {
        const bad = idOrError(id);
        if (bad) return bad;
        const r = outbox.store.retry(id as string);
        if (!r.ok) return json(r.code === 'not-found' ? 404 : 409, { error: r.code });
        void outbox.drain.wake();
        return json(200, { record: toView(r.record) });
      },
    },
  ];
}
