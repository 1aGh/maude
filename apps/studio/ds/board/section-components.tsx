// Components: one master tile per entry in components.json, drawn with the system's own classes
// (S10.6). Variants × states × sizes and in-place edits are S10.10; this section lists the
// masters, their variants and where they are used.
import { Frame, type SectionProps } from './parts.tsx';
import { usedWords } from './types.ts';

export function ComponentsSection({ model, mode }: SectionProps) {
  const comps = model.components;
  return (
    <Frame kind="components" model={model} mode={mode}>
      <div className="ds-pad ds-comps">
        {comps.length === 0 ? <p className="ds-cap">No components declared yet.</p> : null}
        {comps.slice(0, 12).map((c) => {
          const used = usedWords(c.used);
          const variants = c.variants.length ? c.variants : [{ name: c.label, class: null }];
          return (
            <div
              key={c.name}
              className="ds-m"
              data-ds-master={c.name}
              data-pending={c.pending ? 'true' : undefined}
            >
              <span className="ds-m-hd">
                <b>{c.label}</b>
                {used ? <em>{used}</em> : null}
                {c.pending ? <span className="ds-flag ds-flag--inline">as edited</span> : null}
              </span>
              <div className="ds-m-body">
                {variants.slice(0, 4).map((v) => (
                  <span
                    key={v.name}
                    className={['ds-m-sample', c.className, v.class].filter(Boolean).join(' ')}
                    title={v.name}
                  >
                    {v.name}
                  </span>
                ))}
              </div>
              {c.sizes.length ? (
                <p className="ds-cap">Sizes: {c.sizes.map((s) => s.name).join(' · ')}</p>
              ) : null}
            </div>
          );
        })}
      </div>
    </Frame>
  );
}
