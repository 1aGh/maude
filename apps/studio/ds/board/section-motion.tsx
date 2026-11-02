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

/** What a duration is for, by the words in its name — the card says it under the curve. */
const JOBS: Array<[RegExp, string]> = [
  [/quick|fast|flip|instant|tap/i, 'Hover and press'],
  [/soft|fade|slow/i, 'Fades and tooltips'],
  [/panel|route|menu|sheet/i, 'Menus and panels'],
  [/spring|signature|land|bounce/i, 'A thing lands'],
];
const jobOf = (label: string): string => JOBS.find(([re]) => re.test(label))?.[1] ?? '';
const LINEAR: [number, number, number, number] = [0, 0, 1, 1];

export function MotionSection({ model, mode }: SectionProps) {
  const all = model.tokens.filter((t) => t.section === 'motion');
  const theme = model.themes.default;
  const durations = all
    .filter((t) => t.kind === 'duration')
    .sort((a, b) => (msOf(val(a, theme)) ?? 0) - (msOf(val(b, theme)) ?? 0));
  const easings = all.filter((t) => t.kind === 'easing');
  // a card = one duration with the curve it moves on; the curves pair off in order, the last one repeats
  const cards = durations.slice(0, 4).map((d, i) => {
    const e = easings.length ? easings[Math.min(i, easings.length - 1)] : null;
    return { d, e, b: (e ? bezierOf(val(e, theme)) : null) ?? LINEAR };
  });
  const drawn = new Set(cards.flatMap((c) => [c.d.css, c.e?.css]));
  const rest = all
    .filter((t) => !drawn.has(t.css))
    .slice(0, Math.max(0, CAP.motion - cards.length));
  return (
    <Frame kind="motion" model={model} mode={mode}>
      <div className="ds-pad ds-motion">
        {all.length === 0 ? <p className="ds-cap">No motion declared yet.</p> : null}
        {cards.map(({ d, b }) => (
          <div
            key={d.css}
            className="ds-mo"
            data-ds-token={d.css}
            data-ds-label={d.label}
            data-ds-kind={d.kind}
            data-pending={d.pending ? 'true' : undefined}
          >
            <Curve b={b} />
            <b>
              {d.label.replace(/^(dur|duration)\s+/i, '').replace(/^./, (c) => c.toUpperCase())}
              <em>{val(d, theme)}</em>
            </b>
            <span>{jobOf(d.label)}</span>
          </div>
        ))}
        {rest.map((t) => (
          <div
            key={t.css}
            className="ds-mo ds-mo--line"
            data-ds-token={t.css}
            data-ds-label={t.label}
            data-ds-kind={t.kind}
            data-pending={t.pending ? 'true' : undefined}
          >
            <b>
              {t.label}
              <em>{val(t, theme)}</em>
            </b>
          </div>
        ))}
        <More n={all.length - drawn.size - rest.length} />
        <p className="ds-cap ds-motion-foot">
          Reduce motion on this Mac: every curve becomes an instant cut.
        </p>
      </div>
    </Frame>
  );
}
