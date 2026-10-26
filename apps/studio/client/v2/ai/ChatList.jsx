// client/v2/ai/ChatList.jsx — S5.12 (03 `ai-chat-list`): the chat list. "Every chat is kept with the project,
// grouped by canvas." Running first, then Earlier by canvas with "N more"; a search that finds words INSIDE
// chats (marked), and a row ⋯ menu — Open · Rename… · Copy transcript · Archive · Move to trash.
//
// This is the v1 chat switcher's dropdown (chat-menu*) grown up: every control it had is here (nothing
// deleted — Rename / Archive / Copy transcript, and "Delete" is now "Move to trash", which Trash keeps until
// it is cleared out). The list shows YOUR chats only; another person's run appears in ✦ N, never here (D5).
//
// The host (ChatPanel) owns the chat state and the connections; this component owns what is the list's own:
// the fetch (`chat-store-api.js`), the query, the open ⋯ menu, an inline rename and the trash dialog.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StIcon } from '../../shell/icons.jsx';
import { askForCovers } from '../canvases/covers.js';
import { useCanvasIndex } from '../canvases/use-canvas-index.js';
import { AskButton, copy, Empty } from '../empty/index.js';
import { sendToAskAI } from '../search/search-env.js';
import {
  boardsByRel,
  buildChatList,
  buildSearchList,
  chatsWord,
  coversByRel,
  queuedPromptsOf,
  rowMenu,
  trashDialog,
} from './chat-list-model.js';
import { useChatUndoReady, useUndoChat } from './ChatUndo.jsx';
import { fetchChats, searchChats, trashChat } from './chat-store-api.js';
import { Spark } from './icons.jsx';
import { RunIcon } from './RunList.jsx';

const SEARCH_DEBOUNCE_MS = 150;

function Marked({ parts }) {
  return parts.map((p, i) =>
    p.mark ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: the parts are a fixed split of one string
      <mark key={i} className="ai-cl-mark">
        {p.text}
      </mark>
    ) : (
      // biome-ignore lint/suspicious/noArrayIndexKey: the parts are a fixed split of one string
      <span key={i}>{p.text}</span>
    )
  );
}

/** The leading disc (03 `k-ai-sst`, 22 px): a spark that works, a help mark that waits on you, a quiet spark at rest. */
function State({ state }) {
  return (
    <span className="ai-cl-state" data-state={state} aria-hidden="true">
      {state === 'idle' ? (
        <span className="ai-run-ic ai-run-ic--idle">
          <Spark size={11} />
        </span>
      ) : (
        <RunIcon state={state} />
      )}
    </span>
  );
}

function RowMenu({ items, anchorRef, onPick, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    ref.current?.querySelector('button')?.focus();
    const onDown = (e) => {
      if (!ref.current?.contains(e.target) && !anchorRef.current?.contains(e.target)) onClose();
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [anchorRef, onClose]);
  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose(true);
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const btns = [...ref.current.querySelectorAll('button')];
    const at = btns.indexOf(document.activeElement);
    const next =
      e.key === 'ArrowDown' ? (at + 1) % btns.length : (at - 1 + btns.length) % btns.length;
    btns[next]?.focus();
  };
  return (
    // biome-ignore lint/a11y/useSemanticElements: an ARIA menu of buttons, the same shape the panel's other menus use
    <div
      ref={ref}
      className="ai-cl-menu"
      role="menu"
      aria-label="Chat actions"
      data-testid="chat-overflow-menu"
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      {items.map((it, i) =>
        it === 'sep' ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: separators have no identity
          <hr key={`sep${i}`} className="ai-cl-menu-sep" />
        ) : (
          <button
            key={it.id}
            type="button"
            role="menuitem"
            className={`ai-cl-menu-item${it.danger ? ' ai-cl-menu-item--danger' : ''}`}
            data-action={it.id}
            disabled={it.disabled || undefined}
            title={it.hint || undefined}
            onClick={() => onPick(it)}
          >
            {it.label}
            {it.hint ? <span className="ai-cl-menu-hint">{it.hint}</span> : null}
          </button>
        )
      )}
    </div>
  );
}

function TrashDialog({ dialog, busy, error, onConfirm, onCancel }) {
  const cancelRef = useRef(null);
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);
  return (
    <div className="ai-cl-scrim">
      <div
        className="ai-cl-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="ai-cl-dialog-t"
        aria-describedby="ai-cl-dialog-b"
        data-testid="ai-chat-trash-dialog"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onCancel();
          }
        }}
      >
        <h3 id="ai-cl-dialog-t" className="ai-cl-dialog-t">
          {dialog.title}
        </h3>
        <p id="ai-cl-dialog-b" className="ai-cl-dialog-b">
          {dialog.body}
        </p>
        {error ? (
          <p className="ai-cl-dialog-err" role="alert">
            {error}
          </p>
        ) : null}
        <div className="ai-cl-dialog-acts">
          <button ref={cancelRef} type="button" className="btn btn--sm" onClick={onCancel}>
            {dialog.cancel}
          </button>
          {dialog.confirm ? (
            <button
              type="button"
              className="btn btn--sm btn--danger"
              data-testid="ai-chat-trash-confirm"
              disabled={busy}
              onClick={onConfirm}
            >
              {dialog.confirm}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * @param {object} p
 * @param {string} [p.projectName]            the project chip in the header
 * @param {object} [p.busy]                   `{ chatId: true }` — YOUR chats with a turn in flight
 * @param {Set<string>} [p.needs]             chats waiting on you (S5.13)
 * @param {object} [p.titles]                 `{ chatId: title }` for a running chat the server has not listed yet
 * @param {string|null} [p.activeChatId]
 * @param {object} p.ctx                      the shell's KeyCtx (`menuCtx(...)`) — what the row menu may offer
 * @param {number} [p.refreshKey]             bump to re-read the list (after a rename / archive / finished turn)
 * @param {(id: string) => void} p.onOpen
 * @param {() => void} p.onBack               "‹ Chats" — back to the chat
 * @param {(id: string, title: string) => void} p.onRename
 * @param {(id: string) => void} p.onCopyTranscript
 * @param {() => void} [p.onNewChat]               the header's "+" — start a new chat (03 `ai-chat-list`)
 * @param {(id: string) => void} p.onArchive
 * @param {(id: string, dropped: number) => void} p.onTrashed   the chat is in the trash — close its connection
 * @param {typeof fetch} [p.fetchImpl]
 */
/** 03 `ai-chat-list`: the canvas's own picture beside its name (the Canvases panel's cover); an empty box until it exists. */
function CanvasThumb({ cover }) {
  return (
    <span className="ai-cl-thumb" aria-hidden="true" data-testid="ai-cl-thumb">
      {cover ? (
        <img
          src={`/_api/thumb/${cover}`}
          alt=""
          loading="lazy"
          draggable={false}
          onError={(e) => {
            e.currentTarget.style.visibility = 'hidden';
          }}
        />
      ) : null}
    </span>
  );
}

export function ChatList({
  projectName = '',
  busy = {},
  needs,
  titles = {},
  activeChatId = null,
  ctx,
  refreshKey = 0,
  onOpen,
  onBack,
  onRename,
  onCopyTranscript,
  onArchive,
  onTrashed,
  onStartChat,
  onNewChat,
  fetchImpl = fetch,
}) {
  const [groups, setGroups] = useState(null); // null = loading
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState(null);
  const [expanded, setExpanded] = useState(() => new Set());
  const [menuFor, setMenuFor] = useState(null);
  const [renaming, setRenaming] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [dialog, setDialog] = useState(null); // { id, title, queued, running }
  const [trashBusy, setTrashBusy] = useState(false);
  const [trashError, setTrashError] = useState('');
  const dotsRefs = useRef(new Map());
  // S5.15 — Undo this chat: the server's probe says whether this team server can (U22)
  const chatUndo = useChatUndoReady({ fetchImpl, key: refreshKey });
  const undo = useUndoChat({ fetchImpl });
  const needsSet = useMemo(() => needs ?? new Set(), [needs]);

  // browse data
  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey is the re-read trigger
  useEffect(() => {
    let live = true;
    fetchChats({ group: 'canvas', fetchImpl }).then((r) => {
      if (!live) return;
      setGroups(Array.isArray(r?.groups) ? r.groups : []);
    });
    return () => {
      live = false;
    };
  }, [refreshKey, fetchImpl]);

  // search data (debounced; a late answer for an old query is dropped)
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setHits(null);
      return undefined;
    }
    let live = true;
    const t = setTimeout(() => {
      searchChats(q, { fetchImpl }).then((h) => {
        if (live) setHits(h);
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [query, fetchImpl]);

  // S5.18 G5: the artboard names under each title come from the canvases index
  const index = useCanvasIndex({ stamp: refreshKey, fetchImpl });
  const boards = useMemo(() => boardsByRel(index), [index]);
  const covers = useMemo(() => coversByRel(index), [index]);
  // the group pictures: ask the thumbnail service once per page load (the Canvases panel may not be open)
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per page load; the request is the same whatever the list holds
  useEffect(() => {
    askForCovers(fetchImpl);
  }, []);
  const browse = useMemo(
    () =>
      buildChatList({
        groups: groups ?? [],
        busy,
        needs: needsSet,
        titles,
        expanded,
        boards,
        covers,
      }),
    [groups, busy, needsSet, titles, expanded, boards, covers]
  );
  const searching = query.trim() !== '';
  const found = useMemo(
    () => (searching && hits ? buildSearchList(hits, query.trim(), Date.now(), covers) : null),
    [searching, hits, query, covers]
  );

  // "Start a chat about it" (05 · es-edge-panels): a new chat with the search words in its composer. The host
  // owns chats (`onStartChat`); without one the words go to the composer the person is back in.
  const startChat = (text) => {
    if (onStartChat) onStartChat(text);
    else {
      sendToAskAI(text);
      onBack?.();
    }
  };

  const closeMenu = useCallback(
    (refocus) => {
      const id = menuFor;
      setMenuFor(null);
      if (refocus && id) dotsRefs.current.get(id)?.focus();
    },
    [menuFor]
  );

  const startTrash = useCallback(
    async (id, title) => {
      let queued = [];
      try {
        const res = await fetchImpl('/_api/outbox');
        if (res.ok) queued = queuedPromptsOf(await res.json(), id);
      } catch {
        /* the outbox is a courtesy here: the server drops the prompt either way */
      }
      setTrashError('');
      setDialog({ id, title, queued, running: !!busy[id] });
    },
    [fetchImpl, busy]
  );

  const confirmTrash = useCallback(async () => {
    if (!dialog) return;
    setTrashBusy(true);
    setTrashError('');
    const res = await trashChat(dialog.id, { fetchImpl });
    setTrashBusy(false);
    if (res.ok) {
      const dropped = Number(res.body?.droppedPrompts) || 0;
      setDialog(null);
      onTrashed?.(dialog.id, dropped);
      fetchChats({ group: 'canvas', fetchImpl }).then((r) =>
        setGroups(Array.isArray(r?.groups) ? r.groups : [])
      );
    } else if (res.status === 409) {
      setDialog((d) => (d ? { ...d, running: true } : d));
    } else {
      setTrashError("Couldn't move it to the trash. Try again.");
    }
  }, [dialog, fetchImpl, onTrashed]);

  const pick = (row, it) => {
    setMenuFor(null);
    if (it.id === 'open') onOpen?.(row.id);
    else if (it.id === 'chat.rename') {
      setRenaming(row.id);
      setRenameValue(row.rawTitle === 'New chat' ? '' : row.rawTitle);
    } else if (it.id === 'chat.copy-transcript') onCopyTranscript?.(row.id);
    else if (it.id === 'chat.archive') onArchive?.(row.id);
    else if (it.id === 'chat.trash') startTrash(row.id, row.rawTitle);
    else if (it.id === 'chat.undo' && !it.disabled) void undo.run(row.id);
  };

  const commitRename = (id) => {
    const value = renameValue.trim();
    setRenaming(null);
    if (value) onRename?.(id, value);
  };

  const items = useMemo(() => rowMenu(ctx, undefined, { chatUndo }), [ctx, chatUndo]);

  const renderRow = (r) => {
    const rawTitle =
      r.rawTitle ?? (Array.isArray(r.title) ? r.title.map((p) => p.text).join('') : r.title);
    const row = { ...r, rawTitle };
    const title = Array.isArray(r.title) ? <Marked parts={r.title} /> : r.title;
    const when = r.state === 'needs' ? 'Needs you' : r.stopped ? `Stopped · ${r.when}` : r.when;
    return (
      <div
        key={r.id}
        className={`ai-cl-row${r.id === activeChatId ? ' is-active' : ''}${menuFor === r.id ? ' is-menu' : ''}`}
      >
        {renaming === r.id ? (
          <input
            type="text"
            className="ai-cl-rename"
            aria-label="Chat name"
            value={renameValue}
            // biome-ignore lint/a11y/noAutofocus: the field replaces the row the person just asked to rename
            autoFocus
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={() => commitRename(r.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename(r.id);
              else if (e.key === 'Escape') {
                e.stopPropagation();
                setRenaming(null);
              }
            }}
          />
        ) : (
          <button
            type="button"
            className="ai-cl-open"
            data-testid={`ai-chat-row-${r.id}`}
            data-state={r.state}
            onClick={() => onOpen?.(r.id)}
          >
            <State state={r.state} />
            <span className="ai-cl-stxt">
              <span className="ai-cl-st">{title}</span>
              {r.via ? (
                <span className="ai-cl-sw">
                  … <Marked parts={r.via} /> …
                </span>
              ) : r.where ? (
                <span className="ai-cl-sw">{r.where}</span>
              ) : null}
            </span>
            <span className={`ai-cl-when${r.state === 'needs' ? ' ai-cl-when--needs' : ''}`}>
              {when}
            </span>
          </button>
        )}
        {items.length > 1 ? (
          <span className="ai-cl-dots-wrap">
            <button
              type="button"
              ref={(el) => {
                if (el) dotsRefs.current.set(r.id, el);
                else dotsRefs.current.delete(r.id);
              }}
              className="ai-cl-dots"
              aria-label="More options"
              title="More options"
              aria-haspopup="menu"
              aria-expanded={menuFor === r.id}
              onClick={() => setMenuFor((m) => (m === r.id ? null : r.id))}
            >
              <StIcon name="more" size={14} />
            </button>
            {menuFor === r.id ? (
              <RowMenu
                items={items}
                anchorRef={{ current: dotsRefs.current.get(r.id) }}
                onPick={(it) => pick(row, it)}
                onClose={closeMenu}
              />
            ) : null}
          </span>
        ) : null}
      </div>
    );
  };

  const body = (() => {
    if (groups === null) return <p className="ai-cl-empty">Reading your chats…</p>;
    if (searching) {
      if (!found) return <p className="ai-cl-empty">Searching…</p>;
      if (found.groups.length === 0) {
        // 05 · es-edge-panels: what was searched, and one way on — a new chat about it
        const vars = {
          q: query.trim(),
          chats: chatsWord(browse.total),
          project: projectName || 'this project',
        };
        return (
          <Empty
            glyph="spark"
            copyId="es-edge-panels.chat-search-none"
            vars={vars}
            testid="ai-chat-search-none"
            foot=""
            chips={
              <AskButton onClick={() => startChat(vars.q)}>
                {copy('es-edge-panels.chat-search-none', vars).action}
              </AskButton>
            }
          />
        );
      }
      return found.groups.map((g) => (
        <section key={g.canvas ?? ''} className="ai-cl-grp" aria-label={g.name}>
          <p className="ai-cl-canvas">
            <CanvasThumb cover={g.cover} />
            <span className="ai-cl-canvas-n">{g.name}</span>
          </p>
          {g.rows.map(renderRow)}
        </section>
      ));
    }
    return (
      <>
        {browse.running.length ? (
          <section className="ai-cl-grp" aria-label="Running">
            <p className="ai-cl-gt">
              Running<span className="ai-cl-gc">{browse.running.length}</span>
            </p>
            {browse.running.map(renderRow)}
          </section>
        ) : null}
        {browse.groups.length ? <p className="ai-cl-gt">Earlier</p> : null}
        {browse.groups.map((g) => (
          <section key={g.canvas ?? ''} className="ai-cl-grp" aria-label={g.name}>
            <p className="ai-cl-canvas">
              <CanvasThumb cover={g.cover} />
              <span className="ai-cl-canvas-n">{g.name}</span>
              <span className="ai-cl-gc">
                {g.count} {g.count === 1 ? 'chat' : 'chats'}
              </span>
            </p>
            {g.rows.map(renderRow)}
            {g.more > 0 ? (
              <button
                type="button"
                className="ai-cl-more"
                onClick={() => setExpanded((s) => new Set(s).add(g.canvas ?? ''))}
              >
                {g.more} more
              </button>
            ) : null}
          </section>
        ))}
        {browse.total === 0 ? (
          <p className="ai-cl-empty">No chats yet. Ask AI something and it is kept here.</p>
        ) : null}
      </>
    );
  })();

  // no hits: the foot still counts the chats that were searched (05 · es-edge-panels)
  const foot = searching
    ? found?.groups.length === 0
      ? browse.foot
      : (found?.foot ?? '')
    : browse.foot;

  return (
    <div className="ai-cl" data-testid="ai-chat-list">
      <div className="ai-cl-hd">
        <button
          type="button"
          className="ai-cl-back"
          aria-label="Back to the chat"
          title="Back to the chat"
          data-testid="ai-chat-list-back"
          onClick={onBack}
        >
          <StIcon name="chevron-right" size={12} />
        </button>
        <strong>Chats</strong>
        {projectName ? <span className="ai-cl-chip">{projectName}</span> : null}
        {/* 03 `ai-chat-list`: the header's "+" — a new chat, from the list */}
        {onNewChat ? (
          <button
            type="button"
            className="sh-iconbtn ai-cl-new"
            aria-label="New chat"
            title="New chat"
            data-testid="ai-chat-list-new"
            onClick={onNewChat}
          >
            <StIcon name="plus" size={14} />
          </button>
        ) : null}
      </div>
      <label className={`ai-cl-find${searching ? ' is-on' : ''}`}>
        <StIcon name="search" size={14} />
        <input
          type="search"
          className="ai-cl-find-in"
          placeholder="Search chats"
          aria-label="Search chats"
          data-testid="ai-chat-list-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && query) {
              e.stopPropagation();
              setQuery('');
            }
          }}
        />
      </label>
      {/* biome-ignore lint/a11y/useSemanticElements: a labelled list of chat rows, not a form fieldset */}
      <div className="ai-cl-list" role="group" aria-label={searching ? 'Search results' : 'Chats'}>
        {body}
      </div>
      <p className="ai-cl-foot" role="status">
        {foot}
      </p>
      {dialog ? (
        <TrashDialog
          dialog={trashDialog(dialog.title, { queued: dialog.queued, running: dialog.running })}
          busy={trashBusy}
          error={trashError}
          onConfirm={confirmTrash}
          onCancel={() => setDialog(null)}
        />
      ) : null}
    </div>
  );
}
