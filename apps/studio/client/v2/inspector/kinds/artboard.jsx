// client/v2/inspector/kinds/artboard.jsx — S2.8: the artboard's inspector (14 Editing, ed-ab-select / ed-ab-resize).
// It supersedes `client/inspector/artboard-knobs.jsx` in the v2 inspector; every knob of that panel keeps a home:
//
//   Artboard   the per-kind rows: a web page (artboard-web.jsx), a fixed size (artboard-fixed.jsx), a video
//              (artboard-video.jsx), paper (artboard-print.jsx, S7.23) — S2.8's one body for all four is gone;
//              every knob it had lives in one of those four or under Advanced
//   Fill       Background (a token, from the system)
//   Layout     Content (Top to bottom · Stacked · Left to right · Grid) · Padding · Gap
//   Export     the default presets (S2.5's slot; S8 fills it)
//   Advanced   Theme (DS default · Follow chrome · Light · Dark) — see `artboard-advanced.jsx`
//
// Writes go through the handlers the panel already owns (`ctx.artboard`): the numeric JSX props (DDR-027) via the
// resize lane, Hug/Fixed, style, kind and print props — nothing here talks to a file itself. Hug vs Fixed is
// never a chip: it is the Height row.

import { Select } from '../../../inspector-controls.jsx';
import { colourFromCss, colourToCss } from '../../../../edit-ops/words-paint.ts';
import { registerSlot } from '../slots.js';
import { ColorControl } from '../sections/color-control.jsx';
import { Row } from '../sections/row.jsx';
import { LengthControl, useDsFamilies, useSpaceTokens } from '../token-chip.jsx';
import {
  LAYOUT_OPTIONS,
  artboardFacts,
  artboardLength,
  artboardLengthPatch,
} from './artboard-model.js';

/** The handlers the panel passes to the artboard (frame.jsx puts them on `ctx.artboard`). */
const handlersOf = (ctx) => ctx?.artboard || {};

function ArtboardFillRow({ el, ctx }) {
  const f = artboardFacts(el);
  // 14 ed-ab-select: a web page's Fill is a section with one row, "Background"; a fixed size keeps 08's "Fill" row
  const label = f.kind === 'web' ? 'Background' : 'Fill';
  const h = handlersOf(ctx);
  const fam = useDsFamilies(ctx);
  const value = f.bg ? colourFromCss(f.bg) : null;
  return (
    <Row k={label} name="ab-background" dim={!value}>
      <ColorControl
        name="ab-background"
        label="Artboard fill"
        value={value}
        colors={fam.color}
        vals={fam.vals}
        allowNone
        noneLabel="None"
        showOpacity
        disabled={!f.id}
        onChange={(c) =>
          f.id && h.onSetArtboardStyle?.(f.id, { background: c ? colourToCss(c) : null })
        }
      />
    </Row>
  );
}

/**
 * V2-8.5 C5 (14 ed-ab-select) — the web page's Layout section is ONE row, "Content: Top to bottom". Its Padding and
 * Gap are exact numbers: they sit under Advanced with the other facts (`artboard-advanced-rows.jsx`), same writes.
 */
function ArtboardLayoutRows({ el, ctx }) {
  const f = artboardFacts(el);
  const h = handlersOf(ctx);
  const set = (patch) => f.id && h.onSetArtboardStyle?.(f.id, patch);
  return (
    <Row k="Content" name="ab-content">
      <Select
        value={f.layout}
        ariaLabel="Artboard body layout"
        testId="inspector-body-layout"
        options={LAYOUT_OPTIONS}
        onChange={(v) => set({ layout: v || null })}
      />
    </Row>
  );
}

/** Padding and Gap of a web page's body — under Advanced (the board's card draws neither). */
export function ArtboardSpacingRows({ el, ctx }) {
  const f = artboardFacts(el);
  const h = handlersOf(ctx);
  const tokens = useSpaceTokens(ctx);
  const set = (patch) => f.id && h.onSetArtboardStyle?.(f.id, patch);
  return (
    <>
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

const kindOf = (selection) => {
  const el = Array.isArray(selection) ? selection[0] : selection;
  return el?.attrs?.['data-dc-kind'] || 'digital';
};

/**
 * V2-8.5 C2 (08 ak-*; 07 ve-select) — rows by kind, not one body for every board. A background belongs to a web page
 * and a fixed size; a print board's colour is the paper's and a video's is its footage. Layout (Content · Padding ·
 * Gap) is a web page's: a fixed size places things anywhere, a print board has its guides, a video its
 * timeline.
 */
export const hasBackground = (kind) => kind === 'web' || kind === 'digital';
export const hasPageLayout = (kind) => kind === 'web';

/** The artboard's slot entries, section by section (S2.8). Exported so a test can seat them in a clean registry. */
export const ARTBOARD_SLOTS = Object.freeze([
  [
    'fill',
    {
      id: 'fill.artboard',
      order: 10,
      kinds: ARTBOARD,
      when: ({ selection }) => hasBackground(kindOf(selection)),
      // 08 board: "Fill" is a row of the one Artboard card, not a section of its own — except on a web page, where
      // 14 ed-ab-select draws Fill ▸ Background as a section
      headless: ({ selection }) => kindOf(selection) !== 'web',
      Body: ArtboardFillRow,
    },
  ],
  [
    'layout',
    {
      id: 'layout.artboard',
      order: 10,
      kinds: ARTBOARD,
      when: ({ selection }) => hasPageLayout(kindOf(selection)),
      // 14 ed-ab-select: Layout ▸ Content
      headless: false,
      Body: ArtboardLayoutRows,
    },
  ],
]);

/** @returns {() => void} take the artboard's sections back out of the registry */
export function registerArtboardSlots() {
  const offs = ARTBOARD_SLOTS.map(([section, entry]) => registerSlot(section, entry));
  return () => {
    for (const off of offs) off();
  };
}

export const offArtboardSections = registerArtboardSlots();
