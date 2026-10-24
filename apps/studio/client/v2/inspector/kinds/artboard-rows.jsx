// client/v2/inspector/kinds/artboard-rows.jsx — S7.21: the rows the per-kind artboard inspectors share (08 ak-*).
// No registration happens here; `artboard-{web,fixed,video}.jsx` compose these and register themselves.
//
//   useArtboardWrites   resize / Fits content ⇄ Fixed / height commit — through the handlers the panel owns
//                       (`ctx.artboard`), exactly the ones artboard.jsx (S2.8) calls; nothing here writes a file
//   SizeSelectRow       Size / Width: the catalogue's presets for this kind (testid `insp-ab-preset`)
//   SizePairRow         W × H (testids `insp-num-ab-w` / `insp-num-ab-h`)
//   HeightRows          Height "Fits content | Fixed" (+ the web page's "1573 now — grows as you add.")

import { NumberField, Segmented, Select, Toggle } from '../../../inspector-controls.jsx';
import { resolveHeightCommit } from '../../../../artboard-hug-commit.ts';
import { Quiet, Row } from '../sections/row.jsx';
import { artboardFacts, heightMode, presetOptions, presetValue } from './artboard-model.js';
import { webHeightNote } from './artboard-kinds-model.js';

const CUSTOM = '';

/** The handlers the panel passes to the artboard (frame.jsx puts them on `ctx.artboard`). */
export const handlersOf = (ctx) => ctx?.artboard || {};

/** @returns {{ f: ReturnType<typeof artboardFacts>, id: string | null, can: boolean, resize: Function, setHug: Function, commitHeight: Function }} */
export function useArtboardWrites(el, ctx) {
  const f = artboardFacts(el);
  const h = handlersOf(ctx);
  const id = f.id;
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
  return { f, id, can: !!id, resize, setHug, commitHeight };
}

/** Size (a fixed size, a video) or Width (a web page): a preset of the one catalogue, or Custom. */
export function SizeSelectRow({ k, f, resize, onConvert }) {
  const options = presetOptions(f.kind);
  const value = presetValue(f);
  const pick = (v) => {
    const o = options.find((x) => x.value === v);
    if (!o) return;
    // S7.25: a paper in a fixed size's select is Change kind — it asks first (ConvertDialog), it never resizes
    if (o.convert && o.paper) onConvert?.(o.paper);
    else resize(o.width, o.height ?? null);
  };
  return (
    <Row k={k} name="ab-preset">
      <Select
        value={value}
        ariaLabel={k === 'Width' || k === 'Preset' ? 'Artboard width' : 'Artboard size'}
        testId="insp-ab-preset"
        options={value === CUSTOM ? [{ value: CUSTOM, label: 'Custom' }, ...options] : options}
        onChange={pick}
      />
    </Row>
  );
}

/** W × H, in world px. */
export function SizePairRow({ k = '', f, can, resize, commitHeight }) {
  return (
    <Row k={k} name="ab-size">
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
  );
}

/**
 * Clip content — on, because an artboard always clips to its edge (DCArtboard has no prop to turn it off), so the switch
 * shows the truth and does not pretend. On the card for a web page (14 ed-ab-select); under Advanced for the other kinds.
 */
export function ClipRow() {
  return (
    <Row k="Clip content" name="ab-clip">
      <span data-testid="insp-ctl-ab-clip">
        <Toggle checked ariaLabel="Clip content" onChange={() => {}} />
      </span>
    </Row>
  );
}

/** Height: Fits content | Fixed, and — while it fits — how tall the page is now. */
export function HeightRows({ f, setHug }) {
  return (
    <>
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
      {!f.fixed && Number.isFinite(f.h) ? (
        <Quiet testid="insp-ab-height-note">{webHeightNote(f.h)}</Quiet>
      ) : null}
    </>
  );
}
