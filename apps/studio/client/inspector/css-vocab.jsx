// inspector/css-vocab.jsx — moved verbatim out of client/app.jsx (Maude v2 plan V2-0.2, move-only split).

import { Lu } from '../shell/icons.jsx';
import {
  ALargeSmall as LuALargeSmall,
  AlignHorizontalSpaceBetween as LuSpaceBetween,
  Baseline as LuBaseline,
  Minus as LuMinus,
  MoveHorizontal as LuMoveH,
  Spline as LuSpline,
} from 'lucide-react';

// ---------- CSS knobs (Phase 12.2, DDR-104) — interactive panel ----------
//
// Hybrid vocabulary (friendly collapsible section headers + CSS-named rows),
// per-field DS-token quick-pick, nested box-model widget, per-corner radius,
// per-row provenance (token-bound / raw-override / inherited), per-field save
// state, and two escape hatches: custom CSS property (via /_api/edit-css) +
// custom HTML attribute (via /_api/edit-attr). Each knob pre-fills from the
// AUTHORED inline value (`el.authored`); the resolved `computed` value is a
// faint placeholder only (NOT editable — the v1 UX bug). Ported from the
// critic-approved + user-iterated `.design/ui/Studio.tsx` spec.

export const CSS_DISPLAYS = [
  'block',
  'inline-block',
  'flex',
  'inline-flex',
  'grid',
  'inline',
  'none',
];

// feature-3-web-artboards T5 — per-track unit ladder for the Grid section's
// UnitSelect (the stub's own list: px/%/fr/em/auto/min-content/max-content).
export const GRID_TRACK_UNITS = ['px', '%', 'fr', 'em', 'auto', 'min-content', 'max-content'];

export const CSS_FLEX_DIR = ['row', 'row-reverse', 'column', 'column-reverse'];

export const CSS_FLEX_WRAP = ['nowrap', 'wrap', 'wrap-reverse'];

export const CSS_ALIGN = ['stretch', 'flex-start', 'center', 'flex-end', 'baseline'];

// Stage M — flex-CHILD align-self (adds `auto` to the container align-items set).
export const CSS_ALIGN_SELF = ['auto', 'stretch', 'flex-start', 'center', 'flex-end', 'baseline'];

export const CSS_JUSTIFY = [
  'flex-start',
  'center',
  'flex-end',
  'space-between',
  'space-around',
  'space-evenly',
];

export const CSS_WEIGHTS = ['300', '400', '500', '600', '700', '800'];

/** What an edit route says the write replaced (`previous`, read under the file
 *  lock) — the value an undo must restore. `fallback` only when the route could
 *  not name it (an expression, or an older server). */
export const replacedValue = (j, fallback) =>
  j && Object.hasOwn(j, 'previous') ? j.previous : fallback;

export const CSS_FONTS = [
  'inherit',
  'system-ui',
  'sans-serif',
  'serif',
  'monospace',
  'Inter',
  'Inter Tight',
  'JetBrains Mono',
];

export const CSS_BORDER_STYLES = ['none', 'solid', 'dashed', 'dotted', 'double'];

export const CSS_UNITS = ['px', 'rem', 'em', '%', 'vw', 'vh', 'auto'];

// Properties whose bare-number value is unitless — never append a unit suffix.
export const CSS_UNITLESS = new Set([
  'line-height',
  'opacity',
  'font-weight',
  'z-index',
  'flex-grow',
  'flex-shrink',
  'order',
]);

// #2 — Figma-style property prefix inside numeric fields: a small glyph (icon) or
// a mono letter (t). Only where it reads cleanly; selects/colours keep their own.
export const PROP_LEAD = {
  'font-size': { node: <Lu as={LuALargeSmall} size={12} /> },
  'line-height': { node: <Lu as={LuBaseline} size={12} /> },
  'letter-spacing': { node: <Lu as={LuMoveH} size={12} /> },
  gap: { node: <Lu as={LuSpaceBetween} size={12} /> },
  width: { t: 'W' },
  height: { t: 'H' },
  'max-width': { t: 'W' },
  'border-radius': { node: <Lu as={LuSpline} size={12} /> },
  'border-width': { node: <Lu as={LuMinus} size={12} /> },
};

export const CSS_ALIGN_OPTS = ['left', 'center', 'right', 'justify'];

// feature-element-editing-robustness Stage B — enum option lists for the promoted
// DDR-104 OUT-list knobs (Position / Typography extras / Media framing).
export const CSS_POSITION = ['static', 'relative', 'absolute', 'fixed', 'sticky'];

export const CSS_FONT_STYLE = ['normal', 'italic', 'oblique'];

export const CSS_TEXT_TRANSFORM = ['none', 'uppercase', 'lowercase', 'capitalize'];

export const CSS_TEXT_DECORATION = ['none', 'underline', 'line-through', 'overline'];

export const CSS_WHITE_SPACE = ['normal', 'nowrap', 'pre', 'pre-wrap', 'pre-line', 'break-spaces'];

export const CSS_OBJECT_FIT = ['fill', 'contain', 'cover', 'none', 'scale-down'];

export const CSS_OVERFLOW = ['visible', 'hidden', 'auto', 'scroll'];

// DDR-171 — Designer mode "Effects" cluster (blend) + the matching Advanced-mode
// Appearance row. Standard CSS `mix-blend-mode` keyword list.
export const CSS_BLEND_MODES = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
];

// Common aspect ratios for the Media dropdown (dogfood request — a select, not a
// free-text field). Canonical spaced form so a dropdown-set value round-trips.
export const CSS_ASPECT_RATIO = [
  'auto',
  '1 / 1',
  '4 / 3',
  '3 / 2',
  '16 / 9',
  '21 / 9',
  '3 / 4',
  '2 / 3',
  '9 / 16',
];

// feature-element-editing-robustness Stage I4 — device presets for the "New
// artboard" menu (inserts an empty <DCArtboard> of these dims into the canvas).
export const SCREEN_PRESETS = {
  desktop: { label: 'Desktop', width: 1440, height: 1024 },
  laptop: { label: 'Laptop', width: 1280, height: 800 },
  tablet: { label: 'Tablet', width: 834, height: 1194 },
  mobile: { label: 'Mobile', width: 390, height: 844 },
};
