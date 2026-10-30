// p8-sweep-leftovers (lead follow-up 1): the canvas's own right-click menu Paste is not a dead row.
//
// The annotation menu lives in the untrusted canvas frame (DDR-054). Its Paste read the clipboard from inside the
// frame — blocked by the iframe's permissions policy, so the row did nothing. A frame-initiated read through the
// shell is refused too (planted code could spam it). The row rests and says how to paste: CONTRACT.md's Edit-menu
// words "Paste ⌘V" (⌘V raises a real paste event the frame receives). No clipboard read is left in the layer.

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => GlobalRegistrator.unregister());

let root: Root | null = null;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = '';
});

describe('annotation context menu › Paste', () => {
  test('rests, says how to paste, and runs nothing on a click', async () => {
    const mod = await import('../annotations-layer.tsx');
    const ran: string[] = [];
    const host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () =>
      root?.render(
        createElement(mod.AnnotationContextMenu, {
          pos: { x: 10, y: 10 },
          selCount: 1,
          canUngroup: false,
          allLocked: false,
          canReplace: false,
          canEditPhoto: false,
          onAction: (a: string) => ran.push(a),
          onClose: () => {},
        })
      )
    );
    const paste = host.querySelector('[data-testid="annot-menu-paste"]') as HTMLButtonElement;
    expect(paste).not.toBeNull();
    expect(paste.disabled).toBe(true);
    expect(mod.PASTE_KEY_REASON).toBe('Paste ⌘V');
    expect(paste.getAttribute('title')).toBe('Paste ⌘V');
    expect(paste.getAttribute('aria-description')).toBe('Paste ⌘V');
    await act(async () => paste.click());
    expect(ran).toEqual([]);
    // the other rows still act
    await act(async () =>
      (host.querySelector('[data-testid="annot-menu-copy"]') as HTMLElement).click()
    );
    expect(ran).toEqual(['copy']);
  });

  test('the words are the CONTRACT’s, and the layer reads no clipboard', () => {
    const repo = join(import.meta.dir, '..', '..', '..');
    const contract = readFileSync(
      join(repo, '.design', 'system', 'maude-v2', 'CONTRACT.md'),
      'utf8'
    );
    expect(contract).toContain('Paste ⌘V');
    const layer = readFileSync(join(import.meta.dir, '..', 'annotations-layer.tsx'), 'utf8');
    expect(layer).not.toContain('clipboard\n            ?.readText');
    expect(layer).not.toMatch(/navigator\.clipboard\s*\??\.\s*readText/);
    expect(layer).not.toMatch(/navigator\.clipboard\s*\??\.\s*read\(/);
  });
});
