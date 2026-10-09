// The offline outbox — V2-1.14. One per project, under `_state/outbox/`.
//
// What the lead wires (V2-2.5 / S5 / S8 / S9 / S11):
//   const outbox = createOutbox({ designRoot, senders, gates, target, onChange });
//   outbox.store.load(); outbox.store.prune(); void outbox.drain.wake();   // boot
//   bus 'outbox:changed' ← onChange(seq); gate events → outbox.drain.wake()
//   routes: createOutboxRoutes({ outbox }) (apps/studio/routes/outbox.ts)
// Features enqueue in-process when their target is unreachable:
//   outbox.enqueue({ kind, actor, device, project, target, label, payload })
// — the content watermark is taken here, so no caller can forget it (O4).

import { contentPending, contentView, contentWatermark } from './content.ts';
import { createOutboxDrain, type DrainOptions } from './drain.ts';
import { createOutboxStore, type EnqueueInput, type EnqueueResult } from './store.ts';

export * from './content.ts';
export * from './drain.ts';
export * from './policy.ts';
export * from './store.ts';
export * from './types.ts';

export interface OutboxOptions
  extends Omit<DrainOptions, 'store' | 'contentPending'>,
    Partial<Pick<DrainOptions, 'contentPending'>> {
  designRoot: string;
  onChange?: (seq: number) => void;
  newId?: () => string;
}

export function createOutbox(opts: OutboxOptions) {
  const store = createOutboxStore({
    designRoot: opts.designRoot,
    ...(opts.now ? { now: opts.now } : {}),
    ...(opts.newId ? { newId: opts.newId } : {}),
    ...(opts.onChange ? { onChange: opts.onChange } : {}),
    ...(opts.log ? { log: opts.log } : {}),
  });
  const pending = opts.contentPending ?? (() => contentPending(opts.designRoot));
  const drain = createOutboxDrain({ ...opts, store, contentPending: pending });
  return {
    store,
    drain,
    /** Queue an intent (watermark taken now, unless given) and wake the drain. */
    enqueue(input: Omit<EnqueueInput, 'watermark'> & { watermark?: number | null }): EnqueueResult {
      const r = store.enqueue({
        ...input,
        watermark:
          input.watermark !== undefined ? input.watermark : contentWatermark(opts.designRoot),
      });
      if (r.ok) void drain.wake();
      return r;
    },
    content: (o?: Parameters<typeof contentView>[1]) => contentView(opts.designRoot, o),
  };
}

export type Outbox = ReturnType<typeof createOutbox>;
