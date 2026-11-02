// apps/studio/editing/anchor-report.ts — S7.7: the canvas tells its shell which artboard is selected and where.
//
// The timeline island (client/v2/timeline/) is tied to the selected VIDEO artboard: it rises from that
// artboard, its notch points at the artboard's centre, and it follows pan and zoom. The shell never reads
// the canvas DOM, so the canvas posts one message — `artboard-anchor { artboardId, kind, label, rect }` (the
// rect in iframe viewport px) — when the ONE selected whole artboard changes, and `{ artboardId: null }` when
// it is not one any more. While a video is selected a frame loop re-measures (the island follows the camera);
// for any other artboard the report is once per change. Nothing is posted while nothing was selected.
//
// Pure like empty-report.ts (the document, the clock and the post are injected): the throttle and the "once
// per change" rule are unit tests. One post per animation frame at most.

import { articleOf, bodyOf, type EmptyRect, labelOf } from './empty-report.ts';

// unlike the empty hint's rect, an artboard panned half off the left or top edge really is at a negative x / y
const px = (v: number) => (Number.isFinite(v) ? Math.round(v) : 0);

export interface AnchorPost {
  dgn: 'artboard-anchor';
  artboardId: string | null;
  kind?: string;
  label?: string;
  rect?: EmptyRect | null;
}

/**
 * What kind of artboard this is, as the shell should treat it: the resolved `data-dc-kind`, and a
 * `<VideoComp>` inside (an unmigrated canvas, canvas-shell's `artboardHasVideo` rule) makes it a video.
 */
export function artboardKindOf(article: Element): string {
  if (article.getAttribute('data-dc-kind') === 'video') return 'video';
  if (article.querySelector('[data-comp-id]')) return 'video';
  return article.getAttribute('data-dc-kind') || 'digital';
}

/** The selected artboard: its kind, its name, and where it is in the iframe viewport. Null when it is gone. */
export function measureAnchor(
  doc: Document,
  id: string
): { kind: string; label: string; rect: EmptyRect } | null {
  const article = articleOf(doc, id);
  if (!article) return null;
  const r = (bodyOf(article) ?? article).getBoundingClientRect();
  return {
    kind: artboardKindOf(article),
    label: labelOf(article),
    rect: { x: px(r.left), y: px(r.top), w: px(r.width), h: px(r.height) },
  };
}

export interface AnchorReporterDeps {
  doc: Document;
  /** The artboard id when exactly one WHOLE artboard is selected, else null. */
  selectedArtboard: () => string | null;
  post: (m: AnchorPost) => void;
  raf?: (fn: () => void) => number;
  caf?: (id: number) => void;
}

export interface AnchorReporter {
  /** Ask for a measurement on the next frame; any number of calls inside a frame cost one pass. */
  request(): void;
  cancel(): void;
}

const NONE = 'none';

export function createAnchorReporter(deps: AnchorReporterDeps): AnchorReporter {
  const raf =
    deps.raf ??
    ((fn: () => void) =>
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame(fn)
        : (setTimeout(fn, 16) as unknown as number));
  const caf =
    deps.caf ??
    ((id: number) =>
      typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame(id) : clearTimeout(id));
  let pending: number | null = null;
  let lastKey = NONE; // what the shell was last told

  function clear(): void {
    if (lastKey === NONE) return;
    lastKey = NONE;
    deps.post({ dgn: 'artboard-anchor', artboardId: null });
  }

  function pass(): void {
    const id = deps.selectedArtboard();
    const m = id ? measureAnchor(deps.doc, id) : null;
    if (!id || !m) {
      clear();
      return;
    }
    const key = `${id}|${m.kind}|${m.rect.x},${m.rect.y},${m.rect.w},${m.rect.h}|${m.label}`;
    if (key !== lastKey) {
      lastKey = key;
      deps.post({
        dgn: 'artboard-anchor',
        artboardId: id,
        kind: m.kind,
        label: m.label,
        rect: m.rect,
      });
    }
    // the island follows pan and zoom, so a selected video is measured every frame
    if (m.kind === 'video') pending = raf(frame);
  }
  function frame(): void {
    pending = null;
    pass();
  }
  return {
    request() {
      if (pending !== null) return;
      pending = raf(frame);
    },
    cancel() {
      if (pending !== null) caf(pending);
      pending = null;
    },
  };
}
