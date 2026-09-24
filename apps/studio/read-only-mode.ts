/**
 * @file       read-only-mode.ts — Cloud Phase 25 C2
 * @scope      apps/studio/read-only-mode.ts
 * @purpose    One boot-static answer to "is this canvas read-only?" for every
 *             module that runs inside the canvas iframe.
 *
 * The shell appends `?ro=1` to the canvas URL (client/canvas-url.js) when
 * `/_config.readOnly` is true — i.e. the linked hub vouched a `viewer` role at
 * workspace sign-in (sync/hubs-config.ts). Boot-static on purpose: a role is
 * per-session, and reading the URL can't race the way a post-load postMessage
 * could (during which a viewer could still drag something).
 *
 * This flag decides what the canvas chrome OFFERS — tools, drag handles,
 * inline edit, context menus. It never STOPS a write; that is the cell
 * (Phase 25 C1) and the dev-server's read-only gate (http.ts), both of which
 * hold whatever this returns.
 */

let cached: boolean | null = null;

export function isReadOnlyCanvas(): boolean {
  if (typeof window === 'undefined') return false;
  if (cached === null) {
    try {
      cached = new URLSearchParams(window.location.search).get('ro') === '1';
    } catch {
      cached = false;
    }
  }
  return cached;
}

let embedCached: boolean | null = null;

/**
 * DDR-242 — is this canvas the chromeless view another app frames
 * (`client/embed-view.jsx` appends `?embed=1`)? Boot-static for the same reason
 * as `isReadOnlyCanvas`. An embed pans and zooms, but never persists its
 * camera: the designer's own view of the canvas is not the embed's to move.
 */
export function isEmbedCanvas(): boolean {
  if (typeof window === 'undefined') return false;
  if (embedCached === null) {
    try {
      embedCached = new URLSearchParams(window.location.search).get('embed') === '1';
    } catch {
      embedCached = false;
    }
  }
  return embedCached;
}

/**
 * DDR-242 — Escape inside an embedded canvas belongs to the app around it.
 * Keys pressed in this frame never reach the embedding page, so an embed shown
 * in a dialog would trap a keyboard user: the dialog's own Escape stops
 * working. When nothing in the canvas consumed the key (`defaultPrevented`,
 * read after every listener has run), tell the studio page, which relays it to
 * the embedder as the contract's `escape`. Never in the studio itself.
 */
export function installEmbedEscapeRelay(win: Window = window): () => void {
  let embed = false;
  try {
    embed = new URLSearchParams(win.location?.search ?? '').get('embed') === '1';
  } catch {
    /* not a canvas URL */
  }
  if (!embed || win.parent === win) return () => {};
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || e.isComposing) return;
    setTimeout(() => {
      if (e.defaultPrevented) return;
      try {
        // The studio page checks origin + source before relaying anything.
        win.parent.postMessage({ dgn: 'embed-escape' }, '*');
      } catch {
        /* parent gone */
      }
    }, 0);
  };
  win.addEventListener('keydown', onKey);
  return () => win.removeEventListener('keydown', onKey);
}

/** Test seam — reset the module cache (bun:test re-uses the module registry). */
export function _resetReadOnlyCache(): void {
  cached = null;
  embedCached = null;
}
