// inspector/artboard-knobs.jsx — moved verbatim out of client/app.jsx (Maude v2 plan V2-0.2, move-only split).

import { activeDsNameFor, useAllDsTokens } from './ds-tokens.js';
import { SCREEN_PRESETS } from './css-vocab.jsx';
import { PAPER_PRESETS, resolvePrintArtboard } from '../../print/units.ts';
import { resolveHeightCommit } from '../../artboard-hug-commit.ts';
import {
  ColorField,
  NumberField,
  Segmented,
  Select,
  ValueTokenField,
} from '../inspector-controls.jsx';
import { TokenPopover } from './token-popover.jsx';
import { cssColorToHex } from './color.js';

// Dogfood 2026-07-07 — resolve the artboard id for a whole-artboard selection
// defensively: prefer `el.artboardId` (set by `hoverTargetToSelection` for a
// live chrome click), but fall back to parsing it out of `el.selector` — some
// selection-construction paths (Layers-tree artboard row, a restored
// `_active.json` selection) may not carry `artboardId` even though the
// selector is always the `[data-dc-screen="…"]` chrome form for one.
export function resolveArtboardIdFromSelection(el) {
  if (el.artboardId) return el.artboardId;
  const m = /^\[data-dc-screen="([^"]+)"\]$/.exec(el.selector || '');
  return m ? m[1] : null;
}

// Dogfood 2026-07-07 — the CSS tab showed everything disabled for a
// whole-ARTBOARD selection (`CssKnobs`'s `editable = !!el.id`, and an artboard
// chrome click has NO data-cd-id — DCArtboard doesn't forward it to the DOM).
// A dedicated, MUCH smaller panel: exact width/height fields (writes via
// /_api/resize-artboard, NOT edit-css — DDR-027 numeric JSX props) + the SAME
// SCREEN_PRESETS the "+ Artboard" menu uses, so picking "Tablet" resizes the
// CURRENT artboard to 834×1194 in one click instead of typing both fields.
export const ARTBOARD_LAYOUT_OPTIONS = [
  ['', 'Block (default)'],
  ['flex-col', 'Flex ↓ (column)'],
  ['flex-row', 'Flex → (row)'],
  ['grid', 'Grid'],
];

// feature-1-artboard-kinds-foundation, T8 — kind picker options. Order
// mirrors the DCArtboard `kind` union; 'digital' is the implicit default
// (writes `kind: null`, clearing the explicit prop, per applySetArtboardKind).
export const ARTBOARD_KIND_OPTIONS = [
  ['digital', 'Digital'],
  ['print', 'Print'],
  ['web', 'Web'],
  ['video', 'Video'],
];

export function ArtboardKnobs({
  el,
  cfg,
  onResizeArtboard,
  onSetArtboardHug,
  onSetArtboardStyle,
  onSetArtboardKind,
  onSetArtboardPrint,
  onDuplicateArtboard,
}) {
  const artboardId = resolveArtboardIdFromSelection(el);
  // Dogfood (artboard panel ↔ shared inspector controls) — the panel now uses
  // the SAME control library + design-token plumbing as CssKnobs (NumberField
  // / Segmented / Select / ColorField+TokenPopover / ValueTokenField), so Bg
  // binds color variables and Pad/Gap bind space variables exactly like any
  // CSS-panel row. Token resolution mirrors CssKnobs' own tokenGroups/
  // flatTokens closures over useAllDsTokens.
  const _designRel = (cfg?.designRel || cfg?.designRoot || '.design').replace(/^\/+|\/+$/g, '');
  const _activeDs = activeDsNameFor(el.file, cfg);
  const allDs = useAllDsTokens(cfg, _designRel, _activeDs);
  const tokenGroups = (familyKey) =>
    allDs
      .map((d) => ({ ds: d.name, names: d[familyKey] || [], vals: d.vals }))
      .filter((g) => g.names.length);
  const flatTokens = (familyKey) =>
    tokenGroups(familyKey).flatMap((g) =>
      (g.names || []).map((n) => ({ name: n, value: g.vals?.[n] || '' }))
    );
  // Resolve a `var(--x)` binding to its concrete value across every DS (for
  // the Bg swatch color); a raw value passes through.
  const resolveTokenValue = (v) => {
    const m = /^var\(\s*(--[\w-]+)\s*\)$/.exec(v || '');
    if (!m) return v || '';
    for (const d of allDs) {
      const val = d.vals?.[m[1]];
      if (val) return val;
    }
    return '';
  };
  // Dogfood 2026-07-07 (round 2) — `worldW`/`worldH` (zoom-independent) are
  // undefined for a selection that reached here via a code path predating
  // that field (a canvas iframe that hasn't remounted since); fall back to
  // `bounds` (the SCREEN rect — always populated, but wrong at any zoom other
  // than 100%) so the fields show SOMETHING rather than sit empty. Self-heals
  // to the exact value the moment `worldW`/`worldH` are present.
  const w = Number.isFinite(el.worldW)
    ? el.worldW
    : Number.isFinite(el.bounds?.w)
      ? el.bounds.w
      : null;
  const h = Number.isFinite(el.worldH)
    ? el.worldH
    : Number.isFinite(el.bounds?.h)
      ? el.bounds.h
      : null;
  const commitSize = (width, height) => {
    if (!artboardId) return;
    const nw = Number.isFinite(width) && width > 0 ? Math.round(width) : undefined;
    const nh = Number.isFinite(height) && height > 0 ? Math.round(height) : undefined;
    if (nw == null && nh == null) return;
    onResizeArtboard?.(artboardId, nw, nh);
  };
  const activePreset = Object.entries(SCREEN_PRESETS).find(
    ([, p]) => p.width === w && p.height === h
  )?.[0];
  // feature-3-web-artboards T2 — a web artboard hugs height (Design Decision
  // 1), so its `h` rarely equals a preset's device height even when the
  // artboard genuinely represents that breakpoint. Match by WIDTH alone so
  // the picker still shows "Desktop" selected after the hugged height
  // settles to the content's real size.
  const activeWidthPreset = Object.entries(SCREEN_PRESETS).find(([, p]) => p.width === w)?.[0];
  // Hug default (artboard "hug height") — current mode + the "more settings"
  // (background/padding/layout/gap) read off the SAME generic `attrs` escape
  // hatch dom-selection.ts already scrapes for every selection (the `data-dc-*`
  // attributes DCArtboard stamps on the frame purely for this panel to read
  // its own resolved props back — see canvas-lib.tsx readBackAttrs).
  const fixed = el.attrs?.['data-dc-fixed'] === 'true';
  const bg = el.attrs?.['data-dc-bg'] ?? '';
  const padding = el.attrs?.['data-dc-padding'] ?? '';
  const layoutMode = el.attrs?.['data-dc-layout'] ?? '';
  const gap = el.attrs?.['data-dc-gap'] ?? '';
  // T8 — `data-dc-kind` is DCArtboard's RESOLVED kind (readBackAttrs always
  // emits it, unlike the optional-override attrs above — see T1's comment on
  // why), so this reads 'digital' even for an implicit/unmigrated artboard.
  const kind = el.attrs?.['data-dc-kind'] || 'digital';
  // feature-2-print-artboards T2 — paper/orientation/bleed. Read-back mirrors
  // `data-dc-kind` above: a small JSON attr DCArtboard stamps for exactly this
  // panel (canvas-lib.tsx readBackAttrs), since `print` (unlike bg/padding/…)
  // is object-valued, not a scalar.
  let print = null;
  try {
    print = el.attrs?.['data-dc-print'] ? JSON.parse(el.attrs['data-dc-print']) : null;
  } catch {
    /* malformed attr — treat as absent */
  }
  const setKind = (nextKind) => {
    if (!artboardId) return;
    // Dogfood fix — switching TO "print" with no print prop yet left the
    // artboard half-configured (no guides geometry, no bleed for the PDF
    // exporter). Seed a default A4 print prop + its resolved px size in the
    // SAME gesture. Round 6: the seed is PASSED THROUGH the kind flow (not
    // written immediately) so the freeze-convert the canvas may enqueue first
    // lands BEFORE the A4 resize — resizing pre-freeze moved elements around
    // while the confirm dialog was still open.
    let seedPrint = null;
    if (nextKind === 'print' && !print) {
      const defaults = { paper: 'a4' };
      try {
        const resolved = resolvePrintArtboard(defaults);
        if (resolved) {
          seedPrint = { defaults, widthPx: resolved.widthPx, heightPx: resolved.heightPx };
        }
      } catch {
        /* keep null */
      }
    }
    // Picking "Digital" clears the explicit prop back to the implicit
    // default (applySetArtboardKind's `kind: null` path) rather than writing
    // a redundant `kind="digital"`.
    onSetArtboardKind?.(artboardId, nextKind === 'digital' ? null : nextKind, seedPrint);
    // feature-3-web-artboards Design Decision 1 — a web artboard's height
    // hugs content (`fixed` omitted); switching TO "web" flips hug mode in
    // the same gesture so the artboard doesn't stay pinned to whatever exact
    // height a prior digital/print size left it at. Mirrors the print
    // auto-seed above — switching kind should never require a second,
    // easy-to-miss step in the Hug/Fixed segmented control above.
    if (nextKind === 'web' && fixed) {
      onSetArtboardHug?.(artboardId, false, undefined);
    }
  };
  const setPrint = (patch) => {
    if (!artboardId) return;
    const next = { paper: 'a4', ...print, ...patch };
    let resolved;
    try {
      resolved = resolvePrintArtboard(next);
    } catch {
      return; // unknown paper id — ignore rather than write garbage
    }
    // Design Decision 2 — the picker writes BOTH the resolved px size (via
    // the existing resize lane, DDR-027) and the `print` intent prop, in the
    // same gesture, so geometry and intent never drift apart.
    onResizeArtboard?.(artboardId, resolved.widthPx, resolved.heightPx);
    onSetArtboardPrint?.(artboardId, next);
  };
  const setHug = (nextFixed, explicitHeight) => {
    if (!artboardId) return;
    const src = Number.isFinite(explicitHeight) ? explicitHeight : h;
    const freezeHeight = nextFixed && Number.isFinite(src) ? Math.round(src) : undefined;
    onSetArtboardHug?.(artboardId, nextFixed, freezeHeight);
  };
  const commitHeight = (n) => {
    const action = resolveHeightCommit(fixed, n);
    if (action.kind === 'resize') commitSize(null, action.height);
    else if (action.kind === 'promote-to-fixed') setHug(true, action.height);
  };
  const commitStyle = (patch) => {
    if (!artboardId) return;
    onSetArtboardStyle?.(artboardId, patch);
  };
  return (
    <section className="st-cp-sec">
      <div className="st-cp-sechd-row">
        <span className="st-cp-sechd">Artboard</span>
      </div>
      <div style={{ display: 'flex', gap: 8, padding: '4px 12px' }}>
        <NumberField
          value={w ?? 0}
          min={1}
          ariaLabel="artboard width"
          lead="W"
          steppers={false}
          onCommit={(n) => commitSize(n, null)}
        />
        <NumberField
          value={h ?? 0}
          min={1}
          ariaLabel="artboard height"
          lead="H"
          steppers={false}
          scrub={fixed}
          onCommit={commitHeight}
        />
      </div>
      <div style={{ padding: '0 12px 8px' }}>
        {kind === 'print' ? (
          // Dogfood follow-up — a PRINT artboard's "Preset size…" dropdown
          // showed only the screen presets (Desktop/Laptop/Tablet/Mobile),
          // which are meaningless for paper. Show the paper ladder here
          // instead, writing through the SAME setPrint lane as the Print
          // section below (resolved px + print prop together).
          <select
            className="st-cp-nsel"
            aria-label="artboard paper preset"
            value={print?.paper ?? ''}
            onChange={(e) => setPrint({ paper: e.currentTarget.value })}
          >
            <option value="" disabled>
              Paper size…
            </option>
            {PAPER_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label} — {p.width}×{p.height}
                {p.unit}
              </option>
            ))}
          </select>
        ) : kind === 'web' ? (
          // feature-3-web-artboards T2 — a web artboard's "Preset size…"
          // dropdown reads as BREAKPOINT selection, not exact-box selection:
          // same SCREEN_PRESETS widths (Design Decision 2 — no separate
          // preset table needed), but commits width-only (height stays
          // hug-driven) and labels each option as the breakpoint it is.
          <select
            className="st-cp-nsel"
            aria-label="artboard breakpoint preset"
            value={activeWidthPreset ?? ''}
            onChange={(e) => {
              const p = SCREEN_PRESETS[e.currentTarget.value];
              if (p) commitSize(p.width, null);
            }}
          >
            <option value="" disabled>
              {activeWidthPreset
                ? `${SCREEN_PRESETS[activeWidthPreset].label} — ≤ ${SCREEN_PRESETS[activeWidthPreset].width}px`
                : 'Breakpoint…'}
            </option>
            {Object.entries(SCREEN_PRESETS).map(([key, p]) => (
              <option key={key} value={key}>
                {p.label} — ≤ {p.width}px breakpoint
              </option>
            ))}
          </select>
        ) : (
          <select
            className="st-cp-nsel"
            aria-label="artboard size preset"
            value={activePreset ?? ''}
            onChange={(e) => {
              const p = SCREEN_PRESETS[e.currentTarget.value];
              if (p) commitSize(p.width, p.height);
            }}
          >
            <option value="" disabled>
              {activePreset ? SCREEN_PRESETS[activePreset].label : 'Preset size…'}
            </option>
            {Object.entries(SCREEN_PRESETS).map(([key, p]) => (
              <option key={key} value={key}>
                {p.label} — {p.width}×{p.height}
              </option>
            ))}
          </select>
        )}
      </div>
      <div style={{ padding: '0 12px 8px' }}>
        <Segmented
          value={fixed ? 'fixed' : 'hug'}
          ariaLabel="artboard height sizing mode"
          options={[
            { value: 'hug', label: 'Hug' },
            { value: 'fixed', label: 'Fixed' },
          ]}
          onChange={(v) => setHug(v === 'fixed')}
        />
      </div>
      <div className="st-cp-sechd-row">
        <span className="st-cp-sechd">Kind</span>
      </div>
      <div style={{ padding: '0 12px 8px' }}>
        <Select
          value={kind}
          ariaLabel="artboard kind"
          options={ARTBOARD_KIND_OPTIONS.map(([value, label]) => ({ value, label }))}
          onChange={setKind}
        />
      </div>
      {kind !== 'print' && artboardId && onDuplicateArtboard ? (
        // feature-3-web-artboards T3 — "Duplicate at width…". A stateless
        // action trigger (not a size preset reflecting current state, unlike
        // the Preset-size select above), so the control resets to its
        // placeholder after firing rather than showing the last pick as
        // though it were now selected. Gated off kind="print" — paper size
        // is picked via the Artboard preset dropdown above, not a px width.
        <div style={{ padding: '0 12px 8px' }}>
          <select
            className="st-cp-nsel"
            aria-label="duplicate artboard at breakpoint width"
            value=""
            onChange={(e) => {
              const p = SCREEN_PRESETS[e.currentTarget.value];
              if (p) onDuplicateArtboard(artboardId, p.width);
              e.currentTarget.value = '';
            }}
          >
            <option value="" disabled>
              Duplicate at width…
            </option>
            {Object.entries(SCREEN_PRESETS).map(([key, p]) => (
              <option key={key} value={key}>
                {p.label} — {p.width}px
              </option>
            ))}
          </select>
        </div>
      ) : null}
      {kind === 'print' ? (
        <>
          <div className="st-cp-sechd-row">
            <span className="st-cp-sechd">Print</span>
          </div>
          {/* Paper picker lives in the Artboard section's own preset dropdown
              above (it REPLACES the screen presets for kind="print") — this
              section carries the print-specific residue: orientation + bleed. */}
          <div style={{ padding: '0 12px 8px' }}>
            <Segmented
              value={print?.orientation ?? 'portrait'}
              ariaLabel="paper orientation"
              options={[
                { value: 'portrait', label: 'Portrait' },
                { value: 'landscape', label: 'Landscape' },
              ]}
              onChange={(v) => setPrint({ orientation: v })}
            />
          </div>
          <div style={{ padding: '0 12px 8px' }}>
            <NumberField
              value={Number.isFinite(print?.bleedMm) ? print.bleedMm : 3}
              min={0}
              step={0.5}
              ariaLabel="bleed, millimeters"
              // Single-glyph lead — the drag-handle slot is sized for 1–2
              // chars ("W"/"Pad"); a full word clips. mm suffix + aria carry
              // the meaning.
              lead="B"
              steppers={false}
              unitSlot={
                <span className="st-cp-numsuffix" aria-hidden="true">
                  mm
                </span>
              }
              onCommit={(n) => setPrint({ bleedMm: n })}
            />
          </div>
        </>
      ) : null}
      <div className="st-cp-sechd-row">
        <span className="st-cp-sechd">Style</span>
      </div>
      <div style={{ padding: '4px 12px 8px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {(() => {
          // Bg — the CssKnobs `color()` recipe: TokenPopover swatch as the
          // flush prefix inside ColorField (HSV picker + per-DS variables).
          const bgResolved = resolveTokenValue(bg);
          const bgBound = /var\(\s*--/.test(bg);
          const bgDisplay = bgBound
            ? bg
                .replace(/^var\(\s*|\s*\)$/g, '')
                .replace(/^--/, '')
                .replace(/-/g, ' ')
            : bg;
          return (
            <ColorField
              swatch={
                <TokenPopover
                  kind="color"
                  swatchClassName="st-cp-cf-sw"
                  groups={tokenGroups('color')}
                  current={bg}
                  activeDs={_activeDs}
                  swatchBg={bgResolved}
                  seedHex={cssColorToHex(bgResolved) || '#000000'}
                  onPick={(v) => commitStyle({ background: v || null })}
                  label="artboard background colour"
                />
              }
              displayValue={bgDisplay}
              bound={bgBound}
              ariaLabel="artboard background"
              onValue={(v) => commitStyle({ background: (v || '').trim() || null })}
            />
          );
        })()}
        <Select
          value={layoutMode}
          ariaLabel="artboard body layout"
          options={ARTBOARD_LAYOUT_OPTIONS.map(([value, label]) => ({
            value,
            label,
          }))}
          onChange={(v) => commitStyle({ layout: v || null })}
        />
        <div style={{ display: 'flex', gap: 8 }}>
          <ValueTokenField
            value={/^var\(/.test(padding) ? padding : Number.parseFloat(padding) || 0}
            tokens={flatTokens('space')}
            ariaLabel="artboard padding"
            lead="Pad"
            min={0}
            onChange={(v) => commitStyle({ padding: typeof v === 'string' ? v : v > 0 ? v : null })}
          />
          <ValueTokenField
            value={/^var\(/.test(gap) ? gap : Number.parseFloat(gap) || 0}
            tokens={flatTokens('space')}
            ariaLabel="artboard gap"
            lead="Gap"
            min={0}
            onChange={(v) => commitStyle({ gap: typeof v === 'string' ? v : v > 0 ? v : null })}
          />
        </div>
      </div>
    </section>
  );
}
