// Colour: every colour token as Light | Dark swatches, grouped by ROLE in the order a person reads a
// palette — surfaces and text first, then the accent and its statuses (S10.6) — and under them the
// "Text on surfaces" pairs the way the system's own words promise them (contrast, Light | Dark).
import { contrastRatio } from '../../draw/palette.ts';
import { resolveColour } from '../contrast.ts';
import { CAP, Frame, GROUP_TITLES, More, type SectionProps, Swatch } from './parts.tsx';
import { type BoardModel, type BoardToken, humanize } from './types.ts';

/** The board's reading order: the group a role belongs to → the row it sits in (two groups a row). */
const ROWS: string[][] = [
  ['surfaces', 'text'],
  ['accent', 'status'],
  ['palette', 'focus'],
];
const TITLES: Record<string, string> = {
  palette: 'Brand and illustration',
  focus: 'Links and focus',
  borders: 'Lines',
};
/** Swatches a group draws before it says "+ N more in the files" — a group is a fixed-width column. */
const PER_GROUP = 7;

interface PairSpec {
  fg: string;
  bg: string;
  need: number;
}
/** The text-on-surface pairs a palette promises; only the ones the system declares are drawn. */
const PAIRS: PairSpec[] = [
  { fg: '--fg-0', bg: '--bg-0', need: 4.5 },
  { fg: '--fg-1', bg: '--bg-1', need: 4.5 },
  { fg: '--fg-2', bg: '--bg-2', need: 4.5 },
  { fg: '--fg-3', bg: '--bg-0', need: 3 },
  { fg: '--accent-text', bg: '--bg-0', need: 4.5 },
  { fg: '--accent-fg', bg: '--accent', need: 4.5 },
];

const valuesOf = (model: BoardModel, theme: string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const t of model.tokens) {
    const v =
      (t.pending && !t.pending.trashTo ? t.pending.values[theme] : undefined) ?? t.values[theme];
    if (typeof v === 'string') out[t.css] = v;
  }
  return out;
};

function ratioIn(values: Record<string, string>, p: PairSpec): number | null {
  const look = (n: string) => values[n];
  const fg = resolveColour(values[p.fg], look);
  const bg = resolveColour(values[p.bg], look);
  return fg && bg ? contrastRatio(fg, bg) : null;
}

const fmt = (r: number | null): string => (r === null ? '–' : r.toFixed(1));

export function Pairs({ model }: { model: BoardModel }) {
  const { light, dark } = model.themes;
  const byCss = new Map(model.tokens.map((t) => [t.css, t]));
  const lv = valuesOf(model, light);
  const dv = dark ? valuesOf(model, dark) : null;
  const rows = PAIRS.filter((p) => byCss.has(p.fg) && byCss.has(p.bg))
    .map((p) => ({ p, l: ratioIn(lv, p), d: dv ? ratioIn(dv, p) : null }))
    .filter((r) => r.l !== null)
    .slice(0, 5);
  if (!rows.length) return null;
  const name = (t: BoardToken | undefined) => t?.label ?? '';
  return (
    <div className="ds-pairs" data-ds-pairs="">
      <p className="ds-k">Text on surfaces — contrast{dv ? ', Light | Dark' : ''}</p>
      <div className="ds-pairs-row">
        {rows.map(({ p, l, d }) => {
          const warn = (l !== null && l < p.need) || (d !== null && d < p.need);
          const face = { color: `var(${p.fg})`, background: `var(${p.bg})` };
          return (
            <span key={`${p.fg}${p.bg}`} className="ds-pair" data-warn={warn ? 'true' : undefined}>
              <span className="ds-pair-t">
                <span data-ds-mode={light} style={face}>
                  Aa
                </span>
                {dark ? (
                  <span data-ds-mode={dark} style={face}>
                    Aa
                  </span>
                ) : null}
              </span>
              <b>
                {name(byCss.get(p.fg))} on {name(byCss.get(p.bg))}
              </b>
              <em>
                {fmt(l)}
                {dv ? ` | ${fmt(d)}` : ''}
                {warn ? ` — needs ${p.need}` : ''}
              </em>
            </span>
          );
        })}
      </div>
    </div>
  );
}

export function ColourSection({ model, mode }: SectionProps) {
  const all = model.tokens.filter((t) => t.section === 'colour');
  const groups = new Map<string, BoardToken[]>();
  for (const t of all) groups.set(t.group, [...(groups.get(t.group) ?? []), t]);
  const placed = new Set(ROWS.flat());
  const rest = [...groups.keys()].filter((g) => !placed.has(g));
  // the rows the board draws: the named pairs first, then every other role two to a row
  const order: string[][] = [
    ...ROWS.map((r) => r.filter((g) => groups.has(g))),
    ...rest.reduce<string[][]>((acc, g, i) => {
      if (i % 2 === 0) acc.push([g]);
      else acc[acc.length - 1].push(g);
      return acc;
    }, []),
  ].filter((r) => r.length);
  const { dark } = model.themes;
  let drawn = 0;
  return (
    <Frame kind="colour" model={model} mode={mode}>
      <div className="ds-pad ds-colour">
        <p className="ds-modekey">
          Each swatch: <b>Light</b>
          {dark ? (
            <>
              {' '}
              | <b>Dark</b>
            </>
          ) : null}
        </p>
        {all.length === 0 ? <p className="ds-cap">No colours declared yet.</p> : null}
        {order.map((row) => (
          <div key={row.join('+')} className="ds-swrow">
            {row.map((group) => {
              const tokens = groups.get(group) ?? [];
              const shown = tokens.slice(0, Math.min(PER_GROUP, CAP.colour));
              drawn += shown.length;
              return (
                <div key={group} className="ds-swg" data-ds-group={group}>
                  <p className="ds-k">{TITLES[group] ?? GROUP_TITLES[group] ?? humanize(group)}</p>
                  <div className="ds-swg-row">
                    {shown.map((t) => (
                      <Swatch key={t.css} token={t} model={model} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
        <More n={all.length - drawn} />
        <Pairs model={model} />
      </div>
    </Frame>
  );
}
