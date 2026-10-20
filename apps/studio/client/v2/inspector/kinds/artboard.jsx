// client/v2/inspector/kinds/artboard.jsx — S2.8: the artboard's inspector (14 Editing, ed-ab-select / ed-ab-resize).
// It supersedes `client/inspector/artboard-knobs.jsx` in the v2 inspector; every knob of that panel keeps a home:
//
//   Artboard   Preset · Size (W, H) · Height (Fits content | Fixed) · Clip content · Kind · [Print: orientation, bleed]
//              · Other widths ("Add a width")
//   Fill       Background (a token, from the system)
//   Layout     Content (Page flow · Top to bottom · Left to right · Grid) · Padding · Gap
//   Export     the default presets (S2.5's slot; S8 fills it)
//   Advanced   Theme (DS default · Follow chrome · Light · Dark) — see `artboard-advanced.jsx`
//
// Writes go through the handlers the panel already owns (`ctx.artboard`): the numeric JSX props (DDR-027) via the
// resize lane, Hug/Fixed, style, kind and print props — nothing here talks to a file itself. Hug vs Fixed is
// never a chip: it is the Height row.

import { Toggle, NumberField, Segmented, Select } from '../../../inspector-controls.jsx';
import { resolveHeightCommit } from '../../../../artboard-hug-commit.ts';
import { colourFromCss, colourToCss } from '../../../../edit-ops/words-paint.ts';
import { resolvePrintArtboard } from '../../../../print/units.ts';
import { registerSlot } from '../slots.js';
import { ColorControl } from '../sections/color-control.jsx';
import { Quiet, Row } from '../sections/row.jsx';
import { LengthControl, useDsFamilies, useSpaceTokens } from '../token-chip.jsx';
import {
  KIND_OPTIONS,
  LAYOUT_OPTIONS,
  artboardFacts,
  artboardLength,
  artboardLengthPatch,
  heightMode,
  otherWidths,
  presetOptions,
  presetValue,
} from './artboard-model.js';

const CUSTOM = '';

/** The handlers the panel passes to the artboard (frame.jsx puts them on `ctx.artboard`). */
const handlersOf = (ctx) => ctx?.artboard || {};

function ArtboardSizeRows({ el, ctx }) {
  const f = artboardFacts(el);
  const h = handlersOf(ctx);
  const id = f.id;
  const options = presetOptions(f.kind);
  const value = presetValue(f);
  const can = !!id;

  const resize = (w, ht) => {
    const nw = Number.isFinite(w) && w > 0 ? Math.round(w) : undefined;
    const nh = Number.isFinite(ht) && ht > 0 ? Math.round(ht) : undefined;
    if (id && (nw != null || nh != null)) h.onResizeArtboard?.(id, nw, nh);
  };
  const setHug = (fixed, explicitHeight) => {
    if (!id) return;
    const src = Number.isFinite(explicitHeight) ? explicitHeight : f.h;
    h.onSetArtboardHug?.(id, fixed, fixed && Number.isFinite(src) ? Math.round(src) : undefined);
  };
  const commitHeight = (n) => {
    const a = resolveHeightCommit(f.fixed, n);
    if (a.kind === 'resize') resize(null, a.height);
    else if (a.kind === 'promote-to-fixed') setHug(true, a.height);
  };
  const setPrint = (patch) => {
    if (!id) return;
    const next = { paper: 'a4', ...f.print, ...patch };
    let resolved;
    try {
      resolved = resolvePrintArtboard(next);
    } catch {
      return; // an unknown paper id: ignore rather than write garbage
    }
    // geometry and intent in the same gesture, so they never drift apart (print artboards design decision 2)
    h.onResizeArtboard?.(id, resolved.widthPx, resolved.heightPx);
    h.onSetArtboardPrint?.(id, next);
  };
  const pick = (v) => {
    const o = options.find((x) => x.value === v);
    if (!o) return;
    if (o.paper) setPrint({ paper: o.paper });
    else resize(o.width, o.height ?? null);
  };
  const setKind = (next) => {
    if (!id) return;
    let seedPrint = null;
    if (next === 'print' && !f.print) {
      const defaults = { paper: 'a4' };
      try {
        const r = resolvePrintArtboard(defaults);
        if (r) seedPrint = { defaults, widthPx: r.widthPx, heightPx: r.heightPx };
      } catch {
        /* keep null */
      }
    }
    // "Fixed size" is the implicit kind: it clears the prop instead of writing `kind="digital"`
    h.onSetArtboardKind?.(id, next === 'digital' ? null : next, seedPrint);
    // a web page hugs its height: switching to it frees a Fixed height in the same gesture
    if (next === 'web' && f.fixed) h.onSetArtboardHug?.(id, false, undefined);
  };

  return (
    <>
      {options.length ? (
        <Row k="Preset" name="ab-preset">
          <Select
            value={value}
            ariaLabel="Artboard preset"
            testId="insp-ab-preset"
            options={value === CUSTOM ? [{ value: CUSTOM, label: 'Custom' }, ...options] : options}
            onChange={pick}
          />
        </Row>
      ) : null}
      <Row k="Size" name="ab-size">
        <span className="insp-pair">
          <span data-testid="insp-num-ab-w">
            <NumberField
              value={f.w ?? 0}
              min={1}
              lead="W"
              ariaLabel="Artboard width"
              steppers={false}
              scrub={false}
              className="insp-nf"
              onCommit={(n) => can && resize(n, null)}
            />
          </span>
          <span data-testid="insp-num-ab-h">
            <NumberField
              value={f.h ?? 0}
              min={1}
              lead="H"
              ariaLabel="Artboard height"
              steppers={false}
              scrub={false}
              className="insp-nf"
              onCommit={(n) => can && commitHeight(n)}
            />
          </span>
        </span>
      </Row>
      <Row k="Height" name="ab-height">
        <span data-testid="insp-ab-height">
          <Segmented
            value={heightMode(f)}
            ariaLabel="Artboard height"
            options={[
              { value: 'hug', label: 'Fits content' },
              { value: 'fixed', label: 'Fixed' },
            ]}
            onChange={(v) => setHug(v === 'fixed')}
          />
        </span>
      </Row>
      {!f.fixed ? (
        <Quiet testid="insp-ab-height-note">
          Drag the bottom edge to fix the height at a number.
        </Quiet>
      ) : null}
      <Row k="Clip content" name="ab-clip">
        <span data-testid="insp-ctl-ab-clip">
          {/* An artboard always clips to its edge (DCArtboard); there is no prop to turn it off, so the switch shows
              the truth and does not pretend. */}
          <Toggle checked ariaLabel="Clip content" onChange={() => {}} />
        </span>
      </Row>
      <Row k="Kind" name="ab-kind">
        <Select
          value={f.kind}
          ariaLabel="Artboard kind"
          testId="insp-ab-kind"
          options={KIND_OPTIONS}
          onChange={setKind}
        />
      </Row>
      {f.kind === 'print' ? (
        <>
          <Row k="Orientation" name="ab-orientation">
            <Segmented
              value={f.print?.orientation ?? 'portrait'}
              ariaLabel="Paper orientation"
              options={[
                { value: 'portrait', label: 'Portrait' },
                { value: 'landscape', label: 'Landscape' },
              ]}
              onChange={(v) => setPrint({ orientation: v })}
            />
          </Row>
          <Row k="Bleed" name="ab-bleed">
            <NumberField
              value={Number.isFinite(f.print?.bleedMm) ? f.print.bleedMm : 3}
              min={0}
              step={0.5}
              ariaLabel="Bleed, millimeters"
              lead="mm"
              steppers={false}
              className="insp-nf"
              onCommit={(n) => setPrint({ bleedMm: n })}
            />
          </Row>
        </>
      ) : null}
      {f.kind !== 'print' && h.onDuplicateArtboard && id ? (
        <Row k="Other widths" name="ab-add-width">
          <Select
            value=""
            ariaLabel="Add a width"
            testId="insp-ab-add-width"
            options={[
              { value: '', label: 'Add a width…' },
              ...otherWidths(f).map((p) => ({ value: String(p.w), label: `${p.label} · ${p.w}` })),
            ]}
            onChange={(v) => v && h.onDuplicateArtboard(id, Number(v))}
          />
        </Row>
      ) : null}
    </>
  );
}

function ArtboardFillRow({ el, ctx }) {
  const f = artboardFacts(el);
  const h = handlersOf(ctx);
  const fam = useDsFamilies(ctx);
  const value = f.bg ? colourFromCss(f.bg) : null;
  return (
    <Row k="Background" name="ab-background" dim={!value}>
      <ColorControl
        name="ab-background"
        label="Artboard background"
        value={value}
        colors={fam.color}
        allowNone
        noneLabel="None"
        disabled={!f.id}
        onChange={(c) =>
          f.id && h.onSetArtboardStyle?.(f.id, { background: c ? colourToCss(c) : null })
        }
      />
    </Row>
  );
}

function ArtboardLayoutRows({ el, ctx }) {
  const f = artboardFacts(el);
  const h = handlersOf(ctx);
  const tokens = useSpaceTokens(ctx);
  const set = (patch) => f.id && h.onSetArtboardStyle?.(f.id, patch);
  return (
    <>
      <Row k="Content" name="ab-content">
        <Select
          value={f.layout}
          ariaLabel="Artboard body layout"
          testId="inspector-body-layout"
          options={LAYOUT_OPTIONS}
          onChange={(v) => set({ layout: v || null })}
        />
      </Row>
      <Row k="Padding" name="ab-padding">
        <LengthControl
          name="ab-padding"
          label="Artboard padding"
          value={artboardLength(f.padding, tokens)}
          tokens={tokens}
          allowNone
          disabled={!f.id}
          onChange={(l) => set({ padding: artboardLengthPatch(l) })}
        />
      </Row>
      <Row k="Gap" name="ab-gap">
        <LengthControl
          name="ab-gap"
          label="Artboard gap"
          value={artboardLength(f.gap, tokens)}
          tokens={tokens}
          allowNone
          disabled={!f.id}
          onChange={(l) => set({ gap: artboardLengthPatch(l) })}
        />
      </Row>
    </>
  );
}

const ARTBOARD = ['artboard'];

/** The artboard's slot entries, section by section (S2.8). Exported so a test can seat them in a clean registry. */
export const ARTBOARD_SLOTS = Object.freeze([
  [
    'size',
    {
      id: 'size.artboard',
      order: 10,
      kinds: ARTBOARD,
      title: 'Artboard',
      // S7.21: a web page, a fixed size and a video have their own rows (artboard-{web,fixed,video}.jsx, 08 ak-*);
      // paper keeps this body until S7.23's print inspector takes it over
      when: ({ selection }) =>
        (Array.isArray(selection) ? selection[0] : selection)?.attrs?.['data-dc-kind'] === 'print',
      Body: ArtboardSizeRows,
    },
  ],
  ['fill', { id: 'fill.artboard', order: 10, kinds: ARTBOARD, Body: ArtboardFillRow }],
  ['layout', { id: 'layout.artboard', order: 10, kinds: ARTBOARD, Body: ArtboardLayoutRows }],
]);

/** @returns {() => void} take the artboard's sections back out of the registry */
export function registerArtboardSlots() {
  const offs = ARTBOARD_SLOTS.map(([section, entry]) => registerSlot(section, entry));
  return () => {
    for (const off of offs) off();
  };
}

export const offArtboardSections = registerArtboardSlots();
