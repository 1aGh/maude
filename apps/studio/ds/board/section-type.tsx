// Type: the families, the weights and the size ladder, each as real text in the system's own
// tokens (S10.6). A condensed display face shows as itself.
import { CAP, Frame, More, type SectionProps } from './parts.tsx';
import type { BoardToken } from './types.ts';

const SENTENCE = 'Calm, careful software for people who make things.';

const valueFor = (t: BoardToken, theme: string): string =>
  t.values[theme] ?? Object.values(t.values)[0] ?? '';

export function TypeSection({ model, mode }: SectionProps) {
  const all = model.tokens.filter((t) => t.section === 'type');
  const fonts = all.filter((t) => t.kind === 'font');
  const weights = all.filter((t) => t.kind === 'weight');
  const sizes = all.filter((t) => t.kind === 'length' && /^--(type|display)-/.test(t.css));
  const lh = (css: string) => css.replace(/^--(type|display)-/, '--lh-');
  const rows = [...fonts, ...sizes, ...weights].slice(0, CAP.type);
  const theme = model.themes.default;
  return (
    <Frame kind="type" model={model} mode={mode}>
      <div className="ds-pad ds-type">
        {all.length === 0 ? <p className="ds-cap">No type declared yet.</p> : null}
        {rows.map((t) => (
          <div
            key={t.css}
            className="ds-trow"
            data-ds-token={t.css}
            data-pending={t.pending ? 'true' : undefined}
          >
            <span className="ds-tname">
              <b>{t.label}</b>
              <em>{valueFor(t, theme)}</em>
            </span>
            <span
              className="ds-tsample"
              style={
                t.kind === 'font'
                  ? { fontFamily: `var(${t.css})` }
                  : t.kind === 'weight'
                    ? { fontWeight: `var(${t.css})` as unknown as number }
                    : { fontSize: `var(${t.css})`, lineHeight: `var(${lh(t.css)}, 1.25)` }
              }
            >
              {t.kind === 'font' ? 'Hamburgefonstiv 0123' : SENTENCE}
            </span>
          </div>
        ))}
        <More n={all.length - rows.length} />
      </div>
    </Frame>
  );
}
