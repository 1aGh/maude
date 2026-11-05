// _ds-prove-judge.mjs — the pure half of the Bring-up visual gate (`_ds-prove-playwright.mjs`):
// which element is measured, how it is isolated and clipped, and how a measured pair is judged
// against the noise control. No imports: the page functions are handed to `page.evaluate` as they
// are (so they close over nothing), and the tests run them in happy-dom.

/** The pseudo-artboard id of a canvas that has no `[data-dc-screen]` (a specimen): its whole mount. */
export const SPECIMEN_ID = '(canvas)';

/**
 * In the page: the element to measure for `id` — an artboard, or (for SPECIMEN_ID) the canvas's own
 * mount. Hides every element that is not it, one of its ancestors or one of its descendants
 * (`visibility: hidden`, no layout change), so nothing else can cover it; sets the theme on the
 * artboard's own `[data-theme]` nodes, or on `<html>` when it carries none (`htmlTheme`); resets the
 * world's pan/zoom. Returns the element's rect, or null when it is not there. Idempotent: the first
 * call saves what it changes, `restoreArtboard` puts it back.
 */
export function isolateArtboard({ id, theme, htmlTheme, specimenId }) {
  const doc = document;
  const find = () => {
    if (id === specimenId) {
      const root = doc.getElementById('canvas-root');
      if (!root) return null;
      return root.childElementCount === 1 ? root.firstElementChild : root;
    }
    return (
      [...doc.querySelectorAll('[data-dc-screen]')].find(
        (el) => el.getAttribute('data-dc-screen') === id
      ) ?? null
    );
  };
  const el = find();
  if (!el) return null;
  window.__dsProveSaved ??= new Map();
  if (!window.__dsProveSaved.has(id)) {
    const themed = [el, ...el.querySelectorAll('[data-theme]')].filter((n) =>
      n.hasAttribute('data-theme')
    );
    const hidden = [];
    for (let n = el; n?.parentElement; n = n.parentElement)
      for (const sib of n.parentElement.children) {
        if (sib === n || /^(?:SCRIPT|STYLE|LINK|META|HEAD|TITLE)$/.test(sib.tagName)) continue;
        hidden.push([sib, sib.style.visibility]);
      }
    window.__dsProveSaved.set(id, {
      left: el.style.left,
      top: el.style.top,
      html: doc.documentElement.getAttribute('data-theme'),
      themed: themed.map((n) => [n, n.getAttribute('data-theme')]),
      hidden,
    });
  }
  const saved = window.__dsProveSaved.get(id);
  for (const [n] of saved.hidden) n.style.visibility = 'hidden';
  if (saved.themed.length)
    for (const [n, t] of saved.themed) n.setAttribute('data-theme', theme ?? t);
  else if (htmlTheme) doc.documentElement.setAttribute('data-theme', htmlTheme);
  const world = doc.querySelector('.dc-world');
  if (world) {
    world.style.zoom = '1';
    world.style.transform = 'none';
  }
  // an artboard far out in the world is brought to the page's origin (a specimen flows there already)
  if (id !== specimenId) {
    el.style.left = '0px';
    el.style.top = '0px';
    const r = el.getBoundingClientRect();
    if (r.left || r.top) {
      el.style.left = `${-r.left}px`;
      el.style.top = `${-r.top}px`;
    }
  }
  window.scrollTo(0, 0);
  const f = el.getBoundingClientRect();
  return { x: f.left, y: f.top, width: f.width, height: f.height };
}

/** In the page: undo `isolateArtboard(id)`. */
export function restoreArtboard({ id }) {
  const saved = window.__dsProveSaved?.get(id);
  if (!saved) return;
  const el =
    [...document.querySelectorAll('[data-dc-screen]')].find(
      (n) => n.getAttribute('data-dc-screen') === id
    ) ?? null;
  if (el) {
    el.style.left = saved.left;
    el.style.top = saved.top;
  }
  for (const [n, t] of saved.themed) n.setAttribute('data-theme', t);
  if (saved.html === null) document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', saved.html);
  for (const [n, v] of saved.hidden) n.style.visibility = v;
  window.__dsProveSaved.delete(id);
}

/**
 * The screenshot clip: the element's OWN rect (never a corner of the viewport), whole pixels,
 * inside the page, at most `maxSide` a side. Null when there is nothing to shoot.
 */
export function clipOf(rect, maxSide = 4000) {
  if (!rect) return null;
  const x = Math.max(0, Math.floor(rect.x));
  const y = Math.max(0, Math.floor(rect.y));
  const width = Math.min(maxSide, Math.ceil(rect.x + rect.width) - x);
  const height = Math.min(maxSide, Math.ceil(rect.y + rect.height) - y);
  if (!(width > 0 && height > 0)) return null;
  return { x, y, width, height };
}

/** The viewport an element needs to be shot whole: at least `base`, at most `maxSide`. */
export function viewportFor(rect, base, maxSide = 4000) {
  return {
    width: Math.min(maxSide, Math.max(base.width, Math.ceil(rect.x + rect.width))),
    height: Math.min(maxSide, Math.max(base.height, Math.ceil(rect.y + rect.height))),
  };
}

/** One measured pair: same size, changed pixels over its area. */
export const pairFails = (d, ratio) => !d.sized || d.changed / Math.max(1, d.area) > ratio;

/**
 * The verdict for one artboard in one theme. `ab` is before × after. When it fails, the gate renders
 * `before` a second time the way it rendered `after` (`ac` = before × control, `bc` = after × control,
 * same procedure, same page kind): a pair that differs with ITSELF cannot be a failure.
 *   - no control (it passed, or the control could not render): `ab` decides
 *   - the control is clean (before × before is identical): `ab` decides — the change is real
 *   - the control is noisy: after × control decides (both rendered the same way); and a residue no
 *     larger than the noise itself is noise too
 * Returns { fail, noise } — `noise: true` marks a failure the control explained away.
 */
export function judge({ ab, ac, bc }, ratio) {
  if (!pairFails(ab, ratio)) return { fail: false, noise: false };
  if (!ac || !bc) return { fail: true, noise: false };
  if (!pairFails(ac, ratio)) return { fail: true, noise: false };
  if (!pairFails(bc, ratio)) return { fail: false, noise: true };
  const area = Math.max(1, bc.area);
  const within = bc.sized && bc.changed <= ac.changed + ratio * area;
  return within ? { fail: false, noise: true } : { fail: true, noise: false };
}

/** The themes one artboard is measured in: its own, else the system's (set on `<html>`), else none. */
export function themesFor(own, systemThemes) {
  if (own.length) return own.map((t) => ({ theme: t, htmlTheme: null }));
  if (systemThemes?.length) return systemThemes.map((t) => ({ theme: t, htmlTheme: t }));
  return [{ theme: null, htmlTheme: null }];
}

/**
 * Run `fn` with a hard deadline. On time: { ok: true, value }; past it: { ok: false } — `fn` is left
 * running (the caller throws its page away). `fn` failing rejects as usual.
 */
export async function withDeadline(fn, ms) {
  let timer;
  const late = new Promise((r) => {
    timer = setTimeout(() => r({ ok: false }), ms);
  });
  try {
    return await Promise.race([
      Promise.resolve()
        .then(fn)
        .then((value) => ({ ok: true, value })),
      late,
    ]);
  } finally {
    clearTimeout(timer);
  }
}
