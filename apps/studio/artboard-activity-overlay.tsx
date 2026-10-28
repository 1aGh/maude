/**
 * @file       artboard-activity-overlay.tsx — Phase 13 / DDR-029 overlay.
 * @scope      apps/studio/artboard-activity-overlay.tsx
 * @purpose    The "agent works here" chrome for a single artboard: an animated
 *             rim + a top-right `AI’s new <artboard> — shown live` badge (04 md-edge-ai). Rendered by
 *             `DCArtboard` as a world-coord sibling of the `<article>`, so it
 *             pans/zooms with the artboard for free.
 *
 * Decorative — `aria-hidden` + `pointer-events:none`. All visual styling
 * (border, pulse keyframes, reduced-motion fallback) lives in the inspector
 * style block injected by `inspect.ts` (single injection point — DDR-029), so
 * this component only places the box and toggles `data-fading` for the 200 ms
 * cross-fade out when the file goes idle.
 *
 * S5.11 adds a second export to this module, `ArtboardRingsLayer`: the v2 ring + tag per artboard from the
 * run registry (see the block at the foot of the file). It does not touch `ArtboardActivityOverlay` above.
 */

import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react';

import { acceptFromShell } from './bridge/dgn-protocol.ts';

export interface OverlayRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function ArtboardActivityOverlay({
  rect,
  label,
  active,
  color,
}: {
  rect: OverlayRect;
  label: string;
  /** true = editing now (pulse, opacity 1); false = idle, cross-fading out. */
  active: boolean;
  /**
   * Per-agent presence color (Phase 13.2 / DDR-078). Overrides the default
   * `--mdcc-activity` hue so each agent's rim + badge carry its own color.
   * Omitted for manual / non-agent edits (default inspector blue).
   */
  color?: string;
}) {
  const style: CSSProperties = {
    position: 'absolute',
    left: rect.x,
    top: rect.y,
    width: rect.w,
    height: rect.h,
    pointerEvents: 'none',
    // The injected CSS reads `var(--mdcc-activity)`; setting it here recolors the
    // border, the ::after glow, and the badge background in one shot.
    ...(color ? ({ '--mdcc-activity': color } as CSSProperties) : {}),
  };
  return (
    <div
      className="dc-activity-rim"
      data-fading={active ? undefined : 'true'}
      aria-hidden
      style={style}
    >
      {/* Phase 13.3 — full-artboard scan beam (top→bottom sweep). Styled +
          animated by the injected inspector CSS; this just mounts the cover. */}
      <div className="dc-activity-scan" />
      <span className="dc-activity-badge">AI’s new {label} — shown live</span>
      {/* 04 md-edge-ai: the AI's own pointer — an arrow and a "+ AI" label — where the change is landing */}
      <span className="dc-activity-ptr">
        <svg width="14" height="16" viewBox="0 0 14 16" aria-hidden="true">
          <path
            d="M1 1l11 6.2-4.7 1.3L5.6 14z"
            fill="currentColor"
            stroke="var(--maude-hud-spark-fg, #1a1d24)"
            strokeWidth="1"
            strokeLinejoin="round"
          />
        </svg>
        <span className="dc-activity-ptr-l">+ AI</span>
      </span>
    </div>
  );
}
ArtboardActivityOverlay.displayName = 'ArtboardActivityOverlay';

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// S5.11 (03 AI Chat: ai-hero, ai-two-artboards, ai-tereza) — the ring and tag an AI wears on an artboard.
//
//   running    dashed spark outline + spark-led tag ("AI is working", "Tereza's AI") + "· N waiting"
//   needs-you  dashed azure outline + azure tag ("Waiting for you")
//   done       the "Made by AI" label mark only (01 cf-ai-done draws no ring on a finished artboard). A run that
//              JUST ended well also settles a solid spark ring once and sweeps Before / After across the
//              artboard (`data-fresh`, ~1.8 s), then lets go of the ring - 03 `ai-ring--done` is that moment.
//   drafting   the artboard that LANDS while a run of yours is live wears the dashed ring and reads
//              "AI is drawing <its name>" (01 cf-ai-drafting) until the next one lands or the run ends; the name
//              is the artboard's own, read here (the shell's tag stays the fixed "AI is working")
//   Reduced motion collapses every animation to 1 ms.
//
// Data flow, one direction only: the shell (client/v2/ai/ring-relay.js) posts `{ dgn: 'ai-runs', artboards }`
// into the iframe; the bridge parses it (bridge/dgn-protocol.ts `ai-runs`: parent-gated, capped, no
// `__proto__` key) and this layer draws it. The payload carries a state, a name and a count — never a prompt,
// a question or a progress line — so nothing the canvas (the untrusted side) could read back says what the
// person asked.
//
// Geometry: a `position: fixed` screen-coord layer like the hover halo. Each ring reads its artboard's
// `getBoundingClientRect()` on an animation frame, so pan and zoom need no maths here; the loop runs only
// while a ring exists. The mount is ONE line in the canvas shell's overlay list (next to
// `<ArtboardMarqueeOverlay />`); it is read-only decoration (pointer-events none), so a read-only canvas
// mounts it too.

export type AiRingState = 'running' | 'needs-you' | 'done';
export interface AiRing {
  state: AiRingState;
  /** 'you' for your AI, else the other person's actor id */
  who: string;
  tag: string;
  waiting: number;
}
export type AiRings = Record<string, AiRing>;

const RINGS_CSS = `
.dc-ai-rings {
  /* P8 C5 (C0 rule): the AI's rim and tags read ONLY the HUD tokens - spark for the AI, accent for "needs you" */
  --dc-ai-spark: var(--maude-hud-spark, oklch(0.66 0.2 36));
  --dc-ai-spark-fg: var(--maude-hud-spark-fg, oklch(0.2 0.03 36));
  --dc-ai-spark-text: var(--maude-hud-spark-text, oklch(0.5 0.17 36));
  --dc-ai-spark-muted: var(--maude-hud-spark-muted, oklch(0.66 0.2 36 / 0.12));
  --dc-ai-azure: var(--maude-hud-accent, oklch(0.53 0.175 238));
  --dc-ai-azure-fg: var(--maude-hud-accent-fg, oklch(0.99 0.004 238));
  --dc-ai-azure-muted: var(--maude-hud-accent-muted, oklch(0.53 0.175 238 / 0.12));
  --dc-ai-ink: var(--maude-chrome-bg-2, oklch(0.99 0.004 250));
  --dc-ai-dur: 320ms;
  --dc-ai-sweep: 1100ms;
  --dc-ai-ease: cubic-bezier(0.34, 1.4, 0.5, 1);
  position: fixed; inset: 0; z-index: 7; pointer-events: none;
}
.dc-ai-ring { position: fixed; display: none; border-radius: var(--maude-hud-radius-sm, 6px); box-sizing: border-box; pointer-events: none; }
.dc-ai-ring[data-state="running"] { border: 1.5px dashed var(--dc-ai-spark); }
.dc-ai-ring[data-state="needs-you"] { border: 1.5px dashed var(--dc-ai-azure); box-shadow: 0 0 0 4px var(--dc-ai-azure-muted); }
/* 03 ai-permission: several artboards waiting on one ask share ONE dashed box + ONE tag; each keeps a "will change" chip */
.dc-ai-ring[data-grouped] { border-color: transparent; box-shadow: none; }
.dc-ai-ring[data-grouped] .dc-ai-tag { display: none; }
.dc-ai-group {
  position: fixed; display: none; box-sizing: border-box; pointer-events: none; border-radius: var(--maude-hud-radius-sm, 6px);
  border: 1.5px dashed var(--dc-ai-azure); box-shadow: 0 0 0 4px var(--dc-ai-azure-muted);
}
.dc-ai-group .dc-ai-tag { top: calc(100% + 8px); background: var(--dc-ai-azure); color: var(--dc-ai-azure-fg); }
.dc-ai-will {
  position: absolute; right: 9px; bottom: 9px; padding: 0 8px; border-radius: 999px; white-space: nowrap;
  background: var(--maude-chrome-bg-2, #fff); color: var(--maude-chrome-fg-1, #333);
  font: 500 var(--maude-hud-type-xs, 11px)/18px var(--maude-chrome-font-body, system-ui, sans-serif);
  box-shadow: var(--maude-hud-shadow-md, 0 1px 3px rgb(0 0 0 / 0.2));
}
/* a settled "Made by AI" artboard wears the label mark only; the ring is the finish moment (data-fresh) */
.dc-ai-ring[data-state="done"][data-fresh] {
  border: 2px solid var(--dc-ai-spark); box-shadow: 0 0 0 4px var(--dc-ai-spark-muted);
  animation: dc-ai-settle var(--dc-ai-dur) var(--dc-ai-ease) 1 both;
}
@keyframes dc-ai-settle { from { scale: 1.03; opacity: 0.4; } to { scale: 1; opacity: 1; } }
.dc-ai-tag {
  position: absolute; right: -2px; display: inline-flex; align-items: center; gap: 4px; max-width: 320px;
  padding: 2px 8px 2px 4px; border-radius: 999px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  font: 600 var(--maude-hud-type-xs, 11px)/16px var(--maude-hud-font-rounded, ui-rounded, system-ui, sans-serif); letter-spacing: 0;
}
.dc-ai-ring[data-at="above"] .dc-ai-tag { bottom: calc(100% + 2px); }
.dc-ai-ring[data-at="below"] .dc-ai-tag { top: calc(100% + 8px); }
.dc-ai-ring[data-at="inside"] .dc-ai-tag { bottom: 8px; right: 8px; }
.dc-ai-ring[data-state="running"] .dc-ai-tag { background: var(--dc-ai-spark); color: var(--dc-ai-spark-fg); }
.dc-ai-ring[data-state="needs-you"] .dc-ai-tag { background: var(--dc-ai-azure); color: var(--dc-ai-azure-fg); }
/* The settled tag takes its placement from data-at: pinning bottom here as well as the below placement top
   stretched an absolute, overflow-hidden tag to a negative height — "Made by AI" vanished on a narrow artboard. */
.dc-ai-ring[data-state="done"] .dc-ai-tag { background: transparent; color: var(--dc-ai-spark-text); right: 0; padding: 0; font-weight: 500; }
.dc-ai-ring[data-state="done"][data-at="above"] .dc-ai-tag { bottom: calc(100% + 4px); }
.dc-ai-face {
  display: inline-grid; place-items: center; width: 14px; height: 14px; border-radius: 999px;
  background: var(--dc-ai-ink); color: var(--dc-ai-spark-fg); font: 600 9px/1 system-ui, sans-serif;
}
.dc-ai-glyph { flex: none; width: 10px; height: 10px; }
.dc-ai-ring[data-state="running"] .dc-ai-glyph { animation: dc-ai-pulse 1400ms ease-in-out infinite alternate; }
@keyframes dc-ai-pulse { from { opacity: 1; } to { opacity: 0.45; } }
.dc-ai-sweep {
  position: absolute; top: 0; bottom: 0; left: 0; width: 2px; margin-left: -1px; display: none;
  background: var(--dc-ai-spark); box-shadow: 0 0 0 1px var(--dc-ai-spark-muted);
}
.dc-ai-ring[data-state="done"][data-fresh] .dc-ai-sweep { display: block; animation: dc-ai-sweep var(--dc-ai-sweep) ease-in-out 1 both; }
/* 03 .ai-wipe-lab: the Before / After pills ride the sweep line - bg-2 pill, fg-0 semibold, shadow-sm */
.dc-ai-wipe-lab {
  position: absolute; top: 8px; display: none; padding: 1px 8px; border-radius: 999px; white-space: nowrap;
  background: var(--maude-chrome-bg-2, #fff); color: var(--maude-chrome-fg-0, #111);
  font: 600 var(--maude-hud-type-xs, 11px)/16px var(--maude-chrome-font-body, system-ui, sans-serif);
  box-shadow: var(--maude-hud-shadow-md, 0 1px 3px rgb(0 0 0 / 0.2));
}
.dc-ai-wipe-lab[data-side="before"] { right: calc(100% + 4px); }
.dc-ai-wipe-lab[data-side="after"] { left: calc(100% + 4px); }
.dc-ai-ring[data-state="done"][data-fresh] .dc-ai-wipe-lab { display: block; }
@keyframes dc-ai-sweep { from { left: 0; opacity: 1; } 85% { opacity: 1; } to { left: 100%; opacity: 0; } }
@media (prefers-reduced-motion: reduce) {
  .dc-ai-rings { --dc-ai-dur: 1ms; --dc-ai-sweep: 1ms; }
  .dc-ai-ring[data-state="running"] .dc-ai-glyph { animation-duration: 1ms; animation-iteration-count: 1; }
}
`.trim();

function ensureRingStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById('dc-ai-ring-css')) return;
  const s = document.createElement('style');
  s.id = 'dc-ai-ring-css';
  s.textContent = RINGS_CSS;
  document.head.appendChild(s);
}

/** The shell's fixed words for a run in progress (runs-model.js TAG_WORKING) - the one a drafted artboard renames. */
const TAG_WORKING_WORDS = 'AI is working';

/** The words on the tag: the fixed phrase from the shell, plus "· N waiting" when asks are in line. */
export function ringTagText(r: AiRing): string {
  if (r.state === 'done') return r.tag || 'Made by AI';
  return r.waiting > 0 ? `${r.tag} · ${r.waiting} waiting` : r.tag;
}

/** Above the artboard (beside its name) when it is wide enough to leave the name room, else below it. */
export function tagPlacement(
  widthPx: number,
  opts: { selected?: boolean; bottomPx?: number; viewportPx?: number } = {}
): 'above' | 'below' | 'inside' {
  // a selected artboard's own label grows by its size chip: "above" then needs room for name + size + tag
  const placed = widthPx >= (opts.selected ? 440 : 260) ? 'above' : 'below';
  // a tag below an artboard that ends in the dock's strip would sit under the toolbar: it moves inside, at the foot
  if (
    placed === 'below' &&
    opts.bottomPx !== undefined &&
    opts.viewportPx !== undefined &&
    opts.bottomPx + 40 > opts.viewportPx - DOCK_STRIP_PX
  )
    return 'inside';
  return placed;
}

/** The strip along the viewport's foot that the canvas toolbar / zoom controls cover. */
const DOCK_STRIP_PX = 72;

/** One letter for another person's face (the canvas has no avatars). */
export function faceLetter(who: string): string {
  const c = who.trim().charAt(0);
  return c ? c.toUpperCase() : '·';
}

function artboardEl(id: string): Element | null {
  if (typeof document === 'undefined') return null;
  const esc =
    typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
      ? CSS.escape(id)
      : id.replace(/["\\]/g, '\\$&');
  return document.querySelector(`[data-dc-screen="${esc}"]`);
}

/** How long the finish moment (settled ring + Before / After sweep) lasts before only the label mark is left. */
export const FRESH_DONE_MS = 1800;
/** How long the file-write rim stays hidden after the ring layer lets go (its own fade-out is ~200 ms + idle debounce). */
const AI_LIVE_TAIL_MS = 4000;
/** A "done" counts as just-finished when the artboard was a running ring this recently. */
const FRESH_WINDOW_MS = 20_000;

/** "AI is drawing Tablet" - the words for an artboard the AI is drafting (01 cf-ai-drafting). */
export function drawingTag(label: string | null | undefined): string | null {
  const name = (label ?? '').replace(/\s+/g, ' ').trim();
  return name ? `AI is drawing ${name.slice(0, 60)}` : null;
}

/** Artboards that appear this soon after the canvas first drew are the AI's (not the canvas loading). */
export const landing = { graceMs: 1500 }; // mutable so a test need not wait out the canvas's first draw
/** A hold or ring can be announced a little after the write that made the artboard land. */
const LANDED_WINDOW_MS = 5000;

function screenIds(): string[] {
  if (typeof document === 'undefined') return [];
  return Array.from(document.querySelectorAll('[data-dc-screen]'))
    .map((el) => el.getAttribute('data-dc-screen') ?? '')
    .filter(Boolean);
}

/**
 * A file change reloads the canvas, so what "landed" cannot live in memory alone: the ids on the canvas are kept in
 * sessionStorage (this frame's own, per canvas address), and the ones the new load has that the last did not are
 * the artboards that landed in between. Returns them in document order; the first load of a canvas returns none.
 */
function newSinceLastLoad(): string[] {
  if (typeof sessionStorage === 'undefined') return [];
  const key = `dc-ai-seen:${location.pathname}${location.search}`;
  const cur = screenIds();
  let prev: unknown = null;
  try {
    prev = JSON.parse(sessionStorage.getItem(key) || 'null');
  } catch {
    /* unreadable: treat as a first load */
  }
  try {
    // an empty list this early is a canvas still drawing, not a blank one: it is not worth remembering yet
    const early = typeof performance !== 'undefined' && performance.now() < landing.graceMs + 1000;
    if (cur.length || !early) sessionStorage.setItem(key, JSON.stringify(cur));
  } catch {
    /* storage blocked: no memory across reloads */
  }
  return Array.isArray(prev) ? cur.filter((id) => !prev.includes(id)) : [];
}

function labelOfArtboard(id: string): string | null {
  const el = artboardEl(id);
  return el?.getAttribute('data-dc-label') || el?.getAttribute('aria-label') || null;
}

export function ArtboardRingsLayer() {
  ensureRingStyles();
  const [shellRings, setRings] = useState<AiRings>({});
  // ids of artboards whose run just ended well: they wear the ring + sweep for FRESH_DONE_MS
  const [fresh, setFresh] = useState<ReadonlySet<string>>(() => new Set());
  // The artboard that LANDED while a run of yours was live is the one still being drawn (01 cf-ai-drafting): the
  // run leases the artboards it edits, not the ones it has yet to create, so the canvas itself sees the new one
  // arrive and gives it the dashed outline and "AI is drawing <name>" until the next one lands or the run ends.
  const [drafted, setDrafted] = useState<{ id: string; label: string | null } | null>(null);
  // artboards that appeared on this canvas after it first rendered, newest last (a hold can arrive just after the write)
  const landed = useRef<Array<{ id: string; at: number }>>([]);
  const nodes = useRef(new Map<string, HTMLDivElement>());
  const ranAt = useRef(new Map<string, number>());
  // a run of yours is live when it holds an artboard (`ai-runs`) or an object (`ai-holds`)
  const liveBy = useRef({ rings: false, holds: false });
  const [live, setLive] = useState(false);
  const rings = useMemo<AiRings>(() => {
    if (!drafted) return shellRings;
    const held = shellRings[drafted.id];
    // The run LEASES the artboard it has just written (its post-edit hook), so the shell usually speaks for it with
    // the fixed "AI is working": the drafted artboard renames that tag to its own name (01 cf-ai-drafting). A
    // needs-you ring, or another person's, keeps its own words.
    if (held && !(held.state === 'running' && held.who === 'you' && held.tag === TAG_WORKING_WORDS))
      return shellRings;
    return {
      ...shellRings,
      [drafted.id]: {
        state: 'running',
        who: 'you',
        tag: drawingTag(drafted.label) ?? TAG_WORKING_WORDS,
        waiting: held?.waiting ?? 0,
      },
    };
  }, [shellRings, drafted]);
  const ids = useMemo(() => Object.keys(rings), [rings]);
  // 03 ai-permission: your waiting artboards (two or more) read as ONE group
  const groupIds = useMemo(() => {
    const g = ids.filter((id) => rings[id].state === 'needs-you' && rings[id].who === 'you');
    return g.length >= 2 ? g : [];
  }, [ids, rings]);
  const groupEl = useRef<HTMLDivElement | null>(null);

  // P8 c6: the file-write rim (inspect.ts `.dc-activity-rim`) yields while this layer speaks for a run of yours
  // (live, or inside the finish moment + a short tail while the file-activity fade ends).
  const speaking = live || fresh.size > 0;
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const root = document.documentElement;
    if (speaking) {
      root.setAttribute('data-maude-ai-live', '');
      return undefined;
    }
    const tail = setTimeout(() => root.removeAttribute('data-maude-ai-live'), AI_LIVE_TAIL_MS);
    return () => clearTimeout(tail);
  }, [speaking]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const born = Date.now();
    let wasLive = false;
    // the blank-canvas starting point: once the first draw is over, note what is on the canvas
    const settle = setTimeout(() => void newSinceLastLoad(), landing.graceMs + 1100);
    timers.add(settle);
    // a run of yours is live: the artboard that landed just before it was announced is the one being drawn
    const syncLive = () => {
      const on = liveBy.current.rings || liveBy.current.holds;
      for (const id of newSinceLastLoad()) landed.current.push({ id, at: Date.now() });
      if (on && !wasLive) {
        const last = landed.current[landed.current.length - 1];
        if (last && Date.now() - last.at <= LANDED_WINDOW_MS) {
          ranAt.current.set(last.id, Date.now());
          setDrafted({ id: last.id, label: labelOfArtboard(last.id) });
        }
      }
      if (!on) setDrafted(null);
      wasLive = on;
      setLive(on);
    };
    // artboards that arrive after the canvas first drew; while a run of yours is live the newest is "being drawn"
    const watch =
      typeof MutationObserver === 'undefined'
        ? null
        : new MutationObserver((records) => {
            if (Date.now() - born < landing.graceMs) return;
            for (const rec of records)
              for (const node of Array.from(rec.addedNodes)) {
                if (!(node instanceof Element)) continue;
                const hit = node.matches('[data-dc-screen]') ? [node] : [];
                for (const el of [
                  ...hit,
                  ...Array.from(node.querySelectorAll('[data-dc-screen]')),
                ]) {
                  const id = el.getAttribute('data-dc-screen');
                  if (!id) continue;
                  landed.current.push({ id, at: Date.now() });
                  if (landed.current.length > 20) landed.current.shift();
                  if (wasLive) {
                    ranAt.current.set(id, Date.now());
                    setDrafted({ id, label: labelOfArtboard(id) });
                  }
                }
              }
          });
    watch?.observe(document.body, { childList: true, subtree: true });
    const onMessage = (e: MessageEvent) => {
      // Only the shell may say it (DDR-054: the canvas is the untrusted side). The table then parses the
      // payload — state/who/tag/waiting only, capped, no `__proto__` key.
      if (e.source !== window.parent) return;
      const kind = (e.data as { dgn?: string } | null)?.dgn;
      if (kind === 'ai-holds') {
        const h = acceptFromShell(e, window);
        if (h?.dgn !== 'ai-holds') return;
        liveBy.current.holds = (h.holds as Array<{ mine: boolean; point?: boolean }>).some(
          (x) => x.mine && !x.point
        );
        syncLive();
        return;
      }
      if (kind !== 'ai-runs') return;
      const m = acceptFromShell(e, window);
      if (m?.dgn !== 'ai-runs') return;
      const next = m.artboards as AiRings;
      const now = Date.now();
      const justDone: string[] = [];
      liveBy.current.rings = false;
      for (const [id, r] of Object.entries(next)) {
        if (r.state === 'running') {
          if (r.who === 'you') liveBy.current.rings = true;
          if (!ranAt.current.has(id)) ranAt.current.set(id, now);
        } else if (r.state === 'done') {
          const at = ranAt.current.get(id);
          if (at !== undefined && now - at <= FRESH_WINDOW_MS) {
            justDone.push(id);
            ranAt.current.delete(id);
          }
        }
      }
      // a ring that went away without a "done" (stopped, failed) forgets its run
      for (const id of [...ranAt.current.keys()])
        if (!next[id] && now - (ranAt.current.get(id) ?? 0) > FRESH_WINDOW_MS)
          ranAt.current.delete(id);
      syncLive();
      if (justDone.length) {
        setFresh((f) => new Set([...f, ...justDone]));
        const t = setTimeout(() => {
          timers.delete(t);
          setFresh((f) => {
            const n = new Set(f);
            for (const id of justDone) n.delete(id);
            return n;
          });
        }, FRESH_DONE_MS);
        timers.add(t);
      }
      setRings(next);
    };
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
      watch?.disconnect();
      for (const t of timers) clearTimeout(t);
    };
  }, []);

  // One animation-frame loop while any ring exists: follow each artboard's on-screen rectangle.
  useEffect(() => {
    if (ids.length === 0 && !live) return;
    let raf: number | null = null;
    const tick = () => {
      raf = null;
      for (const id of ids) {
        const div = nodes.current.get(id);
        if (!div) continue;
        const target = artboardEl(id) as HTMLElement | null;
        const r = target?.isConnected ? target.getBoundingClientRect() : null;
        if (!r || (r.width === 0 && r.height === 0)) {
          div.style.display = 'none';
          continue;
        }
        const grow = div.dataset.state === 'done' ? (div.dataset.fresh ? 6 : 0) : 5;
        div.style.display = 'block';
        div.style.left = `${Math.round(r.left - grow)}px`;
        div.style.top = `${Math.round(r.top - grow)}px`;
        div.style.width = `${Math.round(r.width + grow * 2)}px`;
        div.style.height = `${Math.round(r.height + grow * 2)}px`;
        div.dataset.at = tagPlacement(r.width, {
          selected: !!target?.hasAttribute('data-ed-selected'),
          bottomPx: r.bottom + grow,
          viewportPx: window.innerHeight,
        });
      }
      const box = groupEl.current;
      if (box) {
        let l = Infinity;
        let t = Infinity;
        let rt = -Infinity;
        let b = -Infinity;
        for (const id of groupIds) {
          const el = artboardEl(id) as HTMLElement | null;
          const r = el?.isConnected ? el.getBoundingClientRect() : null;
          if (!r || (r.width === 0 && r.height === 0)) continue;
          l = Math.min(l, r.left);
          t = Math.min(t, r.top);
          rt = Math.max(rt, r.right);
          b = Math.max(b, r.bottom);
        }
        if (l === Infinity) box.style.display = 'none';
        else {
          box.style.display = 'block';
          box.style.left = `${Math.round(l - 5)}px`;
          box.style.top = `${Math.round(t - 5)}px`;
          box.style.width = `${Math.round(rt - l + 10)}px`;
          box.style.height = `${Math.round(b - t + 10)}px`;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      if (raf != null) cancelAnimationFrame(raf);
    };
  }, [ids, live, groupIds]);

  if (ids.length === 0) return null;
  return (
    <div className="dc-ai-rings" aria-hidden="true" data-testid="ai-rings">
      {ids.map((id) => {
        const r = rings[id];
        return (
          <div
            key={id}
            ref={(el) => {
              if (el) nodes.current.set(id, el);
              else nodes.current.delete(id);
            }}
            className="dc-ai-ring"
            data-testid={`ai-ring-${id}`}
            data-artboard={id}
            data-state={r.state}
            data-who={r.who}
            data-at="below"
            data-grouped={groupIds.includes(id) ? 'true' : undefined}
            data-fresh={r.state === 'done' && fresh.has(id) ? 'true' : undefined}
            data-drawing={
              // the memo above replaced the shell's ring (or made one) only for the artboard being drawn
              drafted?.id === id && rings[id] !== shellRings[id] ? 'true' : undefined
            }
          >
            <span className="dc-ai-sweep">
              <span className="dc-ai-wipe-lab" data-side="before">
                Before
              </span>
              <span className="dc-ai-wipe-lab" data-side="after">
                After
              </span>
            </span>
            <span className="dc-ai-tag">
              {r.who !== 'you' && r.state !== 'done' ? (
                <span className="dc-ai-face">{faceLetter(r.who)}</span>
              ) : r.state === 'needs-you' ? null : (
                <svg className="dc-ai-glyph" viewBox="0 0 16 16" aria-hidden="true">
                  <path
                    d="M8 1l1.6 4.4L14 7l-4.4 1.6L8 13l-1.6-4.4L2 7l4.4-1.6z"
                    fill="currentColor"
                  />
                </svg>
              )}
              {ringTagText(r)}
            </span>
            {r.state === 'needs-you' ? <span className="dc-ai-will">will change</span> : null}
          </div>
        );
      })}
      {groupIds.length ? (
        <div className="dc-ai-group" ref={groupEl} data-testid="ai-ring-group">
          <span className="dc-ai-tag">{`${rings[groupIds[0]].tag} · ${groupIds.length} artboards`}</span>
        </div>
      ) : null}
    </div>
  );
}
