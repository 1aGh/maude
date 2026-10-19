// annotations/ui/vote-dots.tsx — S4.14: a formal vote on the canvas (canvas 15, artboard an-vote).
//
// While a vote is open each voted artboard wears a chip at its top-right: YOUR dots ("yours") and a
// "+" to place one more; a dot taken back is a click on it. Nobody else's dots show — the canvas never
// learns them. Once the vote has ended every artboard shows its count at once, the winner ringed.
//
// The canvas is untrusted (DDR-054) and holds no vote: it hears `vote-state {vote, mine}` from the
// shell — the projection client/v2/annotations/vote-store.js builds (targets, state, your own dots,
// counts once ended; never a name, never another person's picks) — and asks back:
//   vote-cast {artboard, remove?}        a dot on / off (the shell posts the ballot as the session)
//   vote-board {artboards, open?, focus?} the artboards' names + world rects (the sheet lists them, the
//                                        result section is placed under them); `open` = "Start a vote…"
// Self-contained: its own `message` listener and the canvas's own rect manifest (`__maudeCanvasRects`),
// so the layer mounts it with one element.

import { useEffect, useState } from 'react';
import { acceptFromShell } from '../../bridge/dgn-protocol.ts';

export interface VoteView {
  id: string;
  targets: string[];
  state: 'open' | 'ended';
  perVoter: number;
  tallies?: Record<string, number>;
}
type Rect = { id: string; x: number; y: number; w: number; h: number };

const AB_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const isCount = (n: unknown): n is number =>
  typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 && n <= 9999;

/** Read a `vote-state` message defensively (the shell built it; the parser is the second wall). */
export function readVoteState(
  m: unknown
): { vote: VoteView | null; mine: Record<string, number> } | null {
  if (!m || typeof m !== 'object' || (m as { dgn?: unknown }).dgn !== 'vote-state') return null;
  const raw = (m as { vote?: unknown }).vote;
  const mineRaw = (m as { mine?: unknown }).mine;
  if (raw === null) return { vote: null, mine: {} };
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as Record<string, unknown>;
  if (typeof v.id !== 'string' || !Array.isArray(v.targets)) return null;
  const targets = v.targets.filter((t): t is string => typeof t === 'string').slice(0, 32);
  const vote: VoteView = {
    id: v.id,
    targets,
    state: v.state === 'ended' ? 'ended' : 'open',
    perVoter: isCount(v.perVoter) ? v.perVoter : 3,
  };
  if (vote.state === 'ended' && v.tallies && typeof v.tallies === 'object') {
    const t: Record<string, number> = {};
    for (const k of targets) {
      const n = (v.tallies as Record<string, unknown>)[k];
      t[k] = isCount(n) ? n : 0;
    }
    vote.tallies = t;
  }
  const mine: Record<string, number> = {};
  if (vote.state === 'open' && mineRaw && typeof mineRaw === 'object')
    for (const k of targets) {
      const n = (mineRaw as Record<string, unknown>)[k];
      if (isCount(n) && n > 0) mine[k] = n;
    }
  return { vote, mine };
}

function artboardRects(): Rect[] {
  try {
    const w = window as unknown as { __maudeCanvasRects?: () => { artboards: Rect[] } };
    return w.__maudeCanvasRects?.().artboards ?? [];
  } catch {
    return [];
  }
}

function labelOf(id: string): string {
  const el = document.querySelector(`[data-dc-screen="${CSS.escape(id)}"]`);
  return el?.getAttribute('data-dc-label')?.replace(/\s+/g, ' ').trim().slice(0, 120) || id;
}

const post = (msg: Record<string, unknown>) => {
  try {
    window.parent?.postMessage(msg, '*');
  } catch {
    /* detached */
  }
};

/** `vote-board` — the artboards the shell may list / place under. `open` asks for the sheet. */
export function askVoteBoard(open = false, focus?: string | null): void {
  const artboards = artboardRects()
    .filter((r) => AB_RE.test(r.id))
    .slice(0, 200)
    .map((r) => ({ id: r.id, label: labelOf(r.id), x: r.x, y: r.y, w: r.w, h: r.h }));
  post({
    dgn: 'vote-board',
    artboards,
    ...(open ? { open: true } : {}),
    ...(focus && AB_RE.test(focus) ? { focus } : {}),
  });
}

export function castDot(artboard: string, remove = false): void {
  if (!AB_RE.test(artboard)) return;
  post(remove ? { dgn: 'vote-cast', artboard, remove: true } : { dgn: 'vote-cast', artboard });
}

/** The vote the canvas hears, plus "Start a vote…" from ⌘K (`run-action annotations.start-vote`). */
export function useVoteState(): { vote: VoteView | null; mine: Record<string, number> } {
  const [s, setS] = useState<{ vote: VoteView | null; mine: Record<string, number> }>({
    vote: null,
    mine: {},
  });
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window.parent) return;
      const d = e.data as { dgn?: unknown; v?: unknown; id?: unknown } | null;
      if (d?.dgn === 'run-action' && d.v === 1 && d.id === 'annotations.start-vote') {
        askVoteBoard(true);
        return;
      }
      // the table's parser first (it keeps only the projection's fields), then our own read
      const next = d?.dgn === 'vote-state' ? readVoteState(acceptFromShell(e, window)) : null;
      if (!next) return;
      setS(next);
      // the shell keeps names + rects fresh for the result section
      if (next.vote) askVoteBoard(false);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);
  return s;
}

/** What one artboard's chip shows. Pure (the layer test reads it). */
export function chipFor(
  vote: VoteView,
  mine: Record<string, number>,
  target: string
):
  | { kind: 'yours'; dots: number; canAdd: boolean }
  | { kind: 'count'; n: number; win: boolean }
  | null {
  if (!vote.targets.includes(target)) return null;
  if (vote.state === 'ended') {
    const t = vote.tallies ?? {};
    const n = t[target] ?? 0;
    const top = Math.max(0, ...Object.values(t));
    return { kind: 'count', n, win: n > 0 && n === top };
  }
  const used = Object.values(mine).reduce((a, b) => a + b, 0);
  return { kind: 'yours', dots: mine[target] ?? 0, canAdd: used < vote.perVoter };
}

/* Canvas 15 `.an-vdots` / `.an-vcount`, in the canvas's HUD tokens (the canvas has no studio CSS).
   Motion: none. Chips are chrome (`dc-annot-arrowui-live` is in the layer's CHROME_SELECTOR). */
const VOTE_CSS = `
.dc-annot-votes { position: absolute; left: 0; top: 0; width: 0; height: 0; overflow: visible; z-index: 7; pointer-events: none; }
.dc-vdots, .dc-vcount { display: inline-flex; align-items: center; gap: 2px; padding: 3px; border-radius: 999px; white-space: nowrap;
  background: var(--maude-hud-bg, #fff); color: var(--maude-hud-fg, #1a1a1a); box-shadow: 0 2px 8px rgb(0 0 0 / 0.16);
  font: 500 12px/1.3 var(--font-ui, system-ui, sans-serif); }
.dc-vdot { width: 18px; height: 18px; padding: 0; border: 0; border-radius: 50%; cursor: pointer; background: var(--maude-hud-accent, #d63b1f); }
.dc-vdots-n { padding: 0 6px 0 2px; }
.dc-vdot-add { width: 22px; height: 22px; padding: 0; border: 0; border-radius: 50%; cursor: pointer; font: inherit; font-weight: 600;
  color: var(--maude-hud-fg, #1a1a1a); background: color-mix(in oklab, var(--maude-hud-fg, #1a1a1a) 8%, transparent); }
.dc-vdot-add:disabled { opacity: 0.4; cursor: default; }
.dc-vdot:focus-visible, .dc-vdot-add:focus-visible { outline: 2px solid var(--maude-hud-accent, #d63b1f); outline-offset: 1px; }
.dc-vcount { min-width: 26px; justify-content: center; padding: 3px 10px; font-weight: 600; font-variant-numeric: tabular-nums; }
.dc-vcount--win { background: var(--maude-hud-accent, #d63b1f); color: var(--maude-hud-accent-fg, #fff); }
`;

/** World-space chips, inside the layer's world portal (`zoom` keeps them a constant screen size). */
export function VoteDots({ zoom }: { zoom: number }) {
  const { vote, mine } = useVoteState();
  const [rects, setRects] = useState<Rect[]>([]);
  useEffect(() => {
    if (!vote) return;
    setRects(artboardRects());
    const t = window.setInterval(() => setRects(artboardRects()), 1000);
    return () => window.clearInterval(t);
  }, [vote]);
  if (!vote) return null;
  const z = zoom > 0 ? zoom : 1;
  return (
    <div className="dc-annot-votes" data-testid="vote-dots">
      <style>{VOTE_CSS}</style>
      {rects.map((r) => {
        const target = `ab:${r.id}`;
        const chip = chipFor(vote, mine, target);
        if (!chip) return null;
        const style = {
          position: 'absolute' as const,
          left: r.x + r.w,
          top: r.y,
          transform: `translate(-100%, -120%) scale(${1 / z})`,
          transformOrigin: '100% 100%',
          pointerEvents: 'auto' as const,
        };
        if (chip.kind === 'count')
          return (
            <span
              key={r.id}
              className={`dc-vcount dc-annot-arrowui-live${chip.win ? ' dc-vcount--win' : ''}`}
              style={style}
              data-testid={`vote-count-${r.id}`}
            >
              {chip.n}
            </span>
          );
        return (
          <span
            key={r.id}
            className="dc-vdots dc-annot-arrowui-live"
            style={style}
            data-testid={`vote-dots-${r.id}`}
          >
            {Array.from({ length: chip.dots }, (_, i) => (
              <button
                // biome-ignore lint/suspicious/noArrayIndexKey: identical dots, position is the identity
                key={i}
                type="button"
                className="dc-vdot"
                aria-label="Take this vote back"
                onClick={(e) => {
                  e.stopPropagation();
                  castDot(r.id, true);
                }}
              />
            ))}
            {chip.dots > 0 && <span className="dc-vdots-n">yours</span>}
            <button
              type="button"
              className="dc-vdot-add"
              disabled={!chip.canAdd}
              aria-label={`Vote for ${labelOf(r.id)}`}
              data-testid={`vote-add-${r.id}`}
              onClick={(e) => {
                e.stopPropagation();
                castDot(r.id);
              }}
            >
              +
            </button>
          </span>
        );
      })}
    </div>
  );
}
