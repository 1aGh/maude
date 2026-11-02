// client/v2/import/brand-result.jsx — S8.18: what Import a brand found (canvas 12 · ia-brand).
//
// From (the sources), Colours (each with its role — click a role to change it), Fonts (found, or
// "the logo's lettering is drawn as shapes"), and a preview drawn in those colours and fonts.
// Advanced keeps the v1 "Copy command" (A-brand-upload-copy-command; testid brand-up-copy-command).
// Every value shown is a typed value from the server (DDR-173) — no site or logo text.

import { useState } from 'react';
import { setRole } from '../../../bin/_brand-colours.mjs';
import { brandCommand, brandPayload, ROLES, roleLabel } from './brand-model.js';

function RolePicker({ colour, index, colours, onRole }) {
  return (
    <label className="bi-role">
      <span className="bi-sr">Role for {colour.name}</span>
      <select
        className="bi-role-sel"
        value={colour.role}
        data-testid={`brand-colour-role-${index}`}
        onChange={(e) => onRole(setRole(colours, index, e.target.value))}
      >
        {ROLES.map((r) => (
          <option key={r} value={r}>
            {roleLabel(r)}
          </option>
        ))}
      </select>
    </label>
  );
}

function Preview({ colours, fonts }) {
  const by = (role) => colours.find((c) => c.role === role)?.value;
  const font = fonts[0]?.name;
  const style = {
    // brand values are data; a role nobody has falls back to the studio's own tokens
    '--bi-bg': by('background') ?? 'var(--bg-0)',
    '--bi-fg': by('text') ?? 'var(--fg-0)',
    '--bi-accent': by('accent') ?? by('second') ?? 'var(--fg-0)',
    '--bi-second': by('second') ?? by('accent') ?? 'var(--fg-2)',
    ...(font ? { '--bi-font': `"${font}", system-ui, sans-serif` } : {}),
  };
  return (
    <div
      className="bi-preview k-fixed"
      style={style}
      data-testid="brand-preview"
      aria-hidden="true"
    >
      <span className="bi-pv-bar">
        <i />
        <i />
        <i />
      </span>
      <span className="bi-pv-h">A headline in your style</span>
      <span className="bi-pv-s">Text in your colours and type.</span>
      <span className="bi-pv-cta">Get started</span>
    </div>
  );
}

export default function BrandResult({ brand, logoName, onRole, onStartOver }) {
  const [advanced, setAdvanced] = useState(false);
  const { colours, fonts } = brand;
  const command = brandCommand(brandPayload(brand));
  return (
    <div className="bi-result" data-testid="brand-up-result">
      <div className="bi-result-l">
        <p className="bi-bl">From</p>
        {brand.logoPreview ? (
          <span className="bi-src" data-testid="brand-src-logo">
            <span className="bi-src-logo">
              <img src={`/${brand.logoPreview}`} alt="" />
            </span>
            <span>
              <strong>{logoName ?? 'Logo'}</strong>
              <span>Logo · dropped</span>
            </span>
          </span>
        ) : null}
        {brand.host ? (
          <span className="bi-src" data-testid="brand-src-site">
            <span className="bi-src-ic" aria-hidden="true">
              ↗
            </span>
            <span>
              <strong>{brand.host}</strong>
              <span>Website · read once</span>
            </span>
          </span>
        ) : null}

        <p className="bi-bl">
          Colours{' '}
          <span className="bi-bl-n">
            {colours.length} found{colours.length ? ' · click a role to change it' : ''}
          </span>
        </p>
        {colours.length ? (
          <ul className="bi-swatches" data-testid="brand-up-palette">
            {colours.map((c, i) => (
              <li
                key={c.value}
                className="bi-swatch"
                data-testid={`brand-colour-${i}`}
                data-role={c.role}
              >
                <i style={{ background: c.value }} title={c.value} />
                <span className="bi-sw-n">{c.name}</span>
                <RolePicker colour={c} index={i} colours={colours} onRole={onRole} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="bi-fine">No colours could be read.</p>
        )}

        <p className="bi-bl">Fonts</p>
        <ul className="bi-fonts" data-testid="brand-up-fonts">
          {fonts.map((f) => (
            <li key={f.name} className="bi-font">
              <span className="k-sw k-sw--ok">
                <i />
                Found
              </span>
              <span>
                <strong>{f.name}</strong> —{' '}
                {f.from === 'site' ? 'from the website' : 'from the logo'}
              </span>
            </li>
          ))}
          {brand.letteringIsShapes ? (
            <li className="bi-font" data-testid="brand-lettering-shapes">
              <span className="k-sw k-sw--warn">
                <i />
                Not found
              </span>
              <span>The logo's lettering is drawn as shapes, so its font can't be read.</span>
            </li>
          ) : null}
          {!fonts.length && !brand.letteringIsShapes ? (
            <li className="bi-font">
              <span className="k-sw k-sw--off">
                <i />
                Not found
              </span>
              <span>No font was found — the style keeps its own.</span>
            </li>
          ) : null}
        </ul>

        <button
          type="button"
          className="bi-adv-toggle"
          aria-expanded={advanced}
          data-testid="brand-advanced"
          onClick={() => setAdvanced(!advanced)}
        >
          Advanced
        </button>
        {advanced ? (
          <div className="bi-adv">
            <p className="bi-fine">
              Or run <code>{command}</code> in the AI chat or your terminal.
            </p>
            <span className="bi-adv-row">
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                data-testid="brand-up-copy-command"
                onClick={() => navigator.clipboard?.writeText(command)}
              >
                Copy command
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                data-testid="brand-up-again"
                onClick={onStartOver}
              >
                Start over
              </button>
            </span>
          </div>
        ) : null}
      </div>
      <div className="bi-result-r">
        <p className="bi-bl">Preview</p>
        <Preview colours={colours} fonts={fonts} />
        <p className="bi-fine">
          Your canvases keep their content; colours and type follow the style. Version history keeps
          the old one.
        </p>
      </div>
    </div>
  );
}
