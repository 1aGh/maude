import { afterAll, beforeAll, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import DiffView from '../client/panels/DiffView.jsx';
import { HistoryAdvanced } from '../client/v2/history/git-advanced.jsx';

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
    <HistoryAdvanced
      canvas=".design/ui/History.tsx"
      git={{
        status: { repo: true, files: [] },
        project: 'Fixture',
        cellManaged: true,
        historySource: 'project',
        historyRefresh,
        loadLog,
      }}
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

// #195 follow-up (2.0.4): WKWebView answers window.confirm with false and window.alert with nothing, so the
// diff's Restore asks in the shell's own dialog and says a failure inside the sheet. These stubs mimic it.
let real: Pick<Window, 'confirm' | 'alert' | 'prompt'>;
const native = { confirms: 0, alerts: 0 };
function wkWebView() {
  real = { confirm: window.confirm, alert: window.alert, prompt: window.prompt };
  native.confirms = 0;
  native.alerts = 0;
  window.confirm = () => {
    native.confirms++;
    return false;
  };
  window.alert = () => {
    native.alerts++;
  };
  window.prompt = () => null;
}
function restoreNative() {
  window.confirm = real.confirm;
  window.alert = real.alert;
  window.prompt = real.prompt;
}

type Props = {
  onRestore?: (...a: unknown[]) => Promise<unknown>;
  onResolve?: (...a: unknown[]) => Promise<unknown>;
  conflict?: boolean;
  beforeSha?: string;
};
async function mountDiff(props: Props) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <DiffView
        target={{
          file: '.design/ui/History.tsx',
          beforeSha: props.beforeSha ?? 'r8',
          conflict: props.conflict ?? false,
        }}
        cfg={{ designRoot: '.design', designRel: '.design' }}
        loadLog={async () => [
          { sha: 'r8', message: 'Original title', date: '2026-09-22T12:00:00Z' },
          { sha: 'r9', message: 'Peer color', date: '2026-09-22T12:01:00Z' },
        ]}
        onRestore={props.onRestore}
        onResolve={props.onResolve}
        onClose={() => {}}
      />
    );
  });
  return {
    host,
    q: (sel: string) => document.querySelector(sel) as HTMLElement | null,
    click: async (el: Element | null) => {
      if (!el) throw new Error('nothing to click');
      await act(async () => {
        (el as HTMLElement).click();
      });
    },
    done: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

test('restore asks in the shell dialog and sends the selected accepted revision', async () => {
  wkWebView();
  const calls: unknown[][] = [];
  const t = await mountDiff({
    onRestore: async (...args: unknown[]) => {
      calls.push(args);
      return { ok: true };
    },
  });
  try {
    const picker = t.host.querySelector('select');
    if (!picker) throw new Error('Missing history picker');
    await act(async () => {
      picker.value = 'r9';
      picker.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await t.click(t.q('[data-testid="history-preview-restore"]'));
    // Asking sends nothing yet, and says what happens.
    expect(calls).toEqual([]);
    expect(t.q('[data-testid="tree-ask-title"]')?.textContent).toBe(
      'Restore version 9 of “History”?'
    );
    expect(t.q('[data-testid="tree-ask-confirm"]')?.textContent).toContain('new saved version');
    expect(t.q('[data-testid="tree-ask-confirm"]')?.textContent).not.toContain('unsaved changes');
    await t.click(t.q('[data-testid="tree-ask-ok"]'));
    expect(calls).toEqual([['.design/ui/History.tsx', 'r9']]);
    expect(t.q('[data-testid="tree-ask-confirm"]')).toBeNull();
    expect([...picker.options].map((option) => option.value)).toEqual(['r8', 'r9']);
    expect(native).toEqual({ confirms: 0, alerts: 0 });
  } finally {
    restoreNative();
    await t.done();
  }
});

test('Cancel in the restore ask restores nothing', async () => {
  wkWebView();
  const calls: unknown[][] = [];
  const t = await mountDiff({
    beforeSha: 'HEAD',
    onRestore: async (...args: unknown[]) => {
      calls.push(args);
    },
  });
  try {
    await t.click(t.q('[data-testid="history-preview-restore"]'));
    expect(t.q('[data-testid="tree-ask-title"]')?.textContent).toBe(
      'Restore the saved version of “History”?'
    );
    expect(t.q('[data-testid="tree-ask-confirm"]')?.textContent).toContain(
      'Your unsaved changes to it are discarded'
    );
    await t.click(t.q('[data-testid="tree-ask-cancel"]'));
    expect(calls).toEqual([]);
    expect(t.q('[data-testid="tree-ask-confirm"]')).toBeNull();
    expect(t.q('[data-testid="history-preview-restore"]')).not.toBeNull();
  } finally {
    restoreNative();
    await t.done();
  }
});

test('a refused Restore says why inside the sheet — no window.alert', async () => {
  wkWebView();
  const t = await mountDiff({
    onRestore: async () => ({ ok: false, error: 'That version is no longer available.' }),
  });
  try {
    await t.click(t.q('[data-testid="history-preview-restore"]'));
    await t.click(t.q('[data-testid="tree-ask-ok"]'));
    expect(t.q('[data-testid="diff-error"]')?.textContent).toBe(
      'That version is no longer available.'
    );
    // the sheet stays, ready for another try
    expect(t.q('[data-testid="history-preview-restore"]')).not.toBeNull();
    expect(native.alerts).toBe(0);
  } finally {
    restoreNative();
    await t.done();
  }
});

test('a Restore that throws still says so in plain words', async () => {
  wkWebView();
  const t = await mountDiff({
    onRestore: async () => {
      throw new Error('socket closed');
    },
  });
  try {
    await t.click(t.q('[data-testid="history-preview-restore"]'));
    await t.click(t.q('[data-testid="tree-ask-ok"]'));
    expect(t.q('[data-testid="diff-error"]')?.textContent).toBe(
      'Could not restore that version. Try again.'
    );
  } finally {
    restoreNative();
    await t.done();
  }
});

test('a merge that cannot finish says why inside the sheet, and a retry clears it', async () => {
  wkWebView();
  let n = 0;
  const t = await mountDiff({
    conflict: true,
    onResolve: async () =>
      ++n === 1 ? { ok: false, error: 'Get the latest again, then retry.' } : { ok: true },
  });
  try {
    const keep = () =>
      [...t.host.querySelectorAll('button')].find((b) => b.textContent?.includes('Keep both')) ??
      null;
    // the footer's primary button names the chosen side ("Keep both")
    const primary = t.host.querySelector('.dv-ft .btn--primary');
    await t.click(primary);
    expect(t.q('[data-testid="diff-error"]')?.textContent).toBe(
      'Get the latest again, then retry.'
    );
    await t.click(t.host.querySelector('.dv-ft .btn--primary'));
    expect(n).toBe(2);
    expect(t.q('[data-testid="diff-error"]')).toBeNull();
    expect(keep()).not.toBeNull();
    expect(native.alerts).toBe(0);
  } finally {
    restoreNative();
    await t.done();
  }
});
