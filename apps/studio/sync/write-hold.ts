// The write hold — S11.17 (C37): "This Mac is out of space — changes wait here until there's room."
//
// When the disk refuses a canvas write (ENOSPC, `DiskFullError`), the bytes are not dropped: they wait
// here, in this studio's memory, one entry per file. The newest bytes for a file replace the older ones
// (they were made on top of them: the edit lane reads THROUGH the hold, see `read`). When room returns
// each held file lands ONCE:
//
//   · on the room probe's tick (`hasRoom`, a statfs on the file's folder, every `pollMs` while anything
//     is held — the probe stops when the hold is empty);
//   · on the next write that succeeds (room is back: everything held drains behind it);
//   · on Retry (`retry()`, `POST /_api/diagnostics/disk-retry`).
//
// Never twice and never out of order: every put / drain runs under ONE lock, a landed entry leaves the
// map before the next is tried, and a direct write that lands for a held file drops the older held bytes
// (they must never land after it). A second ENOSPC keeps the hold exactly as it was.
//
// Why memory and not a file: there is no room for a file. For a synced project the hold drains into the
// ordinary path (the write lands → the watcher / `source-written` proposes it → the outbox, V2-1.14),
// so the outbox stays the one durable queue; the hold only bridges the time the disk has no room.
// A crash while the disk is full loses what is held — nothing else could have kept it.

import { randomBytes } from 'node:crypto';
import { statfsSync } from 'node:fs';
import { rename, unlink } from 'node:fs/promises';
import path from 'node:path';

import { asDiskFull, isDiskFull } from './atomic-write.ts';

export type Bytes = string | Uint8Array;

export interface HoldStatus {
  /** something is held: the disk refused a write and it has not landed yet */
  full: boolean;
  /** how many files are waiting */
  held: number;
  /** when the oldest held write was refused (ms), null when nothing is held */
  since: number | null;
}

interface Held {
  /** idempotency key: a drain removes the entry only while it is still this one */
  id: string;
  key: string;
  bytes: Bytes;
  heldAt: number;
  onLanded?: () => void;
}

export interface WriteHoldOptions {
  /** The real write; throws a full-disk error (raw or typed) when there is no room. */
  write?: (key: string, bytes: Bytes) => Promise<void> | void;
  /** Is there room for `bytes` next to `key`? Default: statfs on its folder. */
  hasRoom?: (key: string, size: number) => boolean;
  now?: () => number;
  pollMs?: number;
  timers?: {
    set: (fn: () => void, ms: number) => unknown;
    clear: (handle: unknown) => void;
  };
  log?: (line: string) => void;
}

export interface WriteHold {
  /** Write, or hold when the disk is full. Throws any other error. */
  put(key: string, bytes: Bytes, o?: { onLanded?: () => void }): Promise<{ held: boolean }>;
  /** The held bytes for `key` (what the file WILL hold), undefined when nothing is held for it. */
  read(key: string): Bytes | undefined;
  /** Try every held write now, oldest first; stops at the first one the disk still refuses. */
  retry(): Promise<{ landed: number; held: number }>;
  status(): HoldStatus;
  subscribe(fn: (s: HoldStatus) => void): () => void;
  close(): void;
}

/** Room for `size` bytes plus a 1 MiB margin in `key`'s folder (statfs). Unknown → true: try it. */
export function hasRoomFor(key: string, size: number): boolean {
  try {
    const s = statfsSync(path.dirname(key));
    return Number(s.bavail) * Number(s.bsize) > size + 1024 * 1024;
  } catch {
    return true;
  }
}

/** tmp + rename in the same folder, like the canvas writers; the tmp is removed when the write fails. */
export async function writeAtomically(key: string, bytes: Bytes): Promise<void> {
  const tmp = `${key}.tmp.${randomBytes(8).toString('hex')}`;
  try {
    await Bun.write(tmp, bytes);
    await rename(tmp, key);
  } catch (e) {
    await unlink(tmp).catch(() => {});
    throw asDiskFull(e, key);
  }
}

const sizeOf = (b: Bytes) => (typeof b === 'string' ? Buffer.byteLength(b) : b.byteLength);

export function createWriteHold(opts: WriteHoldOptions = {}): WriteHold {
  const write = opts.write ?? writeAtomically;
  const hasRoom = opts.hasRoom;
  const now = opts.now ?? Date.now;
  const pollMs = opts.pollMs ?? 5_000;
  const timers = opts.timers ?? {
    set: (fn: () => void, ms: number) => {
      const t = setInterval(fn, ms);
      (t as { unref?: () => void }).unref?.();
      return t;
    },
    clear: (h: unknown) => clearInterval(h as ReturnType<typeof setInterval>),
  };
  const held = new Map<string, Held>();
  const subs = new Set<(s: HoldStatus) => void>();
  let lock: Promise<unknown> = Promise.resolve();
  let poll: unknown = null;
  let lastFull = false;

  const status = (): HoldStatus => {
    let since: number | null = null;
    for (const h of held.values()) if (since === null || h.heldAt < since) since = h.heldAt;
    return { full: held.size > 0, held: held.size, since };
  };
  const changed = () => {
    const s = status();
    if (held.size && poll === null) poll = timers.set(() => tick(), pollMs);
    if (!held.size && poll !== null) {
      timers.clear(poll);
      poll = null;
    }
    if (s.full === lastFull) return; // subscribers hear the turns: full → room again
    lastFull = s.full;
    for (const fn of subs) {
      try {
        fn(s);
      } catch {
        /* a subscriber's error is its own */
      }
    }
  };
  const locked = <T>(run: () => Promise<T>): Promise<T> => {
    const next = lock.then(run, run);
    lock = next.catch(() => {});
    return next;
  };
  const landed = (h: Held) => {
    try {
      h.onLanded?.();
    } catch (e) {
      opts.log?.(`[maude] held write landed, its announcement failed: ${String(e)}`);
    }
  };

  /** Oldest first; a landed entry leaves before the next is tried; the first refusal stops the drain. */
  const drain = async (): Promise<number> => {
    let n = 0;
    const queue = [...held.values()].sort((a, b) => a.heldAt - b.heldAt);
    for (const h of queue) {
      if (held.get(h.key)?.id !== h.id) continue;
      try {
        await write(h.key, h.bytes);
      } catch (e) {
        if (!isDiskFull(e)) opts.log?.(`[maude] a held write is still waiting: ${String(e)}`);
        break; // still no room (or another refusal): every remaining hold stays as it is
      }
      held.delete(h.key);
      n++;
      landed(h);
    }
    return n;
  };

  const tick = () =>
    locked(async () => {
      if (!held.size) return;
      const first = [...held.values()].sort((a, b) => a.heldAt - b.heldAt)[0] as Held;
      if (hasRoom && !hasRoom(first.key, sizeOf(first.bytes))) return;
      await drain();
      changed();
    });

  return {
    put(key, bytes, o = {}) {
      return locked(async () => {
        try {
          await write(key, bytes);
        } catch (e) {
          if (!isDiskFull(e)) throw e;
          const prev = held.get(key);
          held.set(key, {
            id: prev?.id ?? `hold_${randomBytes(8).toString('hex')}`,
            key,
            bytes,
            heldAt: prev?.heldAt ?? now(),
            onLanded: o.onLanded ?? prev?.onLanded,
          });
          changed();
          return { held: true };
        }
        // Landed: these bytes are newer than anything held for this file, which must never land now.
        held.delete(key);
        if (held.size) await drain(); // room is back: the rest follows
        changed();
        return { held: false };
      });
    },
    read: (key) => held.get(key)?.bytes,
    retry: () =>
      locked(async () => {
        const n = held.size ? await drain() : 0;
        changed();
        return { landed: n, held: held.size };
      }),
    status,
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    close() {
      if (poll !== null) timers.clear(poll);
      poll = null;
      subs.clear();
    },
  };
}

let shared: WriteHold | null = null;

/** The studio's one hold (every canvas write lane in this process shares it). */
export function sourceHold(): WriteHold {
  shared ??= createWriteHold({ hasRoom: hasRoomFor, log: (l) => console.warn(l) });
  return shared;
}

/** Tests only: swap the process hold (null restores a fresh default on next use). */
export function setSourceHoldForTest(h: WriteHold | null): void {
  shared?.close();
  shared = h;
}
