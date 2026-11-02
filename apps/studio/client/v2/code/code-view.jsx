// client/v2/code/code-view.jsx — S11.7 (06 `ad-code`): the canvas as code, read-only.
//
// A panel over the canvas — "View code" from ⌘K or the Canvases row menu. It shows the TSX of the open
// canvas with the SELECTED artboard's lines marked (the server's source map, S11.6, names them — nothing
// here guesses), and four things a developer reaches for: Copy, Open in editor (the desktop app only —
// a browser tab has no editor to open, so the button is not drawn), a close, and — under Advanced — the
// `maude design …` and Claude Code commands for THIS canvas.
//
// READ ONLY, and it looks it: a lock chip says so, there is no field, no caret, no cursor. Editing code
// happens in the person's editor or through the AI; the studio never writes back from here. Mono type
// lives only inside this panel (the path, the code, the commands) — the words around it are the app's.
//
// Can view never gets here: the server refuses the source to them (Export on the canvas), and the shell
// does not offer "View code" (`mayViewCode`). Should a stale request arrive anyway, the panel says what
// the server said. The source is untrusted text: lines are React text nodes, never HTML.

import { useEffect, useMemo, useRef, useState } from 'react';
import { StIcon } from '../../shell/icons.jsx';
import { Check, Copy } from '../ai/icons.jsx';
import { AdvancedFold } from '../fold/advanced-fold.jsx';
import { projectRel } from '../shell/native-doors.js';
import { highlightLines } from './highlight.js';
import {
  canvasTitle,
  foldCommands,
  MAX_RENDER_LINES,
  rangeFor,
  useCanvasSource,
} from './use-canvas-source.js';

/** Roles that do not get the code: Can view (the cloud names it `viewer`, the registry `view`). */
export function mayViewCode(role) {
  return !(role === 'view' || role === 'viewer' || role === 'observer');
}

async function writeClipboard(text, nav = globalThis.navigator) {
  try {
    await nav.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function CopyBtn({ text, label, onCopy, testid, className = 'btn btn--sm', ariaLabel }) {
  const [done, setDone] = useState(false);
  const run = async () => {
    const ok = await (onCopy ?? writeClipboard)(text);
    if (ok === false) return;
    setDone(true);
    setTimeout(() => setDone(false), 1500);
  };
  return (
    <button
      type="button"
      className={className}
      data-testid={testid}
      aria-label={ariaLabel}
      onClick={run}
    >
      {done ? <Check size={12} /> : <Copy size={12} />}
      {label ? (done ? 'Copied' : label) : null}
    </button>
  );
}

function Cmd({ text, onCopy }) {
  return (
    <div className="v2-code-cmd">
      <code className="v2-code-cmd-t">{text}</code>
      <CopyBtn
        text={text}
        onCopy={onCopy}
        className="icon-btn v2-code-cmd-copy"
        ariaLabel={`Copy command: ${text}`}
        testid="code-view-copy-command"
      />
    </div>
  );
}

/**
 * @param canvas      design-root-relative canvas path (`ui/Pricing.tsx`)
 * @param designRel   the design root relative to the project (`.design`) — for the editor door
 * @param artboardId  the selected artboard (its lines are marked), or null
 * @param doors       `nativeDoors()` — `available` false in a browser tab (no Open in editor)
 * @param stamp       changes when the file changes (refetch)
 */
export function CodeView({
  canvas,
  designRel = '.design',
  artboardId = null,
  doors = null,
  onClose,
  onCopy,
  fetchImpl,
  stamp,
}) {
  const src = useCanvasSource({ canvas, stamp, fetchImpl });
  const rootRef = useRef(null);
  const [door, setDoor] = useState(null);
  const total = src.status === 'ok' ? src.lines.length : 0;
  const rows = useMemo(
    () => (src.status === 'ok' ? highlightLines(src.lines.slice(0, MAX_RENDER_LINES)) : []),
    [src]
  );
  const range = src.status === 'ok' ? rangeFor(src.artboards, artboardId) : null;
  const canOpen = !!doors?.available;
  const title = canvasTitle(canvas);

  // Take focus on open, give it back on close; esc closes.
  useEffect(() => {
    const prev = globalThis.document?.activeElement;
    rootRef.current?.focus?.({ preventScroll: true });
    return () => {
      if (prev && prev !== globalThis.document?.body) prev.focus?.({ preventScroll: true });
    };
  }, []);

  // Bring the marked lines into view once the code is drawn.
  const firstMarked = range ? range.start : null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when the marked range or the file changes
  useEffect(() => {
    if (!firstMarked) return;
    const el = rootRef.current?.querySelector?.(`[data-line="${firstMarked}"]`);
    el?.scrollIntoView?.({ block: 'center' });
  }, [firstMarked, src.status]);

  const openInEditor = async () => {
    const r = await doors.openInEditor(projectRel(designRel, canvas));
    setDoor(r.ok ? null : (r.error ?? "Couldn't open the editor. The file is where it was."));
  };
  const commands = foldCommands(canvas, artboardId);

  return (
    <section
      ref={rootRef}
      className="island v2-code"
      role="dialog"
      aria-label={`Code of ${title}, read only`}
      tabIndex={-1}
      data-testid="code-view"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose?.();
        }
      }}
    >
      <header className="v2-code-hd">
        <StIcon name="file" size={14} />
        <strong className="v2-code-name">{title}</strong>
        <span className="v2-code-path" data-testid="code-view-path">
          {src.status === 'ok' ? src.file : canvas}
        </span>
        <span className="chip v2-code-ro" data-testid="code-view-readonly">
          <StIcon name="lock" size={11} />
          Read only
        </span>
        <span className="v2-code-sp" />
        {src.status === 'ok' ? (
          <CopyBtn text={src.source} label="Copy" onCopy={onCopy} testid="code-view-copy" />
        ) : null}
        {canOpen ? (
          <button
            type="button"
            className="btn btn--sm btn--primary"
            data-testid="code-view-open-editor"
            onClick={openInEditor}
          >
            <StIcon name="external" size={12} />
            Open in editor
          </button>
        ) : null}
        <button
          type="button"
          className="icon-btn"
          aria-label="Close code"
          data-testid="code-view-close"
          onClick={() => onClose?.()}
        >
          <StIcon name="x" size={12} />
        </button>
      </header>
      {door ? (
        <p className="v2-code-note" role="status" data-testid="code-view-door-error">
          {door}
        </p>
      ) : null}
      {range ? (
        <p className="v2-code-note" data-testid="code-view-marked">
          Artboard {artboardId} is marked · lines {range.start}–{range.end}
        </p>
      ) : null}
      <section
        className="v2-code-body"
        data-testid="code-view-body"
        aria-label="Source"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling region must take focus to scroll with the keyboard
        tabIndex={0}
      >
        {src.status === 'loading' ? (
          <p className="v2-code-msg" role="status">
            Opening the code…
          </p>
        ) : null}
        {src.status === 'view-only' || src.status === 'refused' ? (
          <p className="v2-code-msg" data-testid="code-view-refused">
            {src.message || "Can view doesn't include the code. Ask the owner to change this."}
          </p>
        ) : null}
        {src.status === 'missing' ? (
          <p className="v2-code-msg" data-testid="code-view-missing">
            This canvas isn't on this Mac yet.
          </p>
        ) : null}
        {src.status === 'too-large' ? (
          <p className="v2-code-msg">This canvas is too large to show here.</p>
        ) : null}
        {src.status === 'error' ? (
          <p className="v2-code-msg" data-testid="code-view-error">
            The code couldn't be read just now. Close this and open it again.
          </p>
        ) : null}
        {src.status === 'ok'
          ? rows.map((tokens, i) => {
              const n = i + 1;
              const marked = !!range && n >= range.start && n <= range.end;
              return (
                <div
                  key={n}
                  className={`v2-code-line${marked ? ' is-marked' : ''}`}
                  data-line={n}
                  data-marked={marked ? 'true' : undefined}
                >
                  <span className="v2-code-n" aria-hidden="true">
                    {n}
                  </span>
                  <span className="v2-code-c">
                    {tokens.map((tk, j) =>
                      tk.c ? (
                        // biome-ignore lint/suspicious/noArrayIndexKey: tokens are positional
                        <span key={j} className={`v2-code-t-${tk.c}`}>
                          {tk.t}
                        </span>
                      ) : (
                        tk.t
                      )
                    )}
                  </span>
                </div>
              );
            })
          : null}
        {src.status === 'ok' && total > rows.length ? (
          <p className="v2-code-msg" data-testid="code-view-truncated">
            The first {rows.length} lines of {total} are shown. The rest is in the file.
          </p>
        ) : null}
      </section>
      {src.status === 'ok' ? (
        <div className="v2-code-foot">
          <AdvancedFold panel="code" hint="Terminal and Claude Code commands for this canvas">
            <h3 className="v2-code-sub">From the terminal — this canvas</h3>
            {commands.terminal.map((c) => (
              <Cmd key={c} text={c} onCopy={onCopy} />
            ))}
            <h3 className="v2-code-sub">In Claude Code</h3>
            {commands.claude.map((c) => (
              <Cmd key={c} text={c} onCopy={onCopy} />
            ))}
          </AdvancedFold>
        </div>
      ) : null}
    </section>
  );
}
