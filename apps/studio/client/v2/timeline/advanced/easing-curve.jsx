// client/v2/timeline/advanced/easing-curve.jsx — S7.18: the curve of one keyframe (07 ve-advanced "Easing").
//
// Two handles on a cubic Bézier; letting go writes `Easing.bezier(a, b, c, d)` into the video
// (`video.easing.set`), and the row under the curve reads it back as `cubic-bezier(a, b, c, d)`. A curve the
// video writes another way is shown as written and left alone until a handle is dragged. Handles move with
// the arrow keys too (a step of 0.02, ⇧ for 0.1), and "Straight line" takes the curve off.

import { useRef, useState } from 'react';
import { bezierAt, EASE_OUT, formatBezier } from '../../../../video/keyframes.ts';
import { ADV_WORDS, valuesLine } from './model.js';

// The plot, in the 340 × 150 viewBox: x 16 → 324, value 0 → y 120, value 1 → y 30 (room above and below for overshoot).
const X0 = 16;
const X1 = 324;
const Y0 = 120;
const Y1 = 30;
const px = (x) => X0 + x * (X1 - X0);
const py = (y) => Y0 - y * (Y0 - Y1);
const unx = (p) => (p - X0) / (X1 - X0);
const uny = (p) => (Y0 - p) / (Y0 - Y1);
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const round = (n) => Math.round(n * 1000) / 1000;

/** The path of the curve, 40 samples — it follows the handles exactly, whatever the numbers. */
export function curvePath(b) {
  const pts = [];
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    pts.push(`${i === 0 ? 'M' : 'L'}${px(t).toFixed(1)} ${py(bezierAt(b, t)).toFixed(1)}`);
  }
  return pts.join('');
}

const STRAIGHT = [0, 0, 1, 1];

/**
 * @param {{ info: { easing: { kind: string, bezier?: number[], css?: string, text?: string }, prop: string|null, values: string[]|null } | null,
 *   from: number, to: number, name: string, canEdit: boolean, onWrite: (b: number[]|null) => void }} p
 */
export function EasingCurve({ info, from, to, name, canEdit, onWrite }) {
  const svgRef = useRef(null);
  const read = info?.easing ?? { kind: 'none' };
  const stored = read.kind === 'bezier' ? read.bezier : STRAIGHT;
  const [draft, setDraft] = useState(null);
  const b = draft ?? stored;
  const drag = useRef(null);

  const at = (e) => {
    const r = svgRef.current.getBoundingClientRect();
    const x = ((e.clientX - r.left) / Math.max(1, r.width)) * 340;
    const y = ((e.clientY - r.top) / Math.max(1, r.height)) * 150;
    return [clamp(unx(x), 0, 1), clamp(uny(y), -0.3, 1.3)];
  };
  const move = (which, [x, y]) => {
    const next = [...(draft ?? stored)];
    next[which * 2] = round(x);
    next[which * 2 + 1] = round(y);
    setDraft(next);
    return next;
  };
  const commit = (next) => {
    setDraft(null);
    if (next && formatBezier(next) !== formatBezier(stored)) onWrite(next);
  };

  const handle = (which) => {
    const hx = px(b[which * 2]);
    const hy = py(b[which * 2 + 1]);
    const label = which === 0 ? 'Start of the curve' : 'End of the curve';
    return (
      <g key={which}>
        <path
          className="tla-curve-arm"
          d={which === 0 ? `M${X0} ${Y0}L${hx} ${hy}` : `M${X1} ${Y1}L${hx} ${hy}`}
        />
        <circle
          className="tla-curve-h"
          cx={hx}
          cy={hy}
          r="6"
          tabIndex={canEdit ? 0 : -1}
          role="slider"
          aria-roledescription="curve handle"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(b[which * 2] * 100)}
          aria-valuetext={`${round(b[which * 2])}, ${round(b[which * 2 + 1])}`}
          aria-readonly={!canEdit}
          data-testid={`timeline-easing-handle-${which}`}
          onPointerDown={(e) => {
            if (!canEdit) return;
            e.currentTarget.setPointerCapture?.(e.pointerId);
            drag.current = { which, last: null };
          }}
          onPointerMove={(e) => {
            if (!drag.current) return;
            drag.current.last = move(drag.current.which, at(e));
          }}
          onPointerUp={() => {
            const d = drag.current;
            drag.current = null;
            if (d?.last) commit(d.last);
          }}
          onKeyDown={(e) => {
            if (!canEdit) return;
            const step = e.shiftKey ? 0.1 : 0.02;
            const d = {
              ArrowLeft: [-step, 0],
              ArrowRight: [step, 0],
              ArrowUp: [0, step],
              ArrowDown: [0, -step],
            }[e.key];
            if (!d) return;
            e.preventDefault();
            e.stopPropagation();
            const next = [...b];
            next[which * 2] = round(clamp(next[which * 2] + d[0], 0, 1));
            next[which * 2 + 1] = round(clamp(next[which * 2 + 1] + d[1], -0.3, 1.3));
            onWrite(next);
          }}
        />
      </g>
    );
  };

  const easingText =
    read.kind === 'bezier' ? read.css : read.kind === 'other' ? read.text : 'linear';
  const line = info?.values ? valuesLine(info.values) : null;
  return (
    // biome-ignore lint/a11y/useSemanticElements: a labelled curve editor (svg + readout), not a form fieldset
    <div
      className="tla-curve-wrap"
      role="group"
      aria-label={ADV_WORDS.easing(name)}
      data-testid="timeline-easing"
    >
      <div className="tla-curve">
        <svg ref={svgRef} viewBox="0 0 340 150" preserveAspectRatio="none">
          <title>{ADV_WORDS.easing(name)}</title>
          <path
            className="tla-curve-grid"
            d="M0 37.5H340M0 75H340M0 112.5H340M85 0V150M170 0V150M255 0V150"
          />
          <path className="tla-curve-line" d={curvePath(read.kind === 'other' ? STRAIGHT : b)} />
          {read.kind === 'other' ? null : [handle(0), handle(1)]}
        </svg>
        <span className="tla-curve-lab" style={{ left: 8, bottom: 4 }}>
          frame {from}
        </span>
        <span className="tla-curve-lab" style={{ right: 8, bottom: 4 }}>
          frame {to}
        </span>
      </div>
      <div className="tla-row">
        <span className="tla-k">easing</span>
        <span className="tla-v" data-testid="timeline-easing-value">
          {easingText}
        </span>
      </div>
      {info?.prop && line ? (
        <div className="tla-row">
          <span className="tla-k">{info.prop}</span>
          <span className="tla-v">{line}</span>
        </div>
      ) : null}
      <div className="tla-row">
        <span className="tla-k">frames</span>
        <span className="tla-v">
          {from} → {to}
        </span>
      </div>
      {read.kind === 'other' ? <p className="tla-note">{ADV_WORDS.otherCurve}</p> : null}
      {canEdit ? (
        <div className="tla-acts">
          {read.kind === 'other' ? (
            <button
              type="button"
              className="tla-btn"
              data-testid="timeline-easing-use-curve"
              onClick={() => onWrite([...EASE_OUT])}
            >
              {formatBezier(EASE_OUT)}
            </button>
          ) : null}
          {read.kind !== 'none' ? (
            <button
              type="button"
              className="tla-btn"
              data-testid="timeline-easing-straight"
              onClick={() => onWrite(null)}
            >
              {ADV_WORDS.straight}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
