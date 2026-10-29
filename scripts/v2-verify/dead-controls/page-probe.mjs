// In-page half of the dead-control crawler. Installed with addInitScript, so it runs in EVERY frame
// (the shell and the cross-origin canvas iframe alike — Playwright reaches across the origin split
// even though page JS cannot). Defines `window.__crawl`:
//   enumerate()      the visible, clickable controls of this document → [{key, occ, family, ...}]
//   mark(key, occ)   tag that control with data-crawl-target (the Node side clicks it for real)
//   start() / stop() a MutationObserver + state snapshot window around one click
//   idle(ms)         the mutation count of an untouched window (the noise floor)
// plus traps: window.open (recorded, never opened) and unhandledrejection (→ console.error, so the
// Node side collects it with the console errors).

export const PAGE_PROBE = String.raw`(() => {
  if (window.__crawl) return;
  const opens = [];
  const realOpen = window.open;
  try {
    window.open = function (url) { opens.push(String(url)); return null; };
  } catch { /* frozen */ }
  void realOpen;
  // a clipboard write is an effect the DOM never shows: record it (and let it through)
  const clips = [];
  try {
    const cb = navigator.clipboard;
    if (cb) {
      for (const m of ['writeText', 'write']) {
        const real = cb[m]?.bind(cb);
        if (!real) continue;
        Object.defineProperty(cb, m, { configurable: true, value: (...a) => { clips.push(m); return real(...a).catch(() => {}); } });
      }
    }
  } catch { /* no clipboard */ }
  document.addEventListener('copy', () => clips.push('copy-event'), true);
  document.addEventListener('cut', () => clips.push('cut-event'), true);
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    console.error('[crawl] unhandledrejection: ' + (r && (r.stack || r.message) || String(r)));
  });

  const SEL = [
    'button', 'a[href]', 'summary', 'select',
    'input[type=checkbox]', 'input[type=radio]', 'input[type=range]', 'input[type=color]', 'input[type=file]',
    '[role=button]', '[role=tab]', '[role=menuitem]', '[role=menuitemcheckbox]', '[role=menuitemradio]',
    '[role=option]', '[role=switch]', '[role=checkbox]', '[role=radio]', '[role=link]', '[role=treeitem]',
  ].join(',');

  const visible = (el) => {
    if (!el.getClientRects().length) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return false;
    if (el.closest('[aria-hidden="true"],[inert]')) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    if (r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) return false;
    return true;
  };
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  const nameOf = (el) =>
    clean(el.getAttribute('aria-label')) || clean(el.getAttribute('title')) ||
    clean(el.innerText || el.textContent) || clean(el.getAttribute('placeholder')) || clean(el.value);
  // a control's "family": the same control repeated per row (canvas-row-ui-a, canvas-row-ui-b …)
  const familyOf = (tid, role, el) => {
    if (tid) return tid.replace(/-(ui|system|ds|assets?)[-/].*$/, '-*').replace(/[-_][0-9a-f]{6,}$/i, '-*').replace(/-\d+$/, '-*');
    if (role === 'option' || role === 'treeitem') return role + '@' + (el.closest('[role=listbox],[role=tree],[role=dialog],[role=menu]')?.getAttribute('aria-label') || '');
    return null;
  };
  const isCanvasContent = (el) => !!el.closest('[data-dc-screen]') && !/^Artboard /.test(el.getAttribute('aria-label') || '');
  const regionOf = (el) => {
    if (!el || el === document.body) return 'body';
    const r = el.closest('[role=dialog],[role=menu],[role=listbox],[role=tooltip],aside,nav,header,main,section,[data-testid]');
    return r ? (r.getAttribute('data-testid') || r.getAttribute('aria-label') || r.getAttribute('role') || r.tagName) : 'body';
  };

  function enumerate() {
    const seen = new Map();
    const out = [];
    for (const el of document.querySelectorAll(SEL)) {
      if (el.matches('input[type=hidden]')) continue;
      if (!visible(el)) continue;
      if (isCanvasContent(el)) continue;
      // a button nested in another control is reached through its parent's own entry
      const tid = el.getAttribute('data-testid') || '';
      const role = el.getAttribute('role') || '';
      const name = nameOf(el);
      const key = tid ? 'tid:' + tid : (role || el.tagName.toLowerCase()) + ':' + name;
      const occ = seen.get(key) || 0;
      seen.set(key, occ + 1);
      const disabled = el.disabled === true || el.getAttribute('aria-disabled') === 'true';
      out.push({
        key, occ, tid, role, tag: el.tagName.toLowerCase(), name, disabled,
        current: el.getAttribute('aria-selected') === 'true' || el.getAttribute('aria-pressed') === 'true' || el.getAttribute('aria-checked') === 'true' || el.getAttribute('aria-current') === 'page' || el.getAttribute('aria-current') === 'true',
        family: familyOf(tid, role, el),
        href: el.tagName === 'A' ? el.getAttribute('href') : null,
        target: el.getAttribute('target') || null,
        haspopup: el.getAttribute('aria-haspopup') || null,
        inDialog: !!el.closest('[role=dialog],[role=alertdialog]'),
        inAlert: !!el.closest('[role=alertdialog]'),
        region: regionOf(el.parentElement),
      });
    }
    return out;
  }

  function find(key, occ) {
    let n = 0;
    for (const el of document.querySelectorAll(SEL)) {
      if (!visible(el) || isCanvasContent(el)) continue;
      const tid = el.getAttribute('data-testid') || '';
      const role = el.getAttribute('role') || '';
      const k = tid ? 'tid:' + tid : (role || el.tagName.toLowerCase()) + ':' + nameOf(el);
      if (k !== key) continue;
      if (n++ === occ) return el;
    }
    return null;
  }

  let target = null;
  function mark(key, occ) {
    for (const o of document.querySelectorAll('[data-crawl-target]')) o.removeAttribute('data-crawl-target');
    target = find(key, occ);
    if (!target) return false;
    target.setAttribute('data-crawl-target', '1');
    return true;
  }

  const ARIA = ['aria-expanded', 'aria-pressed', 'aria-selected', 'aria-checked', 'aria-current'];
  const popups = () => document.querySelectorAll('[role=dialog],[role=alertdialog],[role=menu],[role=listbox],[role=status],[role=alert]').length;
  const inTooltip = (n) => { const e = n && (n.nodeType === 1 ? n : n.parentElement); return !!(e && e.closest && e.closest('[role=tooltip],[data-tooltip],.tooltip')); };
  let st = null;
  let mo = null;
  function start() {
    st = { clips: clips.length, muts: 0, self: 0, aria: [], url: location.href, popups: popups(), region: regionOf(document.activeElement), opens: opens.length, checked: target && 'checked' in target ? target.checked : null, value: target && 'value' in target ? target.value : null };
    mo = new MutationObserver((list) => {
      for (const m of list) {
        if (m.type === 'attributes' && m.attributeName === 'data-crawl-target') continue;
        if (m.type === 'attributes' && ARIA.includes(m.attributeName)) {
          st.aria.push(m.attributeName + '@' + (m.target.getAttribute?.('data-testid') || m.target.tagName));
          continue;
        }
        if (inTooltip(m.target) || [...(m.addedNodes || [])].some(inTooltip) || [...(m.removedNodes || [])].some((x) => x.nodeType === 1 && x.matches?.('[role=tooltip],[data-tooltip],.tooltip'))) continue;
        const onSelf = target && (m.target === target || target.contains(m.target));
        if (onSelf && m.type === 'attributes' && /^(class|style|data-focus|data-hover|data-state)/.test(m.attributeName || '')) { st.self++; continue; }
        st.muts++;
      }
    });
    mo.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    return true;
  }
  function stop() {
    if (!st) return null;
    mo.disconnect();
    const out = {
      muts: st.muts,
      self: st.self,
      aria: st.aria.slice(0, 6),
      urlChanged: location.href !== st.url,
      url: location.href,
      popupsDelta: popups() - st.popups,
      focusMoved: regionOf(document.activeElement) !== st.region && !(target && (document.activeElement === target || target.contains(document.activeElement))),
      focusRegion: regionOf(document.activeElement),
      opens: opens.slice(st.opens),
      clips: clips.slice(st.clips),
      checkedChanged: target && 'checked' in target && st.checked !== null ? target.checked !== st.checked : false,
      valueChanged: target && 'value' in target && st.value !== null ? target.value !== st.value : false,
    };
    st = null;
    return out;
  }
  async function idle(ms) {
    let n = 0;
    const o = new MutationObserver((l) => { n += l.length; });
    o.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    await new Promise((r) => setTimeout(r, ms));
    o.disconnect();
    return n;
  }
  window.__crawl = { enumerate, mark, start, stop, idle };
})();`;
