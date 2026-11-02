// Brand: the board's hero (glyph tile, the system's name, one line saying what is in it), the logo
// specimen and the brand colours (S10.6). Locked brand colours show the lock; the files behind it
// (SKILL.md, CONTRACT.md) stay where they are.
import { useState } from 'react';
import { DsIcon } from '../../canvas-ds-icons.tsx';
import { type LogoTileModel, logoTiles } from './logo-paint.ts';
import { CAP, Frame, More, type SectionProps, Swatch } from './parts.tsx';
import type { BoardBrand, BoardModel } from './types.ts';

const NO_BRAND: BoardBrand = { icons: [], voice: null, say: null, rules: [] };

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

/** A logo file, its colours written in (logo-paint.ts); one the browser cannot draw is left out rather
 *  than shown as its broken-image alt text. The lockup also sits on the ink ground (board 13). */
function LogoTile({ tile }: { tile: LogoTileModel }) {
  const [broken, setBroken] = useState(false);
  if (broken) return null;
  return (
    <span
      className={`ds-logos-tile${tile.onInk ? ' ds-logos-tile--ink' : ''}${tile.wide ? ' ds-logos-tile--wide' : ''}`}
      data-testid={tile.onInk ? 'ds-logo-on-ink' : 'ds-logo-tile'}
      style={tile.ground ? { background: tile.ground } : undefined}
      title={tile.file}
    >
      {tile.src ? (
        <img
          src={tile.src}
          alt={tile.file}
          className="ds-logo-img"
          onError={() => setBroken(true)}
        />
      ) : (
        <i>{tile.file}</i>
      )}
    </span>
  );
}

export function BrandSection({ model, mode }: SectionProps) {
  const brand = model.tokens.filter((t) => t.section === 'brand');
  const shown = brand.slice(0, CAP.brand);
  const brand_ = model.brand ?? NO_BRAND;
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
            {logoTiles(model, mode).map((t) => (
              <LogoTile key={t.key} tile={t} />
            ))}
          </div>
        )}
        {brand_.icons.length ? (
          <>
            <p className="ds-k ds-k--gap">Icons</p>
            <div className="ds-icons" data-testid="ds-brand-icons">
              {brand_.icons.map((i) => (
                <span key={i.name} title={i.name}>
                  <i style={{ WebkitMaskImage: `url(${i.src})`, maskImage: `url(${i.src})` }} />
                </span>
              ))}
            </div>
          </>
        ) : null}
        {brand_.voice ? (
          <>
            <p className="ds-k ds-k--gap">Voice</p>
            <p className="ds-voice ds-voice--line">{brand_.voice}</p>
            {brand_.say ? (
              <p className="ds-say">
                <b>Say</b> {brand_.say.say} <b>not</b> {brand_.say.not}
              </p>
            ) : null}
          </>
        ) : null}
        {brand_.rules.length ? (
          <>
            <p className="ds-k ds-k--gap">Rules for AI and code</p>
            {brand_.rules.map((r) => (
              <p key={r} className="ds-rule">
                <svg
                  className="ds-tick"
                  viewBox="0 0 12 12"
                  width="12"
                  height="12"
                  aria-hidden="true"
                >
                  <path
                    d="M2.5 6.5l2.2 2.2 4.8-5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  />
                </svg>
                {r}
              </p>
            ))}
            <p className="ds-cap">
              Written to SKILL.md — Claude Code and other agents follow them too.
            </p>
          </>
        ) : null}
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
