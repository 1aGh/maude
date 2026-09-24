import { afterAll, beforeAll, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => GlobalRegistrator.unregister());

test.each([
  true,
  false,
])('loading tree rows preserves keyboard ownership (tree focused: %s)', async (focused) => {
  const { FileTree, FileTreeItem } = await import('../client/file-tree.jsx');
  const host = document.createElement('div');
  const outside = document.createElement('button');
  document.body.append(host, outside);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<FileTree aria-label="Files" />));
    const tree = host.querySelector<HTMLElement>('[role="tree"]');
    if (!tree) throw new Error('Missing tree');
    expect(tree.tabIndex).toBe(0);
    (focused ? tree : outside).focus();
    await act(async () => {
      root.render(
        <FileTree aria-label="Files">
          <FileTreeItem label="Loaded" row={<button type="button">Loaded</button>} />
        </FileTree>
      );
    });
    // MutationObserver owns the tab stop after asynchronous tree population.
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    const item = host.querySelector<HTMLElement>('[role="treeitem"]');
    expect(item?.tabIndex).toBe(0);
    expect(tree.tabIndex).toBe(-1);
    expect(document.activeElement).toBe(focused ? item : outside);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    outside.remove();
  }
});

test('tree keyboard navigation preserves hierarchy and independent row actions', async () => {
  const { FileTree, FileTreeItem } = await import('../client/file-tree.jsx');
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  let expanded = false;
  const calls: string[] = [];
  const render = () =>
    root.render(
      <FileTree aria-label="Files">
        <FileTreeItem
          label="Folder"
          expanded={expanded}
          onToggle={() => {
            expanded = !expanded;
            render();
          }}
          row={
            <button type="button" onClick={() => calls.push('folder')}>
              Folder
            </button>
          }
          actions={
            <button type="button" onClick={() => calls.push('actions')}>
              Folder actions
            </button>
          }
        >
          {expanded && (
            <FileTreeItem
              label="Child"
              row={
                <button type="button" onClick={() => calls.push('child')}>
                  Child
                </button>
              }
            />
          )}
        </FileTreeItem>
        <FileTreeItem
          label="Last"
          row={
            <button type="button" onClick={() => calls.push('last')}>
              Last
            </button>
          }
        />
      </FileTree>
    );
  const queryItem = (name: string) =>
    host.querySelector<HTMLElement>(`[role="treeitem"][aria-label="${name}"]`);
  const item = (name: string) => {
    const found = queryItem(name);
    if (!found) throw new Error(`Missing tree item ${name}`);
    return found;
  };
  const key = async (value: string) =>
    act(async () => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key: value, bubbles: true })
      );
    });
  try {
    await act(async () => render());
    expect(item('Folder').tabIndex).toBe(0);
    item('Folder').focus();
    await key('ArrowRight');
    expect(item('Folder').getAttribute('aria-expanded')).toBe('true');
    expect(item('Child').parentElement?.getAttribute('role')).toBe('group');
    expect(item('Child').parentElement?.parentElement).toBe(item('Folder'));
    await key('ArrowRight');
    expect(document.activeElement).toBe(item('Child'));
    await key('Enter');
    expect(calls).toEqual(['child']);
    await key('ArrowLeft');
    expect(document.activeElement).toBe(item('Folder'));
    await key('ArrowLeft');
    expect(queryItem('Child')).toBeNull();
    await key('ArrowDown');
    expect(document.activeElement).toBe(item('Last'));
    await key('Home');
    expect(document.activeElement).toBe(item('Folder'));
    await key('End');
    expect(document.activeElement).toBe(item('Last'));
    await key('ArrowUp');
    expect(document.activeElement).toBe(item('Folder'));
    const action = [...host.querySelectorAll('button')].find(
      (b) => b.textContent === 'Folder actions'
    );
    if (!action) throw new Error('Missing folder actions');
    action.focus();
    await act(async () => action.click());
    expect(calls).toEqual(['child', 'actions']);
    await key('Escape');
    expect(document.activeElement).toBe(item('Folder'));
    expect(host.querySelectorAll('[role="treeitem"][tabindex="0"]')).toHaveLength(1);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
