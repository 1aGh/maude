// Colour: every colour token as Light | Dark swatches, grouped by role (S10.6).
import { CAP, Frame, GROUP_TITLES, More, type SectionProps, Swatch } from './parts.tsx';
import { humanize } from './types.ts';

export function ColourSection({ model, mode }: SectionProps) {
  const all = model.tokens.filter((t) => t.section === 'colour');
  const shown = all.slice(0, CAP.colour);
  const groups = new Map<string, typeof shown>();
  for (const t of shown) groups.set(t.group, [...(groups.get(t.group) ?? []), t]);
  const { dark } = model.themes;
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
        {[...groups].map(([group, tokens]) => (
          <div key={group} className="ds-swg" data-ds-group={group}>
            <p className="ds-k">{GROUP_TITLES[group] ?? humanize(group)}</p>
            <div className="ds-swg-row">
              {tokens.map((t) => (
                <Swatch key={t.css} token={t} model={model} />
              ))}
            </div>
          </div>
        ))}
        <More n={all.length - shown.length} />
      </div>
    </Frame>
  );
}
