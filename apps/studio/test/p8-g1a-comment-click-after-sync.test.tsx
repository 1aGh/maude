// P8 G1a item 2 — "with the Comment tool pressed, a click on the artboard sometimes opens no composer", in Preview
// AND Viewing (share-roles lane run 3–5; reproduced by the scratch debug run with no wait between the slot click
// and the artboard click). A UI canvas carries two tool providers: canvas-lib's (it owns the toolbar) and the
// comment-mount layer's (it owns the comment drop). The Comment slot arms the first; it tells the second over
// `maude:tool-sync`, a DOM event outside any React event, so the second's re-render — and the rendered `tool` its
// router read — landed a task later. A pointerdown in that window read Browse / Inspect and dropped nothing.
// The fix: the provider keeps the last-armed tool synchronously (`getTool`), and the comment layer's router reads it.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act, createElement } from 'react';

beforeAll(() => {
  if (typeof globalThis.document === 'undefined') GlobalRegistrator.register();
});
afterAll(async () => {
  await new Promise((r) => setTimeout(r, 30));
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

const settle = () => new Promise((r) => setTimeout(r, 30));

describe('the comment layer hears the Comment tool before the next click', () => {
  test('a tool-sync, then a pointerdown in the same task: the composer opens', async () => {
    const { mountCanvas } = await import('../canvas-comment-mount.tsx');
    const { TOOL_SYNC_EVENT } = await import('../use-tool-mode.tsx');
    const root = document.createElement('div');
    document.body.append(root);
    const Specimen = () =>
      createElement('div', { id: 'spec', style: { width: '400px', height: '300px' } }, 'Poster');
    await act(async () => {
      mountCanvas(Specimen, { rootEl: root, commentsEnabled: true, file: '.design/ui/poster.tsx' });
      await settle();
    });
    const opened: unknown[] = [];
    document.addEventListener('cm:open-composer', (e) => opened.push((e as CustomEvent).detail));
    const spec = document.getElementById('spec');
    expect(spec).not.toBeNull();
    // the sibling (canvas-lib) provider armed Comment from its toolbar slot …
    document.dispatchEvent(
      new CustomEvent(TOOL_SYNC_EVENT, { detail: { tool: 'comment', from: 'canvas-lib' } })
    );
    // … and the person clicks the artboard before this layer has re-rendered
    const down = new (window.PointerEvent ?? window.MouseEvent)('pointerdown', {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: 40,
      clientY: 40,
    });
    spec?.dispatchEvent(down);
    expect(opened.length).toBe(1);
    expect(down.defaultPrevented).toBe(true);
    await act(async () => {
      await settle();
    });
    root.remove();
  });

  test('without a sync the same click on Browse stays the design’s (no composer)', async () => {
    const { mountCanvas } = await import('../canvas-comment-mount.tsx');
    const root = document.createElement('div');
    document.body.append(root);
    const Specimen = () => createElement('div', { id: 'spec2' }, 'Poster');
    await act(async () => {
      mountCanvas(Specimen, { rootEl: root, commentsEnabled: true, file: '.design/ui/poster.tsx' });
      await settle();
    });
    const opened: unknown[] = [];
    document.addEventListener('cm:open-composer', (e) => opened.push(e));
    document
      .getElementById('spec2')
      ?.dispatchEvent(
        new (window.PointerEvent ?? window.MouseEvent)('pointerdown', { bubbles: true, button: 0 })
      );
    expect(opened.length).toBe(0);
    await act(async () => {
      await settle();
    });
    root.remove();
  });
});
