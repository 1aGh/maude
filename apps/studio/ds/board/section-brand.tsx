// Brand: the board's hero (glyph tile, the system's name, one line saying what is in it), the logo
// specimen and the brand colours (S10.6). Locked brand colours show the lock; the files behind it
// (SKILL.md, CONTRACT.md) stay where they are.
import { useState } from 'react';
import { DsIcon } from '../../canvas-ds-icons.tsx';
import { CAP, Frame, More, type SectionProps, Swatch } from './parts.tsx';
import type { BoardModel } from './types.ts';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "7 sections · 60 colours, each with a Light and a Dark value · 10 type styles · 12 components · used by 5 canvases" */
export function heroLine(model: BoardModel): string {
  const colours = model.tokens.filter((t) => t.section === 'colour').length;
  const both = model.themes.dark ? ', each with a Light and a Dark value' : '';
  return [
    '7 sections',
    `${plural(colours, 'colour', 'colours')}${both}`,
    model.typeRoles.length ? plural(model.typeRoles.length, 'type style', 'type styles') : null,
    model.components.length
      ? `${plural(model.components.length, 'component', 'components')} with their states`
      : null,
    model.canvases ? `used by ${plural(model.canvases, 'canvas', 'canvases')}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** A logo file; one the browser cannot draw is left out rather than shown as its broken-image alt text. */
function LogoTile({ file, src }: { file: string; src: string | null }) {
  const [broken, setBroken] = useState(false);
  if (broken) return null;
  return (
    <span className="ds-logos-tile" title={file}>
      {src ? (
        <img src={src} alt={file} className="ds-logo-img" onError={() => setBroken(true)} />
      ) : (
        <i>{file}</i>
      )}
    </span>
  );
}

export function BrandSection({ model, mode }: SectionProps) {
  const brand = model.tokens.filter((t) => t.section === 'brand');
  const shown = brand.slice(0, CAP.brand);
  return (
    <Frame kind="brand" model={model} mode={mode}>
      <div className="ds-pad ds-col">
        <div className="ds-hero" data-testid="ds-hero">
          <span className="ds-hero-ic" aria-hidden="true">
            <DsIcon name="system" size={20} />
          </span>
          <p className="ds-hero-t">
            Design system <span>{model.label}</span>
          </p>
          <p className="ds-hero-s">{heroLine(model)}</p>
        </div>
        <p className="ds-k ds-k--gap">Logo</p>
        <p className="ds-voice">{model.label}</p>
        {model.logos.length === 0 ? (
          <p className="ds-cap">No logo files yet.</p>
        ) : (
          <div className="ds-logos">
            {model.logos.map((l) => (
              <LogoTile key={l.file} file={l.file} src={l.src} />
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
