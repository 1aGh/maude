/**
 * @file       artboard-activity-overlay.tsx — Phase 13 / DDR-029 overlay.
 * @scope      apps/studio/artboard-activity-overlay.tsx
 * @purpose    The "agent works here" chrome for a single artboard: an animated
 *             rim + a top-right `editing — <label>` badge. Rendered by
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
      <span className="dc-activity-badge">editing — {label}</span>
    </div>
  );
}
ArtboardActivityOverlay.displayName = 'ArtboardActivityOverlay';

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// S5.11 (03 AI Chat: ai-hero, ai-two-artboards, ai-tereza) — the ring and tag an AI wears on an artboard.
//
//   running    dashed spark outline + spark-led tag ("AI is working", "Tereza's AI") + "· N waiting"
//   needs-you  dashed azure outline + azure tag ("Waiting for you")
//   done       solid spark outline that settles once, a sweep across the artboard, "Made by AI"
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
  --dc-ai-spark: oklch(0.66 0.2 36);
  --dc-ai-spark-fg: oklch(0.2 0.03 36);
  --dc-ai-spark-text: oklch(0.5 0.17 36);
  --dc-ai-spark-muted: oklch(0.66 0.2 36 / 0.12);
  --dc-ai-azure: oklch(0.53 0.175 238);
  --dc-ai-azure-fg: oklch(0.99 0.004 238);
  --dc-ai-azure-muted: oklch(0.53 0.175 238 / 0.12);
  --dc-ai-ink: oklch(0.99 0.004 250);
  --dc-ai-dur: 320ms;
  --dc-ai-sweep: 1100ms;
  --dc-ai-ease: cubic-bezier(0.34, 1.4, 0.5, 1);
  position: fixed; inset: 0; z-index: 7; pointer-events: none;
}
:root[data-maude-theme="dark"] .dc-ai-rings {
  --dc-ai-spark: oklch(0.7 0.185 38);
  --dc-ai-spark-fg: oklch(0.2 0.03 38);
  --dc-ai-spark-text: oklch(0.74 0.15 38);
  --dc-ai-spark-muted: oklch(0.7 0.185 38 / 0.18);
  --dc-ai-azure: oklch(0.64 0.165 238);
  --dc-ai-azure-fg: oklch(0.18 0.03 238);
  --dc-ai-azure-muted: oklch(0.64 0.165 238 / 0.18);
}
.dc-ai-ring { position: fixed; display: none; border-radius: 6px; box-sizing: border-box; pointer-events: none; }
.dc-ai-ring[data-state="running"] { border: 1.5px dashed var(--dc-ai-spark); }
.dc-ai-ring[data-state="needs-you"] { border: 1.5px dashed var(--dc-ai-azure); box-shadow: 0 0 0 4px var(--dc-ai-azure-muted); }
.dc-ai-ring[data-state="done"] {
  border: 2px solid var(--dc-ai-spark); box-shadow: 0 0 0 4px var(--dc-ai-spark-muted);
  animation: dc-ai-settle var(--dc-ai-dur) var(--dc-ai-ease) 1 both;
}
@keyframes dc-ai-settle { from { scale: 1.03; opacity: 0.4; } to { scale: 1; opacity: 1; } }
.dc-ai-tag {
  position: absolute; right: -2px; display: inline-flex; align-items: center; gap: 4px; max-width: 320px;
  padding: 2px 8px 2px 4px; border-radius: 999px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  font: 600 11px/16px ui-rounded, system-ui, -apple-system, sans-serif; letter-spacing: 0;
}
.dc-ai-ring[data-at="above"] .dc-ai-tag { bottom: calc(100% + 2px); }
.dc-ai-ring[data-at="below"] .dc-ai-tag { top: calc(100% + 8px); }
.dc-ai-ring[data-state="running"] .dc-ai-tag { background: var(--dc-ai-spark); color: var(--dc-ai-spark-fg); }
.dc-ai-ring[data-state="needs-you"] .dc-ai-tag { background: var(--dc-ai-azure); color: var(--dc-ai-azure-fg); }
.dc-ai-ring[data-state="done"] .dc-ai-tag { background: transparent; color: var(--dc-ai-spark-text); right: 0; bottom: calc(100% + 4px); padding: 0; font-weight: 500; }
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
.dc-ai-ring[data-state="done"] .dc-ai-sweep { display: block; animation: dc-ai-sweep var(--dc-ai-sweep) ease-in-out 1 both; }
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

/** The words on the tag: the fixed phrase from the shell, plus "· N waiting" when asks are in line. */
export function ringTagText(r: AiRing): string {
  if (r.state === 'done') return r.tag || 'Made by AI';
  return r.waiting > 0 ? `${r.tag} · ${r.waiting} waiting` : r.tag;
}

/** Above the artboard (beside its name) when it is wide enough to leave the name room, else below it. */
export function tagPlacement(widthPx: number): 'above' | 'below' {
  return widthPx >= 260 ? 'above' : 'below';
}

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

export function ArtboardRingsLayer() {
  ensureRingStyles();
  const [rings, setRings] = useState<AiRings>({});
  const nodes = useRef(new Map<string, HTMLDivElement>());
  const ids = useMemo(() => Object.keys(rings), [rings]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onMessage = (e: MessageEvent) => {
      // Only the shell may say it (DDR-054: the canvas is the untrusted side). The table then parses the
      // payload — state/who/tag/waiting only, capped, no `__proto__` key.
      if (e.source !== window.parent) return;
      if ((e.data as { dgn?: string } | null)?.dgn !== 'ai-runs') return;
      const m = acceptFromShell(e, window);
      if (m && m.dgn === 'ai-runs') setRings(m.artboards as AiRings);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // One animation-frame loop while any ring exists: follow each artboard's on-screen rectangle.
  useEffect(() => {
    if (ids.length === 0) return;
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
        const grow = div.dataset.state === 'done' ? 6 : 5;
        div.style.display = 'block';
        div.style.left = `${Math.round(r.left - grow)}px`;
        div.style.top = `${Math.round(r.top - grow)}px`;
        div.style.width = `${Math.round(r.width + grow * 2)}px`;
        div.style.height = `${Math.round(r.height + grow * 2)}px`;
        div.dataset.at = tagPlacement(r.width);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      if (raf != null) cancelAnimationFrame(raf);
    };
  }, [ids]);

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
          >
            <span className="dc-ai-sweep" />
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
          </div>
        );
      })}
    </div>
  );
}
