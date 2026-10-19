// client/v2/ai/Advanced.jsx — S5.12 (03 `ai-advanced`, `ai-adv-edges`): the AI chat panel's Advanced fold.
//
// "Advanced is a layer of the panel, not a mode of the app." Everything that used to be on screen — the model,
// effort and mode pickers, the transcript view, the context meter, the session, Open in terminal — sits under
// ONE quiet row at the panel's foot (the shared <AdvancedFold>, open or closed remembered per Mac). Nothing is
// removed, only hidden, and ⌘K finds each row by name ("model", "raw log", "terminal" — advanced-handlers.js).
//
// Rows that need a substrate this build does not have are not drawn: a row that does nothing is worse than no
// row. S5.17b: "Folders AI may read" IS drawn — S5.10's consent store backs it (GET /_api/ai/attach/folders,
// Reset = POST …/folder/revoke). Not drawn, with no capability behind them: the "AI may" switches (Change
// canvases · Use Assets and footage · Search the web — the allowed tools are fixed in acp/bridge.ts), "Write
// outside this project" (always asks, nothing to set), "Always allowed on this canvas · Reset" (Claude Code's
// own session rule, no Maude store to reset) and Images, video and voice (the Generate dialog's per-use choices;
// nothing persists a default). Each lands as a row the day its setting exists.
//
// The suggest-only banner (`SuggestOnlyBanner`) is the other half of 03 `ai-adv-edges`: a mode where AI
// changes nothing is said up front, with ONE verb to undo it.

import { useCallback, useEffect, useRef, useState } from 'react';
import { flattenSelectOptions } from '../../panels/acp-capabilities.js';
import { TRANSCRIPT_VIEWS } from '../../panels/transcript-view.js';
import { AdvancedFold } from '../fold/advanced-fold.jsx';
import { useFold } from '../fold/use-fold.js';
import { ADVANCED_ROW_EVENT, takeParkedRow } from './advanced-handlers.js';
import {
  AI_FOLD_PANEL,
  contextMeter,
  currentModeNote,
  foldersLine,
  limitMeter,
  MODE_GROUP_LABEL,
  modeBanner,
  modeOptions,
  rowDomId,
  viewLabel,
} from './advanced-model.js';
import { canOpenInTerminal, openChatInTerminal } from './chat-store-api.js';
import { ChatFootInfo } from './Composer.jsx';
import { ConnectedRawLog } from './RawLog.jsx';

function Row({ row, label, children, hint }) {
  return (
    <div className="ai-adv-row" data-adv-row={row}>
      <label className="ai-adv-k" htmlFor={rowDomId(row)}>
        {label}
      </label>
      {children}
      {hint ? <span className="ai-adv-hint">{hint}</span> : null}
    </div>
  );
}

function OptionSelect({ row, label, opt, onChange }) {
  const flat = flattenSelectOptions(opt.options);
  if (!flat.length) return null;
  return (
    <Row row={row} label={label}>
      <select
        id={rowDomId(row)}
        className="ai-adv-select"
        data-adv-control
        value={opt.currentValue ?? ''}
        title={flat.find((o) => o.value === opt.currentValue)?.description || label}
        onChange={(e) => onChange(opt.id, e.target.value)}
      >
        {flat.map((o) => (
          <option key={o.value} value={o.value}>
            {o.name || o.value}
          </option>
        ))}
      </select>
    </Row>
  );
}

/** The one-line "AI is set to suggest only. The canvas won't change. [Allow changes]" above the thread. */
export function SuggestOnlyBanner({ modes, onSetMode }) {
  const b = modeBanner(modes);
  if (!b) return null;
  return (
    <div className="ai-modebar" role="alert" data-testid="chat-mode-banner">
      <span className="ai-modebar-t">
        <strong>{b.title}</strong> {b.body}
      </span>
      {b.action ? (
        <button
          type="button"
          className="btn btn--sm"
          data-testid="chat-mode-banner-switch"
          onClick={() => onSetMode(b.target)}
        >
          {b.action}
        </button>
      ) : null}
    </div>
  );
}

/**
 * @param {object} p
 * @param {string} p.chatId
 * @param {string} [p.chatTitle]
 * @param {boolean} [p.active]                 this chat is the one on screen (only it answers ⌘K)
 * @param {{ modes: object|null, parsedOptions: object }} p.caps    the session's live roster
 * @param {(modeId: string) => void} p.onSetMode
 * @param {(configId: string, value: string) => void} p.onSetConfig
 * @param {string} p.transcriptView
 * @param {(view: string) => void} p.onSetTranscriptView
 * @param {boolean} p.suggestOn
 * @param {(on: boolean) => void} p.onSetSuggestOn
 * @param {object} p.usage                     `parseUsage` result
 * @param {object} p.ctx                       the shell's KeyCtx
 * @param {(chatId: string) => void} [p.onCopyTranscript]
 */
export function ChatAdvanced({
  chatId,
  chatTitle = '',
  active = true,
  caps,
  onSetMode,
  onSetConfig,
  transcriptView,
  onSetTranscriptView,
  suggestOn,
  onSetSuggestOn,
  usage,
  ctx,
  onCopyTranscript,
  fetchImpl = fetch,
  openTerminal = openChatInTerminal,
  RawLogView = ConnectedRawLog,
}) {
  const [open, setOpen] = useFold(AI_FOLD_PANEL);
  const rootRef = useRef(null);
  const [rawOpen, setRawOpen] = useState(false);
  const [sessionId, setSessionId] = useState(undefined); // undefined = unknown, null = none yet
  const [termNote, setTermNote] = useState('');
  const [copied, setCopied] = useState(false);
  const [want, setWant] = useState(null);
  const [folders, setFolders] = useState(null); // null = not read yet; else the granted folders (S5.10)

  const parsed = caps?.parsedOptions ?? { model: null, effort: null, fast: null, others: [] };
  const modes = caps?.modes ?? null;
  const modeList = modeOptions(modes);
  const connecting = !modeList.length && !parsed.model && !parsed.effort && !parsed.fast;
  const ctxMeter = contextMeter(usage);
  const limit = limitMeter(usage, (t) => {
    const ms = t > 1e11 ? t : t * 1000;
    try {
      return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return null;
    }
  });
  const terminalHere = canOpenInTerminal(ctx);

  // The session behind this chat — read when the fold opens (a chat that never reached Claude has none).
  useEffect(() => {
    if (!open || !active || !chatId) return undefined;
    let live = true;
    fetchImpl(`/_api/acp/chat/session?id=${encodeURIComponent(chatId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => {
        if (live)
          setSessionId(typeof b?.sessionId === 'string' && b.sessionId ? b.sessionId : null);
      })
      .catch(() => live && setSessionId(null));
    return () => {
      live = false;
    };
  }, [open, active, chatId, fetchImpl]);

  const readFolders = useCallback(async () => {
    try {
      const r = await fetchImpl('/_api/ai/attach/folders');
      const b = r.ok ? await r.json() : null;
      setFolders(Array.isArray(b?.folders) ? b.folders : []);
    } catch {
      setFolders([]);
    }
  }, [fetchImpl]);
  useEffect(() => {
    if (open && active) readFolders();
  }, [open, active, readFolders]);
  // Reset: the consent is taken back, for every chat (the route detaches it everywhere); the list is read again.
  const resetFolders = useCallback(async () => {
    for (const f of folders ?? []) {
      try {
        await fetchImpl('/_api/ai/attach/folder/revoke', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ root: f.root }),
        });
      } catch {
        /* the list below says what is still granted */
      }
    }
    await readFolders();
  }, [folders, fetchImpl, readFolders]);

  const doTerminal = useCallback(async () => {
    setTermNote('');
    const r = await openTerminal({ ctx, chatId, fetchImpl });
    if (r.ok) return;
    setTermNote(
      r.reason === 'desktop-only'
        ? 'Open in terminal is in the Maude desktop app.'
        : r.reason === 'no-session'
          ? 'Nothing to continue yet. Send a message first.'
          : "Couldn't open Terminal."
    );
  }, [openTerminal, ctx, chatId, fetchImpl]);

  // ⌘K "AI chat panel › Advanced …": take the row. Parked requests cover a panel that was not mounted yet.
  useEffect(() => {
    const on = (e) => {
      if (!active) return;
      const parked = takeParkedRow(); // clear it either way: a request is taken once
      setWant(e?.detail?.row ?? parked);
    };
    if (active) {
      const parked = takeParkedRow();
      if (parked) setWant(parked);
    }
    window.addEventListener(ADVANCED_ROW_EVENT, on);
    return () => window.removeEventListener(ADVANCED_ROW_EVENT, on);
  }, [active]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `doTerminal` is stable enough; the row is taken once
  useEffect(() => {
    if (!want || !open || !active) return undefined;
    const id = requestAnimationFrame(() => {
      const root = rootRef.current;
      if (want === 'terminal') {
        doTerminal();
      } else if (want === 'raw-log') {
        setRawOpen(true);
      }
      const el =
        want === 'raw-log'
          ? root?.querySelector(`#${rowDomId('raw-log')}`)
          : root?.querySelector(`#${rowDomId(want)}`);
      el?.scrollIntoView?.({ block: 'nearest' });
      el?.focus?.({ preventScroll: true });
      setWant(null);
    });
    return () => cancelAnimationFrame(id);
  }, [want, open, active]);

  const copy = async () => {
    await onCopyTranscript?.(chatId);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div ref={rootRef} className="ai-adv" data-testid="ai-advanced-root">
      <AdvancedFold
        panel={AI_FOLD_PANEL}
        testid="ai-advanced-fold"
        buttonTestid="ai-advanced"
        open={open}
        onToggle={() => setOpen((v) => !v)}
        classes={{
          root: 'ai-adv-fold',
          btn: 'ai-adv-btn',
          ch: 'ai-adv-ch',
          hint: 'ai-adv-hintbtn',
          body: 'ai-adv-body',
        }}
      >
        <div className="ai-adv-rows" data-testid={connecting ? undefined : 'chat-caps-bar'}>
          {connecting ? (
            <p className="ai-adv-hint ai-adv-hint--row" data-testid="chat-caps-connecting">
              Connecting…
            </p>
          ) : null}
          {modeList.length ? (
            <Row row="ask-before" label="Ask before">
              <select
                id={rowDomId('ask-before')}
                className="ai-adv-select"
                data-adv-control
                data-testid="chat-mode-picker"
                value={modes?.currentModeId ?? ''}
                title={
                  modeList.find((m) => m.id === modes?.currentModeId)?.description || 'Ask before'
                }
                onChange={(e) => onSetMode(e.target.value)}
              >
                {['asks', 'nochange', 'free'].map((g) => {
                  const list = modeList.filter((m) => m.group === g);
                  if (!list.length) return null;
                  const options = list.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ));
                  return MODE_GROUP_LABEL[g] ? (
                    <optgroup key={g} label={MODE_GROUP_LABEL[g]}>
                      {options}
                    </optgroup>
                  ) : (
                    options
                  );
                })}
              </select>
              <span className="ai-adv-val" title="The agent's own name for this mode">
                {currentModeNote(modes)}
              </span>
            </Row>
          ) : null}
          {parsed.model ? (
            <OptionSelect row="model" label="Model" opt={parsed.model} onChange={onSetConfig} />
          ) : null}
          {parsed.effort ? (
            <OptionSelect row="effort" label="Effort" opt={parsed.effort} onChange={onSetConfig} />
          ) : null}
          {parsed.fast ? (
            <OptionSelect row="fast" label="Fast mode" opt={parsed.fast} onChange={onSetConfig} />
          ) : null}

          <Row row="show-in-chat" label="Show in chat">
            <select
              id={rowDomId('show-in-chat')}
              className="ai-adv-select"
              data-adv-control
              data-testid="chat-transcript-menu"
              aria-label="Transcript view"
              title="Transcript view — how much detail replies show"
              value={transcriptView}
              onChange={(e) => onSetTranscriptView(e.target.value)}
            >
              {TRANSCRIPT_VIEWS.map((v) => (
                <option key={v} value={v}>
                  {viewLabel(v)}
                </option>
              ))}
            </select>
          </Row>
          <Row row="suggestions" label="Suggestions">
            <select
              id={rowDomId('suggestions')}
              className="ai-adv-select"
              data-adv-control
              data-testid="ai-adv-suggestions"
              value={suggestOn ? 'on' : 'off'}
              onChange={(e) => onSetSuggestOn(e.target.value === 'on')}
            >
              <option value="on">On</option>
              <option value="off">Off</option>
            </select>
          </Row>

          <p className="ai-adv-sub">AI may</p>
          <div className="ai-adv-row" data-adv-row="folders">
            <span className="ai-adv-k">Folders AI may read</span>
            <span className="ai-adv-val" data-testid="ai-adv-folders">
              {folders?.length ? foldersLine(folders) : 'None'}
            </span>
            {folders?.length ? (
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                data-testid="ai-adv-folders-reset"
                onClick={resetFolders}
              >
                Reset
              </button>
            ) : null}
          </div>

          {parsed.others?.some((o) => flattenSelectOptions(o.options).length) ? (
            <>
              <p className="ai-adv-sub">From the agent</p>
              {parsed.others.map((o) => (
                <OptionSelect
                  key={o.id}
                  row={`agent-${String(o.id).replace(/[^A-Za-z0-9_-]/g, '-')}`}
                  label={o.name || o.id}
                  opt={o}
                  onChange={onSetConfig}
                />
              ))}
              <span className="ai-adv-hint">
                Options the agent adds show up here by themselves.
              </span>
            </>
          ) : null}

          <p className="ai-adv-sub">This chat</p>
          {ctxMeter ? (
            <div className="ai-adv-row" data-adv-row="context">
              <span className="ai-adv-k">Context used</span>
              <span className="ai-meter">
                <span
                  className="ai-bar"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={ctxMeter.pct}
                  aria-label="Context used"
                >
                  <i style={{ width: `${ctxMeter.pct}%` }} />
                </span>
                <b data-testid="ai-adv-context-pct">{ctxMeter.label}</b>
                <ChatFootInfo usage={usage} modes={modes} />
              </span>
            </div>
          ) : (
            <div className="ai-adv-row" data-adv-row="context">
              <span className="ai-adv-k">Context used</span>
              <span className="ai-adv-val">After the first reply</span>
              <ChatFootInfo usage={usage} modes={modes} />
            </div>
          )}
          {limit ? (
            <div className="ai-adv-row" data-adv-row="limit">
              <span className="ai-adv-k">{limit.name}</span>
              <span className="ai-meter">
                <span
                  className="ai-bar"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={limit.pct ?? 0}
                  aria-label={limit.name}
                >
                  <i style={{ width: `${limit.pct ?? 0}%` }} />
                </span>
                <b>{limit.label}</b>
              </span>
            </div>
          ) : null}
          <div className="ai-adv-row" data-adv-row="session">
            <span className="ai-adv-k">Session</span>
            <span className="ai-adv-mono" data-testid="ai-adv-session">
              {sessionId ?? 'Starts with your first message'}
            </span>
          </div>

          <div className="ai-adv-acts">
            <button
              type="button"
              id={rowDomId('raw-log')}
              className="btn btn--sm"
              data-adv-control
              data-testid="ai-adv-raw-log"
              aria-expanded={rawOpen}
              onClick={() => setRawOpen((v) => !v)}
            >
              Raw log
            </button>
            <button
              type="button"
              className="btn btn--sm"
              data-testid="ai-adv-copy-transcript"
              onClick={copy}
            >
              {copied ? 'Copied' : 'Copy transcript'}
            </button>
            {terminalHere ? (
              <button
                type="button"
                id={rowDomId('terminal')}
                className="btn btn--sm"
                data-adv-control
                data-testid="ai-adv-open-terminal"
                onClick={doTerminal}
              >
                Open in terminal
              </button>
            ) : null}
          </div>
          {termNote ? (
            <p className="ai-adv-hint ai-adv-hint--row" role="status">
              {termNote}
            </p>
          ) : null}
          {terminalHere ? (
            <p className="ai-adv-foot">
              Open in terminal continues this exact chat in Claude Code — same session, same
              history. /design:chat in a terminal does the reverse.
            </p>
          ) : null}
          {rawOpen ? <RawLogView chatTitle={chatTitle} /> : null}
        </div>
      </AdvancedFold>
    </div>
  );
}
