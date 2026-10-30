// P8 C3 — the Undo · Redo · zoom % island, bottom left (01 cf-blank, 10 co-browser-view, 14 edit frames).
//   · Edit draws Undo, Redo and the percentage; Viewing the percentage alone; Preview / Present none of it
//     (Preview has its own ZoomOnly readout)
//   · the buttons run the ⌘Z / ⇧⌘Z verbs; the percentage fits
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
import { ZoomUndo, zoomUndoForm } from '../client/v2/undo/zoom-undo.jsx';

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
});
async function mount(el: unknown) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(el as never);
  });
}
const q = (sel: string) => host?.querySelector(sel) ?? null;

describe('zoomUndoForm: which form each mode draws', () => {
  test('Edit is the full island, Viewing the zoom alone, Preview and Present none', () => {
    expect(zoomUndoForm('edit', null)).toBe('full');
    expect(zoomUndoForm('viewing', null)).toBe('zoom-only');
    expect(zoomUndoForm('preview', null)).toBeNull();
    expect(zoomUndoForm('present', { kind: 'artboards' })).toBeNull();
    expect(zoomUndoForm('present', { kind: 'canvas' })).toBeNull();
  });
});

describe('ZoomUndo', () => {
  test('Edit: Undo, Redo, a hairline, the percentage', async () => {
    const calls: string[] = [];
    await mount(
      <ZoomUndo
        zoom={0.76}
        onUndo={() => calls.push('undo')}
        onRedo={() => calls.push('redo')}
        onFit={() => calls.push('fit')}
      />
    );
    expect(q('[data-testid="zoom-undo"]')?.getAttribute('data-form')).toBe('full');
    expect(q('[data-testid="zoom-undo-pct"]')?.textContent).toBe('76%');
    (q('[data-testid="zoom-undo-undo"]') as HTMLButtonElement).click();
    (q('[data-testid="zoom-undo-redo"]') as HTMLButtonElement).click();
    (q('[data-testid="zoom-undo-pct"]') as HTMLButtonElement).click();
    expect(calls).toEqual(['undo', 'redo', 'fit']);
    expect(q('[data-testid="zoom-undo-undo"]')?.getAttribute('aria-label')).toBe('Undo');
    expect(q('[data-testid="zoom-undo-redo"]')?.getAttribute('aria-label')).toBe('Redo');
    expect(q('[data-testid="zoom-undo"] svg')).not.toBeNull();
  });

  test('Viewing: the percentage alone — a viewer changes nothing', async () => {
    await mount(<ZoomUndo zoom={1} form="zoom-only" />);
    expect(q('[data-testid="zoom-undo-undo"]')).toBeNull();
    expect(q('[data-testid="zoom-undo-redo"]')).toBeNull();
    expect(q('[data-testid="zoom-undo-pct"]')?.textContent).toBe('100%');
  });
});
