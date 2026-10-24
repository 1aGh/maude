// The tab strip's script (V2-3.7, contract V2-3.7-own-tab-bar.md §3.2; S1.22b: canvas 11
// pn-tab-b / pn-tab-b20 / pn-tab-menu). S1.22c: Home is the pinned, icon-only FIRST slot (CONTRACT
// §1/§6, amended 2026-10-14) — never in Rust's tab list, never in "N more", never dragged past.
//
// Rust owns the tab list (windows.rs WindowBook); this page only draws the
// TabStripState it is sent and asks Rust to act:
//   tabs_state({ onState })        → the state now; every change later on `onState`
//   tab_activate({ label })        → a click on a tab, on Home or on a row of the tab list
//   tab_close({ label })           → the tab's × or a middle click (never Home)
//   tab_reorder({ label, to })     → a tab dragged along the strip (S1.22b)
//   tab_menu({ label, x, y })      → right-click a tab: the NATIVE tab menu (S1.22b)
//   tab_rename({ label, name })    → its Rename…, edited in place (S1.22b)
//   tab_overview({ open })         → "N more" / Esc: the tab list over the window (S1.22b)
// Every command re-checks in Rust that the caller is this webview on this page.
// Names arrive sanitized and are set as text only, never as markup. A tab carries
// its name, its square, its account badge and one state mark — nothing else of a
// project reaches this page (V2-3.6 / V2-3.7 §8).
(() => {
  const tauri = window.__TAURI__;
  const tabsEl = document.getElementById('tabs');
  const homeEl = document.getElementById('home');
  const moreEl = document.getElementById('more');
  const overEl = document.getElementById('overview');
  const findEl = document.getElementById('find');
  const listEl = document.getElementById('list');
  const headEl = document.getElementById('overview-title');
  if (!tauri || !tauri.core) return;
  const invoke = tauri.core.invoke;

  /** A tab keeps its square, its name and its × at this width (pn-tab-b20). */
  const MIN_TAB = 120;
  /** The "N more" control's width. */
  const MORE_W = 88;
  /** Its horizontal margins (strip.html `.more`: 2px left, 6px right). */
  const MORE_MARGIN = 8;

  let state = null; // the last TabStripState
  let pending = null; // a state that arrived during a drag
  let overflowed = []; // labels the row has no room for
  let editing = null; // the label whose name is being edited (Rename…)
  let editInput = null;
  let moreScope = false; // the tab list was opened from "N more": only the rest
  let selected = 0; // the highlighted row of the tab list
  let drag = null;

  function report(e) {
    // A refused or stale command (the tab closed meanwhile) changes nothing;
    // the next state push redraws the truth.
    if (window.console) console.warn('[strip]', e);
  }

  function activate(label) {
    invoke('tab_activate', { label: label }).catch(report);
  }

  function closeTab(label) {
    invoke('tab_close', { label: label }).catch(report);
  }

  function openMenu(label, x, y) {
    invoke('tab_menu', { label: label, x: x, y: y }).catch(report);
  }

  function setOverview(open) {
    invoke('tab_overview', { open: open }).catch(report);
  }

  // ── Marks (fixed glyphs per enum value — Rust sends only the enum) ──────────

  function square(t, size) {
    const sq = document.createElement('span');
    sq.className = 'sq' + (size ? ' sq--' + size : '');
    sq.setAttribute('data-testid', 'tab-square');
    sq.setAttribute('data-tone', t.tone || 'grey');
    sq.setAttribute('aria-hidden', 'true');
    sq.textContent = t.initial || '·';
    return sq;
  }

  function accountBadge(t) {
    if (!t.account) return null;
    const a = document.createElement('span');
    a.className = 'acct';
    a.setAttribute('data-testid', 'tab-account');
    a.setAttribute('data-tone', t.account.tone || 'grey');
    a.setAttribute('role', 'img');
    a.setAttribute('aria-label', 'Account: ' + t.account.label);
    a.title = t.account.label;
    a.textContent = t.account.initial;
    return a;
  }

  // S5.14 (03 ai-other-tab / ai-needs-tab): a spark while AI works there, an azure "?"
  // while it needs you, the done dot after it finished. S1.22b: a resting tab with no AI
  // mark wears the ring (pn-tab-b20).
  function stateMark(t) {
    if (t.dot === 'done' || t.dot === 'needs-you' || t.dot === 'working') {
      const dot = document.createElement('span');
      dot.className = 'dot ' + t.dot;
      dot.setAttribute('data-testid', 'tab-dot');
      dot.setAttribute('data-dot', t.dot);
      dot.setAttribute(
        'aria-label',
        t.dot === 'needs-you' ? 'AI needs you' : t.dot === 'working' ? 'AI is working' : 'Done'
      );
      if (t.dot === 'needs-you') dot.textContent = '?';
      if (t.dot === 'working') dot.textContent = '✦';
      return dot;
    }
    if (t.resting) {
      const ring = document.createElement('span');
      ring.className = 'rest';
      ring.setAttribute('data-testid', 'tab-rest');
      ring.setAttribute('role', 'img');
      ring.setAttribute('aria-label', 'Resting');
      return ring;
    }
    return null;
  }

  function stateWords(t) {
    if (t.dot === 'working') return 'AI working';
    if (t.dot === 'needs-you') return 'Needs you';
    if (t.dot === 'done') return 'Done';
    if (t.resting) return 'Resting';
    return '';
  }

  // ── Rename… in place ────────────────────────────────────────────────────────

  function startRename(label) {
    const t = state && state.tabs.find((x) => x.label === label);
    if (!t) return;
    editing = label;
    editInput = document.createElement('input');
    editInput.className = 'rename';
    editInput.type = 'text';
    editInput.maxLength = 80;
    editInput.value = t.name;
    editInput.setAttribute('data-testid', 'tab-rename-input');
    editInput.setAttribute('aria-label', 'Name of this tab on this Mac');
    editInput.spellcheck = false;
    let done = false;
    const finish = (commit) => {
      if (done) return;
      done = true;
      const value = editInput.value;
      editing = null;
      editInput = null;
      // Blank goes back to the project's own name (Rust clears the display name).
      if (commit && value !== t.name)
        invoke('tab_rename', { label: label, name: value }).catch(report);
      render(state);
    };
    editInput.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Enter') finish(true);
      if (ev.key === 'Escape') finish(false);
    });
    editInput.addEventListener('blur', () => finish(true));
    for (const type of ['mousedown', 'pointerdown', 'click', 'dblclick']) {
      editInput.addEventListener(type, (ev) => ev.stopPropagation());
    }
    render(state);
    editInput.focus();
    editInput.select();
  }

  // ── Arrow keys along the tab list (WAI-ARIA tabs: ← → Home End move between the tabs, Enter picks) ─────

  /** Home, then the tabs the row draws, in order. */
  function rovers() {
    return [homeEl].concat(Array.from(tabsEl.querySelectorAll('.tab')));
  }

  /** ← → Home End on a tab or on Home: the keyboard moves to the neighbour (P8 B1 — only the active tab was a
   *  tab stop, so no other tab could be reached from the keyboard at all). True when it handled the key. */
  function roveFocus(ev, from) {
    if (editing || ev.altKey || ev.ctrlKey || ev.metaKey) return false;
    const els = rovers();
    const at = els.indexOf(from);
    let to = -1;
    if (ev.key === 'ArrowRight') to = Math.min(els.length - 1, at + 1);
    else if (ev.key === 'ArrowLeft') to = Math.max(0, at - 1);
    else if (ev.key === 'Home') to = 0;
    else if (ev.key === 'End') to = els.length - 1;
    if (to < 0 || at < 0) return false;
    ev.preventDefault();
    if (to !== at) els[to].focus();
    return true;
  }

  // ── One tab ─────────────────────────────────────────────────────────────────

  function tabEl(t, active) {
    const el = document.createElement('div');
    el.className = 'tab' + (t.resting ? ' resting' : '');
    el.setAttribute('role', 'tab');
    el.setAttribute('data-testid', 'tab-' + t.label);
    el.setAttribute('data-label', t.label);
    el.setAttribute('aria-selected', t.label === active ? 'true' : 'false');
    el.tabIndex = t.label === active ? 0 : -1;
    el.title = t.resting ? t.name + ' — resting, opens in a second' : t.name;

    el.appendChild(square(t));
    if (t.label === editing && editInput) {
      el.appendChild(editInput);
    } else {
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = t.name;
      el.appendChild(name);
    }
    const acct = accountBadge(t);
    if (acct) el.appendChild(acct);
    const mark = stateMark(t);
    if (mark) el.appendChild(mark);

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'close';
    close.setAttribute('data-testid', 'tab-close-' + t.label);
    close.setAttribute('aria-label', 'Close ' + t.name);
    close.title = 'Close tab';
    close.disabled = !!t.closing;
    close.innerHTML =
      '<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" focusable="false">' +
      '<path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';
    close.addEventListener('click', (ev) => {
      ev.stopPropagation();
      closeTab(t.label);
    });
    close.addEventListener('mousedown', (ev) => ev.stopPropagation());
    close.addEventListener('pointerdown', (ev) => ev.stopPropagation());
    el.appendChild(close);

    // Activate on press, like a native tab; a middle click closes. A `click` with no press
    // before it (assistive tech, `element.click()` — the e2e WebDriver's click) activates too.
    let pressed = false;
    el.addEventListener('mousedown', (ev) => {
      if (ev.button === 0) {
        pressed = true;
        activate(t.label);
      }
    });
    el.addEventListener('click', () => {
      if (!pressed) activate(t.label);
      pressed = false;
    });
    el.addEventListener('auxclick', (ev) => {
      if (ev.button === 1) {
        ev.preventDefault();
        closeTab(t.label);
      }
    });
    // S1.22b: right-click → the native tab menu (Maude owns it, pn-tab-menu B).
    el.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      openMenu(t.label, ev.clientX, ev.clientY);
    });
    el.addEventListener('keydown', (ev) => {
      if (roveFocus(ev, el)) return;
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        activate(t.label);
      } else if (ev.key === 'ContextMenu' || (ev.key === 'F10' && ev.shiftKey)) {
        ev.preventDefault();
        const r = el.getBoundingClientRect();
        openMenu(t.label, r.left + 8, r.bottom);
      }
    });
    el.addEventListener('pointerdown', (ev) => startDrag(ev, t.label, el));
    return el;
  }

  // ── Drag to reorder (in-strip only, V2-3.7 §10) ─────────────────────────────

  function startDrag(ev, label, el) {
    if (ev.button !== 0 || editing) return;
    // S1.22c: Home is the pinned first slot — a dragged tab stops at its right edge (minDx) and
    // drops as the first tab after it (`to: 0`); Rust's tab list never holds Home.
    const minDx = homeEl.getBoundingClientRect().right - el.getBoundingClientRect().left;
    drag = { label: label, el: el, x0: ev.clientX, minDx: minDx, moving: false, id: ev.pointerId };
  }

  function dropIndex(d, x) {
    const rest = state.tabs.map((t) => t.label).filter((l) => l !== d.label);
    const els = Array.from(tabsEl.querySelectorAll('.tab')).filter((e) => e !== d.el);
    for (const e of els) {
      const r = e.getBoundingClientRect();
      if (x < r.left + r.width / 2) return rest.indexOf(e.getAttribute('data-label'));
    }
    const last = els[els.length - 1];
    return last ? rest.indexOf(last.getAttribute('data-label')) + 1 : 0;
  }

  window.addEventListener('pointermove', (ev) => {
    if (!drag || ev.pointerId !== drag.id) return;
    const dx = Math.max(ev.clientX - drag.x0, Math.min(0, drag.minDx));
    if (!drag.moving && Math.abs(ev.clientX - drag.x0) < 5) return;
    if (!drag.moving) {
      drag.moving = true;
      drag.el.classList.add('dragging');
      try {
        drag.el.setPointerCapture(ev.pointerId);
      } catch {}
    }
    drag.el.style.transform = 'translateX(' + dx + 'px)';
  });

  function endDrag(ev, commit) {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (d.moving) {
      d.el.classList.remove('dragging');
      d.el.style.transform = '';
      const to = commit && state ? dropIndex(d, ev.clientX) : -1;
      const from = state ? state.tabs.findIndex((t) => t.label === d.label) : -1;
      if (to >= 0 && to !== from) invoke('tab_reorder', { label: d.label, to: to }).catch(report);
    }
    if (pending) {
      const s = pending;
      pending = null;
      render(s);
    }
  }
  window.addEventListener('pointerup', (ev) => endDrag(ev, true));
  window.addEventListener('pointercancel', (ev) => endDrag(ev, false));

  // ── The row: what fits, then "N more" ───────────────────────────────────────

  /** Pure: which tabs the row shows at `width` px. The active tab (and the one being
   *  renamed) is always in the row — it takes the last visible slot when it would not be. */
  function fit(tabs, width, keep) {
    if (tabs.length * MIN_TAB <= width) return { shown: tabs, rest: [] };
    const cap = Math.max(1, Math.floor((width - MORE_W) / MIN_TAB));
    let shown = tabs.slice(0, cap);
    const k = tabs.find((t) => t.label === keep);
    if (k && !shown.includes(k)) shown = shown.slice(0, cap - 1).concat([k]);
    return { shown: shown, rest: tabs.filter((t) => !shown.includes(t)) };
  }

  function render(s) {
    if (!s || !Array.isArray(s.tabs)) return;
    if (drag && drag.moving) {
      pending = s;
      return;
    }
    state = s;
    // The row's whole budget. `.tabs` is narrower by "N more" whenever that is showing, and fit() takes the
    // button's room off again — measured from the shrunken row it counted it twice: the first draw (more
    // hidden) fitted four tabs, the next (after a resize or any push) three, and "N more" grew by one.
    const moreRoom = moreEl.hidden ? 0 : moreEl.offsetWidth + MORE_MARGIN;
    const width = (tabsEl.clientWidth || window.innerWidth - 78 - 46) + moreRoom;
    const row = fit(s.tabs, width, editing || s.active);
    overflowed = row.rest.map((t) => t.label);
    const frag = document.createDocumentFragment();
    for (let i = 0; i < row.shown.length; i++) frag.appendChild(tabEl(row.shown[i], s.active));
    // The row is rebuilt on every push from Rust (an AI dot turning, a rename): the tab the keyboard is on
    // keeps it (P8 B1 — focus fell to <body> and the arrow keys with it).
    const focused = tabsEl.contains(document.activeElement)
      ? document.activeElement.getAttribute('data-label')
      : null;
    tabsEl.replaceChildren(frag);
    if (focused && !editing) {
      const again = Array.from(tabsEl.querySelectorAll('.tab')).find(
        (e) => e.getAttribute('data-label') === focused
      );
      if (again) again.focus();
    }
    if (editInput && document.activeElement !== editInput) editInput.focus();

    moreEl.hidden = row.rest.length === 0;
    moreEl.textContent = row.rest.length + ' more';
    moreEl.setAttribute('aria-expanded', s.overview && moreScope ? 'true' : 'false');
    const moreState = row.rest.find((t) => t.dot === 'needs-you') || row.rest.find((t) => t.dot);
    moreEl.setAttribute('data-dot', moreState ? moreState.dot : '');

    const homeActive = s.active === (s.home && s.home.label);
    homeEl.setAttribute('aria-selected', homeActive ? 'true' : 'false');
    homeEl.tabIndex = homeActive ? 0 : -1;
    document.body.setAttribute('data-active', s.active);
    renderOverview(s);
  }

  // ── The tab list (Show All Tabs ⇧⌘\, "N more") ───────────────────────────────

  function fold(text) {
    return String(text || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase();
  }

  function rowsOf(s) {
    const tabs = moreScope ? s.tabs.filter((t) => overflowed.includes(t.label)) : s.tabs;
    const q = fold(findEl.value.trim());
    let rows = tabs.filter((t) => !q || fold(t.name).includes(q));
    if (!moreScope && (!q || fold('Home').includes(q)))
      rows = [{ label: 'home', name: 'Home', home: true }].concat(rows);
    return rows;
  }

  function rowEl(t, active, isSelected) {
    const r = document.createElement('div');
    r.className = 'row' + (isSelected ? ' selected' : '');
    r.setAttribute('role', 'option');
    r.setAttribute('data-testid', 'tab-overview-row-' + t.label);
    r.setAttribute('aria-selected', isSelected ? 'true' : 'false');
    if (t.label === active) r.setAttribute('data-current', 'true');
    if (t.home) {
      const h = document.createElement('span');
      h.className = 'sq sq--md sq--home';
      h.setAttribute('aria-hidden', 'true');
      h.innerHTML = homeEl.innerHTML;
      r.appendChild(h);
    } else {
      r.appendChild(square(t, 'md'));
    }
    const words = document.createElement('span');
    words.className = 'words';
    const strong = document.createElement('strong');
    strong.textContent = t.name;
    words.appendChild(strong);
    const where = document.createElement('span');
    // 11 pn-tab-b20: "<account> · cloud" for a cloud project (the board's `where`), "On this Mac" for a local one
    where.textContent = t.home
      ? 'Every project on this Mac'
      : t.place === 'cloud'
        ? t.account?.label
          ? t.account.label + ' · cloud'
          : 'In the cloud'
        : 'On this Mac';
    words.appendChild(where);
    r.appendChild(words);
    if (!t.home) {
      const acct = accountBadge(t);
      if (acct) r.appendChild(acct);
      const w = stateWords(t);
      if (w) {
        const chip = document.createElement('span');
        chip.className = 'chip' + (t.dot ? ' chip--' + t.dot : ' chip--rest');
        const mark = stateMark(t);
        if (mark) chip.appendChild(mark);
        chip.appendChild(document.createTextNode(w));
        r.appendChild(chip);
      }
    }
    r.addEventListener('mousedown', (ev) => {
      if (ev.button === 0) activate(t.label);
    });
    return r;
  }

  let wasOpen = false;
  function renderOverview(s) {
    const open = !!s.overview;
    document.body.classList.toggle('overview-open', open);
    overEl.hidden = !open;
    if (!open) {
      if (wasOpen) {
        moreScope = false;
        findEl.value = '';
        selected = 0;
      }
      wasOpen = false;
      return;
    }
    if (!wasOpen) {
      selected = 0;
      findEl.focus();
    }
    wasOpen = true;
    headEl.textContent = moreScope ? overflowed.length + ' more' : 'All tabs';
    const rows = rowsOf(s);
    if (selected >= rows.length) selected = Math.max(0, rows.length - 1);
    const frag = document.createDocumentFragment();
    rows.forEach((t, i) => frag.appendChild(rowEl(t, s.active, i === selected)));
    if (!rows.length) {
      const none = document.createElement('div');
      none.className = 'none';
      none.textContent = 'No tab is called that.';
      frag.appendChild(none);
    }
    listEl.replaceChildren(frag);
  }

  findEl.addEventListener('input', () => {
    selected = 0;
    if (state) renderOverview(state);
  });
  findEl.addEventListener('keydown', (ev) => {
    if (!state) return;
    const rows = rowsOf(state);
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      const n = rows.length || 1;
      selected = (selected + (ev.key === 'ArrowDown' ? 1 : n - 1)) % n;
      renderOverview(state);
      listEl.querySelector('.selected')?.scrollIntoView({ block: 'nearest' });
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      if (rows[selected]) activate(rows[selected].label);
    }
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && state && state.overview) {
      ev.preventDefault();
      setOverview(false);
    }
  });
  // A press on the dimmed area (outside the panel) closes the list.
  overEl.addEventListener('mousedown', (ev) => {
    if (ev.target === overEl) setOverview(false);
  });

  moreEl.addEventListener('click', () => {
    if (state && state.overview) {
      setOverview(false);
      return;
    }
    moreScope = true;
    setOverview(true);
  });

  // ── Home ────────────────────────────────────────────────────────────────────

  let homePressed = false;
  homeEl.addEventListener('mousedown', (ev) => {
    if (ev.button === 0) {
      homePressed = true;
      activate('home');
    }
  });
  homeEl.addEventListener('click', () => {
    if (!homePressed) activate('home');
    homePressed = false;
  });
  homeEl.addEventListener('keydown', (ev) => {
    if (roveFocus(ev, homeEl)) return;
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      activate('home');
    }
  });

  window.addEventListener('resize', () => {
    if (state) render(state);
  });

  function receive(s) {
    render(s);
    // Rename… chosen in the native tab menu: edit that tab's name here.
    if (s && s.renaming && !editing) startRename(s.renaming);
  }

  const ch = new tauri.core.Channel();
  ch.onmessage = receive;
  invoke('tabs_state', { onState: ch }).then(receive, report);
})();
