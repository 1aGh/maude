// Space & shape: corners, spacing, elevation and the rest of the geometry (S10.6).
import { CAP, Frame, More, type SectionProps } from './parts.tsx';
import type { BoardToken } from './types.ts';

const val = (t: BoardToken, theme: string) => t.values[theme] ?? Object.values(t.values)[0] ?? '';

export function SpaceSection({ model, mode }: SectionProps) {
  const all = model.tokens.filter((t) => t.section === 'space');
  const radii = all.filter((t) => t.group === 'radius' || /^--radius/.test(t.css));
  const spaces = all.filter((t) => t.group === 'space' || /^--space-/.test(t.css));
  const shadows = all.filter((t) => t.kind === 'shadow');
  const taken = new Set([...radii, ...spaces, ...shadows].map((t) => t.css));
  const rest = all.filter((t) => !taken.has(t.css));
  const theme = model.themes.default;
  const r = radii.slice(0, 7);
  const s = spaces.slice(0, 10);
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
              <b>{t.label}</b>
              <em>{val(t, theme)}</em>
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
        {o.length ? <p className="ds-k ds-k--gap">Layout</p> : null}
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
