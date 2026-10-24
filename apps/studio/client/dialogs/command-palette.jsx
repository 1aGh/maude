// dialogs/command-palette.jsx — Search ⌘K (Maude v2, V2-4.6; was moved verbatim out of app.jsx in V2-0.2).
//
// Nothing typed: the shell's short list (the rows `actions` carries without `searchRow`) and, on the
// desktop, Ask AI last. Something typed: canvases and artboards (the project index), then actions,
// tools and settings from the registry / toolbars / Settings model — each with WHERE it lives — then
// Ask AI, always the last row. The ranking, grouping and copy are `v2/search/search-model.js`; this
// file is the keyboard, the fetch and the markup. A row runs the function the shell already has for
// it (`menuRunner`, via `row.run`) — there is no second dispatcher.

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Kbd, STICONS, StIcon } from '../shell/icons.jsx';
import { Spot } from '../v2/empty/index.js';
import { getPaletteEnv } from '../v2/search/search-env.js';
import { useModalFocus } from '../v2/shell/modal-focus.js';
import { REMOTE_DEBOUNCE_MS, searchIndex } from '../v2/search/search-remote.js';
import {
  askRow as askRowFor,
  emptyCopy,
  footerCount,
  remoteRows,
  sanitizeQuery,
} from '../v2/search/search-model.js';
import { fetchRecents, RECENT_EMPTY, recentRows, startRows } from '../v2/search/search-recent.js';
import { assembleAcross, projectGroups } from '../v2/search/search-projects.js';
import { glyphFor } from '../v2/search/palette-icons.js';

const FALLBACK_ICON = {
  canvases: 'file',
  artboards: 'square',
  actions: 'chevron',
  tools: 'pen',
  settings: 'sliders',
  'ask-ai': 'sparkle',
};

function iconFor(row, group) {
  const wanted = row.icon && STICONS[row.icon] ? row.icon : null;
  // 06 ad-search: a fold action that names no glyph gets the one its words say, not a stand-in chevron
  return wanted ?? glyphFor(row, group, FALLBACK_ICON[group] ?? 'chevron');
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
  // another project's row (S1.5): the shell switches to its tab, or opens one, then goes there
  else if (item.pid) env.openSearchResult?.(item);
  else if (item.group === 'canvases' || item.group === 'artboards')
    env.openCanvas(item.path, item.artboardId ?? null);
  else item.run?.();
}

export function CommandPalette({ open, onClose, actions }) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [remote, setRemote] = useState({ q: '', rows: [] });
  // S1.5: the person's other projects (desktop tab only — the shell's `index_search`)
  const [across, setAcross] = useState({ q: '', groups: [] });
  // Canvases opened on this Mac (`known: false` = the server did not say, so no day-one screen)
  const [recents, setRecents] = useState({ known: false, opened: {} });
  const listRef = useRef(null);
  const inputRef = useRef(null);
  // V2-4 gate (a11y B2/W3): Tab stays inside, esc closes from any row, focus goes back to the opener.
  const dialogRef = useModalFocus({ open, onClose, initialRef: inputRef });
  const baseId = useId();
  const listId = `${baseId}-list`;
  const optionId = (i) => `${baseId}-opt-${i}`;
  const env = open ? getPaletteEnv() : null;
  const canAskAI = env ? env.canAskAI() : false;
  const clean = sanitizeQuery(q);

  useEffect(() => {
    if (open) {
      setQ('');
      setActive(0);
      setRemote({ q: '', rows: [] });
      setAcross({ q: '', groups: [] });
      setRecents({ known: false, opened: {} });
      const ctl = new AbortController();
      fetchRecents({ signal: ctl.signal }).then((r) => {
        if (!ctl.signal.aborted) setRecents(r);
      });
      return () => ctl.abort();
    }
    return undefined;
  }, [open]);

  // Canvases + artboards: the project index, one request per pause in typing.
  useEffect(() => {
    if (!open || !clean) return undefined;
    const ctl = new AbortController();
    const timer = setTimeout(async () => {
      const res = await searchIndex(clean, { signal: ctl.signal });
      if (res && !ctl.signal.aborted)
        setRemote({
          q: clean,
          rows: remoteRows(res, {
            designRel: getPaletteEnv().designRel,
            query: clean,
            project: getPaletteEnv().projectName,
          }),
        });
    }, REMOTE_DEBOUNCE_MS);
    // Other projects answer through the shell, on the same pause; a browser tab has none to ask.
    const { searchProjects, ownProject } = getPaletteEnv();
    const acrossTimer = searchProjects
      ? setTimeout(async () => {
          const res = await searchProjects(clean, { signal: ctl.signal });
          if (res && !ctl.signal.aborted)
            setAcross({
              q: clean,
              groups: projectGroups(res, { ownPid: ownProject?.pid, query: clean }),
            });
        }, REMOTE_DEBOUNCE_MS)
      : null;
    return () => {
      clearTimeout(timer);
      if (acrossTimer) clearTimeout(acrossTimer);
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
  const viewFor = (query, remoteRowsNow, others = []) => {
    if (!sanitizeQuery(query)) {
      const designRel = getPaletteEnv().designRel;
      const recent = recentRows(recents.opened, { designRel });
      // Nothing opened yet on this Mac: say so, and list where to start (05 · es-search-more).
      const dayOne = recents.known && recent.length === 0;
      const rows = dayOne
        ? startRows(actions)
        : [
            ...recent,
            ...shortList.map((a) => ({
              group: 'short',
              id: a.id,
              name: a.label,
              icon: a.icon,
              keys: a.kbd ?? '',
              heading: a.group,
              run: a.run,
            })),
          ];
      const ask = canAskAI ? askRowFor('', dayOne ? 'first' : 'idle') : null;
      return {
        short: true,
        dayOne,
        groups: [],
        rows,
        items: ask ? [...rows, ask] : rows,
        ask,
        total: 0,
      };
    }
    const own = getPaletteEnv().ownProject ?? null;
    return assembleAcross({ query, local, remote: remoteRowsNow, others, own, canAskAI });
  };
  const view = useMemo(
    () =>
      viewFor(q, remote.q === clean ? remote.rows : [], across.q === clean ? across.groups : []),
    [q, clean, remote, across, local, shortList, canAskAI, recents, actions]
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
  // V2-4 gate (a11y B1): the WAI-ARIA combobox pattern — rows are `option`s of the `listbox`, focus stays
  // in the input and `aria-activedescendant` names the active row (so a screen reader hears it).
  const rowButton = (item, group) => {
    at += 1;
    const i = at;
    return (
      <button
        type="button"
        key={item.id}
        id={optionId(i)}
        role="option"
        aria-selected={i === active}
        aria-disabled={item.disabled ? true : undefined}
        tabIndex={-1}
        data-testid={`palette-row-${item.id}`}
        className={`st-pal-item${i === active ? ' is-active' : ''}${item.disabled ? ' is-dim' : ''}${item.quiet ? ' is-quiet' : ''}`}
        onMouseEnter={() => setActive(i)}
        onClick={() => go(item)}
      >
        {item.thumb ? (
          <img className="st-pal-thumb" src={item.thumb} alt="" />
        ) : (
          <span className={`st-pal-icon${group === 'ask-ai' ? ' st-pal-icon--spark' : ''}`}>
            <StIcon name={iconFor(item, group)} size={15} />
          </span>
        )}
        <span className="st-pal-label">
          <span className="st-pal-ltxt">
            <Marked text={item.name} marks={item.marks} />
          </span>
          {item.meta ? (
            <span className="st-pal-meta">
              <Marked text={item.meta} marks={item.metaMarks} />
            </span>
          ) : null}
        </span>
        {item.project ? (
          // another project's row in "Did you mean" (S15-A2): which project ↵ goes to, and where it is
          <span className="st-pal-where st-pal-proj" data-testid="palette-project-label">
            <span className={`st-pal-sq st-pal-sq--${item.project.square.tone}`} aria-hidden="true">
              {item.project.square.initial}
            </span>
            {item.project.name} · {item.project.aside}
          </span>
        ) : item.where ? (
          <span className="st-pal-where">{item.where}</span>
        ) : null}
        {item.keys ? (
          <span className="st-pal-kbd">
            <Kbd>{item.keys}</Kbd>
          </span>
        ) : null}
      </button>
    );
  };

  let body;
  let note = null;
  if (view.short) {
    // One `group` per heading run (the short list is flat — arrow keys index straight across groups).
    const runs = [];
    for (const item of view.rows) {
      const tail = runs[runs.length - 1];
      if (tail && tail.heading === (item.heading ?? null)) tail.rows.push(item);
      else runs.push({ heading: item.heading ?? null, rows: [item] });
    }
    const shortRuns = runs.map((run, r) => {
      const hd = `${baseId}-short-${r}`;
      return run.heading ? (
        // biome-ignore lint/a11y/useSemanticElements: an ARIA listbox may only own option or group children; a <fieldset> is a form grouping and would break the listbox tree
        <div key={hd} role="group" aria-labelledby={hd}>
          <div className="st-pal-group" id={hd} role="presentation">
            {run.heading}
          </div>
          {run.rows.map((item) => rowButton(item, 'short'))}
        </div>
      ) : (
        run.rows.map((item) => rowButton(item, 'short'))
      );
    });
    // Nothing opened yet: Recent says so in one line and Start here lists where to begin (05 · es-search-more)
    body = view.dayOne ? (
      <>
        <div role="presentation">
          <div className="st-pal-group" role="presentation">
            Recent
          </div>
          <p className="st-pal-recent-none" data-testid="palette-recent-empty">
            <span className="st-pal-sit">{RECENT_EMPTY.headline}</span>
            <span className="st-pal-next">{RECENT_EMPTY.next}</span>
          </p>
        </div>
        {shortRuns}
      </>
    ) : (
      shortRuns
    );
  } else if (view.empty) {
    const copy = emptyCopy(q, canAskAI);
    body = (
      <div
        className="st-pal-none st-pal-none--spot"
        data-testid="palette-empty"
        data-copy="es-search-k.search-none"
        role={items.length > 0 ? 'presentation' : 'status'}
      >
        <Spot name="none" w={150} />
        <span className="st-pal-txt">
          <strong className="st-pal-sit">{copy.headline}</strong>
          <span className="st-pal-next">{copy.next}</span>
        </span>
      </div>
    );
  } else {
    // The close-matches note is a status line, not an option: it sits above the listbox.
    note =
      view.closeOnly && !view.didYouMean ? (
        <div className="st-pal-note" data-testid="palette-close-note" role="status">
          <StIcon name="search" size={12} />
          <span>
            Nothing called “{(view.closeTyped ?? q).trim()}”.
            {view.closeWord ? (
              <>
                {' '}
                Showing close matches for <strong>{view.closeWord.toLowerCase()}</strong>.
              </>
            ) : null}
          </span>
        </div>
      ) : null;
    // A misspelling and no word right: the CONTRACT line first, then what it may have meant
    const copy = view.didYouMean ? emptyCopy(q, canAskAI) : null;
    const groupsBody = view.groups.map((g) => (
      // biome-ignore lint/a11y/useSemanticElements: an ARIA listbox may only own option or group children; a <fieldset> would break the listbox tree
      <div
        key={g.id}
        data-testid={`palette-group-${g.id}`}
        role="group"
        aria-labelledby={`${baseId}-g-${g.id}`}
      >
        <div className="st-pal-group" id={`${baseId}-g-${g.id}`} role="presentation">
          {g.square ? (
            <span
              className={`st-pal-sq st-pal-sq--${g.square.tone}`}
              data-testid="palette-project-square"
              aria-hidden="true"
            >
              {g.square.initial}
            </span>
          ) : null}
          {g.title}
          {g.aside ? <span className="st-pal-aside">{g.aside}</span> : null}
        </div>
        {g.rows.map((row) =>
          rowButton(row, g.id === 'did-you-mean' || g.square ? row.group : g.id)
        )}
      </div>
    ));
    body = copy ? (
      <>
        <div
          className="st-pal-none st-pal-none--spot"
          data-testid="palette-did-you-mean-note"
          data-copy="es-search-k.search-none"
          role="presentation"
        >
          <Spot name="none" w={150} />
          <span className="st-pal-txt">
            <strong className="st-pal-sit">{copy.headline}</strong>
            <span className="st-pal-next">{copy.next}</span>
          </span>
        </div>
        {groupsBody}
      </>
    ) : (
      groupsBody
    );
  }

  // Ask AI is the LAST row (after the body, so its arrow-key index is the last one too).
  const askRow = view.ask ? (
    <div className="st-pal-ask" data-testid="palette-ask-ai" role="presentation">
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
        ref={dialogRef}
        tabIndex={-1}
      >
        <div className="st-pal-search">
          <StIcon name="search" size={18} />
          <input
            ref={inputRef}
            data-testid="palette-input"
            placeholder="Search canvases, actions, or ask AI…"
            value={q}
            aria-label="Command search"
            role="combobox"
            aria-autocomplete="list"
            aria-haspopup="listbox"
            aria-expanded={items.length > 0}
            aria-controls={listId}
            aria-activedescendant={items[active] ? optionId(active) : undefined}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              // esc is useModalFocus's (it closes from any row too)
              if (e.key === 'ArrowDown') {
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
          <Kbd>esc</Kbd>
        </div>
        {note}
        <div
          className="st-pal-list"
          ref={listRef}
          id={listId}
          data-testid="palette-list"
          {...(items.length > 0 ? { role: 'listbox', 'aria-label': 'Results' } : {})}
        >
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
              <Kbd>↵</Kbd> {view.dayOne ? 'run' : 'open'}
            </span>
          </span>
          <span data-testid="palette-count" role="status" aria-live="polite">
            {view.dayOne
              ? 'Every tool is here — type its name'
              : view.short
                ? 'Type to search'
                : footerCount(view)}
          </span>
        </div>
      </div>
    </div>
  );
}
