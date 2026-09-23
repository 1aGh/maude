import { afterAll, beforeAll, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import DiffView from '../client/panels/DiffView.jsx';
import GitPanel from '../client/panels/GitPanel.jsx';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

test('history reloads the same canvas after a restore outside the panel', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  let revision = 8;
  const loadLog = async () => [
    {
      sha: `r${revision}`,
      message: revision === 8 ? 'Edit canvas' : 'Restored canvas',
      date: '2026-09-22T12:00:00Z',
      author: 'Designer',
      accepted: { revision, mine: false, undo: false, actionId: `action-${revision}` },
    },
  ];
  const panel = (historyRefresh: number) => (
    <GitPanel
      status={{ repo: true, files: [] }}
      project="Fixture"
      activeCanvas=".design/ui/History.tsx"
      historyOnly={true}
      historySource="project"
      historyRefresh={historyRefresh}
      loadLog={loadLog}
    />
  );
  try {
    await act(async () => {
      root.render(panel(0));
    });
    expect(host.querySelector('[data-testid="project-history-row-8"]')).not.toBeNull();
    revision = 9;
    await act(async () => {
      root.render(panel(1));
    });
    expect(host.querySelector('[data-testid="project-history-row-9"]')).not.toBeNull();
    expect(host.textContent).toContain('Restored canvas');
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
afterAll(() => GlobalRegistrator.unregister());

test('restore receives the currently selected accepted revision and names a new version', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const calls: unknown[][] = [];
  const confirmations: string[] = [];
  const originalConfirm = window.confirm;
  window.confirm = (message) => {
    confirmations.push(String(message));
    return true;
  };
  try {
    await act(async () => {
      root.render(
        <DiffView
          target={{ file: '.design/ui/History.tsx', beforeSha: 'r8', conflict: false }}
          cfg={{ designRoot: '.design', designRel: '.design' }}
          loadLog={async () => [
            { sha: 'r8', message: 'Original title', date: '2026-09-22T12:00:00Z' },
            { sha: 'r9', message: 'Peer color', date: '2026-09-22T12:01:00Z' },
          ]}
          onRestore={async (...args: unknown[]) => {
            calls.push(args);
          }}
          onResolve={undefined}
          onClose={() => {}}
        />
      );
    });
    const picker = host.querySelector('select');
    expect(picker).not.toBeNull();
    if (!picker) throw new Error('Missing history picker');
    await act(async () => {
      picker.value = 'r9';
      picker.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const restore = [...host.querySelectorAll('button')].find(
      (button) => button.textContent === 'Restore saved version'
    );
    expect(restore).toBeDefined();
    await act(async () => {
      restore?.click();
    });
    expect(calls).toEqual([['.design/ui/History.tsx', 'r9']]);
    expect(confirmations).toHaveLength(1);
    expect(confirmations[0]).toContain('version 9');
    expect(confirmations[0]).toContain('new saved version');
    expect(confirmations[0]).not.toContain('unsaved changes');
    expect([...picker.options].map((option) => option.value)).toEqual(['r8', 'r9']);
  } finally {
    window.confirm = originalConfirm;
    await act(async () => root.unmount());
    host.remove();
  }
});
