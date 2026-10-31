// r2-p3-modes — UX audit package P3 (shell chrome + modes), Michal's TD1b/TD1c/TD1d/TD5/TD9
// (.ai/plans/notes/v2-evidence/ux-audit-rc1/MICHAL-DECISIONS.md, decision maude/v2-michal-ux-audit-td-decisions).
//
//   TD1b  the icon-only mode switch reads: pressed state, a tooltip with the name + its key, aria-keyshortcuts,
//         and a held past version (Viewing) shows in the first slot for an editor too.
//   TD1c  a key does what it means in the CURRENT mode when that mode has a slot for it, else it crosses
//         (the per-key table is CONTRACT §2's, pinned against `toolKeyAction`).
//   TD1d  a mode switch changes only the toolbar: the pill, the Share cluster, undo and the avatar keep their
//         form in Preview, and the camera does not move.
//   TD5   no What's-new canvas toast and no "You're in Edit" toast; one toast on screen at a time.
//   TD9   a 2 px :focus-visible ring on every control; menus wear a 1 px border.

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
import { ALL_CAPS, toolKeyAction } from '../bridge/canvas-modes.ts';
import { MODE_SHOWS } from '../bridge/mode-shows.ts';
import { ModeSwitch } from '../client/v2/shell/mode-switch.jsx';
import { zoomUndoForm } from '../client/v2/undo/zoom-undo.jsx';
import { easeKind } from '../preview/preview-camera.tsx';

const ROOT = join(import.meta.dir, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
});
function mount(el: React.ReactElement) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(el));
  return host;
}
const q = (id: string) => host?.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

describe('TD1d — a mode switch changes only the toolbar', () => {
  test('the shell frame rows read the same in Edit and Preview', () => {
    for (const row of ['share-cluster', 'project-menu'] as const)
      expect(`${row}: ${MODE_SHOWS[row].preview}`).toBe(`${row}: ${MODE_SHOWS[row].edit}`);
    // the toolbar is the one row that changes
    expect(MODE_SHOWS.toolbar.preview).not.toBe(MODE_SHOWS.toolbar.edit);
  });

  test('Undo · Redo stay in Preview for an editor; a viewer keeps the zoom alone, as in Viewing', () => {
    expect(zoomUndoForm('preview', null, { edit: true })).toBe('full');
    expect(zoomUndoForm('preview', null, { edit: false })).toBe('zoom-only');
    expect(zoomUndoForm('edit', null, { edit: true })).toBe('full');
    expect(zoomUndoForm('viewing', null, { edit: false })).toBe('zoom-only');
  });

  test('Preview keeps the Edit camera: no transition eases it', () => {
    expect(easeKind('edit', 'preview')).toBeNull();
    expect(easeKind('preview', 'edit')).toBeNull();
    expect(easeKind('viewing', 'preview')).toBeNull();
  });

  test('Preview chrome no longer draws its own zoom readout (the Undo · Redo · zoom island stays)', () => {
    const src = read('client/v2/preview/preview-chrome-host.jsx');
    expect(src).not.toContain('<ZoomOnly');
  });
});

describe('TD1b — the icon-only mode switch reads', () => {
  const editor = { edit: true, annotate: true, comment: true };
  test('each segment names its mode and key in the tooltip and aria-keyshortcuts', () => {
    mount(<ModeSwitch mode="edit" caps={editor} onSelect={() => {}} />);
    const edit = q('palette-mode-edit');
    const preview = q('palette-mode-preview');
    const present = q('palette-mode-present');
    expect(edit?.getAttribute('aria-pressed')).toBe('true');
    expect(preview?.getAttribute('aria-pressed')).toBe('false');
    expect(preview?.getAttribute('title')).toBe('Preview  ⌥⌘P');
    expect(preview?.getAttribute('aria-keyshortcuts')).toBe('Alt+Meta+P');
    expect(present?.getAttribute('title')).toBe('Present  ⌥⌘↵');
    expect(present?.getAttribute('aria-keyshortcuts')).toBe('Alt+Meta+Enter');
    // Edit's way back from Preview is the same toggle (and esc)
    expect(edit?.getAttribute('title')).toBe('Edit  ⌥⌘P');
  });

  test('a held past version shows Viewing, pressed, in the first slot for an editor too', () => {
    mount(<ModeSwitch mode="viewing" caps={editor} onSelect={() => {}} />);
    expect(q('palette-mode-edit')).toBeNull();
    const viewing = q('palette-mode-viewing');
    expect(viewing?.getAttribute('aria-pressed')).toBe('true');
    expect(viewing?.getAttribute('title')).toBe('Viewing — read-only');
  });

  test('the mode is announced politely when it changes (F05, WCAG 4.1.3)', () => {
    mount(<ModeSwitch mode="edit" caps={editor} onSelect={() => {}} />);
    const live = q('mode-switch-live');
    expect(live?.getAttribute('aria-live')).toBe('polite');
    expect(live?.textContent).toBe('');
    act(() => root?.render(<ModeSwitch mode="preview" caps={editor} onSelect={() => {}} />));
    expect(q('mode-switch-live')?.textContent).toBe('Preview');
  });
});

describe('TD1c — a key acts in the current mode when it means something there, else crosses', () => {
  /** CONTRACT §2 "Tool keys in each mode": `Key | In Edit | In Preview`. */
  function contractTable() {
    const md = readFileSync(join(ROOT, '../../.design/system/maude-v2/CONTRACT.md'), 'utf8');
    const at = md.indexOf('**Tool keys in each mode**');
    expect(at).toBeGreaterThan(0);
    const lines = md.slice(at).split('\n');
    const first = lines.findIndex((l) => l.startsWith('|'));
    const end = lines.findIndex((l, i) => i > first && !l.startsWith('|'));
    const rows = lines
      .slice(first, end)
      .filter((l) => /^\| [^-|K]/.test(l))
      .map((l) =>
        l
          .split('|')
          .slice(1, -1)
          .map((c) => c.trim())
      );
    return rows;
  }
  const cell = (mode: 'edit' | 'preview', key: string) => {
    const hit = toolKeyAction(mode, key, ALL_CAPS, 'pen');
    if (!hit) return 'nothing';
    if (hit.kind === 'request') return hit.mode === 'edit' ? 'Edit ›' : 'Preview ›';
    return 'here';
  };
  test('CONTRACT §2 lists every tool key and says, per mode, whether it stays or crosses', () => {
    const rows = contractTable();
    const keys = rows.map((r) => r[0]);
    for (const k of ['V', 'H', 'F', 'R', 'P', 'T', 'I', '⇧I', 'N', 'C', 'M', 'A', 'E', 'S'])
      expect(keys).toContain(k);
    for (const [key, inEdit, inPreview] of rows) {
      const want = (txt: string) =>
        /switches to Preview/.test(txt)
          ? 'Preview ›'
          : /switches to Edit/.test(txt)
            ? 'Edit ›'
            : /^—/.test(txt)
              ? 'nothing'
              : 'here';
      expect(`${key} in Edit: ${cell('edit', key)}`).toBe(`${key} in Edit: ${want(inEdit)}`);
      expect(`${key} in Preview: ${cell('preview', key)}`).toBe(
        `${key} in Preview: ${want(inPreview)}`
      );
    }
  });

  test('the keys both toolbars have stay in the mode you are in (V H R T)', () => {
    for (const k of ['V', 'H', 'R', 'T']) {
      expect(toolKeyAction('edit', k, ALL_CAPS)?.kind).toBe('arm');
      expect(toolKeyAction('preview', k, ALL_CAPS)?.kind).toBe('arm');
    }
  });

  test('the "?" sheet carries the same table', async () => {
    const { modeKeyTable } = await import('../client/v2/search/help-model.js');
    const table = modeKeyTable();
    const rows = contractTable();
    expect(table.map((r: { key: string }) => r.key)).toEqual(rows.map((r) => r[0]));
    for (const r of table as { key: string; edit: string; preview: string }[]) {
      const c = rows.find((x) => x[0] === r.key);
      expect(`${r.key}: ${r.edit} | ${r.preview}`).toBe(`${r.key}: ${c?.[1]} | ${c?.[2]}`);
    }
  });
});

describe('TD5 — What’s new is never a canvas toast; one toast at a time', () => {
  test('the shell renders no What’s-new toast and no mode-hint toast', () => {
    expect(read('client/app.jsx')).not.toContain('<WhatsNewToast');
    expect(read('client/whats-new.jsx')).not.toContain('export function WhatsNewToast');
    expect(read('client/shell/util.js')).not.toContain('You’re in Edit');
    expect(read('client/hooks/use-canvas-bridge.jsx')).not.toContain('browseFirstRunHint(');
  });

  test('the toaster shows one toast; the rest wait their turn', () => {
    const src = read('notifications.tsx');
    expect(src).toContain('visibleToasts={MAX_VISIBLE_TOASTS}');
    expect(src).toMatch(/const MAX_VISIBLE_TOASTS = 1\b/);
    expect(src).toContain('pool.slice(-MAX_VISIBLE_TOASTS)');
  });

  test('menus sit above toasts (UX-TOAST-1: menu > popover > toast)', () => {
    const src = read('notifications.tsx');
    const z = Number(/\[data-sonner-toaster\] \{[^}]*z-index: (\d+)/.exec(src)?.[1]);
    // a shell menu lives in its island's stacking context: the island with an open menu rises over the toaster,
    // and stays under the modal scrims (9000), where a toast still confirms a sheet's action
    const css = read('client/v2/shell/share-cluster.css');
    const menuZ = Number(/\.island:has\(\[role="menu"\]\) \{[^}]*z-index: (\d+)/.exec(css)?.[1]);
    expect(menuZ).toBeGreaterThan(z);
    expect(menuZ).toBeLessThan(9000);
  });
});

describe('TD9 — focus ring and menu edge', () => {
  const reset = () => read('client/styles/0-reset.css');
  test('every control gets a 2 px :focus-visible ring that no component rule can switch off', () => {
    const css = reset();
    const at = css.indexOf('r2-p3 (Michal TD9');
    expect(at).toBeGreaterThan(0);
    const open = css.indexOf('{', at);
    const rule = [css, css.slice(at, open), css.slice(open, css.indexOf('}', open))];
    for (const sel of [
      'button',
      'a[href]',
      '[role="menuitem"]',
      '[role="tab"]',
      '[role="option"]',
      'summary',
      'select',
    ])
      expect(rule?.[1]).toContain(sel);
    expect(rule?.[2]).toContain('outline-style: solid !important');
    expect(rule?.[2]).toContain('outline-width: var(--focus-ring-width, 2px) !important');
    expect(rule?.[2]).toContain('outline-color: var(--focus-ring, var(--accent)) !important');
  });

  test('every menu wears a 1 px border', () => {
    const css = reset();
    expect(css).toMatch(
      /:where\(\[role="menu"\]\)\s*\{[^}]*border: 1px solid var\(--border-default/
    );
  });
});

describe('F27 — a left/right tab selects; it never hides the panel', () => {
  test('the active tab is a no-op; Hide (the fold) is the one close control', () => {
    const src = read('client/app.jsx');
    expect(src).toContain('onPick={(id) => id !== leftActive && togglePanel(id)}');
    expect(src).toContain('onPick={(id) => id !== rightActive && togglePanel(id)}');
    expect(src).not.toContain('onPick={togglePanel}');
  });
});
