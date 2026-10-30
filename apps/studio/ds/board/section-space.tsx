// Space & shape: corners, spacing, elevation and the rest of the geometry (S10.6).
import { CAP, Frame, More, type SectionProps } from './parts.tsx';
import type { BoardToken } from './types.ts';

const val = (t: BoardToken, theme: string) => t.values[theme] ?? Object.values(t.values)[0] ?? '';
/** smallest first — the order a person reads a scale in, never the file's alphabetical one */
const num = (t: BoardToken, theme: string): number => {
  const n = Number.parseFloat(val(t, theme));
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
};
const bySize = (theme: string) => (a: BoardToken, b: BoardToken) => num(a, theme) - num(b, theme);
const dispVal = (v: string): string => (Number.parseFloat(v) >= 999 ? '∞' : v);
/** 'Radius lg' → 'Lg' — the group says what it is */
const short = (label: string): string => {
  const w = label.replace(/^(radius|corner|space|spacing)\s+/i, '');
  return w.charAt(0).toUpperCase() + w.slice(1);
};

export function SpaceSection({ model, mode }: SectionProps) {
  const all = model.tokens.filter((t) => t.section === 'space');
  const radii = all.filter((t) => t.group === 'radius' || /^--radius/.test(t.css));
  const spaces = all.filter((t) => t.group === 'space' || /^--space-/.test(t.css));
  const shadows = all.filter((t) => t.kind === 'shadow');
  const taken = new Set([...radii, ...spaces, ...shadows].map((t) => t.css));
  const rest = all.filter((t) => !taken.has(t.css));
  const theme = model.themes.default;
  const r = [...radii].sort(bySize(theme)).slice(0, 7);
  const s = [...spaces].sort(bySize(theme)).slice(0, 10);
  const e = shadows.slice(0, 5);
  const o = rest.slice(0, Math.max(0, CAP.space - r.length - s.length - e.length));
  const shown = r.length + s.length + e.length + o.length;
  return (
    <Frame kind="space" model={model} mode={mode}>
      <div className="ds-pad ds-col">
        {all.length === 0 ? <p className="ds-cap">No space or shape declared yet.</p> : null}
        {r.length ? <p className="ds-k">Corners</p> : null}
        <div className="ds-radii">
          {r.map((t) => (
            <span
              key={t.css}
              className="ds-rad"
              data-ds-token={t.css}
              data-ds-label={t.label}
              data-ds-kind={t.kind}
              data-pending={t.pending ? 'true' : undefined}
            >
              <i style={{ borderRadius: `var(${t.css})` }} />
              <b>{short(t.label)}</b>
              <em>{dispVal(val(t, theme))}</em>
            </span>
          ))}
        </div>
        {s.length ? <p className="ds-k ds-k--gap">Spacing</p> : null}
        <div className="ds-space">
          {s.map((t) => (
            <span
              key={t.css}
              data-ds-token={t.css}
              data-ds-label={t.label}
              data-ds-kind={t.kind}
              data-pending={t.pending ? 'true' : undefined}
            >
              <i style={{ height: `var(${t.css})` }} />
              <em>{val(t, theme)}</em>
            </span>
          ))}
        </div>
        {e.length ? <p className="ds-k ds-k--gap">Elevation</p> : null}
        <div className="ds-elev">
          {e.map((t) => (
            <span
              key={t.css}
              className="ds-el"
              style={{ boxShadow: `var(${t.css})` }}
              data-ds-token={t.css}
              data-ds-label={t.label}
              data-ds-kind={t.kind}
            >
              {t.label}
            </span>
          ))}
        </div>
        <p className="ds-k ds-k--gap">Layout</p>
        <div className="ds-grid" aria-hidden="true">
          {Array.from({ length: 12 }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: twelve identical columns
            <i key={i} />
          ))}
        </div>
        <p className="ds-bps">
          <b>12 columns</b>
        </p>
        {o.map((t) => (
          <p
            key={t.css}
            className="ds-kv"
            data-ds-token={t.css}
            data-ds-label={t.label}
            data-ds-kind={t.kind}
          >
            <b>{t.label}</b>
            <em>{val(t, theme)}</em>
          </p>
        ))}
        <More n={all.length - shown} />
      </div>
    </Frame>
  );
}
