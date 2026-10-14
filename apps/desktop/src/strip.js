// The tab strip's script (V2-3.7, contract V2-3.7-own-tab-bar.md §3.2).
//
// Rust owns the tab list (windows.rs WindowBook); this page only draws the
// TabStripState it is sent and asks Rust to act:
//   tabs_state({ onState })  → the state now; every change later on `onState`
//   tab_activate({ label })  → a click on a tab or on Home
//   tab_close({ label })     → the tab's × or a middle click (never Home)
// Every command re-checks in Rust that the caller is this webview on this page.
// Names arrive sanitized and are set as text only, never as markup.
(function () {
  'use strict';

  var tauri = window.__TAURI__;
  var tabsEl = document.getElementById('tabs');
  var homeEl = document.getElementById('home');
  if (!tauri || !tauri.core) return;
  var invoke = tauri.core.invoke;

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

  function tabEl(t, active) {
    var el = document.createElement('div');
    el.className = 'tab' + (t.resting ? ' resting' : '');
    el.setAttribute('role', 'tab');
    el.setAttribute('data-testid', 'tab-' + t.label);
    el.setAttribute('data-label', t.label);
    el.setAttribute('aria-selected', t.label === active ? 'true' : 'false');
    el.tabIndex = t.label === active ? 0 : -1;
    el.title = t.name;

    if (t.dot === 'done' || t.dot === 'needs-you') {
      var dot = document.createElement('span');
      dot.className = 'dot ' + t.dot;
      dot.setAttribute('data-testid', 'tab-dot');
      dot.setAttribute('data-dot', t.dot);
      dot.setAttribute('aria-label', t.dot === 'needs-you' ? 'Needs you' : 'Done');
      el.appendChild(dot);
    }

    var name = document.createElement('span');
    name.className = 'name';
    name.textContent = t.name;
    el.appendChild(name);

    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'close';
    close.setAttribute('data-testid', 'tab-close-' + t.label);
    close.setAttribute('aria-label', 'Close ' + t.name);
    close.title = 'Close tab';
    close.disabled = !!t.closing;
    close.innerHTML =
      '<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" focusable="false">' +
      '<path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';
    close.addEventListener('click', function (ev) {
      ev.stopPropagation();
      closeTab(t.label);
    });
    close.addEventListener('mousedown', function (ev) {
      ev.stopPropagation();
    });
    el.appendChild(close);

    // Activate on press, like a native tab; a middle click closes.
    el.addEventListener('mousedown', function (ev) {
      if (ev.button === 0) activate(t.label);
    });
    el.addEventListener('auxclick', function (ev) {
      if (ev.button === 1) {
        ev.preventDefault();
        closeTab(t.label);
      }
    });
    el.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        activate(t.label);
      }
    });
    return el;
  }

  function render(s) {
    if (!s || !Array.isArray(s.tabs)) return;
    var frag = document.createDocumentFragment();
    for (var i = 0; i < s.tabs.length; i++) frag.appendChild(tabEl(s.tabs[i], s.active));
    tabsEl.replaceChildren(frag);
    var homeActive = s.active === (s.home && s.home.label);
    homeEl.setAttribute('aria-selected', homeActive ? 'true' : 'false');
    homeEl.tabIndex = homeActive ? 0 : -1;
    document.body.setAttribute('data-active', s.active);
  }

  homeEl.addEventListener('mousedown', function (ev) {
    if (ev.button === 0) activate('home');
  });
  homeEl.addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      activate('home');
    }
  });

  var ch = new tauri.core.Channel();
  ch.onmessage = render;
  invoke('tabs_state', { onState: ch }).then(render, report);
})();
