/**
 * @file       annotations/ui/arrow-cards.tsx — what an arrow says about what it points at (S4.11)
 * @scope      apps/studio/annotations/ui/arrow-cards.tsx
 * @purpose    The HTML half of an-arrow-bind / an-rebind / an-dangling / an-arrow-kinds, drawn in
 *             WORLD space (portaled into `.dc-world` by the layer, counter-scaled so it holds a
 *             constant screen size):
 *
 *               AimOverlay        candidate outlines, the ring on the thing under the pointer with
 *                                 its tag ("Button · See the work"), or — over an artboard's edge —
 *                                 the edge light (`an-edge`).
 *               BoundTag          "Bound to the artboard" for a moment, when the file was busy.
 *               HostMarks         an open circle at each dangling end; for the SELECTED arrow the
 *                                 dangling card ("Pointed at “Book a call” — …" + **Point to…**)
 *                                 and, for a rewritten element, its ring "· rewritten by AI".
 *               ArrowLabelEditor  the input a double-click opens on the line.
 *
 *             The derivations (`danglingCard`, `rewrittenRing`) are pure so a test reads the words
 *             without a DOM.
 */

import { type KeyboardEvent, useEffect, useRef } from 'react';

import type { DanglingEnd, HostBox } from '../hosts.ts';
import { type AimRects, type BindCandidate, kindWord, rewrittenText } from './arrow-bind.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Words (pure)

/** Why a host cannot be found: its artboard is gone, or the element inside it is. */
export type DanglingCause = 'artboard' | 'element';

export interface DanglingCardModel {
  arrowId: string;
  end: 'start' | 'end';
  /** The name the arrow remembers it under: “See the work”. */
  name: string;
  /** "Pointed at “Book a call” — its artboard is in the trash". */
  lead: string;
  cause: DanglingCause;
  at: [number, number];
}

/** An `ab:` host that cannot be found means the artboard left the canvas (the trash). */
export function danglingCause(ref: string, rects: Pick<AimRects, 'artboards'>): DanglingCause {
  if (ref.startsWith('ab:')) return 'artboard';
  const ab = ref.slice(3).split('/')[0];
  return rects.artboards.some((a) => a.id === ab) ? 'element' : 'artboard';
}

/**
 * The card's words, as canvas 15 (an-dangling) draws them: "Pointed at “Book a call” — moved to the
 * trash by Jonas". `by` is the person's NAME when the layer knows who moved it (name-only, never an id or
 * an e-mail); without one the line stops at "moved to the trash" rather than guessing.
 */
export function danglingCard(
  d: DanglingEnd,
  rects: Pick<AimRects, 'artboards'>,
  by?: string
): DanglingCardModel {
  const cause = danglingCause(d.ref, rects);
  const who = by?.trim() ? ` by ${by.trim().slice(0, 60)}` : '';
  const what = cause === 'artboard' ? 'its artboard is in the trash' : `moved to the trash${who}`;
  return {
    arrowId: d.arrowId,
    end: d.end,
    name: d.label,
    lead: `Pointed at “${d.label}” — ${what}`,
    cause,
    at: d.at,
  };
}

/** The tag a rewritten element's ring carries: "Button · See our work · rewritten by AI". */
export function rewrittenRing(
  rects: AimRects,
  bind: { ref: string; label: string },
  word: string
): { text: string; word: string } | null {
  const now = rewrittenText(rects, bind);
  return now ? { word, text: `${now} · rewritten by AI` } : null;
}

/** The rings of an arrow's ends whose element AI rewrote (same id, new words): box + tag words. */
export function rewrittenFor(
  arrow: { startHost?: { ref: string; label: string }; endHost?: { ref: string; label: string } },
  rects: AimRects
): Array<{ box: HostBox; word: string; text: string }> {
  const out: Array<{ box: HostBox; word: string; text: string }> = [];
  for (const bind of [arrow.startHost, arrow.endHost]) {
    if (!bind) continue;
    const m = /^el:([^/]+)\/([^#]+)(?:#(\d+))?$/.exec(bind.ref);
    if (!m) continue;
    const hits = rects.elements.filter((e) => e.artboard === m[1] && e.cdId === m[2]);
    const hit = hits[m[3] ? Number(m[3]) : 0];
    const ring = hit ? rewrittenRing(rects, bind, kindWord(hit.tag)) : null;
    if (hit && ring)
      out.push({
        box: { x: hit.x, y: hit.y, w: hit.w, h: hit.h },
        word: ring.word,
        text: ring.text,
      });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Aim

export interface AimState {
  /** What the pointer is over (null over empty canvas). */
  hot: BindCandidate | null;
  /** Nearby things the arrow could point at — dashed outlines. */
  near: HostBox[];
}

/** Dashed outlines of the things within `radius` (world px) of the pointer, nearest first, ≤ `max`. */
export function nearbyOutlines(
  rects: AimRects,
  x: number,
  y: number,
  radius: number,
  max = 6
): HostBox[] {
  const dist = (b: HostBox): number => {
    const dx = Math.max(b.x - x, 0, x - (b.x + b.w));
    const dy = Math.max(b.y - y, 0, y - (b.y + b.h));
    return Math.hypot(dx, dy);
  };
  const boxes: HostBox[] = [];
  for (const e of rects.elements) {
    if (!e.cdId || !e.artboard || e.w <= 0 || e.h <= 0) continue;
    boxes.push({ x: e.x, y: e.y, w: e.w, h: e.h });
  }
  for (const a of rects.artboards) boxes.push({ x: a.x, y: a.y, w: a.w, h: a.h });
  return boxes
    .map((b) => ({ b, d: dist(b) }))
    .filter((r) => r.d <= radius)
    .sort((a, b) => a.d - b.d)
    .slice(0, max)
    .map((r) => r.b);
}

const PX = (zoom: number, n: number): number => n / Math.max(zoom, 0.01);

export function AimOverlay({ aim, zoom }: { aim: AimState; zoom: number }) {
  const hot = aim.hot;
  return (
    <>
      {aim.near
        .filter((b) => !hot || !sameBox(b, hot.box))
        .map((b, i) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: positional, rebuilt per move
            key={i}
            className="dc-annot-cand"
            data-testid="annot-arrow-candidate"
            aria-hidden="true"
            style={{
              left: b.x,
              top: b.y,
              width: b.w,
              height: b.h,
              outlineWidth: PX(zoom, 1.5),
            }}
          />
        ))}
      {hot ? (
        <>
          <span
            aria-hidden="true"
            className={hot.edge ? 'dc-annot-edge' : 'dc-annot-snap'}
            data-testid={hot.edge ? 'annot-arrow-edge' : 'annot-arrow-aim-ring'}
            data-host-kind={hot.kind}
            style={{
              left: hot.box.x - PX(zoom, 3),
              top: hot.box.y - PX(zoom, 3),
              width: hot.box.w + PX(zoom, 6),
              height: hot.box.h + PX(zoom, 6),
              boxShadow: `0 0 0 ${PX(zoom, 2)}px var(--maude-hud-accent, oklch(0.53 0.175 238)), 0 0 0 ${PX(zoom, hot.edge ? 7 : 6)}px color-mix(in oklab, var(--maude-hud-accent, oklch(0.53 0.175 238)) 22%, transparent)`,
            }}
          />
          <span
            className="dc-annot-snap-tag"
            data-testid="annot-arrow-aim-tag"
            style={{
              left: hot.box.x + hot.box.w,
              top: hot.box.y + hot.box.h + PX(zoom, 8),
              transform: `scale(${1 / Math.max(zoom, 0.01)})`,
            }}
          >
            <b>{hot.word}</b>
            {hot.text ? <> · {hot.text}</> : null}
          </span>
        </>
      ) : null}
    </>
  );
}

function sameBox(a: HostBox, b: HostBox): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

export function BoundTag({ text, at, zoom }: { text: string; at: [number, number]; zoom: number }) {
  return (
    <span
      className="dc-annot-snap-tag"
      data-testid="annot-arrow-bound-tag"
      role="status"
      style={{ left: at[0], top: at[1], transform: `scale(${1 / Math.max(zoom, 0.01)})` }}
    >
      {text}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Dangling + rewritten

export interface HostMarksProps {
  zoom: number;
  /** Every dangling end on the canvas — each gets its open circle. */
  dangling: readonly DanglingCardModel[];
  /** The arrow whose card is open (the selected one). */
  selectedId: string | null;
  /** The selected arrow's rewritten rings. */
  rewritten: ReadonlyArray<{ box: HostBox; word: string; text: string }>;
  /** Point to… — start aiming that arrow's end at a new target. */
  onPointTo: (arrowId: string, end: 'start' | 'end') => void;
  canEdit: boolean;
}

export function HostMarks({
  zoom,
  dangling,
  selectedId,
  rewritten,
  onPointTo,
  canEdit,
}: HostMarksProps) {
  return (
    <>
      {dangling.map((d) => (
        <span
          key={`${d.arrowId}:${d.end}`}
          className="dc-annot-open"
          data-testid="annot-dangling-mark"
          aria-hidden="true"
          data-cause={d.cause}
          style={{
            left: d.at[0],
            top: d.at[1],
            width: PX(zoom, 10),
            height: PX(zoom, 10),
            borderWidth: PX(zoom, 2),
          }}
        />
      ))}
      {dangling
        .filter((d) => d.arrowId === selectedId)
        .map((d) => (
          <aside
            key={`card:${d.arrowId}:${d.end}`}
            className="dc-annot-dg dc-annot-arrowui-live"
            data-testid="annot-dangling-card"
            aria-label={d.lead}
            style={{
              left: d.at[0] + PX(zoom, 14),
              top: d.at[1] - PX(zoom, 48),
              transform: `scale(${1 / Math.max(zoom, 0.01)})`,
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <p>{d.lead}</p>
            {canEdit ? (
              <button
                type="button"
                className="dc-annot-dg-btn"
                data-testid="annot-point-to"
                onClick={() => onPointTo(d.arrowId, d.end)}
              >
                Point to…
              </button>
            ) : null}
          </aside>
        ))}
      {rewritten.map((r, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: derived per render
          key={i}
          className="dc-annot-snap"
          data-testid="annot-arrow-rewritten"
          style={{
            left: r.box.x - PX(zoom, 3),
            top: r.box.y - PX(zoom, 3),
            width: r.box.w + PX(zoom, 6),
            height: r.box.h + PX(zoom, 6),
            boxShadow: `0 0 0 ${PX(zoom, 2)}px var(--maude-hud-accent, oklch(0.53 0.175 238))`,
          }}
        >
          <span
            className="dc-annot-snap-tag"
            style={{
              left: '100%',
              top: `calc(100% + ${PX(zoom, 8)}px)`,
              transform: `scale(${1 / Math.max(zoom, 0.01)})`,
            }}
          >
            <b>{r.word}</b> · {r.text}
          </span>
        </span>
      ))}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Label

export function ArrowLabelEditor({
  at,
  initial,
  zoom,
  onCommit,
  onCancel,
}: {
  at: { x: number; y: number };
  initial: string;
  zoom: number;
  onCommit: (text: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement | null>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    if (save) onCommit(ref.current?.value ?? '');
    else onCancel();
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      finish(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      finish(false);
    }
  };
  return (
    <input
      ref={ref}
      className="dc-annot-alabel dc-annot-alabel--edit dc-annot-arrowui-live"
      data-testid="annot-arrow-label-input"
      aria-label="Arrow label"
      defaultValue={initial}
      maxLength={200}
      style={{
        left: at.x,
        top: at.y,
        transform: `translate(-50%, -50%) scale(${1 / Math.max(zoom, 0.01)})`,
      }}
      onKeyDown={onKey}
      onBlur={() => finish(true)}
      onPointerDown={(e) => e.stopPropagation()}
    />
  );
}
