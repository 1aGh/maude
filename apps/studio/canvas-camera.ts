// The camera a canvas opens on when nobody chose one (2.0.7 fix #6). Pure and React-free, so
// canvas-lib and the tests share one function.
//
// Michal (desktop 2.0.6, StudyFi): the Design system canvas opened as an empty canvas, and only
// zoom-to-fit showed the artboards — at 2 %, scattered over a huge area. Two causes:
//   · with no stored camera the runtime fitted EVERYTHING, and a canvas 43 000 px wide fits at 2 %:
//     on screen, but nothing on it can be read;
//   · a stored camera (`_canvas-state/<slug>.view.json`, per machine) from an older layout was
//     restored as-is, and pointed at a spot where no artboard is any more.
// So: fit-all while it is readable, else the top row, else the first artboard; and a stored camera
// that frames no artboard once the layout has settled is treated as no camera at all.

/** The slice of an artboard rect the camera reads. */
export interface CameraRect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

/**
 * Below this zoom a fit shows only thumbnails: a 1 440 px page is 144 screen px wide and its text
 * is a grey line. A fit-all that small is not a view of the content, so the default camera frames
 * less of it instead (⌘0 still fits everything).
 */
export const READABLE_ZOOM = 0.1;

/**
 * How long the layout must stay still before a restored camera is judged (ms). Hugging artboards
 * report their heights and the Design system canvas re-pitches its rows in the first frames; a
 * camera is only "on nothing" once that is done.
 */
export const STORED_CAMERA_CHECK_MS = 400;

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/**
 * The top row: the artboard nearest the top (then the left) and every artboard beside it — the
 * ones whose vertical span overlaps its own — left to right.
 */
export function topRow<T extends CameraRect>(rects: readonly T[]): T[] {
  if (rects.length === 0) return [];
  let anchor = rects[0] as T;
  for (const r of rects) if (r.y < anchor.y || (r.y === anchor.y && r.x < anchor.x)) anchor = r;
  return rects
    .filter((r) => r.y < anchor.y + anchor.h && r.y + r.h > anchor.y)
    .slice()
    .sort((a, b) => a.x - b.x);
}

/**
 * The camera a canvas opens on with no camera of its own. `fit` is the runtime's own fit (host size,
 * padding and the shell's occluded insets already applied).
 */
export function defaultCamera<T extends CameraRect>(
  rects: readonly T[],
  fit: (rects: T[]) => Camera
): Camera {
  const all = fit(rects.slice());
  if (rects.length <= 1 || all.zoom >= READABLE_ZOOM) return all;
  const row = topRow(rects);
  const r = fit(row);
  if (row.length <= 1 || r.zoom >= READABLE_ZOOM) return r;
  return fit([row[0] as T]);
}

/** True when the camera, on a `w` x `h` host, shows any part of any artboard. */
export function cameraShowsContent(
  camera: Camera,
  w: number,
  h: number,
  rects: readonly CameraRect[]
): boolean {
  if (!finite(camera.x) || !finite(camera.y) || !finite(camera.zoom) || camera.zoom <= 0)
    return false;
  if (!(w > 0) || !(h > 0)) return false;
  // screen = world * zoom + offset  →  the world rect on screen
  const x0 = -camera.x / camera.zoom;
  const y0 = -camera.y / camera.zoom;
  const x1 = x0 + w / camera.zoom;
  const y1 = y0 + h / camera.zoom;
  return rects.some((r) => r.x < x1 && r.x + r.w > x0 && r.y < y1 && r.y + r.h > y0);
}
