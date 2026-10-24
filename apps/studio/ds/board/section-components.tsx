// Components: one master tile per entry in components.json, drawn with the system's own classes
// (S10.6, S10.10). Each tile shows the master across its variants, its states (hover · active · focus ·
// disabled — held with `.ds-force-<state>`, see component-states.ts) and its sizes, "as edited" while a
// change waits. Select a tile and the inspector edits its Corners · Fill · Text · Height (kinds/master.jsx).
import { Fragment } from 'react';
import { Frame, type SectionProps } from './parts.tsx';
import { type BoardComponent, usedWords } from './types.ts';

/** How many of each a tile draws; the tile is a fixed-size card on a fixed-size artboard. */
const AXIS_CAP = 5;
const TILES_CAP = 9;
const ROWS_CAP = 4;

const cls = (...p: Array<string | null | undefined | false>) => p.filter(Boolean).join(' ');
const STATE_WORDS: Record<string, string> = {
  hover: 'Hover',
  active: 'Pressed',
  focus: 'Focus',
  disabled: 'Disabled',
};

/**
 * One master as variants × states: a row per variant, a column per state it styles (Default first), then its
 * sizes — a designer-grade master shows every state, not one (13 · ds-board-studio).
 */
function Samples({ c }: { c: BoardComponent }) {
  const variants = (c.variants.length ? c.variants : [{ name: c.label, class: null }]).slice(
    0,
    ROWS_CAP
  );
  const states = c.states.slice(0, AXIS_CAP);
  const cols = states.length + 1;
  return (
    <div
      className="ds-var"
      style={{ gridTemplateColumns: `minmax(56px, auto) repeat(${cols}, 1fr)` }}
    >
      {states.length ? (
        <>
          <span className="ds-var-h" />
          <span className="ds-var-h">Default</span>
          {states.map((s) => (
            <span key={s} className="ds-var-h">
              {STATE_WORDS[s] ?? s}
            </span>
          ))}
        </>
      ) : null}
      {variants.map((v) => (
        <Fragment key={v.name}>
          {states.length || variants.length > 1 ? <span className="ds-var-n">{v.name}</span> : null}
          <span className="ds-var-c">
            <span
              className={cls('ds-m-sample', c.className, v.class)}
              data-ds-axis="variant"
              title={v.name}
            >
              {v.name}
            </span>
          </span>
          {states.map((s) => (
            <span key={s} className="ds-var-c">
              <span
                className={cls('ds-m-sample', c.className, v.class, `ds-force-${s}`)}
                data-ds-axis="state"
                data-ds-state={s}
                title={`${v.name} · ${s}`}
              >
                {v.name}
              </span>
            </span>
          ))}
        </Fragment>
      ))}
      {c.sizes.length ? (
        <>
          <span className="ds-var-n">Sizes</span>
          <span className="ds-var-sizes" style={{ gridColumn: `2 / span ${cols}` }}>
            {c.sizes.slice(0, AXIS_CAP).map((z) => (
              <span
                key={z.name}
                className={cls('ds-m-sample', c.className, z.class)}
                data-ds-axis="size"
                title={z.name}
              >
                {z.name}
              </span>
            ))}
          </span>
        </>
      ) : null}
    </div>
  );
}

const axisWords = (c: BoardComponent): string => {
  const n = (k: number, one: string, many: string) => (k ? `${k} ${k === 1 ? one : many}` : '');
  return [
    n(c.variants.length, 'variant', 'variants'),
    n(c.states.length, 'state', 'states'),
    n(c.sizes.length, 'size', 'sizes'),
  ]
    .filter(Boolean)
    .join(' · ');
};

export function ComponentsSection({ model, mode }: SectionProps) {
  const comps = model.components;
  return (
    <Frame kind="components" model={model} mode={mode}>
      <div className="ds-pad ds-comps">
        {comps.length === 0 ? <p className="ds-cap">No components declared yet.</p> : null}
        {[...comps]
          .sort((a, b) => b.states.length - a.states.length)
          .slice(0, TILES_CAP)
          .map((c) => {
            const used = usedWords(c.used);
            const words = axisWords(c);
            return (
              <div
                key={c.name}
                className="ds-m"
                style={c.states.length >= 3 ? { gridColumn: 'span 3' } : undefined}
                data-ds-master={c.name}
                data-ds-label={c.label}
                data-pending={c.pending ? 'true' : undefined}
              >
                <span className="ds-m-hd">
                  <b>{c.label}</b>
                  {used ? <em>{used}</em> : null}
                  {c.pending ? <span className="ds-flag ds-flag--inline">as edited</span> : null}
                </span>
                <div className="ds-m-body">
                  <Samples c={c} />
                </div>
                {words ? <p className="ds-cap ds-m-cap">{words}</p> : null}
              </div>
            );
          })}
        {comps.length > TILES_CAP ? (
          <p className="ds-more">{`+ ${comps.length - TILES_CAP} more components`}</p>
        ) : null}
      </div>
    </Frame>
  );
}
