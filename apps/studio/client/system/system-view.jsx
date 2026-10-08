// system/system-view.jsx — moved verbatim out of client/app.jsx (Maude v2 plan V2-0.2, move-only split).

import { canvasUrl } from '../canvas-url.js';

// ---------- SystemView ----------
//
// DDR-048 — the System view renders the USER's design-system tokens. It does
// NOT read from `document.documentElement` (that would surface the dev-server
// shell's amber-rust chrome theme from styles/1-tokens.css, which is NOT a
// user template) and it does NOT assume any canonical token-name contract.
// Whatever the user's `colors_and_type.css` declared — names, values, theme
// blocks — is what shows up here.

// Order kinds match the typical reading flow of a tokens file. Unknown kinds
// fall through to `other` so a custom token group still renders, just last.
export const TOKEN_GROUP_ORDER = [
  'color',
  'space',
  'radius',
  'shadow',
  'leading',
  'weight',
  'motion',
  'font',
  'other',
];

export const TOKEN_GROUP_LABELS = {
  color: 'colors',
  space: 'spacing',
  radius: 'radii',
  shadow: 'shadows',
  leading: 'leading',
  weight: 'weights',
  motion: 'motion',
  font: 'font stacks',
  other: 'other',
};

export function isSwatchKind(kind) {
  return kind === 'color';
}

export function TokenLadder({ tokens, tokenGroups, tokensPath }) {
  if (!tokens || tokens.length === 0) {
    return (
      <section className="sv-section sv-section-tokens">
        <h2>
          tokens<span className="sv-h-num">0</span>
        </h2>
        <div className="sv-empty">
          <p>
            No tokens parsed from{' '}
            {tokensPath ? <code>{tokensPath}</code> : 'the configured tokens file'}. Does the file
            exist and contain CSS custom properties (<code>--name: value;</code>)?
          </p>
        </div>
      </section>
    );
  }

  const groups = tokenGroups || {};
  const kinds = Array.from(new Set([...TOKEN_GROUP_ORDER, ...Object.keys(groups)])).filter(
    (k) => groups[k]?.length
  );

  return (
    <>
      {kinds.map((kind) => {
        const list = groups[kind];
        const swatch = isSwatchKind(kind);
        return (
          <section className={'sv-section sv-section-tokens sv-section-' + kind} key={kind}>
            <h2>
              tokens · {TOKEN_GROUP_LABELS[kind] || kind}
              <span className="sv-h-num">{list.length}</span>
            </h2>
            <div className="sv-tokens-ladder">
              {list.map((t) => (
                <div className="sv-tok-cell" key={t.name + '|' + t.value}>
                  {swatch ? (
                    <div className="sv-tok-swatch" style={{ background: t.value }} />
                  ) : null}
                  <div className="sv-tok-meta">
                    <code className="sv-tok-name">{t.name}</code>
                    <span className="sv-tok-value">{t.value || '—'}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </>
  );
}

// Find a leading partner by name suffix: --fs-base → --lh-base, --type-xl → --lh-xl.
// Returns null when no convention match exists; caller omits the lineHeight style.
export function findLeadingFor(typeToken, leadingTokens) {
  const m = typeToken.name.match(/^--(?:type|fs|text)-(.+)$/);
  if (!m) return null;
  const suffix = m[1];
  return (
    (leadingTokens || []).find(
      (t) => /^--(?:lh|leading|line-height)-/.test(t.name) && t.name.endsWith('-' + suffix)
    )?.value ?? null
  );
}

// Best-effort sample font: prefer body / sans / display tokens, fall back to
// the first font-kind token, fall back to system-ui. Avoids the shell's
// Berkeley Mono leaking into user-facing previews.
export function sampleFontFamily(fontTokens) {
  if (!fontTokens?.length) return undefined;
  const prefer = ['body', 'sans', 'display', 'text', 'family'];
  for (const tag of prefer) {
    const hit = fontTokens.find((t) => t.name.includes(tag));
    if (hit) return hit.value;
  }
  return fontTokens[0].value;
}

export function TypeLadder({ tokenGroups }) {
  const typeTokens = tokenGroups?.fontsize || [];
  if (typeTokens.length === 0) return null;
  const leadingTokens = tokenGroups?.leading || [];
  const sampleFont = sampleFontFamily(tokenGroups?.font);

  return (
    <section className="sv-section sv-section-type">
      <h2>
        type · ladder<span className="sv-h-num">{typeTokens.length}</span>
      </h2>
      <div className="sv-type-list">
        {typeTokens.map((t) => {
          const lh = findLeadingFor(t, leadingTokens);
          const style = { fontSize: t.value };
          if (lh) style.lineHeight = lh;
          if (sampleFont) style.fontFamily = sampleFont;
          return (
            <div className="sv-type-row" key={t.name}>
              <code className="sv-type-tok">{t.name}</code>
              <span className="sv-type-sample" style={style}>
                The catalog is the system.
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function SystemView({ data, onOpen, cfg, onSelectDs }) {
  if (!data) {
    return (
      <div className="sv-empty">
        <p>Loading design system…</p>
      </div>
    );
  }
  const {
    previewGallery,
    uiKitsGallery,
    systemDir,
    tokens,
    tokenGroups,
    tokensPath,
    ds,
    availableDesignSystems,
  } = data;
  const empty =
    (!previewGallery || !previewGallery.length) && (!uiKitsGallery || !uiKitsGallery.length);
  const hasPicker = Array.isArray(availableDesignSystems) && availableDesignSystems.length > 1;
  const selectedName = ds?.name ?? availableDesignSystems?.[0]?.name ?? '';

  return (
    <div className="sv">
      <header className="sv-header">
        <span className="sv-sku">MAUDE-DSN/01</span>
        <span className="sv-title">design system view</span>
        {hasPicker ? (
          <label className="sv-ds-picker">
            <span className="sv-ds-picker-label">DS</span>
            <select value={selectedName} onChange={(e) => onSelectDs && onSelectDs(e.target.value)}>
              {availableDesignSystems.map((d) => (
                <option key={d.name} value={d.name}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <span className="sv-loc">
          <code>{systemDir}</code>
        </span>
      </header>

      {ds?.description ? <p className="sv-ds-description">{ds.description}</p> : null}

      <TokenLadder tokens={tokens} tokenGroups={tokenGroups} tokensPath={tokensPath} />
      <TypeLadder tokenGroups={tokenGroups} />

      {empty ? (
        <div className="sv-empty">
          <p>
            No <code>preview/</code> or <code>ui_kits/</code> folders found under{' '}
            <code>{systemDir}</code>.
          </p>
        </div>
      ) : (
        <>
          <Gallery
            title="preview"
            items={previewGallery}
            onOpen={onOpen}
            kind="preview"
            cfg={cfg}
          />
          <Gallery title="ui kits" items={uiKitsGallery} onOpen={onOpen} kind="ui_kits" cfg={cfg} />
        </>
      )}
    </div>
  );
}

export function Gallery({ title, items, onOpen, kind, cfg }) {
  if (!items || items.length === 0) return null;
  return (
    <section className="sv-section">
      <h2>
        {title} <span className="sv-count">{items.length}</span>
      </h2>
      <div className={'sv-previews sv-previews-' + kind}>
        {items.map((p) => (
          <article key={p.path} className="sv-preview-card" onClick={() => onOpen(p.path)}>
            <div className="sv-preview-frame">
              <iframe
                src={canvasUrl(p.path, cfg, { thumbnail: true })}
                title={p.label}
                scrolling="no"
                {...(cfg?.canvasOrigin ? { sandbox: 'allow-scripts allow-same-origin' } : {})}
              />
            </div>
            <div className="sv-preview-foot">
              <strong>{p.label}</strong>
              <code>{p.path}</code>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
