// Brand: the logo files, the system's name, the brand colours (S10.6). Locked brand colours show
// the lock; the files behind it (SKILL.md, CONTRACT.md) stay where they are.
import { CAP, Frame, More, type SectionProps, Swatch } from './parts.tsx';

export function BrandSection({ model, mode }: SectionProps) {
  const brand = model.tokens.filter((t) => t.section === 'brand');
  const shown = brand.slice(0, CAP.brand);
  return (
    <Frame kind="brand" model={model} mode={mode}>
      <div className="ds-pad ds-col">
        <p className="ds-k">Name</p>
        <p className="ds-voice">{model.label}</p>
        <p className="ds-k ds-k--gap">Logo</p>
        {model.logos.length === 0 ? (
          <p className="ds-cap">No logo files yet.</p>
        ) : (
          <div className="ds-logos">
            {model.logos.map((l) => (
              <span key={l.file} className="ds-logos-tile" title={l.file}>
                {l.src ? <img src={l.src} alt={l.file} className="ds-logo-img" /> : <i>{l.file}</i>}
              </span>
            ))}
          </div>
        )}
        {shown.length ? (
          <>
            <p className="ds-k ds-k--gap">Brand colours</p>
            <div className="ds-swg-row">
              {shown.map((t) => (
                <Swatch key={t.css} token={t} model={model} />
              ))}
            </div>
            <More n={brand.length - shown.length} />
          </>
        ) : null}
      </div>
    </Frame>
  );
}
