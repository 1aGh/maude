// photo-knobs.jsx — the Inspector "Photo" tab body (feature-photo-editor, Task 15).
//
// A self-contained editor for a PhotoEdit sidecar. Unlike CssKnobs (whose write
// path is /_api/edit-css keyed on a source `data-cd-id`), PhotoKnobs writes the
// non-destructive `assets/<sha8>.photo.json` sidecar through /_api/photo-edit —
// so it works for BOTH an artboard `<img>` and an annotation ImageStroke (both
// carry an `assets/<sha8>.<ext>` source), neither of which CssKnobs can express.
//
// Runs on the MAIN origin (the studio shell), so inline styles are fine
// (style-src 'self' 'unsafe-inline'). Renders the controls; the live pixel
// preview happens in the canvas iframe's <PhotoLayer>, driven by `onEdit`
// (app.jsx broadcasts the updated edit down to the canvas). Reuses the shell's
// HSV `ColorPicker` when injected; falls back to a native color input.
//
// Controls come from the shared inspector-controls library
// (feature-inspector-controls-redesign) so bounded adjustments render as REAL
// sliders (track/thumb, keyboard-accessible) linked to an exact numeric field,
// and every row carries a single control (the old DUOTONE / Pattern rows doubled
// up two controls and overflowed the 304px panel).
//
// Sections + ranges mirror photo/schema.ts exactly:
//   Adjustments (brightness/contrast/saturation/exposure −1..1, hue −180..180,
//   sepia/grayscale/invert 0..1) · Duotone · Grain · Pattern · Mask · Background.

import { useCallback, useEffect, useRef, useState } from 'react';
import { ColorField, PanelSection, Select, SliderField, Toggle } from './inspector-controls.jsx';

const PATTERN_TYPES = ['dots', 'grid', 'lines', 'diagonal', 'crosshatch'];
const PATTERN_BLENDS = ['normal', 'multiply', 'screen', 'overlay', 'soft-light'];
const MASK_PRESETS = ['none', 'vignette', 'radial-reveal', 'edge-fade'];

const ADJUSTMENTS = [
  { key: 'brightness', label: 'Brightness', min: -1, max: 1 },
  { key: 'contrast', label: 'Contrast', min: -1, max: 1 },
  { key: 'saturation', label: 'Saturation', min: -1, max: 1 },
  { key: 'exposure', label: 'Exposure', min: -1, max: 1 },
  { key: 'hue', label: 'Hue', min: -180, max: 180, step: 1, unit: '°' },
  { key: 'sepia', label: 'Sepia', min: 0, max: 1 },
  { key: 'grayscale', label: 'Grayscale', min: 0, max: 1 },
  { key: 'invert', label: 'Invert', min: 0, max: 1 },
];

// Deep-clone a small plain edit object (structuredClone is available in the shell).
const clone = (o) => (o ? JSON.parse(JSON.stringify(o)) : {});

/** Prune empty sub-objects so a neutral edit serializes back to `{}`. */
function prune(edit) {
  const out = {};
  for (const [k, v] of Object.entries(edit)) {
    if (v == null) continue;
    if (typeof v === 'object' && !Array.isArray(v)) {
      const inner = {};
      for (const [ik, iv] of Object.entries(v)) if (iv != null && iv !== '') inner[ik] = iv;
      if (Object.keys(inner).length) out[k] = inner;
    } else {
      out[k] = v;
    }
  }
  return out;
}

// ── small inline-styled primitives ──────────────────────────────────────────

// Theme tokens — the REAL shell tokens (client/styles/1-tokens.css), defined
// for both `:root`/`[data-theme="light"]` and `[data-theme="dark"]`.
const S = {
  body: { fontSize: 12, color: 'var(--fg-0)', overflowY: 'auto' },
  sec: { marginBottom: 'var(--space-4)' },
  secHead: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 'var(--tracking-wide)',
    color: 'var(--fg-2)',
    margin: '4px 0 8px',
  },
  row: { display: 'flex', alignItems: 'center', gap: 8, margin: 'var(--space-2) 0' },
  label: { flex: '0 0 72px', fontSize: 11, color: 'var(--fg-1)' },
  tip: {
    flex: 1,
    fontFamily: 'var(--font-mono, ui-monospace, monospace)',
    fontSize: 10,
    color: 'var(--fg-2)',
    textAlign: 'left',
  },
  // handoff — tips go BELOW the control (help text), not inline right, aligned
  // under the control column (past the 72px label).
  tipBelow: { marginLeft: 80, marginTop: 2, marginBottom: 'var(--space-2)', fontSize: 10, color: 'var(--fg-2)', lineHeight: 1.4 },
  reset: {
    font: 'inherit',
    fontSize: 10,
    padding: '1px 6px',
    borderRadius: 'var(--radius-xs)',
    border: '1px solid transparent',
    background: 'transparent',
    color: 'var(--fg-2)',
    cursor: 'pointer',
  },
};

// handoff — photo sections are now the shared collapsable PanelSection (caret +
// height animation), with the enable Toggle in the header's `right` slot.
function Section({ title, right, onReset, children }) {
  return (
    <PanelSection title={title} right={right} onReset={onReset}>
      {children}
    </PanelSection>
  );
}

// One label + one control per row — the fix for the doubled-up DUOTONE / Pattern
// rows that overflowed the panel. SliderField/Select fill the control side.
function Row({ label, tip, children }) {
  return (
    <>
      <div style={S.row}>
        <span style={S.label}>{label}</span>
        {children}
      </div>
      {tip ? <div style={S.tipBelow}>{tip}</div> : null}
    </>
  );
}

// Compact colour field for the photo panel — the shared ColorField shell (swatch
// flush prefix + value) whose swatch opens a popover holding the injected HSV
// ColorPicker (falls back to a native colour input). 1:1 with the CSS panel's
// colour control, just with the pixel-level picker instead of the token popover.
function PhotoColorField({ value, fallback, label, ColorPicker, onApply }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const hex = value || fallback;
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDoc, true);
    return () => document.removeEventListener('pointerdown', onDoc, true);
  }, [open]);
  return (
    <ColorField
      swatch={
        <span className="st-cp-tokwrap" ref={wrapRef}>
          <button type="button" className="st-cp-cf-sw" style={{ background: hex }} aria-haspopup="dialog" aria-expanded={open} aria-label={label} title={hex} onClick={() => setOpen((o) => !o)} />
          {open ? (
            <div className="st-cp-pop" role="dialog" aria-label={label} style={{ padding: 'var(--space-2)' }}>
              {ColorPicker ? (
                <ColorPicker seed={hex} label={label} onApply={onApply} />
              ) : (
                <input type="color" value={hex} aria-label={label} onChange={(e) => onApply(e.target.value)} style={{ width: '100%', height: 32 }} />
              )}
            </div>
          ) : null}
        </span>
      }
      displayValue={(hex || '').replace('#', '')}
      ariaLabel={label}
      onValue={(v) => onApply(v.startsWith('#') ? v : `#${v.replace(/[^0-9a-fA-F]/g, '').slice(0, 6)}`)}
    />
  );
}

// ── the panel ────────────────────────────────────────────────────────────────

/**
 * @param {object}   p
 * @param {string}   p.asset             `assets/<sha8>.<ext>` source path.
 * @param {object}  [p.initialEdit]      Seed PhotoEdit (else fetched on mount).
 * @param {Function} [p.ColorPicker]     Injected HSV picker component (optional).
 * @param {Function} [p.onEdit]          (edit) => void — live-preview broadcast.
 * @param {Function} [p.onRemoveBackground] async (asset) => { maskAsset } | null.
 * @param {Function} [p.onRecordEdit]    (before, after) => void — undo integration.
 * @param {Function} [p.StIcon]         Injected shell icon component (optional).
 */
export function PhotoKnobs({ asset, initialEdit, ColorPicker, onEdit, onRemoveBackground, onRecordEdit, StIcon }) {
  const [edit, setEditState] = useState(() => clone(initialEdit));
  const [loading, setLoading] = useState(!initialEdit);
  const [saveState, setSaveState] = useState('idle'); // idle | saving | saved | error
  const [bgBusy, setBgBusy] = useState(false);
  // sr-only live-region text for the background-removal busy state (Task 19).
  const [bgAnnounce, setBgAnnounce] = useState('');
  const putTimer = useRef(null);
  const editRef = useRef(edit);
  editRef.current = edit;

  // Hydrate from the sidecar unless seeded.
  useEffect(() => {
    if (initialEdit || !asset) return;
    let dead = false;
    setLoading(true);
    fetch(`/_api/photo-edit?asset=${encodeURIComponent(asset)}`)
      .then((r) => (r.ok ? r.json() : {}))
      .then((j) => {
        if (dead) return;
        setEditState(j && typeof j === 'object' ? j : {});
        setLoading(false);
      })
      .catch(() => !dead && setLoading(false));
    return () => {
      dead = true;
    };
  }, [asset, initialEdit]);

  const put = useCallback(
    (next) => {
      clearTimeout(putTimer.current);
      putTimer.current = setTimeout(async () => {
        setSaveState('saving');
        try {
          const res = await fetch(`/_api/photo-edit?asset=${encodeURIComponent(asset)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(prune(next)),
          });
          setSaveState(res.ok ? 'saved' : 'error');
        } catch {
          setSaveState('error');
        }
      }, 160);
    },
    [asset]
  );

  // Apply a mutation, push the optimistic edit to the live preview, persist
  // (debounced), and record undo (before → after).
  const mutate = useCallback(
    (fn, { commit = false } = {}) => {
      const before = editRef.current;
      const next = clone(before);
      fn(next);
      // Reset and a number field's blur can arrive before React renders.
      // The next mutation (and its undo base) must already see this edit.
      editRef.current = next;
      setEditState(next);
      onEdit?.(next);
      put(next);
      if (commit) onRecordEdit?.(before, next);
    },
    [onEdit, put, onRecordEdit]
  );

  const setAdj = (key, value, commit) =>
    mutate((e) => {
      e.adjustments = e.adjustments || {};
      if (value === 0 || value == null) delete e.adjustments[key];
      else e.adjustments[key] = value;
      if (Object.keys(e.adjustments).length === 0) delete e.adjustments;
    }, { commit });

  const setSection = (section, patch, commit) =>
    mutate((e) => {
      e[section] = { ...(e[section] || {}), ...patch };
    }, { commit });

  const resetAdjustments = () => mutate((e) => delete e.adjustments, { commit: true });
  // handoff — per-section reset (⟲): remove the section → back to its defaults.
  const clearSection = (section) => mutate((e) => { delete e[section]; }, { commit: true });

  // Shared by both the initial "Remove Background" and the "redo" button —
  // drives the busy state + the sr-only live-region announcement (Task 19).
  const runRemoveBackground = async () => {
    if (!onRemoveBackground) return;
    setBgBusy(true);
    setBgAnnounce('Removing background…');
    try {
      const res = await onRemoveBackground(asset);
      if (res?.maskAsset) {
        setSection('backgroundRemoved', { enabled: true, maskAsset: res.maskAsset }, true);
        setBgAnnounce('Background removed');
      } else {
        setBgAnnounce('Background removal failed');
      }
    } catch {
      setBgAnnounce('Background removal failed');
    } finally {
      setBgBusy(false);
    }
  };

  if (loading) return <div style={{ ...S.body, opacity: 0.6 }}>Loading photo edit…</div>;

  const adj = edit.adjustments || {};
  const duo = edit.duotone || {};
  const grain = edit.grain || {};
  const pat = edit.pattern || {};
  const mask = edit.mask || {};
  const bg = edit.backgroundRemoved || {};

  return (
    <div style={S.body} data-testid="photo-knobs">
      <div style={{ ...S.secHead, marginTop: 0, color: 'var(--fg-2)', textTransform: 'none', letterSpacing: 0 }}>
        <span style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 10 }}>{asset}</span>
        <span style={{ fontSize: 10, color: saveState === 'error' ? 'var(--status-error)' : undefined }}>
          {saveState === 'saving' ? 'saving…' : saveState === 'error' ? '⚠ save failed' : saveState === 'saved' ? 'saved' : ''}
        </span>
      </div>

      <Section title="Adjustments" onReset={resetAdjustments}>
        {ADJUSTMENTS.map((a) => (
          <Row key={a.key} label={a.label}>
            <SliderField
              value={adj[a.key]}
              min={a.min}
              max={a.max}
              step={a.step ?? 0.01}
              unit={a.unit ?? ''}
              ariaLabel={a.label}
              onInput={(v) => setAdj(a.key, v)}
              onCommit={(v) => setAdj(a.key, v, true)}
            />
          </Row>
        ))}
      </Section>

      <Section
        title="Duotone"
        right={<Toggle checked={duo.enabled} onChange={(v) => setSection('duotone', { enabled: v }, true)} label="on" ariaLabel="Duotone on" />}
        onReset={() => clearSection('duotone')}
      >
        {duo.enabled && (
          <>
            <Row label="Shadow">
              <PhotoColorField value={duo.colorA} fallback="#111111" label="Shadow" ColorPicker={ColorPicker} onApply={(hex) => setSection('duotone', { colorA: hex }, true)} />
            </Row>
            <Row label="Highlight">
              <PhotoColorField value={duo.colorB} fallback="#ffffff" label="Highlight" ColorPicker={ColorPicker} onApply={(hex) => setSection('duotone', { colorB: hex }, true)} />
            </Row>
            <Row label="Intensity">
              <SliderField value={duo.intensity ?? 1} min={0} max={1} ariaLabel="Duotone intensity" onInput={(v) => setSection('duotone', { intensity: v })} onCommit={(v) => setSection('duotone', { intensity: v }, true)} />
            </Row>
          </>
        )}
      </Section>

      <Section
        title="Grain"
        right={<Toggle checked={grain.enabled} onChange={(v) => setSection('grain', { enabled: v }, true)} label="on" ariaLabel="Grain on" />}
        onReset={() => clearSection('grain')}
      >
        {grain.enabled && (
          <>
            <Row label="Amount">
              <SliderField value={grain.amount ?? 0.4} min={0} max={1} ariaLabel="Grain amount" onInput={(v) => setSection('grain', { amount: v })} onCommit={(v) => setSection('grain', { amount: v }, true)} />
            </Row>
            <Row label="Size">
              {/* Task 7 (feature-inspector-controls-redesign) — range reconciled
                  against photo/schema.ts's clamp (num(errors, g, 'size', 1, 32));
                  the panel used to cap at 8, silently hiding the top 3/4 of what
                  the server would actually accept. */}
              <SliderField value={grain.size ?? 1} min={1} max={32} step={1} ariaLabel="Grain size" onInput={(v) => setSection('grain', { size: v })} onCommit={(v) => setSection('grain', { size: v }, true)} />
            </Row>
          </>
        )}
      </Section>

      <Section
        title="Pattern"
        right={<Toggle checked={pat.enabled} onChange={(v) => setSection('pattern', { enabled: v }, true)} label="on" ariaLabel="Pattern on" />}
        onReset={() => clearSection('pattern')}
      >
        {pat.enabled && (
          <>
            <Row label="Type">
              <Select value={pat.type || 'dots'} options={PATTERN_TYPES} ariaLabel="Pattern type" onChange={(v) => setSection('pattern', { type: v }, true)} />
            </Row>
            <Row label="Blend">
              <Select value={pat.blend || 'normal'} options={PATTERN_BLENDS} ariaLabel="Pattern blend" onChange={(v) => setSection('pattern', { blend: v }, true)} />
            </Row>
            <Row label="Color" tip="tip: dark colour + Multiply blend reads best">
              <PhotoColorField value={pat.color} fallback="#ffffff" label="Pattern color" ColorPicker={ColorPicker} onApply={(hex) => setSection('pattern', { color: hex }, true)} />
            </Row>
            <Row label="Scale">
              {/* Task 7 — reconciled against schema.ts's clamp (num(errors, p,
                  'scale', 0.1, 16)); the panel used to cap at 4. */}
              <SliderField value={pat.scale ?? 1} min={0.1} max={16} step={0.1} ariaLabel="Pattern scale" onInput={(v) => setSection('pattern', { scale: v })} onCommit={(v) => setSection('pattern', { scale: v }, true)} />
            </Row>
            <Row label="Opacity">
              <SliderField value={pat.opacity ?? 0.5} min={0} max={1} ariaLabel="Pattern opacity" onInput={(v) => setSection('pattern', { opacity: v })} onCommit={(v) => setSection('pattern', { opacity: v }, true)} />
            </Row>
          </>
        )}
      </Section>

      <Section title="Mask" onReset={() => clearSection('mask')}>
        <Row label="Preset">
          <Select value={mask.preset || 'none'} options={MASK_PRESETS} ariaLabel="Mask preset" onChange={(v) => setSection('mask', { preset: v }, true)} />
        </Row>
        {mask.preset && mask.preset !== 'none' && (
          <Row label="Strength">
            <SliderField value={mask.strength ?? 0.6} min={0} max={1} ariaLabel="Mask strength" onInput={(v) => setSection('mask', { strength: v })} onCommit={(v) => setSection('mask', { strength: v }, true)} />
          </Row>
        )}
      </Section>

      <Section title="Background" onReset={() => clearSection('backgroundRemoved')}>
        <div style={{ ...S.row, gap: 10 }} aria-busy={bgBusy || undefined}>
          {bg.maskAsset ? (
            <>
              <Toggle checked={bg.enabled} onChange={(v) => setSection('backgroundRemoved', { enabled: v }, true)} label="applied" />
              <button
                type="button"
                style={{ ...S.reset, opacity: bgBusy ? 0.6 : 1 }}
                disabled={bgBusy || !onRemoveBackground}
                title="Run background removal again"
                onClick={() => runRemoveBackground()}
              >
                {bgBusy ? 'removing…' : 'redo'}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="st-btn"
              style={{ opacity: bgBusy ? 0.6 : 1 }}
              disabled={bgBusy || !onRemoveBackground}
              data-testid="photo-remove-bg"
              onClick={() => runRemoveBackground()}
            >
              {StIcon ? <StIcon name="sparkle" size={14} /> : null}
              {bgBusy ? 'Removing…' : 'Remove Background'}
            </button>
          )}
        </div>
        <span aria-live="polite" className="sr-only">
          {bgAnnounce}
        </span>
      </Section>
    </div>
  );
}

export default PhotoKnobs;
