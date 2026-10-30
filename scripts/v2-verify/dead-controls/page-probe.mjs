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
  // the page's sockets, so a fixture state can hand the shell a server message (a hub link's sync status) the
  // rig has no hub to send
  const sockets = (window.__crawlSockets = []);
  try {
    window.WebSocket = new Proxy(window.WebSocket, {
      construct(Target, args) {
        const ws = new Target(...args);
        sockets.push(ws);
        return ws;
      },
    });
  } catch { /* frozen */ }
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
  // a relative time ('17 min ago', 'just now') is in a row's name: it must not make the control a different one a
  // minute later, or a replay can never find the row it clicked
  const clean = (s) =>
    (s || '')
      .replace(/\s+/g, ' ')
      .replace(/\b\d+\s*(?:s|sec|secs|seconds?|m|min|mins|minutes?|h|hr|hrs|hours?|d|days?)\s+ago\b/gi, 'N ago')
      .replace(/\bjust now\b/gi, 'N ago')
      .trim()
      .slice(0, 60);
  const nameOf = (el) =>
    clean(el.getAttribute('aria-label')) || clean(el.getAttribute('title')) ||
    clean(el.innerText || el.textContent) || clean(el.getAttribute('placeholder')) || clean(el.value);
  // a control's "family": the same control repeated per row (canvas-row-ui-a, canvas-row-ui-b …)
  const familyOf = (tid, role, el) => {
    if (tid) return tid.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '*').replace(/-(ui|system|ds|assets?)[-/].*$/, '-*').replace(/[-_][0-9a-f]{6,}$/i, '-*').replace(/-\d+$/, '-*');
    if (role === 'option' || role === 'treeitem') return role + '@' + (el.closest('[role=listbox],[role=tree],[role=dialog],[role=menu]')?.getAttribute('aria-label') || '');
    return null;
  };
  const isCanvasContent = (el) => !!el.closest('[data-dc-screen]') && !/^Artboard /.test(el.getAttribute('aria-label') || '');
  const REGION_SEL = '[role=dialog],[role=menu],[role=listbox],[role=tooltip],aside,nav,header,main,section,[data-testid]';
  const regionEl = (el) => (!el || el === document.body ? document.body : el.closest(REGION_SEL) || document.body);
  const regionOf = (el) => {
    const r = regionEl(el);
    return r === document.body ? 'body' : (r.getAttribute('data-testid') || r.getAttribute('aria-label') || r.getAttribute('role') || r.tagName);
  };
  // A live region: an element a screen reader reads out when it changes.
  const LIVE_SEL = '[role=status],[role=alert],[aria-live]:not([aria-live=off])';
  const asEl = (n) => (n && n.nodeType === 1 ? n : n && n.parentElement) || null;
  // The live region a mutation touched, if any: the region itself added, one added inside the node, or text
  // changed inside one.
  const liveOfMutation = (m) => {
    const hits = [];
    for (const n of m.addedNodes || []) {
      if (n.nodeType !== 1) continue;
      if (n.matches?.(LIVE_SEL)) hits.push(n);
      else hits.push(...(n.querySelectorAll?.(LIVE_SEL) || []));
    }
    const host = asEl(m.target);
    const up = host && host.closest ? host.closest(LIVE_SEL) : null;
    if (up) hits.push(up);
    return hits;
  };
  // "Own area" of the clicked control: the region (dialog, menu, panel, test-id'd block …) it sits in — or, for a
  // control with none, its own container. An announcement counts for a control only inside that area: a "Saved"
  // status ticking in the corner while a dead button is clicked is not that button's doing.
  const areaOf = (el) => {
    const r = regionEl(el.parentElement);
    if (r !== document.body) return r;
    return el.parentElement && el.parentElement !== document.body ? el.parentElement : el;
  };
  // A control inside a popup (a menu row, a listbox option) acts on the surface its popup came from: the
  // trigger's area is the row's too (Attach › Paste a screenshot answers in the composer's notice line, not in the menu).
  const ownAreasOf = (el) => {
    if (!el) return [];
    const areas = [areaOf(el)];
    const popup = el.closest('[role=menu],[role=listbox],[role=dialog]');
    const trigger = popup && popup.id ? document.querySelector('[aria-controls~="' + CSS.escape(popup.id) + '"]') : null;
    if (trigger) areas.push(areaOf(trigger));
    return areas;
  };

  // Why a disabled control is disabled, in the words the person is shown: its title / description attribute,
  // the text it points at (aria-describedby), a hint or status word inside the row, the row's own caption.
  const reasonOf = (el) => {
    const out = [];
    const add = (t, src) => { t = clean(t); if (t && !out.some((o) => o.text === t)) out.push({ text: t, src }); };
    add(el.getAttribute('title'), 'title');
    add(el.getAttribute('aria-description'), 'aria-description');
    add(el.getAttribute('data-reason'), 'data-reason');
    for (const id of (el.getAttribute('aria-describedby') || '').split(/\s+/)) if (id) add(document.getElementById(id)?.textContent, 'describedby');
    const own = clean(el.innerText || el.textContent);
    const status = el.querySelector('[data-testid^="project-menu-status-"],[class*="status"],[class*="hint"],small');
    if (status) add(status.textContent, 'status');
    if (!out.length || (out.length === 1 && out[0].text === own)) {
      const row = el.closest('li,[role=row],[role=group],[role=radiogroup],fieldset,label') || el.parentElement;
      if (row && row !== document.body) {
        const t = clean((row.innerText || '').replace(own, ''));
        if (t) add(t, 'row');
      }
      const tip = row?.querySelector?.('[role=tooltip],[class*="hint"],[class*="note"],[class*="why"],small');
      if (tip) add(tip.textContent, 'hint');
    }
    return out.filter((o) => o.text !== own || o.src === 'title').map((o) => o.text + ' [' + o.src + ']').join(' | ');
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
        reason: disabled ? reasonOf(el) : '',
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

  const ARIA = ['aria-expanded', 'aria-pressed', 'aria-selected', 'aria-checked', 'aria-current', 'open'];
  // a field's value is a property, invisible to a MutationObserver: snapshot every field instead
  const fieldValues = () => [...document.querySelectorAll('input,textarea,select')].map((e) => (e.type === 'checkbox' || e.type === 'radio' ? String(e.checked) : String(e.value ?? ''))).join('\u0001');
  const popups = () => document.querySelectorAll('[role=dialog],[role=alertdialog],[role=menu],[role=listbox],[role=status],[role=alert]').length;
  const inTooltip = (n) => { const e = n && (n.nodeType === 1 ? n : n.parentElement); return !!(e && e.closest && e.closest('[role=tooltip],[data-tooltip],.tooltip')); };
  // a menu pick that relabels the menu's own trigger ("All kinds" → "Photos") is a visible effect a few
  // characters long — under the noise floor; snapshot every popup trigger's text instead
  const triggerText = () => [...document.querySelectorAll('[aria-haspopup]')].map((e) => (e.getAttribute('data-testid') || e.getAttribute('aria-label') || '') + '=' + (e.textContent || '').trim()).join('\u0001');
  let st = null;
  let mo = null;
  function start() {
    st = { areas: ownAreasOf(target), announced: 0, triggers: triggerText(), fields: fieldValues(), clips: clips.length, muts: 0, self: 0, aria: [], url: location.href, popups: popups(), region: regionOf(document.activeElement), opens: opens.length, checked: target && 'checked' in target ? target.checked : null, value: target && 'value' in target ? target.value : null };
    mo = new MutationObserver((list) => {
      for (const m of list) {
        if (m.type === 'attributes' && m.attributeName === 'data-crawl-target') continue;
        if (m.type === 'attributes' && ARIA.includes(m.attributeName)) {
          st.aria.push(m.attributeName + '@' + (m.target.getAttribute?.('data-testid') || m.target.tagName));
          continue;
        }
        if (inTooltip(m.target) || [...(m.addedNodes || [])].some(inTooltip) || [...(m.removedNodes || [])].some((x) => x.nodeType === 1 && x.matches?.('[role=tooltip],[data-tooltip],.tooltip'))) continue;
        // a live region (re)inserted or changed INSIDE the clicked control's own area is an announcement, even when
        // it says the same line as before; one anywhere else is somebody else's
        for (const live of liveOfMutation(m)) {
          if ((target && target.contains(live)) || st.areas.some((a) => a.contains(live) || live.contains(a))) { st.announced++; break; }
        }
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
      triggerChanged: triggerText() !== st.triggers,
      announced: st.announced,
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
      fieldsChanged: fieldValues() !== st.fields,
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
