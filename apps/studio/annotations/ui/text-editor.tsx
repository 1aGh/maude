/**
 * @file       annotations/ui/text-editor.tsx — the one annotation text editor
 * @scope      apps/studio/annotations/ui/text-editor.tsx
 * @purpose    DDR-242 AD7: every text slot (sticky body, standalone text, shape
 *             label, section title, a not-yet-born text) is edited in a plain
 *             `<textarea>` that REPLACES the display block in place, with the
 *             same class and style (text-style.ts). A textarea gives native
 *             IME, caret, selection, word select on double-click, spellcheck
 *             and undo in WKWebView — the contentEditable editors and the
 *             custom caret they needed are gone.
 *
 *             One commit policy for every slot:
 *               Enter commits · Shift+Enter inserts a newline (a single-line
 *               title commits) · ⌘/Ctrl+Enter commits and chains a sibling ·
 *               Esc cancels · blur or a click outside commits · one guard so a
 *               session commits at most once.
 *             While an IME composition is open nothing commits (WebKit sends
 *             `compositionend` BEFORE the Enter keydown that confirms it, with
 *             keyCode 229 — the guard covers both orders).
 */

import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { formatCommands, formatState } from './editor-channel.ts';
import {
  type ListStyle,
  stripListMarkers,
  type TextAlign,
  textDecoration,
  withListMarkers,
} from './text-style.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Pure policy (unit-tested in test/annotations-v2-text.test.ts)

export type KeyAction = 'commit' | 'commit-chain' | 'cancel' | 'none';

export interface KeyInput {
  key: string;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  /** `KeyboardEvent.isComposing` */
  isComposing: boolean;
  keyCode: number;
}

/**
 * Tracks an IME composition. `compositionend` does not end the guard at once:
 * WebKit delivers the Enter that CONFIRMS a candidate after `compositionend`,
 * so the flag clears one macrotask later (`release`, scheduled by the caller).
 */
export class ImeGuard {
  private open = false;
  private tail = false;
  start(): void {
    this.open = true;
    this.tail = false;
  }
  end(): void {
    this.open = false;
    this.tail = true;
  }
  release(): void {
    this.tail = false;
  }
  composing(e: Pick<KeyInput, 'isComposing' | 'keyCode'>): boolean {
    return this.open || this.tail || e.isComposing || e.keyCode === 229;
  }
}

/** What a keydown means to an editor session. Newlines are the textarea's own default. */
export function keyAction(e: KeyInput, composing: boolean, singleLine: boolean): KeyAction {
  if (composing) return 'none';
  if (e.key === 'Escape') return 'cancel';
  if (e.key !== 'Enter') return 'none';
  if (e.shiftKey && !singleLine) return 'none';
  return e.metaKey || e.ctrlKey ? 'commit-chain' : 'commit';
}

/** A session commits at most once, whatever fires (Enter, blur, outside click, unmount). */
export function createCommitGuard<A extends unknown[]>(fn: (...args: A) => void) {
  let done = false;
  return {
    fire(...args: A): boolean {
      if (done) return false;
      done = true;
      fn(...args);
      return true;
    },
    /** Esc — nothing may commit after a cancel. */
    close(): void {
      done = true;
    },
    get done(): boolean {
      return done;
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Formatting while editing (⌘B/I/U + the context toolbar)

export interface EditorFmt {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  fontSize?: number;
  align?: TextAlign;
}

/**
 * Shared inline formatting for the editor. ⌘/Ctrl + B / I / U toggle while
 * editing and preview live via `style`; the edit-mode context toolbar drives
 * the same state and reads it back through editor-channel.ts. The stroke is not touched until commit — a
 * mid-edit store write would re-render the editor under the user's caret.
 */
export function useEditorFormat(initial: EditorFmt): {
  fmtRef: { current: EditorFmt };
  style: CSSProperties;
  onFormatKey: (e: ReactKeyboardEvent) => boolean;
} {
  const [bold, setBold] = useState(!!initial.bold);
  const [italic, setItalic] = useState(!!initial.italic);
  const [underline, setUnderline] = useState(!!initial.underline);
  const [strike, setStrike] = useState(!!initial.strike);
  const [fontSize, setFontSize] = useState<number | undefined>(initial.fontSize);
  const [align, setAlign] = useState<TextAlign | undefined>(initial.align);
  const fmtRef = useRef<EditorFmt>({ bold, italic, underline, strike, fontSize, align });
  fmtRef.current = { bold, italic, underline, strike, fontSize, align };
  const style: CSSProperties = {
    fontWeight: bold ? 700 : undefined,
    fontStyle: italic ? 'italic' : undefined,
    textDecoration: textDecoration(strike, underline),
    ...(fontSize != null && fontSize !== initial.fontSize ? { fontSize: `${fontSize}px` } : {}),
    ...(align && align !== initial.align ? { textAlign: align } : {}),
  };
  useEffect(
    () =>
      formatCommands.listen((d) => {
        if (d.key === 'bold') setBold((v) => !v);
        else if (d.key === 'italic') setItalic((v) => !v);
        else if (d.key === 'underline') setUnderline((v) => !v);
        else if (d.key === 'strike') setStrike((v) => !v);
        else if (d.key === 'fontSize' && typeof d.value === 'number') setFontSize(d.value);
        else if (d.key === 'align' && typeof d.value === 'string') setAlign(d.value as TextAlign);
      }),
    []
  );
  useEffect(() => {
    formatState.publish({ bold, italic, underline, strike, fontSize, align });
  }, [bold, italic, underline, strike, fontSize, align]);
  // The session is over: the toolbar stops mirroring it.
  useEffect(() => () => formatState.publish(null), []);
  const onFormatKey = useCallback((e: ReactKeyboardEvent): boolean => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return false;
    const k = e.key.toLowerCase();
    if (k === 'b') setBold((v) => !v);
    else if (k === 'i') setItalic((v) => !v);
    else if (k === 'u') setUnderline((v) => !v);
    else return false;
    e.preventDefault();
    return true;
  }, []);
  return { fmtRef, style, onFormatKey };
}

// ─────────────────────────────────────────────────────────────────────────────
// Caret at the entry click

/**
 * Character offset under a client point, measured on a throwaway mirror of the
 * textarea (same class, same inline style, same box). A textarea's content is
 * not reachable by `caretRangeFromPoint`, a div with identical metrics is.
 */
export function offsetFromPoint(
  ta: HTMLTextAreaElement,
  clientX: number,
  clientY: number
): number | null {
  const doc = ta.ownerDocument;
  const parent = ta.parentElement;
  if (!doc || !parent) return null;
  const mirror = doc.createElement('div');
  mirror.className = ta.className;
  mirror.style.cssText = ta.style.cssText;
  mirror.style.position = 'absolute';
  mirror.style.left = `${ta.offsetLeft}px`;
  mirror.style.top = `${ta.offsetTop}px`;
  mirror.style.width = `${ta.offsetWidth}px`;
  mirror.style.height = `${ta.offsetHeight}px`;
  mirror.style.zIndex = '2147483647';
  mirror.style.pointerEvents = 'auto';
  mirror.style.visibility = 'visible';
  mirror.style.color = 'transparent';
  // A trailing newline needs a line box to be hit.
  mirror.textContent = ta.value.endsWith('\n') ? `${ta.value} ` : ta.value;
  parent.insertBefore(mirror, ta);
  try {
    type CaretDoc = Document & {
      caretPositionFromPoint?: (
        x: number,
        y: number
      ) => { offsetNode: Node; offset: number } | null;
    };
    const d = doc as CaretDoc;
    let node: Node | null = null;
    let offset = 0;
    if (typeof d.caretPositionFromPoint === 'function') {
      const p = d.caretPositionFromPoint(clientX, clientY);
      if (p) {
        node = p.offsetNode;
        offset = p.offset;
      }
    } else if (typeof doc.caretRangeFromPoint === 'function') {
      const r = doc.caretRangeFromPoint(clientX, clientY);
      if (r) {
        node = r.startContainer;
        offset = r.startOffset;
      }
    }
    if (!node || !mirror.contains(node)) return null;
    return Math.min(offset, ta.value.length);
  } finally {
    mirror.remove();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The editor

export type SizeMode =
  /** Grows downward only (sticky body): at least the card height. */
  | { kind: 'grow-height'; minHeight: number }
  /** Fills its box width; height follows content (shape label). */
  | { kind: 'fit-height' }
  /** No wrapping; width and height follow content (standalone text, section title). */
  | { kind: 'fit-both'; minWidth?: number };

export interface CommitInfo {
  text: string;
  fmt: EditorFmt;
  /** The textarea's laid-out size in world units (the pan/zoom transform sits above it). */
  measured: { w: number; h: number };
  chain: boolean;
}

export interface TextEditorProps {
  /** The slot's text when the session opened — the session base (issue #106 C3). */
  initialText: string;
  list?: ListStyle;
  singleLine?: boolean;
  className: string;
  style: CSSProperties;
  size: SizeMode;
  fmt: EditorFmt;
  /** Client point of the click that opened the editor; null = keyboard entry (select all). */
  caretPoint: { x: number; y: number } | null;
  ariaLabel: string;
  onCommit: (info: CommitInfo) => void;
  onCancel: () => void;
  /** Idle-typing draft hook (Task 19): the current text, list markers stripped. */
  onDraft?: (text: string) => void;
}

const DRAFT_IDLE_MS = 600;

export function TextEditor(props: TextEditorProps) {
  const {
    initialText,
    list,
    singleLine = false,
    className,
    style,
    size,
    fmt: initialFmt,
    caretPoint,
    ariaLabel,
  } = props;
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const [value, setValue] = useState(() => withListMarkers(initialText, list));
  const valueRef = useRef(value);
  valueRef.current = value;
  const { fmtRef, style: fmtStyle, onFormatKey } = useEditorFormat(initialFmt);
  const ime = useRef(new ImeGuard()).current;
  const propsRef = useRef(props);
  propsRef.current = props;

  const guard = useRef(
    createCommitGuard((chain: boolean) => {
      const ta = ref.current;
      propsRef.current.onCommit({
        text: stripListMarkers(valueRef.current, propsRef.current.list),
        fmt: fmtRef.current,
        measured: { w: ta?.offsetWidth ?? 0, h: ta?.scrollHeight ?? 0 },
        chain,
      });
    })
  ).current;

  const commit = useCallback((chain = false) => guard.fire(chain), [guard]);
  const cancel = useCallback(() => {
    if (guard.done) return;
    guard.close();
    propsRef.current.onCancel();
  }, [guard]);

  // Size follows content. Layout effect: no frame paints at the stale size.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `value` + format changes resize the box
  useLayoutEffect(() => {
    const ta = ref.current;
    if (!ta) return;
    if (size.kind === 'fit-both') {
      ta.style.width = '0px';
      ta.style.width = `${Math.max(size.minWidth ?? 8, ta.scrollWidth + 2)}px`;
    }
    ta.style.height = '0px';
    const h = ta.scrollHeight;
    ta.style.height = `${size.kind === 'grow-height' ? Math.max(size.minHeight, h) : h}px`;
  }, [value, fmtStyle.fontSize, fmtStyle.fontWeight, size]);

  // Focus + caret on entry: at the click, else select all (the rename convention).
  useEffect(() => {
    const ta = ref.current;
    if (!ta) return;
    ta.focus({ preventScroll: true });
    const at = caretPoint ? offsetFromPoint(ta, caretPoint.x, caretPoint.y) : null;
    if (at === null) ta.select();
    else ta.setSelectionRange(at, at);
    // Entry point is read once per session.
    // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  }, []);

  // A click anywhere outside the editor (or its formatting toolbar) commits.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      const ta = ref.current;
      if (!ta || (t && ta.contains(t))) return;
      if (t?.closest?.('.dc-annot-ctx, [data-mediaref-player]')) return;
      commit();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [commit]);

  // Unmount without an explicit end (the element vanished, the canvas closed): keep the text.
  useEffect(() => () => void commit(), [commit]);

  // Draft: the text as typed so far, after a pause (Task 19).
  useEffect(() => {
    const onDraft = propsRef.current.onDraft;
    if (!onDraft || guard.done) return;
    const t = setTimeout(() => {
      if (!guard.done) onDraft(stripListMarkers(valueRef.current, propsRef.current.list));
    }, DRAFT_IDLE_MS);
    return () => clearTimeout(t);
  }, [value, guard]);

  return (
    <textarea
      ref={ref}
      // `dc-annot-editor` is chrome to every annotation pointer handler: a
      // click or double-click in the editor is text editing, never a select or
      // a drag of the element the editor sits in.
      className={`${className} dc-annot-editor`}
      data-annot-editor="1"
      aria-label={ariaLabel}
      value={value}
      rows={1}
      wrap={size.kind === 'fit-both' ? 'off' : 'soft'}
      spellCheck
      style={{ ...style, ...fmtStyle }}
      onChange={(e) => setValue(e.target.value)}
      onCompositionStart={() => ime.start()}
      onCompositionEnd={() => {
        ime.end();
        setTimeout(() => ime.release(), 0);
      }}
      onBlur={(e) => {
        const to = e.relatedTarget as Element | null;
        if (to?.closest?.('.dc-annot-ctx')) return;
        commit();
      }}
      onKeyDown={(e) => {
        if (onFormatKey(e)) return;
        const composing = ime.composing({
          isComposing: e.nativeEvent.isComposing,
          keyCode: e.keyCode,
        });
        const action = keyAction(
          {
            key: e.key,
            shiftKey: e.shiftKey,
            metaKey: e.metaKey,
            ctrlKey: e.ctrlKey,
            isComposing: e.nativeEvent.isComposing,
            keyCode: e.keyCode,
          },
          composing,
          singleLine
        );
        if (action === 'none') return;
        e.preventDefault();
        e.stopPropagation();
        if (action === 'cancel') cancel();
        else commit(action === 'commit-chain');
      }}
    />
  );
}
