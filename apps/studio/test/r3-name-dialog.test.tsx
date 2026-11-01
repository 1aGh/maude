// R3 (6) — "New canvas" and "New brief canvas" ask for the name in a small centered dialog right away (Michal:
// the brief's input opened only in the left panel and nobody saw it). The dialog is the shell's NameDialogHost;
// every door (⌘K, ⌘N, the menu, the panel's "+", a folder's "+") only calls `requestNameDialog`.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

let NameDialogHost: typeof import('../client/v2/create/NameDialogHost.jsx').NameDialogHost;
let requestNameDialog: typeof import('../client/v2/create/name-dialog-bus.js').requestNameDialog;
let takeNameDialogRequest: typeof import('../client/v2/create/name-dialog-bus.js').takeNameDialogRequest;
let openNewCanvasDialog: typeof import('../client/v2/create/new-canvas.js').openNewCanvasDialog;
let openBriefBoardComposer: typeof import('../client/v2/create/new-canvas.js').openBriefBoardComposer;

beforeAll(async () => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  ({ NameDialogHost } = await import('../client/v2/create/NameDialogHost.jsx'));
  ({ requestNameDialog, takeNameDialogRequest } = await import(
    '../client/v2/create/name-dialog-bus.js'
  ));
  ({ openNewCanvasDialog, openBriefBoardComposer } = await import(
    '../client/v2/create/new-canvas.js'
  ));
});
afterAll(() => GlobalRegistrator.unregister());

const roots: Root[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
  takeNameDialogRequest();
});

type Made = { ok: boolean; file?: string; error?: string };
function setup(
  over: {
    create?: (o: Record<string, unknown>) => Promise<Made>;
    createBoard?: (name: string, o?: unknown) => Promise<Made>;
    moveCanvas?: (f: string, to: string) => Promise<unknown>;
    viewerMode?: boolean;
    toast?: (m: string) => void;
  } = {}
) {
  const created: Array<Record<string, unknown>> = [];
  const boards: string[] = [];
  const moved: Array<[string, string]> = [];
  const create =
    over.create ??
    (async (o: Record<string, unknown>) => {
      created.push(o);
      return { ok: true, file: 'ui/x.tsx' };
    });
  const createBoard =
    over.createBoard ??
    (async (name: string) => {
      boards.push(name);
      return { ok: true, file: 'ui/b.tsx' };
    });
  const moveCanvas =
    over.moveCanvas ??
    (async (f: string, to: string) => {
      moved.push([f, to]);
    });
  return { created, boards, moved, create, createBoard, moveCanvas, over };
}

async function mountHost(s: ReturnType<typeof setup>) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () =>
    root.render(
      <NameDialogHost
        create={s.create as never}
        createBoard={s.createBoard}
        moveCanvas={s.moveCanvas}
        viewerMode={s.over.viewerMode}
        denial="Only editors can add a canvas."
        toast={s.over.toast}
      />
    )
  );
  return host;
}
const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const typeInto = async (input: HTMLInputElement, value: string) => {
  const propsKey = Object.keys(input).find((k) => k.startsWith('__reactProps')) as string;
  const props = (input as unknown as Record<string, { onChange: (e: unknown) => void }>)[propsKey];
  await act(async () => props.onChange({ target: { value } }));
};
const submit = () =>
  act(async () => {
    q('name-dialog')?.dispatchEvent(
      new window.Event('submit', { bubbles: true, cancelable: true })
    );
  });
const settle = () => act(async () => new Promise((r) => setTimeout(r, 10)));

describe('the New canvas dialog', () => {
  test('a door opens a centered modal at once: labelled, aria-modal, name prefilled and selected', async () => {
    const s = setup();
    await mountHost(s);
    expect(q('name-dialog')).toBeNull();
    await act(async () => openNewCanvasDialog());
    const dlg = q('name-dialog') as HTMLElement;
    expect(dlg.getAttribute('role')).toBe('dialog');
    expect(dlg.getAttribute('aria-modal')).toBe('true');
    const labelId = dlg.getAttribute('aria-labelledby') as string;
    expect(document.getElementById(labelId)?.textContent).toBe('Create canvas');
    const input = q('name-dialog-input') as HTMLInputElement;
    expect(input.value).toBe('Untitled canvas');
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe('Untitled canvas'.length);
    expect(document.activeElement).toBe(input);
    expect(q('name-dialog-create')?.textContent).toBe('Create');
    expect(q('name-dialog-cancel')?.textContent).toBe('Cancel');
    expect(s.created).toHaveLength(0); // nothing written until Create
  });

  test('Enter (submit) creates with the typed name and the size picker flag; the dialog closes', async () => {
    const s = setup();
    await mountHost(s);
    await act(async () => openNewCanvasDialog());
    await typeInto(q('name-dialog-input') as HTMLInputElement, 'Pricing v2');
    await submit();
    await settle();
    expect(s.created).toEqual([{ name: 'Pricing v2', sizes: true, designSystem: undefined }]);
    expect(q('name-dialog')).toBeNull();
  });

  test('Esc cancels and creates nothing', async () => {
    const s = setup();
    await mountHost(s);
    await act(async () => openNewCanvasDialog());
    await act(async () => {
      (q('name-dialog-input') as HTMLElement).dispatchEvent(
        new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      );
    });
    expect(q('name-dialog')).toBeNull();
    expect(s.created).toHaveLength(0);
    expect(s.boards).toHaveLength(0);
  });

  test('Cancel cancels and creates nothing', async () => {
    const s = setup();
    await mountHost(s);
    await act(async () => openNewCanvasDialog());
    await act(async () => {
      q('name-dialog-cancel')?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    expect(q('name-dialog')).toBeNull();
    expect(s.created).toHaveLength(0);
  });

  test('an empty name cannot be created', async () => {
    const s = setup();
    await mountHost(s);
    await act(async () => openNewCanvasDialog());
    await typeInto(q('name-dialog-input') as HTMLInputElement, '   ');
    expect((q('name-dialog-create') as HTMLButtonElement).disabled).toBe(true);
    await submit();
    expect(s.created).toHaveLength(0);
  });

  test('a name the server refuses stays in the dialog with the reason', async () => {
    const s = setup({
      create: async () => ({ ok: false, error: 'a canvas called "Pricing" is already here' }),
    });
    await mountHost(s);
    await act(async () => openNewCanvasDialog());
    await typeInto(q('name-dialog-input') as HTMLInputElement, 'Pricing');
    await submit();
    await settle();
    expect(q('name-dialog')).not.toBeNull();
    expect(q('name-dialog-error')?.textContent).toContain('already here');
  });

  test('a folder’s "+" makes the canvas, then moves it in', async () => {
    const s = setup();
    await mountHost(s);
    await act(async () =>
      requestNameDialog({ kind: 'canvas', target: { path: '.design/ui/2027', name: '2027' } })
    );
    await submit();
    await settle();
    expect(s.moved).toEqual([['ui/x.tsx', '.design/ui/2027']]);
  });
});

describe('the New brief canvas dialog', () => {
  test('⌘K "New brief canvas" opens the same dialog, titled for the brief; Create makes the brief', async () => {
    const s = setup();
    await mountHost(s);
    await act(async () => openBriefBoardComposer({}));
    const dlg = q('name-dialog') as HTMLElement;
    expect(
      document.getElementById(dlg.getAttribute('aria-labelledby') as string)?.textContent
    ).toBe('Create brief canvas');
    expect((q('name-dialog-input') as HTMLInputElement).value).toBe('Untitled brief');
    expect(document.body.textContent).not.toMatch(/board/i);
    await typeInto(q('name-dialog-input') as HTMLInputElement, 'Launch brief');
    await submit();
    await settle();
    expect(s.boards).toEqual(['Launch brief']);
    expect(s.created).toHaveLength(0);
    expect(q('name-dialog')).toBeNull();
  });

  test('Esc on the brief dialog makes nothing', async () => {
    const s = setup();
    await mountHost(s);
    await act(async () => openBriefBoardComposer({}));
    await act(async () => {
      (q('name-dialog-input') as HTMLElement).dispatchEvent(
        new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      );
    });
    expect(q('name-dialog')).toBeNull();
    expect(s.boards).toHaveLength(0);
  });
});

describe('roles', () => {
  test('a viewer gets the one denial line, no dialog', async () => {
    const toasts: string[] = [];
    const s = setup({ viewerMode: true, toast: (m) => toasts.push(m) });
    await mountHost(s);
    await act(async () => openNewCanvasDialog());
    expect(q('name-dialog')).toBeNull();
    expect(toasts).toEqual(['Only editors can add a canvas.']);
  });
});
