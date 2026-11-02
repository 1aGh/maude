// S5.15 — every accepted action reaches the shell as `project:action` (V2-1.5 §5.3), not only the
// ones this studio made through a run or an undo route.
//
// The run registry's stage hooks announce a published run (with the artboards it touched) and the
// undo routes announce their own action. A PERSON's edit — yours through the canvas, or a teammate's
// arriving from the hub — was never announced, so nothing on the shell could clear "Made by AI" on
// the next person's edit (V2-1.5 decision 7), and the ⌘Z projection only heard its own gestures.
//
// The feed closes that: poked when a canvas changes on disk (`fs:any`) or the project's version lands
// on it (`sync:projected`), it reads the newest history rows, and announces each one nobody announced
// yet — with its artboards from the AST attribution (§5.7) over the store's before / after content.
// It never replays the log: the first read only sets where it starts.
//
// Read-only over the log; bounded per poke (ROWS); a failure is silent (the next poke reads again).

import { attributeArtboards } from '../attribute-artboards.ts';
import { projectActionEvent } from '../routes/project-undo.ts';
import type { AcceptedHistoryRow } from './index.ts';

const ROWS = 20;
const SEEN_MAX = 500;
/** Kinds that change no canvas content — announced without artboards. */
const NO_CONTENT = new Set(['comment', 'name', 'aside', 'migration.import']);

export interface ActionFeedRuntime {
  acceptedHistory?(q: { limit?: number }): Promise<unknown[] | null>;
  acceptedVersion?(repoRel: string, revision: number): Promise<string | null>;
}

export interface ActionFeedOptions {
  /** `ctx.syncControl.current()` — the hub link or the local home; null while none answers. */
  control: () => ActionFeedRuntime | null | undefined;
  /** `.design` — history rows name canvases design-root-relative; versions are read repo-relative. */
  designRel: string;
  emit: (event: string, payload: unknown) => void;
  /** ctx.bus.on — what others announced (a run's publish, an undo route) is not announced twice. */
  on?: (event: string, fn: (payload: unknown) => void) => () => void;
  debounceMs?: number;
  /** A second read this long after a poke: a proposal is accepted a beat after its disk write. */
  settleMs?: number;
  now?: () => number;
}

export function createActionFeed(o: ActionFeedOptions) {
  const debounceMs = o.debounceMs ?? 250;
  const settleMs = o.settleMs ?? 1500;
  /** The newest revision read so far; null = never read (the first read only sets it). */
  let last: number | null = null;
  const announced = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let later: ReturnType<typeof setTimeout> | null = null;
  let chain: Promise<void> = Promise.resolve();
  let stopped = false;
  const startedAt = (o.now ?? Date.now)();

  const remember = (id: unknown) => {
    if (typeof id !== 'string') return;
    announced.add(id);
    if (announced.size > SEEN_MAX) announced.delete(announced.values().next().value as string);
  };
  const off = o.on?.('project:action', (p) => remember((p as { actionId?: unknown })?.actionId));

  async function artboardsOf(
    rt: ActionFeedRuntime,
    row: AcceptedHistoryRow
  ): Promise<Record<string, string[]>> {
    const out: Record<string, string[]> = {};
    if (NO_CONTENT.has(row.kind) || !rt.acceptedVersion) return out;
    const prefix = o.designRel.replace(/^\/+|\/+$/g, '');
    for (const canvas of row.canvases ?? []) {
      if (!/\.tsx$/i.test(canvas)) continue;
      if (row.lanes?.[canvas] && !row.lanes[canvas].includes('html')) continue;
      const repoRel = prefix ? `${prefix}/${canvas}` : canvas;
      try {
        const [before, after] = await Promise.all([
          row.revision > 1 ? rt.acceptedVersion(repoRel, row.revision - 1) : Promise.resolve(''),
          rt.acceptedVersion(repoRel, row.revision),
        ]);
        const ids = attributeArtboards(canvas, before ?? '', after ?? '').artboards;
        if (ids.length) out[canvas] = ids;
      } catch {
        /* attribution is bookkeeping: the action is still announced */
      }
    }
    return out;
  }

  async function read(): Promise<void> {
    if (stopped) return;
    const rt = o.control();
    if (!rt?.acceptedHistory) return;
    const rows = (await rt.acceptedHistory({ limit: ROWS }).catch(() => null)) as
      | AcceptedHistoryRow[]
      | null;
    if (!Array.isArray(rows) || stopped) return;
    const newest = rows.reduce((m, r) => Math.max(m, r.revision), last ?? 0);
    // The first read sets where the feed starts: only what was accepted since it was created is news
    // (the home may answer only after the first change of this session).
    const isNew = (r: AcceptedHistoryRow) =>
      last === null ? (r.committedAt ?? 0) >= startedAt : r.revision > last;
    const fresh = rows
      .filter((r) => isNew(r) && !announced.has(r.actionId))
      .sort((a, b) => a.revision - b.revision);
    for (const r of rows) if (!isNew(r)) remember(r.actionId);
    last = newest;
    for (const row of fresh) {
      remember(row.actionId);
      o.emit('project:action', projectActionEvent(row, await artboardsOf(rt, row)));
    }
  }

  const queue = () => {
    chain = chain.then(read, read).catch(() => {});
    return chain;
  };

  return {
    /** Something changed: read the log a beat from now, and once more after it settles. */
    poke(): void {
      if (stopped) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void queue();
      }, debounceMs);
      (timer as { unref?: () => void }).unref?.();
      if (later) clearTimeout(later);
      later = setTimeout(() => {
        later = null;
        void queue();
      }, settleMs);
      (later as { unref?: () => void }).unref?.();
    },
    /** Read now (boot sets the start; tests drive it). */
    flush: () => queue(),
    stop(): void {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (later) clearTimeout(later);
      off?.();
    },
  };
}

export type ActionFeed = ReturnType<typeof createActionFeed>;
