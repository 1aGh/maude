// parity-check.ts — #150 §4 + #128 §8: list, BEFORE the render starts, what
// @remotion/web-renderer will not draw the way the Player does.
//
// Every row below was measured, not assumed: a comp using the feature was exported to mp4 and
// compared with the PNG export of the same artboard (the browser's own rendering) —
//   background-image url()       absent from the mp4 (only `linear-gradient(` is parsed)
//   radial / conic / repeating   drawn as a plain linear gradient, or not at all
//   mix-blend-mode               drawn as `normal`
//   backdrop-filter              not applied
//   inset box-shadow             not drawn (the renderer itself logs "not yet supported")
//   vertical writing-mode        text not drawn (same)
//   inline <svg> edge cases      the renderer serializes the <svg> into a standalone image
//                                document: it cannot see the page, so a `<use>` of a shape that
//                                lives outside it, an outside `<image>`, a `var(--x)`, or a fill
//                                that comes from a page stylesheet class all come out wrong
// and what does NOT make the list because it rendered correctly: `skewX/skewY` (flex items, nested
// under a rotate, chained with translate), `clip-path` (polygon/inset/circle, also over a gradient),
// text-shadow, blur filter, low-opacity images. A skewed element is therefore deliberately not
// flagged — a warning that cries wolf teaches people to stop reading it.
//
// Browser-safe and React-free: imported by `video-render-lib.ts` (runs inside the capture
// Chromium, over the Player's DOM) and unit-tested under happy-dom. Nothing here blocks an export.

export type ParityFeature =
  | 'bg-url'
  | 'bg-gradient'
  | 'blend-mode'
  | 'backdrop-filter'
  | 'inset-shadow'
  | 'vertical-text'
  | 'svg-outside-use'
  | 'svg-outside-image'
  | 'svg-css-var'
  | 'svg-page-class';

/** What a person is told. `label` finishes "…the mp4 differs from the preview: <label> on <elements>". */
export const PARITY_FEATURES: Record<ParityFeature, { label: string; hint: string }> = {
  'bg-url': {
    label: 'a background-image url() is not drawn',
    hint: 'draw the picture with an <img> instead',
  },
  'bg-gradient': {
    label: 'a radial, conic or repeating gradient is not drawn as written',
    hint: 'use a plain linear-gradient',
  },
  'blend-mode': {
    label: 'mix-blend-mode is ignored',
    hint: 'bake the blend into the picture',
  },
  'backdrop-filter': {
    label: 'backdrop-filter is ignored',
    hint: 'use a solid or semi-transparent fill',
  },
  'inset-shadow': {
    label: 'an inset box-shadow is not drawn',
    hint: 'use a border or an inner element',
  },
  'vertical-text': {
    label: 'vertical text (writing-mode) is not drawn',
    hint: 'rotate horizontal text with a transform',
  },
  'svg-outside-use': {
    label: 'an inline <svg> uses a shape from outside itself (<use>)',
    hint: 'put the shape inside that <svg>',
  },
  'svg-outside-image': {
    label: 'an inline <svg> loads a picture from outside itself (<image>)',
    hint: 'use an <img> next to it',
  },
  'svg-css-var': {
    label: 'an inline <svg> reads a CSS variable (var())',
    hint: 'write the color into the <svg>',
  },
  'svg-page-class': {
    label: 'an inline <svg> is colored by a page stylesheet class',
    hint: 'set fill / stroke on the <svg> itself',
  },
};

export interface ParityFinding {
  feature: ParityFeature;
  /** Up to `MAX_NAMED` element descriptions (`div.hero`, `svg#logo`); `count` is the total. */
  elements: string[];
  count: number;
}

export interface ParityScan {
  /** The artboard the comp sits on (its `data-dc-screen` id), when known. */
  artboard: string | null;
  findings: ParityFinding[];
}

const MAX_NAMED = 5;
const MAX_ELEMENTS = 6000;

/** `div#id.class "text"` — short, and enough to find the element in the source. */
export function describeElement(el: Element): string {
  const tag = el.localName;
  const id = el.id ? `#${el.id}` : '';
  const cls = (el.getAttribute('class') ?? '').trim().split(/\s+/)[0];
  let out = tag + id + (cls ? `.${cls}` : '');
  if (!id && !cls) {
    const own = [...el.childNodes]
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent ?? '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (own) out += ` "${own.slice(0, 20)}"`;
    else if (el.parentElement) {
      // nothing to call it by: say where it sits, so it can still be found in the source
      const nth = [...el.parentElement.children].indexOf(el) + 1;
      out = `${el.parentElement.localName} > ${tag}:nth-child(${nth})`;
    }
  }
  return out.slice(0, 48);
}

type StyleReader = Pick<CSSStyleDeclaration, 'getPropertyValue'>;

const has = (v: string | null | undefined): boolean => !!v && v !== 'none' && v !== 'normal';

/** Features of the element's own box (everything but inline-svg internals). */
function boxFeatures(s: StyleReader): ParityFeature[] {
  const out: ParityFeature[] = [];
  const bg = s.getPropertyValue('background-image');
  if (has(bg)) {
    if (/\burl\(/i.test(bg)) out.push('bg-url');
    if (/\b(?:radial|conic)-gradient\(|\brepeating-(?:linear|radial|conic)-gradient\(/i.test(bg)) {
      out.push('bg-gradient');
    }
  }
  if (
    has(s.getPropertyValue('mix-blend-mode')) ||
    has(s.getPropertyValue('background-blend-mode'))
  ) {
    // `background-blend-mode: normal` is the initial value, `has` already drops it
    out.push('blend-mode');
  }
  if (
    has(s.getPropertyValue('backdrop-filter')) ||
    has(s.getPropertyValue('-webkit-backdrop-filter'))
  ) {
    out.push('backdrop-filter');
  }
  if (/\binset\b/i.test(s.getPropertyValue('box-shadow'))) out.push('inset-shadow');
  const wm = s.getPropertyValue('writing-mode');
  if (wm && wm !== 'horizontal-tb') out.push('vertical-text');
  return out;
}

const VISUAL = ['fill', 'stroke', 'stroke-width', 'opacity', 'fill-opacity', 'stroke-opacity'];

/** Does a page stylesheet class change how this svg element looks? Measured by taking the class off. */
function classChangesLook(el: Element, read: (e: Element) => StyleReader): boolean {
  const cls = el.getAttribute('class');
  if (!cls) return false;
  const snapshot = (): string => {
    const s = read(el);
    return VISUAL.map((p) => s.getPropertyValue(p)).join('|');
  };
  const withClass = snapshot();
  el.removeAttribute('class');
  try {
    return snapshot() !== withClass;
  } finally {
    el.setAttribute('class', cls);
  }
}

function svgFeatures(svg: Element, read: (e: Element) => StyleReader): ParityFeature[] {
  const out = new Set<ParityFeature>();
  const markup = svg.outerHTML;
  if (/\bvar\(\s*--/.test(markup)) out.add('svg-css-var');
  for (const use of svg.querySelectorAll('use')) {
    const href = use.getAttribute('href') ?? use.getAttribute('xlink:href') ?? '';
    if (!href.startsWith('#')) out.add('svg-outside-use');
    else if (!svg.querySelector(`[id="${href.slice(1).replace(/"/g, '')}"]`)) {
      out.add('svg-outside-use');
    }
  }
  for (const image of svg.querySelectorAll('image')) {
    const href = image.getAttribute('href') ?? image.getAttribute('xlink:href') ?? '';
    if (!/^data:/i.test(href)) out.add('svg-outside-image');
  }
  // An svg that carries its own <style> is self-contained; classes without one lean on the page.
  if (!svg.querySelector('style')) {
    for (const el of svg.querySelectorAll('[class]')) {
      if (classChangesLook(el, read)) {
        out.add('svg-page-class');
        break;
      }
    }
  }
  return [...out];
}

/**
 * Scan the subtree under `root` (the mounted comp) for features the exporter cannot draw.
 * `getStyle` is a seam for tests; production reads the browser's computed style.
 */
export function scanParity(
  root: Element,
  getStyle?: (el: Element) => StyleReader
): ParityFinding[] {
  const read = getStyle ?? ((el: Element) => getComputedStyle(el));
  const found = new Map<ParityFeature, ParityFinding>();
  const add = (feature: ParityFeature, el: Element): void => {
    const f = found.get(feature) ?? { feature, elements: [], count: 0 };
    f.count += 1;
    if (f.elements.length < MAX_NAMED) f.elements.push(describeElement(el));
    found.set(feature, f);
  };
  let seen = 0;
  for (const el of [root, ...root.querySelectorAll('*')]) {
    if (++seen > MAX_ELEMENTS) break;
    // an svg's children are part of the image the renderer makes of the svg, not nodes it walks
    const inSvg = el.closest('svg');
    if (inSvg && inSvg !== el) continue;
    const style = read(el);
    if (style.getPropertyValue('display') === 'none') continue;
    if (el.localName === 'svg') {
      for (const f of svgFeatures(el, read)) add(f, el);
    } else {
      for (const f of boxFeatures(style)) add(f, el);
    }
  }
  return [...found.values()];
}

/** Fold `more` into `into` by feature: counts add, names stay capped. */
export function mergeFindings(into: ParityFinding[], more: ParityFinding[]): ParityFinding[] {
  const byFeature = new Map(into.map((f) => [f.feature, { ...f, elements: [...f.elements] }]));
  for (const f of more) {
    const have = byFeature.get(f.feature);
    if (!have) {
      byFeature.set(f.feature, { ...f, elements: [...f.elements] });
      continue;
    }
    for (const name of f.elements) {
      if (have.elements.length < MAX_NAMED && !have.elements.includes(name))
        have.elements.push(name);
    }
    // The same element seen on several sampled frames is one element: the larger count wins.
    have.count = Math.max(have.count, f.count);
  }
  return [...byFeature.values()];
}

/** The frames worth looking at: first, last and a few between (an element can appear mid-comp). */
export function sampleFrames(durationInFrames: number): number[] {
  const last = Math.max(0, durationInFrames - 1);
  return [...new Set([0, 0.25, 0.5, 0.75, 1].map((p) => Math.round(last * p)))];
}
