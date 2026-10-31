// r2-e2e-fix — the F size picker belongs to Edit's Artboard / Frame tool. Michal TD1d: a mode switch changes
// only the toolbar, so when the toolbar stops being Edit's the tool's panel goes with it. Seen in the desktop
// e2e (modes-present): F armed the picker, ⌥⌘P went to Preview, and the picker stayed up over Preview — a
// preset click there would still draw an artboard, and the bar's "esc to edit" only closed the picker.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { watchSizePickerMode } from '../client/v2/kinds/SizePickerHost.jsx';
import { createShellMode } from '../client/v2/shell/canvas-mode.js';

describe('the size picker closes when the mode leaves Edit', () => {
  test('Edit → Preview closes it', () => {
    const store = createShellMode();
    store.select('edit');
    let closed = 0;
    const stop = watchSizePickerMode(store, () => closed++);
    expect(closed).toBe(0);
    store.select('preview');
    expect(closed).toBe(1);
    stop();
  });

  test('Edit → Present closes it', () => {
    const store = createShellMode();
    store.select('edit');
    let closed = 0;
    watchSizePickerMode(store, () => closed++);
    store.present({ kind: 'canvas' });
    expect(closed).toBe(1);
  });

  test('staying in Edit (a tool change) keeps it', () => {
    const store = createShellMode();
    store.select('edit');
    let closed = 0;
    watchSizePickerMode(store, () => closed++);
    store.select('edit', { tool: 'frame' });
    expect(closed).toBe(0);
  });

  test('stopped watching, nothing is closed', () => {
    const store = createShellMode();
    store.select('edit');
    let closed = 0;
    const stop = watchSizePickerMode(store, () => closed++);
    stop();
    store.select('preview');
    expect(closed).toBe(0);
  });

  test('the host watches the shell mode while its picker is up', () => {
    const src = readFileSync(
      join(import.meta.dir, '../client/v2/kinds/SizePickerHost.jsx'),
      'utf8'
    );
    expect(src).toMatch(/watchSizePickerMode\(shellMode,/);
  });
});
