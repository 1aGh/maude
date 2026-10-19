/**
 * @file       annotations/ui/element-node.tsx — one DOM node per annotation element
 * @scope      apps/studio/annotations/ui/element-node.tsx
 * @purpose    DDR-242 AD7 + AD8 (Tasks 17 + 23). Every element is its own
 *             absolutely positioned node in the world, in paint order:
 *             geometry in a small SVG drawn in WORLD coordinates (so the shared
 *             geometry helpers apply unchanged), text as HTML. Keeping each
 *             element's text inside its own node keeps z-order exact — a pen
 *             stroke drawn over a sticky still covers its text — which one
 *             text layer over all the ink could not.
 *
 *             `ElementNode` is memoized on its record and resolved geometry, so
 *             a change re-renders only the element that changed. The editor
 *             (text-editor.tsx) replaces an element's text block in place, with
 *             the same class and style.
 *
 *             DOM contract kept for hit-testing, comments and tooling:
 *             `[data-id][data-tool]` on the node (`data-tool` = the v1 tool
 *             name; `data-type` = the v2 type). Painted parts claim pointer
 *             events only while the layer is interactive.
 */

import { Component, type CSSProperties, memo, type ReactNode } from 'react';
import {
  clampLinkTitle,
  LINK_CARD_FILL,
  LINK_CARD_STROKE,
  LINK_DOMAIN_FILL,
  LINK_GLYPH_D1,
  LINK_GLYPH_D2,
  LINK_GLYPH_STROKE,
  LINK_TITLE_FILL,
  linkCardLayout,
  MEDIAREF_AUDIO_GLYPH,
  MEDIAREF_VIDEO_GLYPH,
  penPathD,
  polygonPoints,
  SECTION_CORNER_RADIUS,
  SECTION_LABEL_FONT,
  SECTION_LABEL_H,
  STICKY_CORNER_RADIUS,
  stickyCornerPath,
  type WorldPoint,
} from '../../annotations-model.ts';
import { arrowPrimitives, type SvgPrimitive } from '../../canvas-arrowheads.ts';
import { countRender, useLiveViewport } from '../../canvas-lib.tsx';
import { colorForName } from '../../use-collab.tsx';
import { SECTION_FOLDED_H } from '../constants.ts';
import { authorLine, provenanceLine, relativeTime, tiltOf } from '../elements/sticky.model.ts';
import type { AnnotationElement } from '../types.ts';
import { quietPaper } from './posture.ts';
import type { ResolvedEnds } from './render-model.ts';
import { labelPoint } from './rest-route.ts';
import { polylinePrims } from './ride.ts';
import { type CommitInfo, type SizeMode, TextEditor } from './text-editor.tsx';
import {
  anchorShift,
  type ListStyle,
  slotTextStyle,
  TEXT_FONT,
  type TextAlign,
  type TextSlot,
  withListMarkers,
} from './text-style.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Props

/** An open edit session on this element's text slot (only the edited node gets one). */
export interface EditRequest {
  caretPoint: { x: number; y: number } | null;
  /** A collaborator changed (merged on commit) or deleted (commit restores) the element. */
  notice?: 'edited' | 'deleted' | null;
  onCommit: (info: CommitInfo) => void;
  onCancel: () => void;
  onDraft?: (text: string) => void;
}

export interface ElementNodeProps {
  el: AnnotationElement;
  /** Resolved arrow endpoints (arrows only). */
  ends?: ResolvedEnds;
  interactive: boolean;
  /** S4.9 — Edit's posture: a sticky's paper is mixed with grey (its words keep their ink); CSS fades the rest. */
  quiet?: boolean;
  /** S4.12 — this element is in the selection (a sticky then shows its author line). */
  selected?: boolean;
  /** S4.12 — the signed-in person wrote this (the author line says "You"). */
  mine?: boolean;
  /** S4.12 — a folded section's count line ("6 stickies · 2 people"), computed by the layer. */
  foldNote?: string;
  /** S4.12 — a collaborator is typing in this sticky: their cursor colour edges the paper. */
  typist?: string | null;
  edit: EditRequest | null;
  /** Maps a stored `assets/…` path to a URL the canvas can load. */
  resolveAsset: (href: string) => string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Field readers (records are validated or come from the v1 adapter; be lenient)

function num(v: unknown, def = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : def;
}
function str(v: unknown, def = ''): string {
  return typeof v === 'string' ? v : def;
}
function align(v: unknown, def: TextAlign): TextAlign {
  return v === 'left' || v === 'center' || v === 'right' ? v : def;
}
function list(v: unknown): ListStyle | undefined {
  return v === 'bullet' || v === 'number' ? v : undefined;
}
function textFmt(r: Record<string, unknown>, defAlign: TextAlign, defColor?: string) {
  return {
    fontSize: num(r.fontSize, 14),
    color: typeof r.color === 'string' ? r.color : defColor,
    bold: r.bold === true,
    italic: r.italic === true,
    strike: r.strike === true,
    underline: r.underline === true,
    align: align(r.align, defAlign),
  };
}

/** The v1 tool name hit-testing and tooling key on (`data-tool`). */
export function v1ToolOf(el: AnnotationElement): string {
  if (el.type === 'shape') {
    const k = str(el.kind, 'rect');
    return k === 'rect' || k === 'ellipse' ? k : 'polygon';
  }
  return el.type;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared pieces

function Node({
  el,
  x,
  y,
  w,
  h,
  rot = 0,
  raised = false,
  extraStyle,
  children,
}: {
  el: AnnotationElement;
  x: number;
  y: number;
  w: number | 'auto';
  h: number | 'auto';
  rot?: number;
  /** An open editor floats above the elements painted after it. */
  raised?: boolean;
  extraStyle?: CSSProperties;
  children: ReactNode;
}) {
  const tool = v1ToolOf(el);
  return (
    <div
      className="dc-annot-el"
      data-id={el.id}
      data-tool={tool}
      data-type={el.type}
      {...(tool === 'polygon' ? { 'data-shape': str(el.kind) } : {})}
      style={{
        left: x,
        top: y,
        width: w === 'auto' ? undefined : w,
        height: h === 'auto' ? undefined : h,
        ...(rot ? { transform: `rotate(${rot}deg)` } : {}),
        ...(raised ? { zIndex: 3 } : {}),
        ...extraStyle,
      }}
    >
      {children}
    </div>
  );
}

/** Geometry drawn in WORLD coords, mapped onto the node's box. */
function Geo({
  x,
  y,
  w,
  h,
  children,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  children: ReactNode;
}) {
  const vw = Math.max(w, 1);
  const vh = Math.max(h, 1);
  return (
    <svg
      className="dc-annot-geo"
      xmlns="http://www.w3.org/2000/svg"
      width={vw}
      height={vh}
      viewBox={`${x} ${y} ${vw} ${vh}`}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function hit(interactive: boolean, mode: 'visiblePainted' | 'stroke' = 'visiblePainted') {
  return interactive ? mode : ('none' as const);
}

/** Marker above an open editor when a collaborator changed the element under it. */
function EditNotice({ notice }: { notice: EditRequest['notice'] }) {
  if (!notice) return null;
  const text =
    notice === 'deleted'
      ? 'Deleted by a collaborator — Enter keeps your text, Esc discards it'
      : 'Edited by a collaborator — both changes are kept';
  return (
    <div
      className="dc-annot-edit-notice"
      data-edit-notice={notice}
      role="status"
      style={{
        position: 'absolute',
        left: 0,
        bottom: '100%',
        marginBottom: 6,
        whiteSpace: 'nowrap',
        font: `11px ${TEXT_FONT}`,
        color: '#1f1f1f',
        background: notice === 'deleted' ? '#fde2e1' : '#fff3c4',
        border: '1px solid rgba(0,0,0,0.12)',
        borderRadius: 6,
        padding: '2px 8px',
        zIndex: 4,
      }}
    >
      {text}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-type views

function StickyView({ el, interactive, edit, quiet, selected, mine, typist }: ElementNodeProps) {
  const x = num(el.x);
  const y = num(el.y);
  const w = num(el.w);
  const h = num(el.h);
  const r = num(el.radius, STICKY_CORNER_RADIUS);
  const fill = quiet ? quietPaper(str(el.fill, '#fce8a6')) : str(el.fill, '#fce8a6');
  const resolved =
    el.resolved && typeof el.resolved === 'object'
      ? (el.resolved as { by?: unknown; at?: unknown })
      : null;
  const fmt = textFmt(el, 'left');
  // S4.12 (C29) — a resolved sticky is struck through in place and kept; the words stay readable.
  const style = {
    ...slotTextStyle('sticky', resolved ? { ...fmt, strike: true } : fmt),
    color: '#2a2a28',
    padding: '14px 16px',
    ...(resolved ? { opacity: 0.72 } : {}),
  };
  const text = str(el.text);
  const lst = list(el.list);
  const a =
    el.author && typeof el.author === 'object'
      ? (el.author as { kind?: unknown; name?: unknown })
      : null;
  const authorName = a ? str(a.name) : '';
  const isAi = a?.kind === 'ai';
  // S4.12 — a hand-rotated sticky keeps its angle; the rest tilt a little, from the id, and lie flat while typed in.
  const rot = num(el.rot) || (edit ? 0 : tiltOf(el.id));
  const line = authorLine(
    { name: authorName, ai: isAi, me: mine },
    typeof el.at === 'string' ? el.at : null,
    Date.now()
  );
  const origin = provenanceLine(el.source);
  const doneLine =
    resolved && typeof resolved.by === 'string'
      ? `Resolved by ${resolved.by}${typeof resolved.at === 'string' ? ` · ${relativeTime(resolved.at, Date.now())}` : ''}`
      : null;
  const shown = [line, origin, doneLine].filter(Boolean).join(' · ');
  return (
    <Node el={el} x={x} y={y} w={w} h={h} rot={rot} raised={!!edit}>
      <Geo x={x} y={y} w={w} h={h}>
        <path
          d={stickyCornerPath(x, y, w, h, r)}
          fill={fill}
          stroke="rgba(0,0,0,0.05)"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
          filter="url(#dc-sticky-shadow)"
          pointerEvents={hit(interactive)}
        />
        {typist ? (
          <path
            d={stickyCornerPath(x, y, w, h, r)}
            fill="none"
            stroke={typist}
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
            data-typist-edge="1"
          />
        ) : null}
      </Geo>
      {edit ? (
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: '100%',
            minHeight: h,
            // Grows downward while typing past the card; paints its own paper
            // so the overflow still reads as the note. `backgroundColor`, never
            // the `background` shorthand: the fill is peer-controlled and the
            // shorthand would take a `url(…)`.
            backgroundColor: fill,
            borderRadius: `${r}px ${r}px 0 ${r}px`,
            zIndex: 1,
          }}
        >
          <TextEditor
            initialText={text}
            list={lst}
            className="dc-annot-text"
            style={{ ...style, width: '100%' }}
            size={{ kind: 'grow-height', minHeight: h }}
            fmt={textFmt(el, 'left')}
            caretPoint={edit.caretPoint}
            ariaLabel="Edit sticky note text"
            onCommit={edit.onCommit}
            onCancel={edit.onCancel}
            onDraft={edit.onDraft}
          />
        </div>
      ) : (
        <div
          className="dc-annot-text"
          style={{ ...style, position: 'absolute', inset: 0, overflow: 'hidden' }}
        >
          {withListMarkers(text, lst)}
        </div>
      )}
      {edit ? <EditNotice notice={edit.notice} /> : null}
      {resolved ? (
        <span
          className="dc-annot-done"
          data-resolved="1"
          title="Resolved"
          role="img"
          aria-label="Resolved"
        >
          <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
            <path
              d="M2.5 6.4 5 8.8l4.5-5.2"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      ) : null}
      {shown && !edit ? (
        <span
          className="dc-annot-who"
          title={shown}
          data-an-who={selected ? 'sel' : undefined}
          style={{
            position: 'absolute',
            left: 4,
            right: 4,
            top: '100%',
            marginTop: 3,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontSize: 10,
            fontWeight: 600,
            fontFamily: TEXT_FONT,
            color: authorName ? colorForName(authorName) : '#555',
            lineHeight: 1.4,
          }}
        >
          {shown}
        </span>
      ) : null}
    </Node>
  );
}

function TextView({ el, interactive, edit }: ElementNodeProps) {
  const f = textFmt(el, 'left', '#1a1a1a');
  const style: CSSProperties = { ...slotTextStyle('text', f), color: f.color, padding: '0 2px' };
  const text = str(el.text);
  const lst = list(el.list);
  return (
    <Node
      el={el}
      x={num(el.x)}
      y={num(el.y)}
      w="auto"
      h="auto"
      rot={num(el.rot)}
      raised={!!edit}
      extraStyle={{
        transform:
          [anchorShift(f.align), el.rot ? `rotate(${num(el.rot)}deg)` : undefined]
            .filter(Boolean)
            .join(' ') || undefined,
      }}
    >
      {edit ? (
        <TextEditor
          initialText={text}
          list={lst}
          className="dc-annot-text dc-annot-text--nowrap"
          style={style}
          size={{ kind: 'fit-both' }}
          fmt={f}
          caretPoint={edit.caretPoint}
          ariaLabel="Edit text"
          onCommit={edit.onCommit}
          onCancel={edit.onCancel}
          onDraft={edit.onDraft}
        />
      ) : (
        <div
          className="dc-annot-text dc-annot-text--nowrap"
          style={{ ...style, pointerEvents: interactive ? 'auto' : 'none', cursor: 'text' }}
        >
          {withListMarkers(text, lst)}
        </div>
      )}
      {edit ? <EditNotice notice={edit.notice} /> : null}
    </Node>
  );
}

function ShapeView({ el, interactive, edit }: ElementNodeProps) {
  const x = num(el.x);
  const y = num(el.y);
  const w = num(el.w);
  const h = num(el.h);
  const kind = str(el.kind, 'rect');
  const common = {
    stroke: str(el.color, '#1a1a1a'),
    strokeWidth: num(el.width, 2),
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    fill: typeof el.fill === 'string' ? el.fill : 'none',
    strokeDasharray: el.dashed === true ? '6 4' : undefined,
    pointerEvents: hit(interactive),
  };
  let geo: ReactNode;
  if (kind === 'rect') {
    const r = num(el.radius);
    geo = <rect {...common} x={x} y={y} width={w} height={h} rx={r} ry={r} />;
  } else if (kind === 'ellipse') {
    geo = <ellipse {...common} cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} />;
  } else {
    geo = (
      <polygon
        {...common}
        points={polygonPoints(kind as Parameters<typeof polygonPoints>[0], x, y, w, h)}
      />
    );
  }
  const label = (el.label ?? {}) as Record<string, unknown>;
  const hasLabel = typeof label.text === 'string';
  const f = textFmt(label, 'center', '#1a1a1a');
  const style: CSSProperties = { ...slotTextStyle('label', f), color: f.color };
  return (
    <Node el={el} x={x} y={y} w={w} h={h} rot={num(el.rot)} raised={!!edit}>
      <Geo x={x} y={y} w={w} h={h}>
        {geo}
      </Geo>
      {edit ? (
        <div className="dc-annot-label" style={{ zIndex: 1 }}>
          <TextEditor
            initialText={str(label.text)}
            list={list(label.list)}
            className="dc-annot-text"
            style={style}
            size={{ kind: 'fit-height' }}
            fmt={f}
            caretPoint={edit.caretPoint}
            ariaLabel="Edit annotation text"
            onCommit={edit.onCommit}
            onCancel={edit.onCancel}
            onDraft={edit.onDraft}
          />
        </div>
      ) : hasLabel ? (
        <div className="dc-annot-label">
          <div
            className="dc-annot-text"
            style={{ ...style, pointerEvents: interactive ? 'auto' : 'none' }}
          >
            {withListMarkers(str(label.text), list(label.list))}
          </div>
        </div>
      ) : null}
      {edit ? <EditNotice notice={edit.notice} /> : null}
    </Node>
  );
}

function renderArrowPrimitive(p: SvgPrimitive, key: number): ReactNode {
  switch (p.el) {
    case 'line':
      return (
        <line
          key={key}
          x1={p.x1}
          y1={p.y1}
          x2={p.x2}
          y2={p.y2}
          strokeDasharray={p.dash ? '6 4' : undefined}
        />
      );
    case 'path':
      return <path key={key} d={p.d} strokeDasharray={p.dash ? '6 4' : undefined} />;
    case 'polyline':
      return <polyline key={key} points={p.points} fill={p.fill} />;
    case 'polygon':
      return <polygon key={key} points={p.points} fill={p.fill} />;
    case 'circle':
      return <circle key={key} cx={p.cx} cy={p.cy} r={p.r} fill={p.fill} />;
    default:
      return null;
  }
}

export function arrowGeom(el: AnnotationElement, ends: ResolvedEnds) {
  return {
    x1: ends.x1,
    y1: ends.y1,
    x2: ends.x2,
    y2: ends.y2,
    width: num(el.width, 2),
    color: str(el.color, '#1a1a1a'),
    ...(typeof el.startHead === 'string' ? { startHead: el.startHead } : {}),
    ...(typeof el.endHead === 'string' ? { endHead: el.endHead } : {}),
    ...(el.dashed === true ? { dashed: true } : {}),
    ...(typeof el.line === 'string' ? { lineType: el.line } : {}),
    ...(ends.startAnchor
      ? {
          startBind: {
            hostId: ends.startAnchor.el,
            nx: ends.startAnchor.nx,
            ny: ends.startAnchor.ny,
          },
        }
      : {}),
    ...(ends.endAnchor
      ? { endBind: { hostId: ends.endAnchor.el, nx: ends.endAnchor.nx, ny: ends.endAnchor.ny } }
      : {}),
  } as Parameters<typeof arrowPrimitives>[0];
}

function ArrowView({ el, ends, interactive }: ElementNodeProps) {
  if (!ends) return null;
  const width = num(el.width, 2);
  const pad = width * 4 + 24; // heads + curve bulge stay inside the node's box
  // S4.11 — an elbow arrow at rest draws the route it settled on (rest-route.ts), so its box
  // covers every waypoint, not just the two ends.
  const routed = el.line === 'elbow' && ends.route && ends.route.length >= 2 ? ends.route : null;
  const xs = routed ? routed.map((p) => p.x) : [];
  const ys = routed ? routed.map((p) => p.y) : [];
  const x = Math.min(ends.x1, ends.x2, ...xs) - pad;
  const y = Math.min(ends.y1, ends.y2, ...ys) - pad;
  const w = Math.max(ends.x1, ends.x2, ...xs) - Math.min(ends.x1, ends.x2, ...xs) + pad * 2;
  const h = Math.max(ends.y1, ends.y2, ...ys) - Math.min(ends.y1, ends.y2, ...ys) + pad * 2;
  const label = str(el.label);
  const lp = label ? labelPoint(el, ends) : null;
  // A dangling end (its host is gone) keeps its place, dashed, with no head (an-dangling).
  const dangling = ends.dangling;
  const drawn = danglingEl(el, dangling);
  const prims = routed ? polylinePrims(routed, drawn) : arrowPrimitives(arrowGeom(drawn, ends));
  return (
    <Node el={el} x={x} y={y} w={w} h={h}>
      <Geo x={x} y={y} w={w} h={h}>
        <g
          stroke={str(el.color, '#1a1a1a')}
          strokeWidth={width}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          pointerEvents={hit(interactive)}
          {...(routed ? { 'data-route': routed.length } : {})}
          {...(dangling?.start || dangling?.end ? { 'data-dangling': '1' } : {})}
        >
          {prims.map((p, i) => renderArrowPrimitive(p, i))}
        </g>
      </Geo>
      {lp ? (
        <span
          className="dc-annot-alabel"
          data-testid="annot-arrow-label"
          style={{ left: lp.x - x, top: lp.y - y }}
        >
          {label}
        </span>
      ) : null}
    </Node>
  );
}

/** The record as drawn when an end is dangling: dashed, and no head on the lost end. */
function danglingEl(el: AnnotationElement, d: ResolvedEnds['dangling']): AnnotationElement {
  if (!d?.start && !d?.end) return el;
  return {
    ...el,
    dashed: true,
    ...(d.start ? { startHead: 'none' } : {}),
    ...(d.end ? { endHead: 'none' } : {}),
  };
}

function PenView({ el, interactive }: ElementNodeProps) {
  const flat = Array.isArray(el.points) ? (el.points as number[]) : [];
  const pts: WorldPoint[] = [];
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  for (let i = 0; i + 1 < flat.length; i += 2) {
    const px = flat[i] as number;
    const py = flat[i + 1] as number;
    pts.push([px, py]);
    if (px < x0) x0 = px;
    if (py < y0) y0 = py;
    if (px > x1) x1 = px;
    if (py > y1) y1 = py;
  }
  if (!pts.length) return null;
  const width = num(el.width, 2);
  const pad = width;
  const highlighter = el.highlighter === true;
  return (
    <Node
      el={el}
      x={x0 - pad}
      y={y0 - pad}
      w={x1 - x0 + pad * 2}
      h={y1 - y0 + pad * 2}
      // Overlapping highlighter ink darkens (multiply) against everything below.
      extraStyle={highlighter ? { mixBlendMode: 'multiply' } : undefined}
    >
      <Geo x={x0 - pad} y={y0 - pad} w={x1 - x0 + pad * 2} h={y1 - y0 + pad * 2}>
        {/* No vector-effect: drawn ink is world content and scales with zoom. */}
        <path
          d={penPathD(pts)}
          fill="none"
          stroke={str(el.color, '#1a1a1a')}
          strokeWidth={width}
          strokeLinecap="round"
          strokeLinejoin="round"
          pointerEvents={hit(interactive, 'stroke')}
        />
      </Geo>
    </Node>
  );
}

function ImageView({ el, interactive, resolveAsset }: ElementNodeProps) {
  const x = num(el.x);
  const y = num(el.y);
  const w = num(el.w);
  const h = num(el.h);
  return (
    <Node el={el} x={x} y={y} w={w} h={h} rot={num(el.rot)}>
      <Geo x={x} y={y} w={w} h={h}>
        <image
          x={x}
          y={y}
          width={w}
          height={h}
          href={resolveAsset(str(el.href))}
          preserveAspectRatio="xMidYMid meet"
          aria-label={str(el.alt) || undefined}
          pointerEvents={hit(interactive)}
        />
      </Geo>
    </Node>
  );
}

function LinkView({ el, interactive }: ElementNodeProps) {
  const x = num(el.x);
  const y = num(el.y);
  const w = num(el.w);
  const h = num(el.h);
  const lay = linkCardLayout(x, y, w, h);
  const font = { fontFamily: TEXT_FONT } as const;
  return (
    <Node el={el} x={x} y={y} w={w} h={h} rot={num(el.rot)}>
      <Geo x={x} y={y} w={w} h={h}>
        <g
          data-url={str(el.url)}
          data-title={str(el.title)}
          data-domain={str(el.domain)}
          pointerEvents={hit(interactive)}
        >
          <rect
            x={x}
            y={y}
            width={w}
            height={h}
            rx={8}
            ry={8}
            fill={LINK_CARD_FILL}
            stroke={LINK_CARD_STROKE}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
            filter="url(#dc-sticky-shadow)"
          />
          <svg
            x={lay.glyph.x}
            y={lay.glyph.y}
            width={lay.glyph.size}
            height={lay.glyph.size}
            viewBox="0 0 24 24"
            fill="none"
            stroke={LINK_GLYPH_STROKE}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d={LINK_GLYPH_D1} />
            <path d={LINK_GLYPH_D2} />
          </svg>
          <text
            x={lay.textX}
            y={lay.domain.y}
            fontSize={lay.domain.fontSize}
            fill={LINK_DOMAIN_FILL}
            dominantBaseline="hanging"
            style={font}
          >
            {str(el.domain)}
          </text>
          <text
            x={lay.textX}
            y={lay.title.y}
            fontSize={lay.title.fontSize}
            fill={LINK_TITLE_FILL}
            fontWeight={600}
            dominantBaseline="hanging"
            style={font}
          >
            {clampLinkTitle(str(el.title), lay.textMaxChars)}
          </text>
        </g>
      </Geo>
    </Node>
  );
}

function MediaRefView({ el, interactive }: ElementNodeProps) {
  const x = num(el.x);
  const y = num(el.y);
  const w = num(el.w);
  const h = num(el.h);
  const HEADER = 26;
  const isAudio = el.media === 'audio';
  const src = str(el.src);
  const font = { fontFamily: TEXT_FONT } as const;
  return (
    <Node el={el} x={x} y={y} w={w} h={h} rot={num(el.rot)}>
      <Geo x={x} y={y} w={w} h={h}>
        <g
          data-src={src}
          data-media-kind={isAudio ? 'audio' : 'video'}
          data-title={str(el.title)}
          pointerEvents={hit(interactive)}
        >
          <rect
            x={x}
            y={y}
            width={w}
            height={h}
            rx={8}
            ry={8}
            fill={LINK_CARD_FILL}
            stroke={LINK_CARD_STROKE}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
            filter="url(#dc-sticky-shadow)"
          />
          <svg
            x={x + 8}
            y={y + 5}
            width={16}
            height={16}
            viewBox="0 0 24 24"
            fill={LINK_GLYPH_STROKE}
            stroke="none"
            aria-hidden="true"
          >
            <path d={isAudio ? MEDIAREF_AUDIO_GLYPH : MEDIAREF_VIDEO_GLYPH} />
          </svg>
          <text
            x={x + 30}
            y={y + 9}
            fontSize={11}
            fill={LINK_TITLE_FILL}
            fontWeight={600}
            dominantBaseline="hanging"
            style={font}
          >
            {clampLinkTitle(str(el.title), Math.max(8, Math.floor((w - 40) / 7)))}
          </text>
          {src ? null : (
            <text
              x={x + 30}
              y={y + HEADER + 10}
              fontSize={10}
              fill={LINK_DOMAIN_FILL}
              dominantBaseline="hanging"
              style={font}
            >
              (missing media reference)
            </text>
          )}
        </g>
      </Geo>
    </Node>
  );
}

/** Section title chip geometry — screen-size-constant (counter-scaled by zoom). */
export function sectionChip(label: string, zoom: number) {
  const fontSize = SECTION_LABEL_FONT / zoom;
  const chipH = SECTION_LABEL_H / zoom;
  const gap = 4 / zoom;
  const padX = 9 / zoom;
  const chipW = Math.max(56 / zoom, label.length * fontSize * 0.62 + 18 / zoom);
  return { fontSize, chipH, gap, padX, chipW };
}

function SectionChip({
  el,
  interactive,
  edit,
  note,
}: {
  el: AnnotationElement;
  interactive: boolean;
  edit: EditRequest | null;
  note?: string;
}) {
  // Counter-scaled chrome needs the live zoom, not the settle-cadence one.
  const zoom = useLiveViewport().zoom || 1;
  const label = str(el.label, 'Section');
  const color = str(el.color, '#8a8a8a');
  const g = sectionChip(label, zoom);
  const style: CSSProperties = {
    fontFamily: TEXT_FONT,
    fontSize: `${g.fontSize}px`,
    lineHeight: `${g.chipH}px`,
    color,
    padding: `0 ${g.padX}px`,
    textAlign: 'left',
  };
  const box: CSSProperties = {
    top: -(g.chipH + g.gap),
    minWidth: g.chipW,
    height: g.chipH,
    borderRadius: 5 / zoom,
    // Same wash the SVG chip had (fill-opacity 0.16).
    backgroundColor: `color-mix(in oklab, ${color} 16%, transparent)`,
    pointerEvents: interactive ? 'auto' : 'none',
  };
  if (edit) {
    return (
      <div className="dc-annot-chip" style={{ ...box, zIndex: 1 }}>
        <TextEditor
          initialText={label}
          singleLine
          className="dc-annot-text dc-annot-text--nowrap"
          style={style}
          size={{ kind: 'fit-both', minWidth: g.chipW }}
          fmt={{ fontSize: g.fontSize }}
          caretPoint={edit.caretPoint}
          ariaLabel="Rename section"
          onCommit={edit.onCommit}
          onCancel={edit.onCancel}
          onDraft={edit.onDraft}
        />
      </div>
    );
  }
  return (
    <div
      className="dc-annot-chip"
      data-section-chip="1"
      style={{ ...box, width: note ? undefined : g.chipW, whiteSpace: 'nowrap' }}
    >
      <div className="dc-annot-text dc-annot-text--nowrap" style={style}>
        {label}
        {note ? (
          <span data-fold-note="1" style={{ opacity: 0.75, marginLeft: 8, fontWeight: 500 }}>
            {note}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function SectionView({ el, interactive, edit, foldNote }: ElementNodeProps) {
  const x = num(el.x);
  const y = num(el.y);
  const w = num(el.w);
  const h = num(el.h);
  const color = str(el.color, '#8a8a8a');
  // S4.12 - folded: the members are not drawn, so the body is a faint dashed outline and the chip says what is inside.
  const folded = el.folded === true;
  // S4.13 - and a folded section is ONE LINE on the board: the strip under its chip, not the full outline.
  // The element keeps its size in the file, so Unfold restores it.
  const drawnH = folded ? Math.min(h, SECTION_FOLDED_H) : h;
  return (
    <Node el={el} x={x} y={y} w={w} h={drawnH} raised={!!edit}>
      <Geo x={x} y={y} w={w} h={drawnH}>
        {/* Body: pure backdrop, click-through (content on a section selects normally). */}
        <rect
          x={x}
          y={y}
          width={w}
          height={drawnH}
          rx={SECTION_CORNER_RADIUS}
          ry={SECTION_CORNER_RADIUS}
          fill={color}
          fillOpacity={folded ? 0.03 : 0.07}
          stroke={color}
          strokeOpacity={folded ? 0.3 : 0.45}
          strokeWidth={1.5}
          strokeDasharray={folded ? '6 5' : undefined}
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
        />
        {/* Invisible border ring — the grabbable edge. */}
        {interactive ? (
          <rect
            x={x}
            y={y}
            width={w}
            height={drawnH}
            rx={SECTION_CORNER_RADIUS}
            ry={SECTION_CORNER_RADIUS}
            fill="none"
            stroke="transparent"
            strokeWidth={12}
            vectorEffect="non-scaling-stroke"
            pointerEvents="stroke"
          />
        ) : null}
      </Geo>
      <SectionChip
        el={el}
        interactive={interactive}
        edit={edit}
        note={folded ? (foldNote ?? '') : undefined}
      />
      {edit ? <EditNotice notice={edit.notice} /> : null}
    </Node>
  );
}

/** A placeholder never grows past this (world units) — a hostile record can't blanket the board. */
const PLACEHOLDER_MAX = 2000;
const clampPx = (v: number, lo: number) => Math.min(PLACEHOLDER_MAX, Math.max(lo, v));

function PlaceholderView({ el }: ElementNodeProps) {
  const x = num(el.x);
  const y = num(el.y);
  const w = clampPx(num(el.w), 40);
  const h = clampPx(num(el.h), 24);
  return (
    <Node el={el} x={x} y={y} w={w} h={h}>
      <div
        className="dc-annot-placeholder"
        title="Made with a newer version of Maude — kept as is"
        style={{ pointerEvents: 'none' }}
      >
        {el.type}
      </div>
    </Node>
  );
}

// A Map, never a plain object: `type` is peer data, and a lookup on an object
// would resolve `constructor` & co. to inherited members (security review A1).
const VIEWS = new Map<string, (p: ElementNodeProps) => ReactNode>([
  ['sticky', StickyView],
  ['text', TextView],
  ['shape', ShapeView],
  ['arrow', ArrowView],
  ['pen', PenView],
  ['image', ImageView],
  ['link', LinkView],
  ['mediaref', MediaRefView],
  ['section', SectionView],
]);

/**
 * Register how a runtime-registered element type draws (see
 * `registerElementType`). Without one it draws as a labelled placeholder.
 * `Node` is the positioned wrapper every view uses.
 */
export function registerElementView(type: string, view: (p: ElementNodeProps) => ReactNode): void {
  if (VIEWS.has(type)) throw new Error(`"${type}" already has a view`);
  VIEWS.set(type, view);
}

/** The counterpart of `registerElementView` (a runtime type going away with `unregisterElementType`). */
export function unregisterElementView(type: string): void {
  if (BUILTIN_VIEWS.has(type)) throw new Error(`"${type}" is a built-in element view`);
  VIEWS.delete(type);
}
const BUILTIN_VIEWS = new Set(VIEWS.keys());

export { Node as ElementBox };

/**
 * One element that fails to render (a malformed peer record, a bug in a view)
 * draws as a placeholder instead of unmounting the whole canvas.
 */
class ElementBoundary extends Component<ElementNodeProps, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  override componentDidUpdate(prev: ElementNodeProps): void {
    if (this.state.failed && prev.el !== this.props.el) this.setState({ failed: false });
  }
  override render(): ReactNode {
    if (this.state.failed) return <PlaceholderView {...this.props} />;
    const View = VIEWS.get(this.props.el.type) ?? PlaceholderView;
    return <View {...this.props} />;
  }
}

function ElementNodeImpl(props: ElementNodeProps) {
  countRender('annotationNodeRenders');
  return <ElementBoundary {...props} />;
}

function sameEnds(a?: ResolvedEnds, b?: ResolvedEnds): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.x1 === b.x1 &&
    a.y1 === b.y1 &&
    a.x2 === b.x2 &&
    a.y2 === b.y2 &&
    a.startAnchor?.nx === b.startAnchor?.nx &&
    a.startAnchor?.ny === b.startAnchor?.ny &&
    a.endAnchor?.nx === b.endAnchor?.nx &&
    a.endAnchor?.ny === b.endAnchor?.ny &&
    sameRoute(a.route, b.route) &&
    a.dangling?.start === b.dangling?.start &&
    a.dangling?.end === b.dangling?.end
  );
}

function sameRoute(a?: ResolvedEnds['route'], b?: ResolvedEnds['route']): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((p, i) => p.x === b[i]?.x && p.y === b[i]?.y);
}

export const ElementNode = memo(
  ElementNodeImpl,
  (a, b) =>
    a.el === b.el &&
    a.interactive === b.interactive &&
    a.quiet === b.quiet &&
    a.selected === b.selected &&
    a.mine === b.mine &&
    a.foldNote === b.foldNote &&
    a.typist === b.typist &&
    a.edit === b.edit &&
    a.resolveAsset === b.resolveAsset &&
    sameEnds(a.ends, b.ends)
);

/** Slot geometry for a pending (not yet born) standalone text at a world point. */
export function PendingTextNode({
  x,
  y,
  color,
  fontSize,
  edit,
}: {
  x: number;
  y: number;
  color: string;
  fontSize: number;
  edit: EditRequest;
}) {
  const style: CSSProperties = {
    ...slotTextStyle('text', { fontSize, color }),
    color,
    padding: '0 2px',
  };
  return (
    <div className="dc-annot-el" data-pending-text="1" style={{ left: x, top: y }}>
      <TextEditor
        initialText=""
        className="dc-annot-text dc-annot-text--nowrap"
        style={style}
        size={{ kind: 'fit-both' }}
        fmt={{ fontSize }}
        caretPoint={null}
        ariaLabel="Edit text"
        onCommit={edit.onCommit}
        onCancel={edit.onCancel}
      />
    </div>
  );
}

export type { SizeMode, TextSlot };
