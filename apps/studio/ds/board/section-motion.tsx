// Motion: durations as bars, easings as their curves (S10.6). Reduced motion is the system's own
// rule (every duration collapses to 1 ms); the board only says so.
import { CAP, Frame, More, type SectionProps } from './parts.tsx';
import type { BoardToken } from './types.ts';

const val = (t: BoardToken, theme: string) => t.values[theme] ?? Object.values(t.values)[0] ?? '';

/** `cubic-bezier(a,b,c,d)` → the four numbers, or null (a `var()` or a keyword is not drawn). */
export function bezierOf(v: string): [number, number, number, number] | null {
  const m = /^cubic-bezier\(\s*([^)]+)\)$/i.exec(v.trim());
  if (!m) return null;
  const n = m[1].split(',').map((x) => Number(x.trim()));
  return n.length === 4 && n.every((x) => Number.isFinite(x))
    ? (n as [number, number, number, number])
    : null;
}

function Curve({ b }: { b: [number, number, number, number] }) {
  const [x1, y1, x2, y2] = b;
  const y = (v: number) => 68 - v * 62;
  return (
    <svg className="ds-curve" viewBox="0 0 120 74" width="120" height="74" aria-hidden="true">
      <path className="ds-curve-ax" d="M4 6 V 68 H 116" />
      <path
        className="ds-curve-p"
        d={`M4 68 C ${4 + x1 * 112} ${y(y1)}, ${4 + x2 * 112} ${y(y2)}, 116 6`}
      />
    </svg>
  );
}

const msOf = (v: string): number | null => {
  const m = /^([\d.]+)(ms|s)$/.exec(v.trim());
  return m ? Number(m[1]) * (m[2] === 's' ? 1000 : 1) : null;
};

export function MotionSection({ model, mode }: SectionProps) {
  const all = model.tokens.filter((t) => t.section === 'motion');
  const shown = all.slice(0, CAP.motion);
  const theme = model.themes.default;
  return (
    <Frame kind="motion" model={model} mode={mode}>
      <div className="ds-pad ds-motion">
        {all.length === 0 ? <p className="ds-cap">No motion declared yet.</p> : null}
        {shown.map((t) => {
          const v = val(t, theme);
          const b = t.kind === 'easing' ? bezierOf(v) : null;
          const ms = t.kind === 'duration' ? msOf(v) : null;
          return (
            <div
              key={t.css}
              className="ds-mo"
              data-ds-token={t.css}
              data-ds-label={t.label}
              data-ds-kind={t.kind}
              data-pending={t.pending ? 'true' : undefined}
            >
              {b ? <Curve b={b} /> : null}
              {ms !== null ? (
                <span className="ds-bar-d">
                  <i style={{ width: `${Math.min(100, Math.max(4, ms / 8))}%` }} />
                </span>
              ) : null}
              <b>
                {t.label}
                <em>{v}</em>
              </b>
            </div>
          );
        })}
        <More n={all.length - shown.length} />
        <p className="ds-cap ds-motion-foot">
          Reduce motion on this Mac: every curve becomes an instant cut.
        </p>
      </div>
    </Frame>
  );
}
