// IntersectionObserver-driven lazy iframe mount.
//
// mountLazy(host, src) wraps the iframe in a `content-visibility: auto`
// container and only sets its `src` when the wrapper intersects the viewport.
// When the wrapper has been off-screen for > 30 s, the src is cleared and the
// iframe's last known state is stashed against the wrapper id so re-mount can
// hint the inspector to restore selection/scroll.
//
// Saves ~80 % initial render work on a 10-canvas page (plan Task 10 + web.dev
// iframe-lazy-loading + debugbear content-visibility).

const DEFAULT_IDLE_MS = 30_000;
const DEFAULT_ROOT_MARGIN = '200px 0px';

const stateById = new Map();
const observers = new WeakMap();

function makeWrapper() {
  const wrap = document.createElement('div');
  wrap.className = 'iframe-lazy-wrap';
  wrap.style.cssText =
    'contain: layout style paint; content-visibility: auto; contain-intrinsic-size: 1280px 720px;';
  return wrap;
}

function attachIframe(wrap, src) {
  let f = wrap.querySelector('iframe');
  if (!f) {
    f = document.createElement('iframe');
    f.setAttribute('loading', 'lazy');
    f.setAttribute('referrerpolicy', 'no-referrer-when-downgrade');
    f.style.cssText = 'width: 100%; height: 100%; border: 0; display: block;';
    wrap.appendChild(f);
  }
  if (f.dataset.src !== src) {
    f.dataset.src = src;
    f.src = src;
  }
}

function detachIframe(wrap, id) {
  const f = wrap.querySelector('iframe');
  if (!f) return;
  // Snapshot whatever cheap state we can reach before clearing.
  try {
    stateById.set(id, {
      ts: Date.now(),
      src: f.dataset.src,
      scroll: { x: f.contentWindow?.scrollX, y: f.contentWindow?.scrollY },
    });
  } catch {
    stateById.set(id, { ts: Date.now(), src: f.dataset.src });
  }
  f.removeAttribute('src');
  f.src = 'about:blank';
}

/**
 * Mount a lazy iframe into `host` with the given `src` + stable `id`.
 *   - Initial intersection sets the src.
 *   - When the wrapper leaves viewport for > idleMs, the iframe is detached.
 *   - State stashed in `stateById` is restored via `data-restore-*` on remount.
 */
export function mountLazy(host, src, id, opts = {}) {
  const idleMs = opts.idleMs ?? DEFAULT_IDLE_MS;
  const rootMargin = opts.rootMargin ?? DEFAULT_ROOT_MARGIN;

  let wrap = host.querySelector('.iframe-lazy-wrap');
  if (!wrap) {
    wrap = makeWrapper();
    wrap.dataset.lazyId = id;
    wrap.dataset.canvasPath = src;
    host.appendChild(wrap);
  }
  // Re-apply restore hints if we have any.
  const prior = stateById.get(id);
  if (prior) {
    wrap.dataset.restoreScrollX = String(prior.scroll?.x ?? 0);
    wrap.dataset.restoreScrollY = String(prior.scroll?.y ?? 0);
  }

  const exitedAt = new WeakMap();

  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const w = entry.target;
        if (entry.isIntersecting) {
          exitedAt.delete(w);
          attachIframe(w, src);
        } else {
          exitedAt.set(w, Date.now());
          // Schedule a deferred detach; if it comes back into view before idleMs we cancel.
          setTimeout(() => {
            const exited = exitedAt.get(w);
            if (!exited) return;
            if (Date.now() - exited >= idleMs) detachIframe(w, id);
          }, idleMs + 100);
        }
      }
    },
    { rootMargin, threshold: 0.01 }
  );
  io.observe(wrap);
  observers.set(wrap, io);
  return wrap;
}

export function unmountLazy(host) {
  const wraps = host.querySelectorAll('.iframe-lazy-wrap');
  for (const wrap of wraps) {
    const io = observers.get(wrap);
    io?.disconnect();
    observers.delete(wrap);
    wrap.remove();
  }
}

export function _resetState() {
  stateById.clear();
}
