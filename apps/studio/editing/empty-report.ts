// apps/studio/editing/empty-report.ts — S11.2: the canvas tells its shell what is empty.
//
// Two facts the shell cannot know for itself (it never reads the canvas DOM):
//   · `artboards {count}`   how many artboards the canvas really has — the empty canvas ("Your canvas is
//                           ready.") shows at 0 and nowhere else. The meta.json seed lies for a canvas the
//                           AI wrote as plain JSX, so the canvas reports.
//   · `artboard-empty`      the ONE selected artboard has nothing on it: its rect in the iframe viewport
//                           (the shell anchors the hint there), its name, and the first other board that has
//                           content ("let AI start it from Desktop"). `rect: null` = it is not empty now / a
//                           different thing is selected — the hint leaves.
//
// Q5 of S11-slices: the hint is drawn SHELL-side so the words live in one table; the canvas draws nothing.
// Pure (the document, the clock and the post are injected): the throttle and the "once per change" rule are
// a unit test, not a timing test. One post per animation frame at most, nothing when nothing changed, and
// the frame loop runs only while an empty artboard is selected (the hint follows pan and zoom).

export interface EmptyRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type EmptyPost =
  | { dgn: 'artboards'; count: number }
  | {
      dgn: 'artboard-empty';
      artboardId: string | null;
      rect: EmptyRect | null;
      label?: string;
      from?: string;
    };

/** Dev-server chrome that sits inside an artboard's body but is not the person's content. */
export const EMPTY_CHROME_SEL =
  '.dgn-pin, .dc-cv-halo, .dc-cv-group-bbox, .dc-activity-rim, .dc-activity-scan, .dc-cv-reorder-divider, .dc-cv-reorder-into, .dc-cv-reorder-lift';

const LABEL_MAX = 120;

export function articleOf(doc: Document, id: string): HTMLElement | null {
  try {
    return doc.querySelector<HTMLElement>(`[data-dc-screen="${CSS.escape(id)}"]`);
  } catch {
    return null;
  }
}

export const bodyOf = (article: Element): HTMLElement | null =>
  article.querySelector<HTMLElement>(':scope > .dc-artboard-body');

/** Does this artboard hold nothing but chrome? (An artboard with no body at all is not "empty": legacy markup.) */
function hasContent(article: Element): boolean {
  const body = bodyOf(article);
  if (!body) return true;
  for (const child of Array.from(body.children)) {
    if (!child.matches(EMPTY_CHROME_SEL)) return true;
  }
  return false;
}

export function labelOf(article: Element): string {
  const raw = article.querySelector(':scope > .dc-artboard-label')?.firstChild?.textContent;
  return (raw ?? article.getAttribute('data-dc-screen') ?? '').trim().slice(0, LABEL_MAX);
}

const whole = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0);

/**
 * The selected artboard, if it is empty: where it is on screen, what it is called, and where AI could start
 * from. Null when it is absent, or has anything on it.
 */
export function measureEmptyArtboard(
  doc: Document,
  id: string
): { rect: EmptyRect; label: string; from?: string } | null {
  const article = articleOf(doc, id);
  if (!article || hasContent(article)) return null;
  const body = bodyOf(article) ?? article;
  const r = body.getBoundingClientRect();
  let from: string | undefined;
  for (const other of Array.from(doc.querySelectorAll('[data-dc-screen]'))) {
    if (other === article || !hasContent(other)) continue;
    const name = labelOf(other);
    if (name) {
      from = name;
      break;
    }
  }
  return {
    rect: { x: whole(r.left), y: whole(r.top), w: whole(r.width), h: whole(r.height) },
    label: labelOf(article),
    ...(from ? { from } : {}),
  };
}

export interface EmptyReporterDeps {
  doc: Document;
  /** The artboard id when exactly one WHOLE artboard is selected, else null. */
  selectedArtboard: () => string | null;
  post: (m: EmptyPost) => void;
  raf?: (fn: () => void) => number;
  caf?: (id: number) => void;
}

export interface EmptyReporter {
  /** Ask for a measurement on the next frame; any number of calls inside a frame cost one pass. */
  request(): void;
  cancel(): void;
}

export function createEmptyReporter(deps: EmptyReporterDeps): EmptyReporter {
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
  let lastCount = -1;
  let lastKey: string | null = null;
  let lastId: string | null = null;

  function pass(): void {
    const count = deps.doc.querySelectorAll('[data-dc-screen]').length;
    if (count !== lastCount) {
      lastCount = count;
      deps.post({ dgn: 'artboards', count });
    }
    const id = deps.selectedArtboard();
    const m = id ? measureEmptyArtboard(deps.doc, id) : null;
    if (id && m) {
      const key = `${id}|${m.rect.x},${m.rect.y},${m.rect.w},${m.rect.h}|${m.label}|${m.from ?? ''}`;
      lastId = id;
      if (key !== lastKey) {
        lastKey = key;
        deps.post({
          dgn: 'artboard-empty',
          artboardId: id,
          rect: m.rect,
          label: m.label,
          ...(m.from ? { from: m.from } : {}),
        });
      }
      pending = raf(frame); // the hint follows pan and zoom while it is up
    } else if (lastKey !== null && lastKey !== 'cleared') {
      lastKey = 'cleared';
      deps.post({ dgn: 'artboard-empty', artboardId: lastId, rect: null });
    }
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
