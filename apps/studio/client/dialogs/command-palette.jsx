// dialogs/command-palette.jsx — Search ⌘K (Maude v2, V2-4.6; was moved verbatim out of app.jsx in V2-0.2).
//
// Nothing typed: the shell's short list (the rows `actions` carries without `searchRow`) and, on the
// desktop, Ask AI last. Something typed: canvases and artboards (the project index), then actions,
// tools and settings from the registry / toolbars / Settings model — each with WHERE it lives — then
// Ask AI, always the last row. The ranking, grouping and copy are `v2/search/search-model.js`; this
// file is the keyboard, the fetch and the markup. A row runs the function the shell already has for
// it (`menuRunner`, via `row.run`) — there is no second dispatcher.

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Kbd, STICONS, StIcon } from '../shell/icons.jsx';
import { getPaletteEnv } from '../v2/search/search-env.js';
import { REMOTE_DEBOUNCE_MS, searchIndex } from '../v2/search/search-remote.js';
import {
  assemble,
  emptyCopy,
  remoteRows,
  resultsCount,
  sanitizeQuery,
} from '../v2/search/search-model.js';

const FALLBACK_ICON = {
  canvases: 'file',
  artboards: 'square',
  actions: 'chevron-right',
  tools: 'pen',
  settings: 'sliders',
  'ask-ai': 'sparkle',
};

function iconFor(row, group) {
  const wanted = row.icon && STICONS[row.icon] ? row.icon : null;
  return wanted ?? FALLBACK_ICON[group] ?? 'chevron-right';
}

/** The name with its matched ranges marked (ranges index the unfolded name). */
function Marked({ text, marks }) {
  if (!marks?.length) return text;
  const out = [];
  let at = 0;
  for (const [a, b] of marks) {
    if (a < at) continue;
    if (a > at) out.push(text.slice(at, a));
    out.push(
      <mark className="st-pal-mark" key={a}>
        {text.slice(a, b)}
      </mark>
    );
    at = b;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

/** What ↵ / a click does for an item the list holds. */
function runItem(item, { env, query, close }) {
  close();
  if (item.group === 'ask-ai') env.askAI(query.trim());
  else if (item.group === 'canvases' || item.group === 'artboards')
    env.openCanvas(item.path, item.artboardId ?? null);
  else item.run?.();
}

export function CommandPalette({ open, onClose, actions }) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [remote, setRemote] = useState({ q: '', rows: [] });
  const listRef = useRef(null);
  const env = open ? getPaletteEnv() : null;
  const canAskAI = env ? env.canAskAI() : false;
  const clean = sanitizeQuery(q);

  useEffect(() => {
    if (open) {
      setQ('');
      setActive(0);
      setRemote({ q: '', rows: [] });
    }
  }, [open]);

  // Canvases + artboards: the project index, one request per pause in typing.
  useEffect(() => {
    if (!open || !clean) return undefined;
    const ctl = new AbortController();
    const timer = setTimeout(async () => {
      const res = await searchIndex(clean, { signal: ctl.signal });
      if (res && !ctl.signal.aborted)
        setRemote({ q: clean, rows: remoteRows(res, { designRel: getPaletteEnv().designRel }) });
    }, REMOTE_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
  }, [open, clean]);

  // The rows the registry, the toolbars and Settings give — the shell's runner decides which can run.
  const local = useMemo(
    () => (open ? actions.filter((a) => a.searchRow && (a.runnable?.() ?? true)) : []),
    [open, actions]
  );
  const shortList = useMemo(
    () => actions.filter((a) => !a.onlyWhenSearched && !a.searchRow),
    [actions]
  );

  /** Everything on screen for a query (the live input value or the rendered one). */
  const viewFor = (query, remoteRowsNow) => {
    if (!sanitizeQuery(query)) {
      const rows = shortList.map((a) => ({
        group: 'short',
        id: a.id,
        name: a.label,
        icon: a.icon,
        keys: a.kbd ?? '',
        heading: a.group,
        run: a.run,
      }));
      const ask = canAskAI
        ? {
            group: 'ask-ai',
            id: 'ask-ai',
            name: 'Ask AI',
            meta: ' — describe what you want on the canvas',
            keys: '⌘↵',
          }
        : null;
      return { short: true, groups: [], rows, items: ask ? [...rows, ask] : rows, ask, total: 0 };
    }
    return assemble({ query, local, remote: remoteRowsNow, canAskAI });
  };
  const view = useMemo(
    () => viewFor(q, remote.q === clean ? remote.rows : []),
    [q, clean, remote, local, shortList, canAskAI]
  );
  const items = view.items;

  // Keep the keyboard-active row visible while arrowing through a scrolled list.
  useEffect(() => {
    listRef.current?.querySelector('.st-pal-item.is-active')?.scrollIntoView({ block: 'nearest' });
  }, [active, items.length]);
  useEffect(() => {
    if (active >= items.length) setActive(0);
  }, [items.length, active]);

  if (!open) return null;
  const close = () => onClose();
  const go = (item) => runItem(item, { env, query: q, close });
  let at = -1;
  const rowButton = (item, group) => {
    at += 1;
    const i = at;
    return (
      <button
        type="button"
        key={item.id}
        data-testid={`palette-row-${item.id}`}
        className={`st-pal-item${i === active ? ' is-active' : ''}${item.disabled ? ' is-dim' : ''}`}
        onMouseEnter={() => setActive(i)}
        onClick={() => go(item)}
      >
        <span className={`st-pal-icon${group === 'ask-ai' ? ' st-pal-icon--spark' : ''}`}>
          <StIcon name={iconFor(item, group)} size={15} />
        </span>
        <span className="st-pal-label">
          <span className="st-pal-ltxt">
            <Marked text={item.name} marks={item.marks} />
          </span>
          {item.meta ? <span className="st-pal-meta">{item.meta}</span> : null}
        </span>
        {item.where ? <span className="st-pal-where">{item.where}</span> : null}
        {item.keys ? (
          <span className="st-pal-kbd">
            <Kbd>{item.keys}</Kbd>
          </span>
        ) : null}
      </button>
    );
  };

  let body;
  if (view.short) {
    body = view.rows.map((item, i) => {
      const header =
        item.heading && (i === 0 || view.rows[i - 1].heading !== item.heading) ? (
          <div className="st-pal-group" key={`g-${item.heading}`}>
            {item.heading}
          </div>
        ) : null;
      return (
        <Fragment key={item.id}>
          {header}
          {rowButton(item, 'short')}
        </Fragment>
      );
    });
  } else if (view.empty) {
    const copy = emptyCopy(q, canAskAI);
    body = (
      <div className="st-pal-none" data-testid="palette-empty" role="status">
        <strong className="st-pal-sit">{copy.headline}</strong>
        <span className="st-pal-next">{copy.next}</span>
      </div>
    );
  } else {
    body = (
      <>
        {view.closeOnly ? (
          <div className="st-pal-note" data-testid="palette-close-note" role="status">
            Nothing called “{q.trim()}”.
            {view.closeWord ? (
              <>
                {' '}
                Showing close matches for <strong>{view.closeWord}</strong>.
              </>
            ) : null}
          </div>
        ) : null}
        {view.groups.map((g) => (
          <div key={g.id} data-testid={`palette-group-${g.id}`}>
            <div className="st-pal-group">
              {g.title}
              {g.aside ? <span className="st-pal-aside">{g.aside}</span> : null}
            </div>
            {g.rows.map((row) => rowButton(row, g.id))}
          </div>
        ))}
      </>
    );
  }

  // Ask AI is the LAST row (after the body, so its arrow-key index is the last one too).
  const askRow = view.ask ? (
    <div className="st-pal-ask" data-testid="palette-ask-ai">
      {rowButton(view.ask, 'ask-ai')}
    </div>
  ) : null;

  return (
    <div
      className="st-scrim"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="st-palette st-palette--search"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        <div className="st-pal-search">
          <StIcon name="search" size={18} />
          <input
            // biome-ignore lint/a11y/noAutofocus: command palette opens on an explicit ⌘K.
            autoFocus
            data-testid="palette-input"
            placeholder="Search canvases, actions, or ask AI…"
            value={q}
            aria-label="Command search"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
              } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((i) => Math.min(items.length - 1, i + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((i) => Math.max(0, i - 1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                const live = e.currentTarget.value;
                // ⌘↵ is Ask AI whatever is highlighted (CONTRACT §4)
                if (e.metaKey || e.ctrlKey) {
                  if (canAskAI) runItem({ group: 'ask-ai' }, { env, query: live, close });
                  return;
                }
                // WHAT IS IN THE BOX, not what the last render saw: a query typed and confirmed at once
                // reaches Enter before the list re-rendered for it (surface run 2026-09-16). When the box
                // and the rendered query disagree, the box wins and its first row runs.
                const stale = sanitizeQuery(live) !== clean;
                const now = stale ? viewFor(live, []) : view;
                const pick = stale ? now.items[0] : items[active];
                if (pick) runItem(pick, { env, query: live, close });
              }
            }}
          />
          <Kbd>⌘K</Kbd>
        </div>
        <div className="st-pal-list" ref={listRef} data-testid="palette-list">
          {body}
          {askRow}
        </div>
        <div className="st-pal-foot">
          <span className="st-pal-hints">
            <span>
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd> move
            </span>
            <span>
              <Kbd>↵</Kbd> open
            </span>
          </span>
          <span data-testid="palette-count">
            {view.short ? 'Type to search' : resultsCount(view.total)}
          </span>
        </div>
      </div>
    </div>
  );
}
