/**
 * @file       artboard-placeholder.ts — 2.0.7: what an artboard shows while its children are not mounted
 * @scope      apps/studio/artboard-placeholder.ts (React-free; drawn by artboard-live-gate.tsx)
 * @purpose    An artboard that is not mounted yet, or was released because it is far away, used to show the
 *             bare frame — `var(--bg-0)`, which on a dark design system is a black box (Michal, 2.0.7). It now
 *             shows a placeholder of the same size in the artboard's OWN colours:
 *
 *             - `picture` — it has rendered before (this session): its background and a few of its biggest
 *               blocks (their rectangles and colours, pictures as a muted tone), a cheap still of what was there;
 *             - `skeleton` — it has never rendered: its `background` prop, else the background the canvas's other
 *               artboards turned out to have, else the frame's own.
 *
 *             The picture lives only in this canvas document's memory: never on disk and never in the canvas
 *             origin's storage, which every canvas on that origin can read (C4's named gap) — a canvas must not
 *             learn another canvas's layout from it.
 */

export interface PictureBlock {
  /** left, top, width, height — fractions of the artboard body */
  x: number;
  y: number;
  w: number;
  h: number;
  /** a CSS colour; '' = a picture / media, drawn in a muted tone */
  c: string;
}

export interface ArtboardPicture {
  bg: string;
  blocks: PictureBlock[];
  /** the body's height when it was taken (px) — the placeholder holds it */
  h: number;
}

export type PlaceholderKind = 'picture' | 'skeleton';

/** At most this many blocks per picture, and this many elements walked to find them. */
export const PICTURE_MAX_BLOCKS = 24;
export const PICTURE_MAX_WALK = 400;
/** A block smaller than this share of the body is detail, not structure. */
export const PICTURE_MIN_AREA = 0.004;

const pictures = new Map<string, ArtboardPicture>();
const backgrounds = new Map<string, string>();
let canvasBg = '';
const canvasBgSubs = new Set<() => void>();

/** The background this canvas's artboards turned out to have ('' until one has mounted). */
export function canvasBackground(): string {
  return canvasBg;
}

/**
 * Told once, when the canvas colour first becomes known: the skeletons drawn before any artboard rendered took the
 * mid tone and repaint in it. Later colours do not repaint every placeholder again (new ones take the latest).
 */
export function subscribeCanvasBackground(fn: () => void): () => void {
  canvasBgSubs.add(fn);
  return () => {
    canvasBgSubs.delete(fn);
  };
}

function setCanvasBg(bg: string): void {
  if (!bg) return;
  const first = !canvasBg;
  canvasBg = bg;
  if (first) for (const fn of [...canvasBgSubs]) fn();
}

/**
 * Nothing known yet (the first frames of an open): a soft mid tone over the frame's own colour — on a dark
 * design system the bare `var(--bg-0)` is the black box this replaces.
 */
export const UNKNOWN_BG = 'color-mix(in oklab, var(--bg-0, #ffffff) 55%, #9a9a9a)';

/** Test hook. */
export function resetPictures(): void {
  pictures.clear();
  backgrounds.clear();
  canvasBg = '';
}

export function pictureOf(id: string): ArtboardPicture | undefined {
  return pictures.get(id);
}

export function rememberPicture(id: string, pic: ArtboardPicture): void {
  pictures.set(id, pic);
  setCanvasBg(pic.bg);
}

/** Transparent, or a colour the frame would show through. */
export function isClear(c: string | null | undefined): boolean {
  if (!c) return true;
  const v = c.replace(/\s+/g, '').toLowerCase();
  return (
    v === 'transparent' ||
    v === 'none' ||
    v === 'rgba(0,0,0,0)' ||
    /^rgba\([^)]*,0(\.0+)?\)$/.test(v) ||
    /\/0(\.0+)?\)$/.test(v)
  );
}

/**
 * Which placeholder, in which colour. `background` is the artboard's own prop (a token or a colour); a
 * remembered picture wins over it because it is what the artboard actually looked like.
 */
export function choosePlaceholder(
  id: string,
  background?: string
): { kind: PlaceholderKind; bg: string; picture?: ArtboardPicture } {
  const pic = pictures.get(id);
  const own = backgrounds.get(id);
  if (pic)
    return {
      kind: 'picture',
      bg: pic.bg || own || background || canvasBg || UNKNOWN_BG,
      picture: pic,
    };
  return { kind: 'skeleton', bg: own || background || canvasBg || UNKNOWN_BG };
}

const MEDIA = new Set(['IMG', 'PICTURE', 'VIDEO', 'CANVAS', 'svg', 'SVG', 'IFRAME']);

/**
 * The colour an artboard body shows: its own background, else that of the first element covering most of it
 * (a transparent body usually wraps a full-size `.root`). '' when it has none. Cheap — at most four elements.
 */
export function backgroundOf(
  body: HTMLElement,
  br: DOMRect = body.getBoundingClientRect()
): string {
  const area = br.width * br.height;
  let bg = getComputedStyle(body).backgroundColor;
  let probe: Element | null = body;
  for (let depth = 0; isClear(bg) && probe && depth < 4; depth++) {
    probe = probe.firstElementChild;
    if (!probe) break;
    const r = probe.getBoundingClientRect();
    if (area > 0 && r.width * r.height < area * 0.6) break;
    bg = getComputedStyle(probe).backgroundColor;
  }
  return isClear(bg) ? '' : bg;
}

/** An artboard's colour as soon as it mounts (its picture comes later): its own skeleton and the canvas guess. */
export function rememberBackground(id: string, bg: string): void {
  if (!bg) return;
  backgrounds.set(id, bg);
  setCanvasBg(bg);
}

/**
 * Take the picture of a mounted artboard body: its background (the body's, else the first element covering
 * most of it) and its biggest coloured / media blocks. Bounded (`PICTURE_MAX_WALK` elements), read-only.
 */
export function takePicture(body: HTMLElement): ArtboardPicture | null {
  const br = body.getBoundingClientRect();
  if (br.width < 2 || br.height < 2) return null;
  const area = br.width * br.height;
  const cs = (el: Element) => getComputedStyle(el);
  const bg = backgroundOf(body, br) || '';
  const blocks: PictureBlock[] = [];
  const queue: Element[] = [...body.children];
  let walked = 0;
  while (queue.length && walked < PICTURE_MAX_WALK && blocks.length < PICTURE_MAX_BLOCKS) {
    const el = queue.shift() as Element;
    walked += 1;
    const r = el.getBoundingClientRect();
    const share = (r.width * r.height) / area;
    if (share < PICTURE_MIN_AREA) continue;
    const media = MEDIA.has(el.tagName);
    const c = media ? '' : cs(el).backgroundColor;
    if (media || (!isClear(c) && c !== bg && share < 0.9)) {
      blocks.push({
        x: (r.left - br.left) / br.width,
        y: (r.top - br.top) / br.height,
        w: r.width / br.width,
        h: r.height / br.height,
        c: media ? '' : c,
      });
    }
    if (!media) for (const ch of el.children) queue.push(ch);
  }
  return { bg, blocks, h: body.offsetHeight };
}
