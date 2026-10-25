// editing/hold-rings.tsx — holds on the canvas (S2.18; artboards ed-edge-tereza, ed-edge-ai; Gate 0 A10).
//
//   a person's hold   her ring (her colour, offset off the object) + her name tag; her cursor is the
//                     cursors overlay's. You can still select it — the inspector goes view mode (the shell,
//                     client/v2/inspector/view-mode.jsx). ADVISORY: nothing refuses a write on it.
//   an AI hold        a dashed spark outline on the held object only + its tag ("AI is drawing the
//                     footer"); a click on it says "Footer is AI's until it's done · Stop in the AI chat".
//                     ENFORCED on the server (409 held-by-ai, routes/agent.ts) — this is only the face.
//
// This layer also publishes THIS person's hold (`holding`, use-collab.tsx `createHoldPublisher`) from the
// selection, the gestures on it, and the shell's `hold-intent` (an inspector field has focus / the app
// has focus), and reports the selection's holds to the shell (`hold-view`) for the inspector.
//
// A foreign hold frees 30 s after its last refresh, by THIS canvas's clock (`createHoldClock`): a peer
// that stops refreshing — or lies about time — holds nothing.

import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react';

import { acceptFromShell } from '../bridge/dgn-protocol.ts';
import { isReadOnlyCanvas } from '../read-only-mode.ts';
import {
  createHoldPublisher,
  type ForeignAwareness,
  HOLD_FREE_MS,
  type HoldingAwareness,
  type HoldPublisher,
  useCollab,
  useForeignAwareness,
} from '../use-collab.tsx';
import { type Selection, useSelectionSet } from '../use-selection-set.tsx';
import { crumbsForElement } from './selection.tsx';

// ── the receiver clock ─────────────────────────────────────────────────────────────────────────

export interface LiveHold {
  name: string;
  color?: string;
  holding: HoldingAwareness;
  /** when THIS canvas last saw the hold change (its own clock) */
  seenAt: number;
}

export interface HoldClock {
  /** every foreign peer, as `useForeignAwareness` gives them (already sanitized) */
  observe(peers: readonly ForeignAwareness[]): void;
  /** the holds still live by this canvas's clock */
  live(): Map<number, LiveHold>;
  /** when the next live hold frees (ms epoch), or null */
  nextExpiry(): number | null;
}

const holdKey = (h: HoldingAwareness) => `${h.artboard}|${h.element}|${h.at}`;

/**
 * The receiver side of V2-1.15 §5.12: a hold counts from the moment it (or its `at`) last CHANGED here.
 * An awareness renewal re-sending the same state does not extend it, and the sender's own clock is
 * never read — so a hold nobody refreshes frees after 30 s, whatever the sender claims.
 */
export function createHoldClock(now: () => number = Date.now): HoldClock {
  const seen = new Map<number, LiveHold & { key: string }>();
  return {
    observe(peers) {
      const t = now();
      const here = new Set<number>();
      for (const p of peers) {
        if (!p.holding) continue;
        here.add(p.clientID);
        const key = holdKey(p.holding);
        const prev = seen.get(p.clientID);
        seen.set(p.clientID, {
          name: p.name,
          color: p.color,
          holding: p.holding,
          key,
          seenAt: prev && prev.key === key ? prev.seenAt : t,
        });
      }
      for (const id of [...seen.keys()]) if (!here.has(id)) seen.delete(id);
    },
    live() {
      const t = now();
      const out = new Map<number, LiveHold>();
      for (const [id, h] of seen)
        if (t - h.seenAt < HOLD_FREE_MS)
          out.set(id, { name: h.name, color: h.color, holding: h.holding, seenAt: h.seenAt });
      return out;
    },
    nextExpiry() {
      const t = now();
      let next: number | null = null;
      for (const h of seen.values()) {
        const at = h.seenAt + HOLD_FREE_MS;
        if (at > t && (next === null || at < next)) next = at;
      }
      return next;
    },
  };
}

// ── what the inspector gets (`hold-view`) ──────────────────────────────────────────────────────

/** One object a live AI run holds, as the shell relays it (`ai-holds`). */
export interface AiHoldRow {
  artboard: string;
  element: string;
  occurrence?: number;
  /** the canvas tag, e.g. "AI is drawing the footer" */
  tag: string;
  /** a run of this Mac's person: Stop is in their AI chat */
  mine: boolean;
  /** S2.19 — the object was ASKED about (⌘/ on a selection): `ai-scope-outline.tsx` draws those as one outline */
  scope?: boolean;
}

export interface HoldView {
  person: { name: string } | null;
  /** what the inspector calls the selection */
  label: string;
  ai: { label: string; held: boolean; mine: boolean } | null;
}

type Ref = { artboard: string; element: string };

/** The key an AI hold is drawn (and de-duplicated) under. */
export const aiHoldKey = (h: Pick<AiHoldRow, 'artboard' | 'element' | 'occurrence'>) =>
  `${h.artboard}|${h.element}|${h.occurrence ?? 0}`;

/**
 * 01 cf-ai-drafting: a run that writes a whole page holds the page, its heading, its text and its button at once, and
 * four tags piled on one corner hide the very words the AI is writing. Every held object keeps its dashed outline (the
 * hold is real, the server enforces it), but an artboard prints ONE tag: the first hold's.
 */
export function aiHoldTagCarriers(holds: readonly AiHoldRow[]): Set<string> {
  const byBoard = new Set<string>();
  const out = new Set<string>();
  for (const h of holds) {
    if (byBoard.has(h.artboard)) continue;
    byBoard.add(h.artboard);
    out.add(aiHoldKey(h));
  }
  return out;
}

/**
 * The selection's holds: a person holding it, and an AI run holding it (`held`) or another object in
 * its artboard. null = nothing to say.
 */
export function holdViewFor(
  sel: Ref | null,
  live: ReadonlyMap<number, Pick<LiveHold, 'name' | 'holding'>>,
  ai: readonly AiHoldRow[],
  labelOf: (ref: Ref) => string
): HoldView | null {
  if (!sel) return null;
  let person: HoldView['person'] = null;
  for (const h of live.values())
    if (h.holding.artboard === sel.artboard && h.holding.element === sel.element) {
      person = { name: h.name };
      break;
    }
  const on = ai.find((a) => a.artboard === sel.artboard && a.element === sel.element);
  const near = on ?? ai.find((a) => a.artboard === sel.artboard);
  if (!person && !near) return null;
  return {
    person,
    label: labelOf(sel),
    ai: near ? { label: labelOf(near), held: !!on, mine: near.mine } : null,
  };
}

/** The tip a click on an AI-held object shows (CONTRACT §3 words). */
export const aiHoldTip = (label: string, mine: boolean): string =>
  `${label} is AI's until it's done${mine ? ' · Stop in the AI chat' : ''}`;

// ── DOM ────────────────────────────────────────────────────────────────────────────────────────

function heldElement(doc: Document, ref: Ref, occurrence = 0): Element | null {
  try {
    const screen = doc.querySelector(`[data-dc-screen="${CSS.escape(ref.artboard)}"]`);
    const all = screen?.querySelectorAll(`[data-cd-id="${CSS.escape(ref.element)}"]`);
    return all?.[occurrence] ?? all?.[0] ?? null;
  } catch {
    return null;
  }
}

function labelIn(doc: Document, ref: Ref): string {
  const el = heldElement(doc, ref);
  const crumbs = el ? crumbsForElement(el) : [];
  return crumbs[crumbs.length - 1]?.label || ref.element;
}

function targetOf(sel: readonly Selection[]): Ref | null {
  if (sel.length !== 1) return null;
  const s = sel[0] as Selection;
  return s.id && s.artboardId ? { artboard: s.artboardId, element: s.id } : null;
}

const CSS_TEXT = `
.ed-holds { --ed-hold-spark: oklch(0.66 0.2 36); --ed-hold-spark-fg: oklch(0.99 0.004 36); }
@media (prefers-color-scheme: dark) { .ed-holds { --ed-hold-spark: oklch(0.7 0.185 38); --ed-hold-spark-fg: oklch(0.2 0.03 36); } }
.ed-hold-ring, .ed-ai-hold {
  position: fixed; pointer-events: none; z-index: 5; box-sizing: border-box; display: none;
}
.ed-hold-ring { border: 2px solid var(--ed-hold-c); border-radius: 6px; }
.ed-ai-hold { border: 1.5px dashed var(--ed-hold-spark); border-radius: 4px; }
.ed-hold-tag {
  position: absolute; left: -2px; bottom: calc(100% + 3px); display: inline-flex; align-items: center; gap: 4px;
  padding: 1px 6px; border-radius: 3px; white-space: nowrap; max-width: 260px; overflow: hidden;
  text-overflow: ellipsis; font: 600 11px/16px system-ui, -apple-system, sans-serif;
}
.ed-hold-ring .ed-hold-tag { background: var(--ed-hold-c); color: var(--maude-hud-accent-fg, #fff); }
.ed-ai-hold--quiet .ed-hold-tag { display: none; }
.ed-ai-hold .ed-hold-tag { background: var(--ed-hold-spark); color: var(--ed-hold-spark-fg); }
.ed-ai-tip {
  position: fixed; z-index: 7; pointer-events: none; padding: 4px 8px; border-radius: 6px;
  background: var(--maude-hud-accent, oklch(0.25 0.02 268)); color: var(--maude-hud-accent-fg, #fff);
  font: 500 12px/16px system-ui, -apple-system, sans-serif; white-space: nowrap;
  animation: ed-ai-tip-in var(--dur-fast, 120ms) ease-out;
}
@keyframes ed-ai-tip-in { from { opacity: 0; } to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .ed-ai-tip { animation-duration: 1ms; } }
`;

const RING_OFFSET = 4;
const TIP_MS = 2600;

function placeRing(div: HTMLElement, el: Element | null, offset: number): void {
  const r = el?.isConnected ? el.getBoundingClientRect() : null;
  if (!r || (r.width === 0 && r.height === 0)) {
    div.style.display = 'none';
    return;
  }
  div.style.display = 'block';
  div.style.left = `${Math.round(r.left - offset)}px`;
  div.style.top = `${Math.round(r.top - offset)}px`;
  div.style.width = `${Math.round(r.width + offset * 2)}px`;
  div.style.height = `${Math.round(r.height + offset * 2)}px`;
}

// ── the layer ──────────────────────────────────────────────────────────────────────────────────

/** Rings for other people's holds, outlines for AI's, and this person's own hold. */
export function HoldRings() {
  const collab = useCollab();
  const peers = useForeignAwareness();
  const { selected } = useSelectionSet();
  const target = targetOf(selected);
  const targetKey = target ? `${target.artboard}|${target.element}` : '';
  const [aiHolds, setAiHolds] = useState<AiHoldRow[]>([]);
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const [, bump] = useState(0);

  // ── this person's hold ──
  const pubRef = useRef<HoldPublisher | null>(null);
  const publishRef = useRef(collab?.publishAwareness);
  publishRef.current = collab?.publishAwareness;
  useEffect(() => {
    if (!collab || isReadOnlyCanvas()) return;
    const pub = createHoldPublisher({ publish: (holding) => publishRef.current?.({ holding }) });
    pubRef.current = pub;
    return () => {
      pub.dispose();
      pubRef.current = null;
    };
  }, [collab]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: targetKey is the selection's identity
  useEffect(() => {
    pubRef.current?.select(target);
  }, [targetKey, collab]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hosted = window.parent !== window;
    const onMessage = (e: MessageEvent) => {
      // every row this listener reads is parent-gated: only the shell speaks here
      if (e.source !== window.parent) return;
      const t = (e.data as { dgn?: unknown } | null)?.dgn;
      if (t === 'hold-intent' || t === 'ai-holds') {
        const m = acceptFromShell(e, window);
        if (m?.dgn === 'hold-intent') {
          pubRef.current?.field(m.field);
          pubRef.current?.app(m.app);
          if (m.gesture) pubRef.current?.gesture();
        } else if (m?.dgn === 'ai-holds') {
          // S5.19 — a spot the AI points at (`point`) is not a hold: no outline, no inspector line
          setAiHolds(m.holds.filter((h) => !h.point));
        }
        return;
      }
      // an inspector edit landing on the selection is an edit gesture on it
      if (t === 'apply-style' || t === 'edit-op-result' || t === 'apply-edit-result')
        pubRef.current?.gesture();
    };
    // hosted, the iframe blurs whenever the inspector takes focus — the shell's `hold-intent.app` is the
    // app's focus; standalone, this window is the app
    const onBlur = () => pubRef.current?.app(false);
    const onFocus = () => pubRef.current?.app(true);
    const onPointer = () => pubRef.current?.gesture();
    const onKey = (e: KeyboardEvent) => {
      if (!['Shift', 'Meta', 'Control', 'Alt'].includes(e.key)) pubRef.current?.gesture();
    };
    window.addEventListener('message', onMessage);
    if (!hosted) {
      window.addEventListener('blur', onBlur);
      window.addEventListener('focus', onFocus);
    }
    document.addEventListener('pointerdown', onPointer, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('message', onMessage);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('pointerdown', onPointer, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, []);

  // ── others' holds, by this canvas's clock ──
  const clock = useMemo(() => createHoldClock(), []);
  clock.observe(peers);
  const live = clock.live();
  const next = clock.nextExpiry();
  useEffect(() => {
    if (next === null) return;
    const id = setTimeout(() => bump((n) => n + 1), Math.max(0, next - Date.now()) + 5);
    return () => clearTimeout(id);
  }, [next]);

  // ── the selection's holds → the shell's inspector ──
  const view =
    typeof document === 'undefined'
      ? null
      : holdViewFor(target, live, aiHolds, (ref) => labelIn(document, ref));
  const viewKey = JSON.stringify(view);
  const sentView = useRef<string | null>(null);
  useEffect(() => {
    if (typeof window === 'undefined' || window.parent === window) return;
    if (sentView.current === viewKey) return;
    sentView.current = viewKey;
    const v = view ?? { person: null, label: '', ai: null };
    try {
      window.parent.postMessage(
        { dgn: 'hold-view', person: v.person, label: v.label, ai: v.ai },
        '*'
      );
    } catch {
      /* detached */
    }
  });

  // ── a click on an AI-held object: the tip ──
  const aiRef = useRef(aiHolds);
  aiRef.current = aiHolds;
  useEffect(() => {
    if (typeof document === 'undefined') return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onDown = (e: PointerEvent) => {
      const el = e.target instanceof Element ? e.target : null;
      const hit = el
        ? aiRef.current.find((h) => heldElement(document, h, h.occurrence)?.contains(el))
        : null;
      if (!hit) return;
      setTip({
        x: e.clientX + 12,
        y: e.clientY + 16,
        text: aiHoldTip(labelIn(document, hit), hit.mine),
      });
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setTip(null), TIP_MS);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      if (timer) clearTimeout(timer);
    };
  }, []);

  // ── follow the objects through pan / zoom / re-render ──
  const rootRef = useRef<HTMLDivElement | null>(null);
  const rings = [...live.entries()];
  // S2.19 — the objects a ⌘/ ask names are one outline (ai-scope-outline.tsx), not one ring each
  const aiRings = aiHolds.filter((h) => !h.scope);
  const tagged = aiHoldTagCarriers(aiRings);
  const drawn = rings.length + aiRings.length;
  useEffect(() => {
    if (!drawn || typeof document === 'undefined') return;
    let raf: number | null = null;
    const tick = () => {
      const root = rootRef.current;
      if (root)
        for (const div of Array.from(root.querySelectorAll<HTMLElement>('[data-hold]'))) {
          const ref = {
            artboard: div.dataset.artboard ?? '',
            element: div.dataset.element ?? '',
          };
          const occ = Number(div.dataset.occurrence ?? 0) || 0;
          placeRing(
            div,
            heldElement(document, ref, occ),
            div.dataset.hold === 'person' ? RING_OFFSET : 2
          );
        }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      if (raf != null) cancelAnimationFrame(raf);
    };
  }, [drawn]);

  if (!drawn && !tip) return null;
  return (
    <div ref={rootRef} className="ed-holds" aria-hidden="true">
      <style>{CSS_TEXT}</style>
      {rings.map(([clientID, h]) => (
        <div
          key={`p-${clientID}`}
          className="ed-hold-ring"
          data-testid="edit-hold-ring"
          data-hold="person"
          data-artboard={h.holding.artboard}
          data-element={h.holding.element}
          style={{ '--ed-hold-c': h.color } as CSSProperties}
        >
          <span className="ed-hold-tag">{h.name}</span>
        </div>
      ))}
      {aiRings.map((h) => (
        <div
          key={`ai-${h.artboard}-${h.element}-${h.occurrence ?? 0}`}
          className={`ed-ai-hold${tagged.has(aiHoldKey(h)) ? '' : ' ed-ai-hold--quiet'}`}
          data-testid="edit-ai-hold"
          data-hold="ai"
          data-artboard={h.artboard}
          data-element={h.element}
          data-occurrence={h.occurrence ?? 0}
        >
          <span className="ed-hold-tag">
            <svg width="11" height="11" viewBox="0 0 16 16" aria-hidden="true">
              <path
                d="M8 1.5l1.6 4.9 4.9 1.6-4.9 1.6L8 14.5l-1.6-4.9L1.5 8l4.9-1.6z"
                fill="currentColor"
              />
            </svg>
            {h.tag}
          </span>
        </div>
      ))}
      {tip ? (
        <div
          className="ed-ai-tip"
          data-testid="edit-ai-hold-tip"
          style={{ left: tip.x, top: tip.y }}
        >
          {tip.text}
        </div>
      ) : null}
    </div>
  );
}
