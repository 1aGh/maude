// annotations-v2 (DDR-242 AD7, Task 18) — the one text editor: commit policy,
// IME guard, single-commit guard, list markers, and the editor in a DOM.

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  type CommitInfo,
  createCommitGuard,
  ImeGuard,
  type KeyInput,
  keyAction,
  TextEditor,
} from '../annotations/ui/text-editor.tsx';
import { stripListMarkers, withListMarkers } from '../annotations/ui/text-style.ts';

const key = (k: string, mods: Partial<KeyInput> = {}): KeyInput => ({
  key: k,
  shiftKey: false,
  metaKey: false,
  ctrlKey: false,
  isComposing: false,
  keyCode: k === 'Enter' ? 13 : 0,
  ...mods,
});

describe('commit policy', () => {
  test('Enter commits, Shift+Enter is a newline, ⌘/Ctrl+Enter chains, Esc cancels', () => {
    expect(keyAction(key('Enter'), false, false)).toBe('commit');
    expect(keyAction(key('Enter', { shiftKey: true }), false, false)).toBe('none');
    expect(keyAction(key('Enter', { metaKey: true }), false, false)).toBe('commit-chain');
    expect(keyAction(key('Enter', { ctrlKey: true }), false, false)).toBe('commit-chain');
    expect(keyAction(key('Escape'), false, false)).toBe('cancel');
    expect(keyAction(key('a'), false, false)).toBe('none');
  });

  test('a single-line title commits on Shift+Enter too', () => {
    expect(keyAction(key('Enter', { shiftKey: true }), false, true)).toBe('commit');
  });

  test('nothing commits or cancels while composing', () => {
    expect(keyAction(key('Enter'), true, false)).toBe('none');
    expect(keyAction(key('Escape'), true, false)).toBe('none');
  });
});

describe('IME guard', () => {
  test('WebKit order: compositionend BEFORE the confirming Enter (keyCode 229) — no commit', () => {
    const g = new ImeGuard();
    g.start();
    g.end(); // WebKit fires this first…
    const enter = { isComposing: false, keyCode: 229 };
    expect(g.composing(enter)).toBe(true); // …then the Enter that confirmed the candidate
    g.release(); // one macrotask later
    expect(g.composing({ isComposing: false, keyCode: 13 })).toBe(false);
  });

  test('Chromium order: keydown during the composition carries isComposing', () => {
    const g = new ImeGuard();
    expect(g.composing({ isComposing: true, keyCode: 13 })).toBe(true);
    expect(g.composing({ isComposing: false, keyCode: 229 })).toBe(true);
    expect(g.composing({ isComposing: false, keyCode: 13 })).toBe(false);
  });
});

describe('single-commit guard', () => {
  test('fires once whatever calls it; a cancel closes it', () => {
    const calls: string[] = [];
    const g = createCommitGuard((why: string) => calls.push(why));
    expect(g.fire('enter')).toBe(true);
    expect(g.fire('blur')).toBe(false);
    expect(g.fire('outside-click')).toBe(false);
    expect(calls).toEqual(['enter']);
    const c = createCommitGuard(() => calls.push('late'));
    c.close();
    expect(c.fire()).toBe(false);
    expect(calls).toEqual(['enter']);
  });
});

describe('list markers are display-only', () => {
  test('round-trip, and a renumbered list still strips', () => {
    const t = 'one\ntwo';
    expect(withListMarkers(t, 'bullet')).toBe('• one\n• two');
    expect(stripListMarkers(withListMarkers(t, 'bullet'), 'bullet')).toBe(t);
    expect(stripListMarkers('1. one\n7. two', 'number')).toBe(t);
    expect(withListMarkers(t)).toBe(t);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The editor in a DOM

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
});

function mount(
  opts: { initialText?: string; list?: 'bullet' | 'number'; singleLine?: boolean } = {}
) {
  const commits: CommitInfo[] = [];
  const cancels: number[] = [];
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root?.render(
      <TextEditor
        initialText={opts.initialText ?? 'hello'}
        list={opts.list}
        singleLine={opts.singleLine}
        className="dc-annot-text"
        style={{}}
        size={{ kind: 'fit-height' }}
        fmt={{ fontSize: 14 }}
        caretPoint={null}
        ariaLabel="Edit"
        onCommit={(i) => commits.push(i)}
        onCancel={() => cancels.push(1)}
      />
    );
  });
  const ta = host.querySelector('textarea') as HTMLTextAreaElement;
  return { ta, commits, cancels };
}

/**
 * React's own handler for `name` on the textarea. happy-dom's input and
 * composition events do not reach React's trackers when react-dom was loaded
 * before the DOM was registered (bun shares one module registry across test
 * files), so the tests drive the handlers the way comment-edit.test.tsx does.
 */
function reactProp(ta: HTMLTextAreaElement, name: string): ((e: unknown) => void) | undefined {
  const k = Object.keys(ta).find((x) => x.startsWith('__reactProps'));
  const props = k ? (ta as unknown as Record<string, Record<string, unknown>>)[k] : undefined;
  return props?.[name] as ((e: unknown) => void) | undefined;
}

function type(ta: HTMLTextAreaElement, value: string) {
  act(() => {
    ta.value = value;
    reactProp(ta, 'onChange')?.({ target: ta, currentTarget: ta });
  });
}

function compose(ta: HTMLTextAreaElement, phase: 'start' | 'end') {
  act(() => {
    reactProp(ta, phase === 'start' ? 'onCompositionStart' : 'onCompositionEnd')?.({});
  });
}

/**
 * The textarea's onKeyDown, called directly. A dispatched keydown with
 * keyCode 229 would trip react-dom's fallback composition synthesis (used
 * where CompositionEvent is missing), which no browser path goes through.
 */
function keydownDirect(ta: HTMLTextAreaElement, k: { key: string; keyCode: number }) {
  act(() => {
    reactProp(
      ta,
      'onKeyDown'
    )?.({
      ...k,
      shiftKey: false,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      nativeEvent: { isComposing: false },
      preventDefault() {},
      stopPropagation() {},
    });
  });
}

function keydown(ta: HTMLTextAreaElement, init: KeyboardEventInit & { keyCode?: number }) {
  act(() => {
    const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    if (init.keyCode !== undefined) Object.defineProperty(e, 'keyCode', { value: init.keyCode });
    ta.dispatchEvent(e);
  });
}

describe('TextEditor', () => {
  test('opens focused with the text selected (keyboard entry) and the editor marker', () => {
    const { ta } = mount();
    expect(ta.value).toBe('hello');
    expect(ta.getAttribute('data-annot-editor')).toBe('1');
    expect(ta.className).toContain('dc-annot-editor');
    expect(document.activeElement).toBe(ta);
  });

  test('Enter commits once; a following blur does not commit again', () => {
    const { ta, commits } = mount();
    type(ta, 'hello world');
    keydown(ta, { key: 'Enter' });
    act(() => ta.dispatchEvent(new FocusEvent('blur')));
    expect(commits.map((c) => c.text)).toEqual(['hello world']);
    expect(commits[0]?.chain).toBe(false);
  });

  test('Esc cancels; unmounting afterwards commits nothing', () => {
    const { ta, commits, cancels } = mount();
    type(ta, 'changed');
    keydown(ta, { key: 'Escape' });
    act(() => root?.unmount());
    root = null;
    expect(cancels).toEqual([1]);
    expect(commits).toEqual([]);
  });

  test('an IME Enter in WebKit order does not commit; the next real Enter does', async () => {
    const { ta, commits } = mount();
    compose(ta, 'start');
    compose(ta, 'end');
    keydownDirect(ta, { key: 'Enter', keyCode: 229 });
    expect(commits).toEqual([]);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
    keydownDirect(ta, { key: 'Enter', keyCode: 13 });
    expect(commits.length).toBe(1);
  });

  test('⌘Enter commits and asks for a chained sibling', () => {
    const { ta, commits } = mount();
    keydown(ta, { key: 'Enter', metaKey: true });
    expect(commits[0]?.chain).toBe(true);
  });

  test('list markers show while editing and are stripped on commit', () => {
    const { ta, commits } = mount({ initialText: 'a\nb', list: 'bullet' });
    expect(ta.value).toBe('• a\n• b');
    type(ta, '• a\n• b\n• c');
    keydown(ta, { key: 'Enter' });
    expect(commits[0]?.text).toBe('a\nb\nc');
  });

  test('a click outside the editor commits; a click into the format toolbar does not', () => {
    const { ta, commits } = mount();
    const toolbar = document.createElement('div');
    toolbar.className = 'dc-annot-ctx';
    document.body.append(toolbar);
    act(() => toolbar.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
    expect(commits).toEqual([]);
    act(() => document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
    expect(commits.length).toBe(1);
    toolbar.remove();
    void ta;
  });

  test('the element vanishing mid-edit (unmount) keeps the typed text', () => {
    const { ta, commits } = mount();
    type(ta, 'kept');
    act(() => root?.unmount());
    root = null;
    expect(commits.map((c) => c.text)).toEqual(['kept']);
  });
});
