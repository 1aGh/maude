// P8 bug sweep B2 — "? and ⌘, did nothing while the canvas had the focus" (⌘K worked). A keydown inside the
// canvas iframe never reaches the shell's listener; the injected inspector script forwards the chords the
// registry marks `fromCanvas`, and it only looked at ⌘ / ⌃ chords and F-keys. "?" (the cheat sheet) and ⌘,
// (Settings) are CONTRACT §2 / §1 globals, so both are forwarded now — "?" never out of a text field.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

import { type Context, createBus } from '../context.ts';
import { createInspect } from '../inspect.ts';
import { makeSandbox } from './_helpers.ts';

function mkCtx(root: string, designRoot: string): Context {
  return {
    cfg: {} as Context['cfg'],
    projectLabel: 'test',
    bus: createBus(),
    paths: {
      repoRoot: root,
      designRel: '.design',
      designRoot,
      serverInfoFile: join(designRoot, '_server.json'),
      activeFile: join(designRoot, '_active.json'),
      commentsDir: join(designRoot, '_comments'),
      canvasStateDir: join(designRoot, '_canvas-state'),
      historyDir: join(designRoot, '_history'),
      tokensUrlRel: '',
      systemDirRel: 'system',
    },
  };
}

beforeAll(() => {
  GlobalRegistrator.register();
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

/** Run the injected inspector script in this document; return what it forwards to its parent. */
async function forwardedBy(
  press: (doc: Document) => KeyboardEvent
): Promise<Array<Record<string, unknown>>> {
  const { root, designRoot } = makeSandbox();
  const inspect = createInspect(mkCtx(root, designRoot), async () => []);
  const html = inspect.injectInspector('<html><body><div id="host"></div></body></html>');
  const bodies = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1] as string);
  const sent: Array<Record<string, unknown>> = [];
  const parent = { postMessage: (m: Record<string, unknown>) => sent.push(m) };
  Object.defineProperty(window, 'parent', { value: parent, configurable: true });
  document.body.innerHTML =
    '<div id="host"></div><input id="field" /><div id="ce" contenteditable="true"></div>';
  for (const b of bodies) new Function(b)();
  document.dispatchEvent(press(document));
  return sent.filter((m) => m.dgn === 'key');
}

const key = (target: string, init: KeyboardEventInit) => (doc: Document) => {
  const ev = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  // the forwarder listens on the document in the capture phase and reads e.target
  Object.defineProperty(ev, 'target', { value: doc.querySelector(target), configurable: true });
  return ev;
};

describe('the canvas forwards the global keys it used to swallow', () => {
  test('"?" with no text field focused', async () => {
    const sent = await forwardedBy(key('#host', { key: '?', code: 'Slash', shiftKey: true }));
    expect(sent.map((m) => m.chord)).toEqual(['?']);
  });
  test('⌘,', async () => {
    const sent = await forwardedBy(key('#host', { key: ',', code: 'Comma', metaKey: true }));
    expect(sent.map((m) => m.chord)).toEqual(['⌘,']);
  });
  test('"?" typed into an input or a contenteditable is text, not the cheat sheet', async () => {
    expect(await forwardedBy(key('#field', { key: '?', code: 'Slash', shiftKey: true }))).toEqual(
      []
    );
    expect(await forwardedBy(key('#ce', { key: '?', code: 'Slash', shiftKey: true }))).toEqual([]);
  });
  test('an ordinary bare key is still not forwarded', async () => {
    expect(await forwardedBy(key('#host', { key: 'f', code: 'KeyF' }))).toEqual([]);
  });
});

describe('the shell runs what the canvas forwarded', () => {
  test('runForwardedKey("?") toggles the cheat sheet and "⌘," opens Settings', async () => {
    const { runForwardedKey } = await import('../client/actions/shell-key-handlers.js');
    const calls: string[] = [];
    const d = {
      readOnly: false,
      setShortcutsOpen: () => calls.push('shortcuts'),
      setSettingsOpen: (v: boolean) => calls.push(`settings:${v}`),
    };
    expect(runForwardedKey('?', d)).toBe(true);
    expect(runForwardedKey('⌘,', d)).toBe(true);
    expect(calls).toEqual(['shortcuts', 'settings:true']);
  });

  test('the canvas bridge hands those two setters to runForwardedKey', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(
      join(import.meta.dir, '..', 'client', 'hooks', 'use-canvas-bridge.jsx'),
      'utf8'
    );
    const call = src.slice(
      src.indexOf('runForwardedKey(m.chord'),
      src.indexOf("m.dgn === 'open-export'")
    );
    expect(call).toContain('setSettingsOpen');
    expect(call).toContain('setShortcutsOpen');
  });
});
