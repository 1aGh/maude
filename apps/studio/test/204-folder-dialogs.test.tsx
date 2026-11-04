// #195 (2.0.4) — "I can't add or rename folder" (desktop). The folder row's menu asked with `window.prompt`,
// which Tauri's WKWebView does not implement (it answers null at once): "New folder here" and "Rename folder"
// did nothing, and "Delete folder"'s `window.confirm` answered no. They now ask in the shell's own centered
// dialog (TreeAsk), and every refusal says why under the field instead of failing silently.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { FOLDER_WORDS } from '../canvas-create.ts';

let TreeAsk: typeof import('../client/v2/canvases/folder-dialogs.jsx').TreeAsk;
let ASK: typeof import('../client/v2/canvases/folder-ask.js');

beforeAll(async () => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  ({ TreeAsk } = await import('../client/v2/canvases/folder-dialogs.jsx'));
  ASK = await import('../client/v2/canvases/folder-ask.js');
});
afterAll(() => GlobalRegistrator.unregister());

const roots: Root[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
});

type Ask = { kind: string; path: string; name?: string };
type Res = { ok: boolean; status?: number; error?: string; network?: boolean };

async function mount(ask: Ask, answer: (ask: Ask, name?: string) => Res | Promise<Res>) {
  const runs: Array<[string, string | undefined]> = [];
  const state = { closed: 0 };
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  const render = (a: Ask | null) =>
    root.render(
      <TreeAsk
        ask={a}
        run={async (x: Ask, name?: string) => {
          runs.push([x.kind, name]);
          return answer(x, name);
        }}
        onClose={() => {
          state.closed++;
          void act(async () => render(null));
        }}
      />
    );
  await act(async () => render(ask));
  return { runs, state };
}
const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const typeInto = async (input: HTMLInputElement, value: string) => {
  const propsKey = Object.keys(input).find((k) => k.startsWith('__reactProps')) as string;
  const props = (input as unknown as Record<string, { onChange: (e: unknown) => void }>)[propsKey];
  await act(async () => props.onChange({ target: { value } }));
};
const submit = (id: string) =>
  act(async () => {
    q(id)?.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  });
const settle = () => act(async () => new Promise((r) => setTimeout(r, 10)));

describe('#195 the folder row asks in its own dialog', () => {
  test('the tree never asks with window.prompt / window.confirm (no-ops in the desktop app)', () => {
    const tree = readFileSync(join(import.meta.dir, '../client/tree/tree.jsx'), 'utf8');
    const tabs = readFileSync(join(import.meta.dir, '../client/hooks/use-tabs.jsx'), 'utf8');
    expect(tree).not.toMatch(/window\.(prompt|confirm)\s*\(/);
    // the folder and file requests the tree's menu runs
    for (const fn of ['newFolderReq', 'renameFolderReq', 'deleteFolderReq', 'deleteFileReq']) {
      const at = tabs.indexOf(`const ${fn} = useCallback(`);
      expect(at).toBeGreaterThan(-1);
      const body = tabs.slice(at, tabs.indexOf('\n  );', at));
      expect(body).not.toMatch(/window\.(prompt|confirm)\s*\(/);
    }
  });

  test('New folder here: a dialog that says where, then creates under the typed name', async () => {
    const m = await mount({ kind: 'new-folder', path: '.design/ui/2026' }, () => ({ ok: true }));
    const dlg = q('name-dialog') as HTMLElement;
    expect(dlg.getAttribute('aria-modal')).toBe('true');
    expect(q('name-dialog-title')?.textContent).toBe('Create folder in “2026”');
    expect((q('name-dialog-input') as HTMLInputElement).value).toBe('Untitled folder');
    await typeInto(q('name-dialog-input') as HTMLInputElement, 'dresy');
    await submit('name-dialog');
    await settle();
    expect(m.runs).toEqual([['new-folder', 'dresy']]);
    expect(m.state.closed).toBe(1);
  });

  test('a name used already: the server’s words under the field, the dialog stays open', async () => {
    const m = await mount({ kind: 'new-folder', path: '.design/ui/2026' }, () => ({
      ok: false,
      status: 409,
      error: FOLDER_WORDS.taken('dresy'),
    }));
    await typeInto(q('name-dialog-input') as HTMLInputElement, 'dresy');
    await submit('name-dialog');
    await settle();
    expect(q('name-dialog-error')?.textContent).toBe(
      'There is already something called “dresy” here. Try another name.'
    );
    expect(q('name-dialog')).not.toBeNull();
    expect(m.state.closed).toBe(0);
    expect((q('name-dialog-create') as HTMLButtonElement).disabled).toBe(false);
  });

  test('a reserved _ name is refused at once, with the way out; nothing is sent', async () => {
    const m = await mount({ kind: 'new-folder', path: '.design/ui' }, () => ({ ok: true }));
    await typeInto(q('name-dialog-input') as HTMLInputElement, '_drafts');
    await submit('name-dialog');
    await settle();
    expect(q('name-dialog-error')?.textContent).toBe('Names can’t start with _. Try “drafts”.');
    expect(m.runs).toEqual([]);
  });

  test('Can view / Can comment (403): it says what is needed, not "error 403"', async () => {
    await mount({ kind: 'rename-folder', path: '.design/ui/2026' }, () => ({
      ok: false,
      status: 403,
      error: 'error 403',
    }));
    await typeInto(q('name-dialog-input') as HTMLInputElement, '2027');
    await submit('name-dialog');
    await settle();
    expect(q('name-dialog-error')?.textContent).toBe(
      'Folders need Can edit. Ask a project owner for edit access.'
    );
  });

  test('Rename folder: prefilled with its name; unchanged closes and sends nothing; a lost connection says so', async () => {
    let m = await mount({ kind: 'rename-folder', path: '.design/ui/2026' }, () => ({ ok: true }));
    expect(q('name-dialog-title')?.textContent).toBe('Rename folder “2026”');
    expect((q('name-dialog-input') as HTMLInputElement).value).toBe('2026');
    expect(q('name-dialog-create')?.textContent).toBe('Rename');
    await submit('name-dialog');
    await settle();
    expect(m.runs).toEqual([]);
    expect(m.state.closed).toBe(1);

    m = await mount({ kind: 'rename-folder', path: '.design/ui/2026' }, () => ({
      ok: false,
      network: true,
      error: 'Load failed',
    }));
    await typeInto(q('name-dialog-input') as HTMLInputElement, '2027');
    await submit('name-dialog');
    await settle();
    expect(m.runs).toEqual([['rename-folder', '2027']]);
    expect(q('name-dialog-error')?.textContent).toBe(
      'Could not rename the folder. Nothing was changed. Try again.'
    );
  });

  test('Delete folder asks “Move … to the trash?” with the same verb on the button', async () => {
    const m = await mount({ kind: 'trash-folder', path: '.design/ui/2026' }, () => ({ ok: true }));
    expect(q('tree-ask-confirm')?.getAttribute('aria-modal')).toBe('true');
    expect(q('tree-ask-title')?.textContent).toBe('Move “2026” to the trash?');
    expect(q('tree-ask-ok')?.textContent).toBe('Move to trash');
    expect(q('tree-ask-cancel')?.textContent).toBe('Cancel');
    await submit('tree-ask-confirm');
    await settle();
    expect(m.runs).toEqual([['trash-folder', undefined]]);
    expect(m.state.closed).toBe(1);
  });

  test('a refused folder move to the trash stays open with the reason', async () => {
    await mount({ kind: 'trash-folder', path: '.design/ui/2026' }, () => ({
      ok: false,
      status: 409,
      error: FOLDER_WORDS.refused,
    }));
    await submit('tree-ask-confirm');
    await settle();
    expect(q('tree-ask-error')?.textContent).toBe(FOLDER_WORDS.refused);
    expect(q('tree-ask-confirm')).not.toBeNull();
  });

  test('askFailure never shows a developer string', () => {
    expect(
      ASK.askFailure('new-folder', {
        ok: false,
        error: 'parent must be inside a managed canvas group',
      } as never)
    ).toBe('Could not make the folder. Nothing was changed. Try again.');
    expect(
      ASK.askFailure('new-folder', { ok: false, status: 500, error: 'error 500' } as never)
    ).toBe('Could not make the folder. Nothing was changed. Try again.');
    expect(ASK.askFailure('rename-file', { ok: false, status: 403 } as never)).toBe(
      'Changing files needs Can edit. Ask a project owner for edit access.'
    );
  });
});
