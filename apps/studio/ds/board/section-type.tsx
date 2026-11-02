// Type: the system's type ROLES as real sentences, each drawn with the role's own look (S10.6) — the
// board shows Title · Heading · Body · Caption …, not the size ladder as a file would list it. The
// families come last, as themselves; a condensed display face shows as itself.
import { CAP, Frame, type SectionProps } from './parts.tsx';
import type { BoardModel, BoardToken } from './types.ts';

/** One sentence per role: real copy, so the specimen reads as text and not as a font test. */
const SENTENCES: Record<string, string> = {
  title: 'Calm, careful software.',
  heading: 'Three ways we help',
  subheading: 'Small apps for teams who would rather not shout',
  body: 'We design and build small, careful apps for teams who would rather not shout.',
  'body-sm': 'Monthly · Yearly — save two months',
  caption: 'Photo: Kraví hora, Brno',
  label: 'Email address',
  eyebrow: 'New this spring',
  code: 'const accent = "var(--accent)"',
  num: '12 € · 29 € · 79 €',
};
const NAMES: Record<string, string> = { 'body-sm': 'Body small' };

const valueFor = (t: BoardToken, theme: string): string =>
  t.values[theme] ?? Object.values(t.values)[0] ?? '';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const varName = (v: string | undefined): string | null =>
  /var\(\s*(--[\w-]+)/.exec(v ?? '')?.[1] ?? null;
const px = (v: string): string => {
  const m = /^([\d.]+)px$/.exec(v.trim());
  return m ? m[1] : v;
};
const WEIGHTS: Record<string, string> = {
  '300': 'Light',
  '400': 'Regular',
  '500': 'Medium',
  '600': 'Semibold',
  '700': 'Bold',
  '800': 'Heavy',
};

/** "35 · Semibold" — the role's size and weight, read from the tokens its look names. */
function metaOf(
  style: Record<string, string> | undefined,
  tokens: Map<string, BoardToken>,
  theme: string
): string {
  const val = (prop: string): string => {
    const v = style?.[prop];
    const n = varName(v);
    const t = n ? tokens.get(n) : undefined;
    return t ? valueFor(t, theme) : (v ?? '');
  };
  const size = val('font-size');
  const w = val('font-weight');
  const feat = style?.['font-variant-numeric'];
  return [size ? px(size) : '', w ? (WEIGHTS[w.trim()] ?? w) : '', feat ? 'Tabular figures' : '']
    .filter(Boolean)
    .join(' · ');
}

function families(model: BoardModel, theme: string) {
  return model.tokens
    .filter((t) => t.section === 'type' && t.kind === 'font')
    .map((t) => ({ t, v: valueFor(t, theme).split(',')[0].replace(/["']/g, '').trim() }));
}

export function TypeSection({ model, mode }: SectionProps) {
  const all = model.tokens.filter((t) => t.section === 'type');
  const theme = model.themes.default;
  const byCss = new Map(all.map((t) => [t.css, t]));
  const roles = model.typeRoles.slice(0, CAP.type);
  const fonts = families(model, theme);
  return (
    <Frame kind="type" model={model} mode={mode}>
      <div className="ds-pad ds-type">
        {all.length === 0 && roles.length === 0 ? (
          <p className="ds-cap">No type declared yet.</p>
        ) : null}
        {roles.map((r) => {
          // the role's own look, from its fallback declarations — so a system whose CSS has no `.t-*`
          // class for it still draws the role; the class goes on too and wins where the system styles it
          const style: Record<string, string> = {};
          for (const [prop, v] of Object.entries(r.style ?? {})) {
            if (/^[a-z-]+$/.test(prop))
              style[prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v;
          }
          // selecting the row edits the size the role is set in (the token the inspector's type kind owns)
          const sizeTok = byCss.get(varName(r.style?.['font-size']) ?? '');
          return (
            <div
              key={r.role}
              className="ds-trow"
              data-ds-role={r.role}
              data-ds-token={sizeTok?.css}
              data-ds-label={sizeTok?.label}
              data-ds-kind={sizeTok?.kind}
              data-pending={sizeTok?.pending ? 'true' : undefined}
            >
              <span className="ds-tname">
                <b>{NAMES[r.role] ?? cap(r.role)}</b>
                <em>{metaOf(r.style, byCss, theme)}</em>
              </span>
              <span className={`ds-tsample ${r.class}`} style={style}>
                {SENTENCES[r.role] ?? SENTENCES.body}
              </span>
            </div>
          );
        })}
        {fonts.length ? (
          <p className="ds-cap ds-type-foot">
            {fonts.map(({ t, v }, i) => (
              <span
                key={t.css}
                data-ds-token={t.css}
                data-ds-label={t.label}
                data-ds-kind={t.kind}
                data-pending={t.pending ? 'true' : undefined}
              >
                {i ? ' · ' : ''}
                {cap(t.label.replace(/^font\s+/i, ''))}{' '}
                <span style={{ fontFamily: `var(${t.css})` }}>{v}</span>
              </span>
            ))}
          </p>
        ) : null}
      </div>
    </Frame>
  );
}
