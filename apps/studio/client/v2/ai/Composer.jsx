// v2/ai/Composer.jsx — the AI chat's composer: slash menu, highlighted input, send, foot info, the
// rate-limit banner (moved from ChatPanel.jsx, S5.8; behaviour unchanged except where marked S5.8).

import {
  ComposerPrimitive,
  ThreadPrimitive,
  useComposer,
  useComposerRuntime,
  useThread,
} from '@assistant-ui/react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  buildCommandModel,
  filterCommands,
  trimmedCommands,
  matchLeadingCommand,
  normalizeName,
  STATIC_COMMANDS,
} from '../../panels/slash-commands.js';
import { Spark } from './icons.jsx';
import {
  chipNodes,
  classifyPaste,
  clipboardImageFile,
  insertChipAtCaret,
  nextChipIndex,
  uploadChatImage,
} from './paste-chips.jsx';
import { AttachChips } from './AChip.jsx';
import { AttachMenu } from './AttachMenu.jsx';
import { Consent } from './Consent.jsx';
import { ScopeChip } from './ScopeChip.jsx';
import { useAskAI } from './use-ask-ai.js';
import { useAskSelection } from './use-ask-selection.js';

export function prettyCanvas(path) {
  if (!path) return null;
  const file = path.split('/').pop() || path;
  return file.replace(/\.(tsx|html)$/i, '');
}

// Composer footer note (Task B3) — tells the user whether the CURRENT mode
// will interrupt them for a permission decision. `bypassPermissions`/
// `dontAsk` never call requestPermission at all (adapter short-circuits); every
// other mode does. Sourced from the mode's own id — never a hardcoded label
// beyond this yes/no framing, since the mode SET itself is fully dynamic.
const NO_PROMPT_MODE_IDS = new Set(['bypassPermissions', 'dontAsk']);
function modeFootnote(modes) {
  if (!modes?.currentModeId || !modes.availableModes?.length) return null;
  const current = modes.availableModes.find((m) => m.id === modes.currentModeId);
  const name = current?.name || modes.currentModeId;
  return NO_PROMPT_MODE_IDS.has(modes.currentModeId)
    ? `${name} — no prompts`
    : `${name} — you'll be asked`;
}

function formatResetTime(resetsAt) {
  if (!resetsAt) return null;
  const ms = resetsAt > 1e11 ? resetsAt : resetsAt * 1000;
  try {
    return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return null;
  }
}

// Composer footer info (Task D3, revised repeatedly after dogfooding — the
// keyboard hint + context gauge + mode footnote + subscription note first
// sat inline in `.chat-foot` and wrapped into an unreadable mess, then moved
// behind this info icon. The icon itself later moved INTO `.chat-toolbar`
// (inside `.chat-box`, which clips its content with `overflow: hidden` for
// the rounded-corner focus ring) — a plain `position: absolute` popover
// anchored to the icon got clipped by that box, rendering squashed inside
// the textarea instead of floating above the whole composer. Fixed
// positioning computed from the button's own rect escapes that clip (fixed
// is relative to the viewport, not an ancestor's overflow, unless an
// ancestor establishes its own containing block via transform/filter —
// none of `.chat-box`/`.chat-composer`/`.chat-thread` do). Context is
// PER-CHAT (this session's own window); cost is cumulative for this
// session only — labeled accordingly so it doesn't read as an
// account-wide total.
export function ChatFootInfo({ usage, modes }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const rootRef = useRef(null);
  const btnRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const place = () => {
      const r = btnRef.current?.getBoundingClientRect();
      if (r) setPos({ bottom: window.innerHeight - r.top + 8, right: window.innerWidth - r.right });
    };
    place();
    const onPointerDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', place);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', place);
    };
  }, [open]);

  const context = usage.context;
  const footnote = modeFootnote(modes);
  // `asOf` is our OWN Date.now() ms timestamp (acp-usage.js) — unambiguous,
  // unlike SDKRateLimitInfo's resetsAt (see formatResetTime's doc comment).
  const timeLabel = usage.asOf
    ? new Date(usage.asOf).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null;
  // Genuine Pro/Max subscription-plan context — the adapter forwards a THIN,
  // event-driven single-window signal (SDKRateLimitInfo, only fires near a
  // real limit event); the rich Claude-Desktop-style multi-window panel
  // (5h + weekly + per-model, live at rest) isn't reachable — its SDK method
  // is explicitly marked experimental and the pinned adapter never calls it
  // (see the Milestone D research in the ACP capabilities plan). Show what's
  // real; don't fabricate the rest.
  const rateLimitResetLabel = usage.rateLimit ? formatResetTime(usage.rateLimit.resetsAt) : null;

  return (
    <div className="chat-foot-info" ref={rootRef}>
      <button
        ref={btnRef}
        type="button"
        className="chat-foot-info-btn"
        aria-label="Chat info"
        aria-expanded={open}
        title="Chat info"
        data-testid="chat-foot-info-btn"
        onClick={() => setOpen((v) => !v)}
      >
        ⓘ
      </button>
      {open && pos ? (
        <div
          className="chat-foot-popover"
          role="dialog"
          aria-label="Chat info"
          data-testid="chat-foot-popover"
          style={{ bottom: pos.bottom, right: pos.right }}
        >
          {context ? (
            <div className="chat-foot-popover-section">
              <div className="chat-foot-popover-label-row">
                <span>Context</span>
                <span>{context.pct}%</span>
              </div>
              <span className="chat-usage-bar chat-usage-bar--wide" aria-hidden="true">
                <span className="chat-usage-bar-fill" style={{ width: `${context.pct}%` }} />
              </span>
              <div className="chat-foot-popover-row--muted">
                {context.used.toLocaleString()} / {context.size.toLocaleString()} tokens
              </div>
            </div>
          ) : null}
          {usage.rateLimit ? (
            <>
              <div className="chat-foot-popover-sep" />
              <div className="chat-foot-popover-label-row">
                <span>{usage.rateLimit.label}</span>
                <span>{usage.rateLimit.pct != null ? `${usage.rateLimit.pct}%` : '—'}</span>
              </div>
              {rateLimitResetLabel ? (
                <div className="chat-foot-popover-row--muted">resets {rateLimitResetLabel}</div>
              ) : null}
            </>
          ) : null}
          {footnote ? (
            <>
              <div className="chat-foot-popover-sep" />
              <div className="chat-foot-popover-row">{footnote}</div>
            </>
          ) : null}
          <div className="chat-foot-popover-sep" />
          <div className="chat-foot-popover-foot">
            <div className="chat-foot-popover-row--muted">↵ to send · ⇧↵ newline</div>
            <div className="chat-foot-popover-row--muted">
              Uses your Claude subscription{timeLabel ? ` · updated ${timeLabel}` : ''}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// Event-driven single-window rate-limit banner (Task D3) — only the ONE
// active window `SDKRateLimitInfo` carries; NOT the full multi-window "Plan
// usage limits" panel (out of scope — see the plan's Milestone D research).
// Dismissible per reset window (re-appears once a NEW window starts warning).
export function RateLimitBanner({ rateLimit, onDismiss }) {
  if (!rateLimit) return null;
  const resetLabel = formatResetTime(rateLimit.resetsAt);
  return (
    <div className="chat-usage-banner" role="status" data-testid="chat-usage-banner">
      <span>
        You're at {rateLimit.pct != null ? `${rateLimit.pct}%` : 'high usage'} of your{' '}
        {rateLimit.label}
        {resetLabel ? ` · resets ${resetLabel}` : ''}
      </span>
      <button
        type="button"
        className="chat-usage-banner-x"
        aria-label="Dismiss"
        title="Dismiss"
        onClick={onDismiss}
      >
        ×
      </button>
    </div>
  );
}

// Merge the static bootstrap list with the live ACP catalogue (pushed over the
// connection). Returns `{ all, existsSet }` — see slash-commands.js.
export function useSlashCommands(conn) {
  const [live, setLive] = useState([]);
  useEffect(() => conn.onCommands(setLive), [conn]);
  return useMemo(() => buildCommandModel(STATIC_COMMANDS, live), [live]);
}

// Autocomplete menu — opens upward above the composer while a slash command is
// being typed. Keyboard-driven from the composer (see Composer); mouse hover +
// click supported. onMouseDown (not onClick) so picking beats the textarea blur.
// S5.18 G8 (03 `ai-adv-edges`): a "Slash commands" group, one-line notes, no argument hints; "More…" opens the rest.
export function CommandPopover({ items, activeIndex, onPick, onHover }) {
  const ref = useRef(null);
  const [place, setPlace] = useState(null);
  // Fixed, from the composer's own rectangle: the dock slot clips whatever hangs above a short (new) chat, and
  // the menu was cut to one row there (03 `ai-adv-edges` draws all three).
  useLayoutEffect(() => {
    const el = ref.current;
    const anchor = el?.parentElement;
    if (!el || !anchor) return;
    const a = anchor.getBoundingClientRect();
    if (!a.width) return;
    setPlace({
      position: 'fixed',
      left: Math.round(a.left),
      width: Math.round(a.width),
      right: 'auto',
      bottom: Math.round(window.innerHeight - a.top + 4),
    });
  }, [items]);
  if (!items.length) return null;
  return (
    <div
      ref={ref}
      className="chat-cmd-menu"
      role="listbox"
      aria-label="Slash commands"
      data-testid="chat-cmd-menu"
      style={place ?? undefined}
    >
      <div className="chat-cmd-group" role="presentation">
        Slash commands
      </div>
      {items.map((c, i) =>
        c.more ? (
          <button
            key="__more"
            type="button"
            role="option"
            aria-selected={i === activeIndex}
            data-testid="chat-cmd-more"
            className={`chat-cmd-item chat-cmd-item--more${i === activeIndex ? ' is-active' : ''}`}
            onMouseEnter={() => onHover(i)}
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(c);
            }}
          >
            <span className="chat-cmd-name">More…</span>
            <span className="chat-cmd-desc">{c.note}</span>
          </button>
        ) : (
          <button
            key={c.name}
            type="button"
            role="option"
            aria-selected={i === activeIndex}
            data-testid={`chat-cmd-item-${c.name.replace(/[^a-z0-9]+/gi, '-')}`}
            className={`chat-cmd-item${i === activeIndex ? ' is-active' : ''}`}
            onMouseEnter={() => onHover(i)}
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(c);
            }}
          >
            <span className={`chat-cmd-name chat-cmd-name--${c.group}`}>/{c.name}</span>
            {c.note ? <span className="chat-cmd-desc">{c.note}</span> : null}
          </button>
        )
      )}
    </div>
  );
}

// Inline command highlight via a mirror-overlay: a div behind a transparent-text
// textarea renders the same text, wrapping the leading command token in a pill —
// but ONLY when that token is a command that exists (the badge gate). The mirror
// MUST match the textarea's box model exactly (see .chat-input / .chat-input-mirror
// in v2/ai/chat.css) or the pill drifts off the text.
function HighlightedInput({ existsSet, attachmentsRef, onAttachChange, attach, multi, onMulti }) {
  const text = useComposer((c) => c.text);
  const mirrorRef = useRef(null);
  const wrapRef = useRef(null);
  const flipAt = useRef(0);

  // P8-C6 (03 `ai-ask--multi`): the field is one row until the words need a second line; then they wrap ABOVE
  // the row (paperclip · chip · send). Measured on the textarea itself (it grows with its content). Going back to
  // one row needs the text to be shorter than it was when it flipped, or it would flip every keystroke.
  useLayoutEffect(() => {
    const ta = wrapRef.current?.querySelector('textarea');
    if (!ta) return;
    const cs = getComputedStyle(ta);
    const line = Number.parseFloat(cs.lineHeight) || 16;
    const pad =
      (Number.parseFloat(cs.paddingTop) || 0) + (Number.parseFloat(cs.paddingBottom) || 0);
    const wrapped = text.length > 0 && (text.includes('\n') || ta.scrollHeight > line + pad + 3);
    if (!multi && wrapped) {
      flipAt.current = text.length;
      onMulti?.(true);
    } else if (multi && (text.length === 0 || (!wrapped && text.length < flipAt.current - 2))) {
      onMulti?.(false);
    }
  }, [text, multi, onMulti]);
  const match = matchLeadingCommand(text);
  const token = match ? normalizeName(match.token) : '';
  const highlight = !!(match && token && existsSet.has(token));

  // Build the mirror: an optional leading command pill, then the remainder with
  // any [image|file|link-N] tokens wrapped as chips. Both wrappers preserve the
  // exact glyphs so the transparent-text textarea's caret stays aligned.
  let head = null;
  let bodyStart = 0;
  if (highlight) {
    const leadingWs = text.match(/^\s*/)[0];
    const cmd = `/${match.token}`;
    head = (
      <>
        {leadingWs}
        <span className="chat-cmd-pill">{cmd}</span>
      </>
    );
    bodyStart = leadingWs.length + cmd.length;
  }
  const body = text.slice(bodyStart);
  // Trailing newline needs a zero-width guard so the mirror keeps the last line.
  const guard = text.endsWith('\n') ? '​' : '';

  // Collapse a pasted attachment into a chip token at the caret and stash its real
  // value in the map so the adapter expands it on send. Two sources:
  //  1) a raw clipboard image (screenshot) — insert the chip synchronously, upload
  //     the bytes in the background, and fill the map when the path comes back. The
  //     in-flight promise is tracked so send can await it (no literal [image-N] if
  //     the user hits Enter before the upload lands).
  //  2) a lone path / URL as text — resolved synchronously.
  const onPaste = useCallback(
    (e) => {
      const cd = e.clipboardData;
      const ta = e.currentTarget;
      const { map, pending } = attachmentsRef.current;

      const img = clipboardImageFile(cd);
      // S5.10 — ⌘V a screenshot = a photo chip, the same door as a drop (it lands in Assets too).
      if (img && attach) {
        e.preventDefault();
        attach.addFiles([img]);
        return;
      }
      if (img) {
        e.preventDefault();
        const chip = `[image-${nextChipIndex(ta.value, 'image')}]`;
        map.set(chip, null); // pending — expandPasteChips leaves it literal until resolved
        insertChipAtCaret(ta, chip);
        onAttachChange?.();
        const p = uploadChatImage(img)
          .then((path) => {
            if (path) map.set(chip, path);
            else map.delete(chip);
          })
          .catch(() => map.delete(chip))
          .finally(() => {
            pending.delete(p);
            onAttachChange?.();
          });
        pending.add(p);
        return;
      }

      const cls = classifyPaste(cd?.getData('text/plain'));
      if (!cls) return; // ordinary paste — let assistant-ui handle it
      e.preventDefault();
      const chip = `[${cls.kind}-${nextChipIndex(ta.value, cls.kind)}]`;
      map.set(chip, cls.value);
      insertChipAtCaret(ta, chip);
      onAttachChange?.();
    },
    [attachmentsRef, onAttachChange, attach]
  );

  return (
    <div className="chat-input-wrap" ref={wrapRef}>
      <div className="chat-input-mirror" aria-hidden="true" ref={mirrorRef}>
        {head}
        {chipNodes(body)}
        {guard}
      </div>
      <ComposerPrimitive.Input
        className="chat-input chat-input--overlay"
        submitMode="enter"
        placeholder="Ask AI…"
        aria-label="Message to AI"
        onPaste={onPaste}
        onScroll={(e) => {
          if (mirrorRef.current) mirrorRef.current.scrollTop = e.currentTarget.scrollTop;
        }}
      />
    </div>
  );
}

export function Composer({
  activeCanvas,
  scope,
  artboards,
  activeArtboardId,
  stale = false,
  onChooseScope,
  onCtxDismiss,
  above = null,
  picksRef,
  conn,
  chatId,
  attachmentsRef,
  attach = null,
  usage,
  showRateLimitBanner,
  onDismissRateLimitBanner,
  active = true,
  unavailable = false,
  viewer = false,
}) {
  const { all, existsSet } = useSlashCommands(conn);
  const composerRuntime = useComposerRuntime();
  const running = useThread((t) => t.isRunning);
  const text = useComposer((c) => c.text);

  const match = matchLeadingCommand(text);
  const [dismissed, setDismissed] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const menuOpen = !!(match && match.typing) && !dismissed;

  // Attachment reveal (security — DDR-140): a chip collapses a pasted path/URL to
  // an opaque badge, and the real value is what gets sent to the auto-approving
  // agent. So the composer MUST show what each chip will expand to BEFORE send —
  // otherwise a value the user can't see (e.g. one an untrusted canvas seeded onto
  // the clipboard) rides into the prompt invisibly. `attachTick` re-renders the
  // strip when an async image upload fills its map entry.
  const [attachTick, setAttachTick] = useState(0);
  const bumpAttach = useCallback(() => setAttachTick((t) => t + 1), []);
  const chipList = useMemo(() => {
    const map = attachmentsRef.current.map;
    const seen = new Set();
    const out = [];
    for (const m of text.matchAll(/\[(?:image|file|link)-\d+\]/g)) {
      if (seen.has(m[0])) continue;
      seen.add(m[0]);
      out.push({ token: m[0], value: map.get(m[0]) ?? null });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, attachTick, attachmentsRef]);
  // S5.18 G8: the short list; "More…" (or just typing) reaches every command
  const [moreOpen, setMoreOpen] = useState(false);
  const [multi, setMulti] = useState(false); // P8-C6: the words wrap above the row
  const items = useMemo(() => {
    if (!menuOpen) return [];
    const { items: rows, more } = trimmedCommands(all, match.token, { expanded: moreOpen });
    return more > 0
      ? [...rows, { more: true, name: '', note: `${more} more`, group: 'other' }]
      : rows;
  }, [menuOpen, all, match?.token, moreOpen]);

  // Reset selection + un-dismiss whenever the typed token changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setActiveIndex(0);
    setDismissed(false);
    setMoreOpen(false);
  }, [match?.token]);

  // Warm the adapter the first time the user starts a slash command, so the live
  // catalogue arrives without a full prompt. Guarded to fire once per mount.
  // model/effort/mode are the user's PERSISTED picks (read live off the ref so
  // this effect doesn't need to re-run when they change) — applied once, live,
  // by the bridge right after the session establishes.
  const warmedRef = useRef(false);
  useEffect(() => {
    if (menuOpen && !warmedRef.current) {
      warmedRef.current = true;
      const p = picksRef.current;
      conn.warm(chatId, p.model, p.effort, p.mode);
    }
  }, [menuOpen, conn, chatId, picksRef]);

  // V2-4.6 — ⌘K "Ask AI": the query lands in the composer; the person still sends it. S10.16c: the DS hosts'
  // `askAI(text, { send: true, origin: 'ds-…' })` is the one ask that also sends (use-ask-ai.js; this file never does).
  useAskAI({ composerRuntime, active, unavailable, viewer, running });

  // S2.19 — ⌘/ on a selection (AskSelectionHost): the bubble's words + an `elements` scope; the send is in the hook
  // (this file never sends — the ⌘K contract above).
  useAskSelection({ composerRuntime, scope, onChooseScope });

  const pick = useCallback(
    (cmd) => {
      if (cmd.more) {
        setMoreOpen(true);
        setActiveIndex(0);
        return;
      }
      composerRuntime.setText(`/${cmd.name} `);
      setDismissed(false);
      setActiveIndex(0);
    },
    [composerRuntime]
  );

  const onKeyDownCapture = useCallback(
    (e) => {
      if (!menuOpen || !items.length) return;
      // Swallow navigation keys before they reach the textarea (capture phase +
      // stopPropagation) so the menu drives them, not the caret / submit.
      const swallow = () => {
        e.preventDefault();
        e.stopPropagation();
      };
      if (e.key === 'ArrowDown') {
        swallow();
        setActiveIndex((i) => (i + 1) % items.length);
      } else if (e.key === 'ArrowUp') {
        swallow();
        setActiveIndex((i) => (i - 1 + items.length) % items.length);
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        swallow();
        pick(items[Math.min(activeIndex, items.length - 1)]);
      } else if (e.key === 'Escape') {
        swallow();
        setDismissed(true);
      }
    },
    [menuOpen, items, activeIndex, pick]
  );

  return (
    <div className="chat-composer" data-testid="chat-composer">
      <ThreadPrimitive.If running={false}>
        {showRateLimitBanner ? (
          <RateLimitBanner rateLimit={usage.rateLimit} onDismiss={onDismissRateLimitBanner} />
        ) : null}
        {/* S5.8 — the suggestion strip (03 `ai-suggest`) sits above the field. */}
        {above}
      </ThreadPrimitive.If>
      {/* S5.10 — a folder from disk asks once, above the prompt. */}
      {attach?.consent ? (
        <Consent consent={attach.consent} onAllow={attach.allowFolder} onNotNow={attach.notNow} />
      ) : null}
      {/* P8-C6 (03 `.ask.ai-ask`, rule R3): ONE field, and it stays while AI works — typing the next ask ahead
          is fine; Send waits for the turn (the working line above carries Stop). The row is
          📎 · ◆ scope chip · text · send, the chip INSIDE the field (kit `.k-selchip`), attachments on top.
          The anchor is relative so the command popover can float above it. */}
      <div className="chat-cmd-anchor" onKeyDownCapture={onKeyDownCapture}>
        {menuOpen ? (
          <CommandPopover
            items={items}
            activeIndex={activeIndex}
            onPick={pick}
            onHover={setActiveIndex}
          />
        ) : null}
        <ComposerPrimitive.Root
          className={`chat-box${multi ? ' chat-box--multi' : ''}`}
          data-testid="chat-box"
        >
          {/* S5.10 — what you attach sits inside the prompt, on top. */}
          <AttachChips attach={attach} />
          {attach ? <AttachMenu attach={attach} /> : null}
          {/* S5.8 — the scope chip (03 `ai-scope`): what AI touches, and the v1 context chip with its
              removable × (DDR-140 reveal: the chip text is the `[maude-scope …]` line the send carries). */}
          {activeCanvas ? (
            <ScopeChip
              scope={scope}
              artboards={artboards}
              activeArtboardId={activeArtboardId}
              stale={stale}
              onChoose={onChooseScope}
              onRemove={onCtxDismiss}
            />
          ) : null}
          <HighlightedInput
            existsSet={existsSet}
            attachmentsRef={attachmentsRef}
            onAttachChange={bumpAttach}
            attach={attach}
            multi={multi}
            onMulti={setMulti}
          />
          {/* S5.12 — the model / effort / mode pickers and the info button moved to the panel's
              Advanced fold (Advanced.jsx); the field keeps only what 03 draws: the text and send
              (+ S5.10's paperclip). */}
          <ComposerPrimitive.Send className="chat-send" aria-label="Send message">
            <Spark size={12} />
          </ComposerPrimitive.Send>
        </ComposerPrimitive.Root>
      </div>
      <ThreadPrimitive.If running={false}>
        {chipList.length ? (
          <div className="chat-attach" role="list" aria-label="Attachments — expands on send">
            {chipList.map((c) => (
              <div className="chat-attach-row" role="listitem" key={c.token}>
                <span className="chat-attach-tok">{c.token}</span>
                <span className="chat-attach-arrow" aria-hidden="true">
                  →
                </span>
                <span className="chat-attach-val" title={c.value || undefined}>
                  {c.value || 'attaching…'}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </ThreadPrimitive.If>
      <ThreadPrimitive.If running>
        <div className="chat-stopbar">
          <span className="chat-stop-meta">
            <span className="chat-status-dot chat-status-dot--working" />
            Working…
          </span>
          <span className="chat-foot-spacer" />
          <ComposerPrimitive.Cancel className="btn btn--danger" aria-label="Stop">
            Stop
          </ComposerPrimitive.Cancel>
        </div>
      </ThreadPrimitive.If>
    </div>
  );
}
