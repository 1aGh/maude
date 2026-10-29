// save-hold.ts — a person's save to a file a running interpreter call names is HELD, then lands as theirs
// (p8-a1-save-hold; Michal 2026-10-29, decision `maude/v2-michal-a1-hold-save-during-interpreter`, extends
// `maude/v2-p8-a1-claims-bytes-not-time`).
//
// After p8-a1-claims every AI write that can name its bytes claims them. A Bash call that cannot claim (S7:
// `python3`, `node -e`, `sed -i`, `bash -c`, a terminal-lane verb) opens a WINDOW over the canvases its command
// names (acp/index.ts `shellWindow`, the design hook's `POST /_api/agent/bash/window`). Inside it two things
// went wrong with a person's save to one of those canvases: the post-bash binding (routes/agent.ts
// `bindBashWrites`, by mtime) marked it Made by AI, and the interpreter — which read the file before the save —
// wrote its bytes over it. So the save is neither refused nor written while the window is open: it is HELD here.
//
//   · held — a person's canvas source write (`isPersonSave()`: a browser request on the main origin with no AI
//     write claim, `withSaveRequest`) to a file an open window names, or one that closed less than
//     SHELL_SETTLE_MS ago, waits in memory. The edit lanes read THROUGH the hold (`read`), so the next edit
//     builds on it: repeated saves collapse into the last bytes, which carry every edit (each lane write is a
//     full file computed from the held one), and land as ONE write — one person undo step.
//   · lands — when the window closes + SHELL_SETTLE_MS (the AI's last bytes settle first), at the cap
//     (SAVE_HOLD_CAP_MS from the first hold, with a warning: the AI may still be changing it), on `flushAll`
//     (shutdown, the tab or app closing) — never dropped. The bytes are rebased on what the disk holds then
//     (`mergeSource(base, held, disk)`): the AI's change and the person's both stay. When the two touch the
//     same text the person's bytes land as they are (the AI's change is still in its run and in history).
//   · as the person's — the landing says its bytes BEFORE they land (`source-writing`) and after
//     (`source-written`), like every studio write, so the local home records the person's `edit` and the hub
//     link proposes it at landing time; nothing was said while it was held, so it enters the outbox once.
//     `landedByPerson` lets the post-bash binding skip it.
//   · a window that never closes (a killed call whose PostToolUse never came) stops holding after
//     WINDOW_STALE_MS; a run's end closes its windows (`closeOwner`).
//
// The canvas-source writers call `holds(abs)` before their write and `hold(...)` instead of it
// (canvas-edit.ts `writeCanvasSource`, routes/edit.ts `writeSource`).

import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { SHELL_SETTLE_MS } from '../sync/action-stage.ts';
import { hashBytes } from '../sync/echo-guard.ts';
import { mergeSource } from '../sync/source-merge.ts';
import { sourceHold } from '../sync/write-hold.ts';
import { currentWriteClaim } from './write-claim.ts';

/** A hold lasts at most this long (or until the call ends, whichever comes first). */
export const SAVE_HOLD_CAP_MS = 10_000;
/** A window older than the Bash tool's own 10-minute ceiling belongs to a call that is gone. */
export const WINDOW_STALE_MS = 10 * 60_000;

/** CONTRACT §4 — the notice while a save is held, and the line when the cap lands it. */
export const HOLD_NOTICE = 'AI is changing this file… your change saves when it’s done';
export const CAP_WARNING = 'Your change is saved. AI may still be changing this file.';

// ── Who is saving ────────────────────────────────────────────────────────────────────────────────

type Saver = 'person' | 'tool';
const saver = new AsyncLocalStorage<Saver>();

/**
 * Run `fn` as request `req`'s saver. A person's save comes from the studio page: a browser always sends
 * `Origin` on a write. A `maude design` verb or curl from a terminal sends none, and must never be held — it
 * may be the very call whose window holds the file.
 */
export function withSaveRequest<T>(req: Request, fn: () => T): T {
  const write = req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS';
  return saver.run(write && req.headers.get('origin') ? 'person' : 'tool', fn);
}

/** Tests and server-side person writes: run `fn` as the person's save. */
export function asPersonSave<T>(fn: () => T): T {
  return saver.run('person', fn);
}

/** Is the current write a person's save (and not one an AI verb claimed for its run)? */
export function isPersonSave(): boolean {
  return saver.getStore() === 'person' && !currentWriteClaim();
}

// ── The hold ─────────────────────────────────────────────────────────────────────────────────────

export interface SaveHoldNotice {
  /** design-root-relative path of the held file */
  file: string;
  state: 'held' | 'landed';
  /** landed at the cap while the window was still open, or rebased with an overlap */
  warning?: 'cap' | 'overlap';
  text: string;
}

interface Window {
  files: Set<string>;
  openedAt: number;
  owner?: string;
  /**
   * Files this window already held to the cap: it holds them no more. A call that outlives the cap is
   * likely gone without a close (an interrupted turn sends none) — every later save must not wait 10 s.
   */
  spent?: Set<string>;
}

interface Pending {
  abs: string;
  bytes: string;
  /** what the disk held under the person's first held edit — the merge base at landing */
  base: string;
  heldAt: number;
  label?: string;
  /** a lane with its own writer (the layout lane: meta write + its proposal) — no source notes */
  landWith?: (bytes: string, base: string) => Promise<void>;
  timer?: unknown;
  landing?: Promise<void>;
}

export interface SaveHoldOptions {
  now?: () => number;
  settleMs?: number;
  capMs?: number;
  staleMs?: number;
  timers?: { set: (fn: () => void, ms: number) => unknown; clear: (h: unknown) => void };
  /** the real write (default: the studio's disk hold, S11.17) */
  write?: (abs: string, bytes: string) => Promise<unknown>;
  readDisk?: (abs: string) => string | null;
  log?: (line: string) => void;
}

export function createSaveHold(opts: SaveHoldOptions = {}) {
  const now = opts.now ?? Date.now;
  const settleMs = opts.settleMs ?? SHELL_SETTLE_MS;
  const capMs = opts.capMs ?? SAVE_HOLD_CAP_MS;
  const staleMs = opts.staleMs ?? WINDOW_STALE_MS;
  const timers = opts.timers ?? {
    set: (fn: () => void, ms: number) => {
      const t = setTimeout(fn, ms);
      (t as { unref?: () => void }).unref?.();
      return t;
    },
    clear: (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>),
  };
  const write = opts.write ?? ((abs: string, bytes: string) => sourceHold().put(abs, bytes));
  const readDisk =
    opts.readDisk ??
    ((abs: string) => {
      try {
        return readFileSync(abs, 'utf8');
      } catch {
        return null;
      }
    });
  const log = opts.log ?? ((l: string) => console.warn(l));

  const windows = new Map<string, Window>();
  /** abs → when the last window naming it closed */
  const closedAt = new Map<string, number>();
  const pending = new Map<string, Pending>();
  /** abs → hash of the bytes a held save landed (the post-bash binding skips them) */
  const landed = new Map<string, { hash: string; at: number }>();
  let bus: { emit: (ev: string, p: unknown) => void; designRoot: string } | null = null;

  const rel = (abs: string) =>
    bus ? path.relative(bus.designRoot, abs).split(path.sep).join('/') : path.basename(abs);
  const emit = (ev: string, p: unknown) => {
    try {
      bus?.emit(ev, p);
    } catch (e) {
      log(`[maude] save-hold: ${ev} listener failed: ${String(e)}`);
    }
  };
  const notice = (n: SaveHoldNotice) => emit('save-hold', n);

  const live = (w: Window) => now() - w.openedAt <= staleMs;
  /** A window over a canvas covers its layout lane too (as the run stage's window does): one key. */
  const keyOf = (abs: string) => abs.replace(/\.meta\.json$/i, '.tsx');
  /** Is a window open over `abs` right now (not stale)? */
  const openOver = (abs: string) =>
    [...windows.values()].some(
      (w) => live(w) && w.files.has(keyOf(abs)) && !w.spent?.has(keyOf(abs))
    );
  /** ms until `abs` is free, 0 when it is; Infinity while a window is open over it. */
  const blockedFor = (abs: string): number => {
    if (openOver(abs)) return Number.POSITIVE_INFINITY;
    const k = keyOf(abs);
    const at = closedAt.get(k);
    if (at === undefined) return 0;
    const left = at + settleMs - now();
    if (left <= 0) {
      closedAt.delete(k);
      return 0;
    }
    return left;
  };

  function schedule(p: Pending): void {
    if (p.timer !== undefined) timers.clear(p.timer);
    p.timer = undefined;
    if (p.landing) return;
    const free = blockedFor(p.abs);
    const cap = Math.max(0, p.heldAt + capMs - now());
    const wait = Math.min(free, cap);
    p.timer = timers.set(() => {
      p.timer = undefined;
      void land(p, blockedFor(p.abs) > 0 ? 'cap' : 'free');
    }, wait);
  }

  async function land(p: Pending, why: 'free' | 'cap' | 'flush'): Promise<void> {
    if (pending.get(p.abs) !== p) return;
    if (p.landing) return p.landing;
    if (p.timer !== undefined) timers.clear(p.timer);
    p.timer = undefined;
    if (why === 'cap') {
      const k = keyOf(p.abs);
      for (const w of windows.values()) if (w.files.has(k)) (w.spent ??= new Set()).add(k);
    }
    // Rebased synchronously, before any await: an edit read through the hold meanwhile sees what lands.
    const disk = readDisk(p.abs);
    let overlap = false;
    if (disk !== null && disk !== p.base) {
      const m = mergeSource(p.base, p.bytes, disk);
      if (m.ok) p.bytes = m.merged;
      else overlap = true;
    }
    const bytes = p.bytes;
    const base = disk ?? p.base;
    const r = rel(p.abs);
    const label = p.label;
    const own = p.landWith;
    p.landing = (async () => {
      if (!own)
        emit('source-writing', { rel: r, content: bytes, base, ...(label ? { label } : {}) });
      try {
        if (own) await own(bytes, base);
        else await write(p.abs, bytes);
      } catch (e) {
        if (!own) emit('source-write-failed', { rel: r, content: bytes });
        log(`[maude] a held save could not be written: ${String(e)}`);
        // keep it: the next close / flush tries again, it is never dropped
        p.landing = undefined;
        p.heldAt = now();
        schedule(p);
        return;
      }
      landed.set(p.abs, { hash: hashBytes(bytes), at: now() });
      if (!own)
        emit('source-written', { rel: r, content: bytes, base, ...(label ? { label } : {}) });
      p.landing = undefined;
      if (p.bytes !== bytes) {
        // edited again while it was landing: what landed is the new base, the rest waits its turn
        p.base = bytes;
        p.heldAt = now();
        if (blockedFor(p.abs) > 0) {
          schedule(p);
          return;
        }
        await land(p, why);
        return;
      }
      pending.delete(p.abs);
      const warning = why === 'cap' ? 'cap' : overlap ? 'overlap' : undefined;
      notice({
        file: r,
        state: 'landed',
        ...(warning ? { warning } : {}),
        text: warning ? CAP_WARNING : '',
      });
    })();
    return p.landing;
  }

  return {
    /** Wire the bus the landing announces on (api.ts `createApi`). */
    attach(b: { emit: (ev: string, p: unknown) => void; designRoot: string }): void {
      bus = b;
    },

    /**
     * Call `call` (a tool call id) opened / closed its window over `files` (absolute paths). `owner` names the
     * run it belongs to, so the run's end can close what its calls never did.
     */
    window(call: string, open: boolean, files: readonly string[], owner?: string): void {
      if (open) {
        const prev = windows.get(call);
        const set = new Set([...(prev?.files ?? []), ...files.map(keyOf)]);
        if (set.size)
          windows.set(call, {
            files: set,
            openedAt: prev?.openedAt ?? now(),
            ...(owner ? { owner } : {}),
          });
        return;
      }
      const w = windows.get(call);
      if (!w) return;
      windows.delete(call);
      const t = now();
      for (const f of w.files) closedAt.set(f, t);
      for (const p of pending.values()) if (w.files.has(keyOf(p.abs))) schedule(p);
    },

    /** Every window `owner` still has open closes (a run ended, a session went away). */
    closeOwner(owner: string): void {
      for (const [call, w] of [...windows]) if (w.owner === owner) this.window(call, false, []);
    },

    /** Should the current write to `abs` be held? (a person's save, while a window covers the file) */
    holds(abs: string): boolean {
      if (pending.has(abs)) return isPersonSave();
      return isPersonSave() && blockedFor(abs) > 0;
    },

    /**
     * Hold `bytes` for `abs`. `base` = the bytes the edit was made on (the disk, or what was held already);
     * `label` = the history line the landing says.
     */
    hold(
      abs: string,
      bytes: string,
      o: { base: string; label?: string; landWith?: (bytes: string, base: string) => Promise<void> }
    ): void {
      const prev = pending.get(abs);
      if (prev) {
        prev.bytes = bytes;
        if (o.label) prev.label = o.label;
        if (o.landWith) prev.landWith = o.landWith;
        if (!prev.landing) schedule(prev);
        return;
      }
      const p: Pending = {
        abs,
        bytes,
        base: o.base,
        heldAt: now(),
        ...(o.label ? { label: o.label } : {}),
        ...(o.landWith ? { landWith: o.landWith } : {}),
      };
      pending.set(abs, p);
      schedule(p);
      notice({ file: rel(abs), state: 'held', text: HOLD_NOTICE });
    },

    /**
     * The held bytes for `abs` (what the file WILL hold) — for the person's next edit only, so it builds on
     * the held one. Anyone else (an AI verb's route write) reads the disk: the landing rebases on it.
     */
    read(abs: string): string | undefined {
      return isPersonSave() ? pending.get(abs)?.bytes : undefined;
    },

    /** The held bytes for `abs`, whoever asks. */
    peek(abs: string): string | undefined {
      return pending.get(abs)?.bytes;
    },

    /**
     * The person's write to `abs` went straight through (an action the home records itself): it was made on
     * the held bytes, so they are in it — nothing is left to land.
     */
    drop(abs: string): void {
      const p = pending.get(abs);
      if (!p || p.landing || !isPersonSave()) return;
      if (p.timer !== undefined) timers.clear(p.timer);
      pending.delete(abs);
      notice({ file: rel(abs), state: 'landed', text: '' });
    },

    /** Land every held save now (shutdown, the tab or the app closing). Resolves to how many landed. */
    async flushAll(): Promise<number> {
      const all = [...pending.values()];
      await Promise.all(all.map((p) => land(p, 'flush')));
      return all.length - pending.size;
    },

    /** How many files have a held save (the shell's close confirm counts them as unsent). */
    size(): number {
      return pending.size;
    },

    /** The held files, design-root-relative. */
    files(): string[] {
      return [...pending.keys()].map(rel).sort();
    },

    /** Did a held person save land exactly `content` at `abs` within `withinMs`? (post-bash skips it) */
    landedByPerson(abs: string, content: string, withinMs = staleMs): boolean {
      const l = landed.get(abs);
      return !!l && now() - l.at <= withinMs && l.hash === hashBytes(content);
    },

    close(): void {
      for (const p of pending.values()) if (p.timer !== undefined) timers.clear(p.timer);
    },
  };
}

export type SaveHold = ReturnType<typeof createSaveHold>;

let shared: SaveHold | null = null;

/** The studio's one save hold. */
export function saveHold(): SaveHold {
  shared ??= createSaveHold();
  return shared;
}

/** Tests only: swap the process hold (null: a fresh default on next use). */
export function setSaveHoldForTest(h: SaveHold | null): void {
  shared?.close();
  shared = h;
}
