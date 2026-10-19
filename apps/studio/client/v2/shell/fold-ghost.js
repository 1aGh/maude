// client/v2/shell/fold-ghost.js — S3.14 (G4): a floating panel FOLDS toward its corner icon instead of cutting.
//
// 04 md-motion: "Edit → Preview … the Canvases panel and the AI chat panel fold into their icons, in the corners
// they came from — 220 ms on --dur-panel, shaped by --ease-out; Reduce motion: a 1 ms cut". A panel that is
// not showing is UNMOUNTED (dock.jsx — the DockSlot / its island go away, the corner icon takes over), so there
// is nothing left to animate. The one thing that survives the unmount is a picture of it: just before the node
// leaves the DOM, `spawnFoldGhost` clones it into the window body, takes the clone out of every hook
// (testids, ids, focus, clicks) and lets CSS (`st-fold-ghost`, floating-panels.css) shrink it toward its corner.
// The ghost is decoration: it never owns a test hook, a focus stop or an inset (the insets are measured on the
// real islands, which are already gone — the camera eases onto the post-fold area from the first frame).
//
// Reduced motion collapses `--dur-panel` to 1 ms: no ghost at all, the cut stays a cut.

/** The fold duration when the token is unreadable (`--dur-panel`, client/styles/1-tokens-maude.css). */
export const FOLD_MS = 220;

/** `--dur-panel` in ms from the computed style of `el`; 1 under reduced motion; `FOLD_MS` when unreadable. */
export function panelMs(el) {
  try {
    const win = el?.ownerDocument?.defaultView;
    if (win?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return 1;
    const raw = win?.getComputedStyle?.(el)?.getPropertyValue('--dur-panel')?.trim() ?? '';
    const m = /^([\d.]+)(ms|s)$/.exec(raw);
    if (m) return Math.round(Number(m[1]) * (m[2] === 's' ? 1000 : 1));
  } catch {
    /* no layout engine */
  }
  return FOLD_MS;
}

/**
 * Fold a picture of `node` toward `origin` ('top-left' | 'top-right' | 'bottom-left' | 'bottom-right'), inside
 * `host` (the window body; it is `position: relative`). Returns the ghost, or null when there is nothing to
 * show (reduced motion, a node with no box, no host). `knownBox` is the node's last rect in viewport
 * coordinates, for a node that is no longer laid out when it folds.
 */
export function spawnFoldGhost(node, host, origin = 'top-left', knownBox = null) {
  if (!node || !host || !node.ownerDocument) return null;
  const ms = panelMs(host);
  if (ms <= 1) return null;
  const box = knownBox ?? node.getBoundingClientRect(); // `knownBox`: a node already out of layout (hidden)
  const at = host.getBoundingClientRect();
  if (!(box.width > 0 && box.height > 0)) return null; // never laid out: nothing to fold
  const ghost = node.cloneNode(true);
  // A picture, not a panel: no hook, no id, no focus stop, no event target.
  for (const el of [ghost, ...ghost.querySelectorAll('*')]) {
    for (const a of ['data-testid', 'data-tour', 'data-occludes', 'id', 'name'])
      el.removeAttribute?.(a);
    el.removeAttribute?.('hidden');
    el.setAttribute?.('tabindex', '-1');
  }
  ghost.classList.add('st-fold-ghost');
  ghost.setAttribute('aria-hidden', 'true');
  ghost.setAttribute('inert', '');
  ghost.setAttribute('data-fold', origin);
  Object.assign(ghost.style, {
    position: 'absolute',
    left: `${box.left - at.left}px`,
    top: `${box.top - at.top}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
    margin: '0',
    pointerEvents: 'none',
  });
  host.appendChild(ghost);
  const done = () => ghost.remove();
  ghost.addEventListener('animationend', done, { once: true });
  setTimeout(done, ms + 80); // the animation event may never come (a background tab)
  return ghost;
}
