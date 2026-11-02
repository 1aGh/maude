// V2-4 gate — the removed sidebar avatar menu's two GitHub doors are back as File-menu rows (desktop):
// Pull a local copy… / Share on GitHub… run through the shared runner and open IdentityBar's existing
// 'get' / 'share' views via the same window event project.new uses.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { ACTIONS_BY_ID } from '../actions/index.ts';
import { PROJECT_MENU } from '../actions/menu.ts';
import { createMenuHandlers } from '../client/v2/shell/menu-runner.js';

const fileItems = (
  PROJECT_MENU.find((x: { submenu?: string }) => x.submenu === 'File') as {
    items: Array<{ id?: string }>;
  }
).items.map((i) => i.id);

describe('File › Pull a local copy… / Share on GitHub…', () => {
  test('registered, desktop only, in the File menu', () => {
    for (const id of ['project.pull-copy', 'project.share-github']) {
      // decision v2-A6c-can-view-menu-minrole: the app-level rows are drawn for every role (Can view
      // reaches them through the menu's minRole), still desktop only
      expect(ACTIONS_BY_ID.get(id)?.visible).toEqual({ shell: ['desktop'], minRole: 'comment' });
      expect(fileItems).toContain(id);
    }
  });

  test('the runner hands them to IdentityBar on desktop and says where they live elsewhere', () => {
    const seen: string[] = [];
    const toasts: string[] = [];
    const prev = Object.getOwnPropertyDescriptor(globalThis, 'window');
    const target = new EventTarget();
    (globalThis as unknown as { window: unknown }).window = Object.assign(target, {
      dispatchEvent: (e: CustomEvent) => {
        seen.push(e.detail?.id);
        return true;
      },
    });
    try {
      const h = createMenuHandlers({ native: true, toast: (t: string) => toasts.push(t) });
      h['project.pull-copy']();
      h['project.share-github']();
      const b = createMenuHandlers({ native: false, toast: (t: string) => toasts.push(t) });
      b['project.pull-copy']();
    } finally {
      // Exactly as found: assigning `prev` back would leave an own `window: undefined` key.
      if (prev) Object.defineProperty(globalThis, 'window', prev);
      else Reflect.deleteProperty(globalThis, 'window');
    }
    expect(seen).toEqual(['project.pull-copy', 'project.share-github']);
    expect(toasts).toEqual(['Pull a local copy… is in the Maude desktop app.']);
  });

  test("IdentityBar maps them to its existing 'get' / 'share' views", () => {
    const src = readFileSync(new URL('../client/panels/IdentityBar.jsx', import.meta.url), 'utf8');
    expect(src).toContain("'project.pull-copy': 'get'");
    expect(src).toContain("'project.share-github': 'share'");
  });
});
