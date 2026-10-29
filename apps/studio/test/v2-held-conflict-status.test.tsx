// p8-held-conflict-status (Michal 2026-10-29, kg maude/v2-michal-selfhost-convert-killswitch-held-conflict
// item 3) — while a held SOURCE conflict waits (this Mac kept its copy, the project's version sits in
// `_history/<slug>/sync-recovery/`), the Share cluster must not say "Saved": it says the CONTRACT §6 word
// Not saved with one action, Compare, which opens Diagnostics › Sync details at that conflict's two
// versions. A one-time toast "<canvas> differs from the project" carries the same Compare. Desktop and
// cloud tab draw the same cluster from the same machine.

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
import { ACTIONS_BY_ID } from '../actions/index.ts';
import { syncPresentation } from '../sync/presentation.ts';
import {
  OPEN_DIAGNOSTICS_EVENT,
  openDiagnostics,
  takeDiagnosticsRequest,
} from '../client/v2/diagnostics/diagnostics-bus.js';
import { createDiagnosticsHandlers } from '../client/v2/diagnostics/diagnostics-handlers.js';
import SyncDetails from '../client/v2/diagnostics/sync-details/sync-details.jsx';
import { heldConflicts } from '../client/v2/diagnostics/sync-details/sync-details-model.js';
import {
  heldConflictToast,
  resetHeldConflictToasts,
  useHeldConflictToast,
} from '../client/v2/shell/held-conflict.js';
import { menuCtx } from '../client/v2/shell/project-menu-model.js';
import { facesOf, saveStatus } from '../client/v2/shell/save-status.js';
import { ShareCluster } from '../client/v2/shell/share-cluster.jsx';
import { parityFor } from '../client/v2/shell/shell-parity.js';

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  resetHeldConflictToasts();
});
async function mount(node: React.ReactNode) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root?.render(node));
  return (id: string) => host?.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
}

const linked = { linked: true, online: true, phase: 'synced', pending: 0, writeFailed: null };
const notice = (slug: string, at = 1000) => ({
  id: `source-conflict-${slug}`,
  severity: 'warn',
  text: `Source sync blocked for ${slug}.`,
  at,
});
const syncStatusWith = (...notices: unknown[]) => ({
  linked: true,
  state: 'online',
  queuedOps: 0,
  docs: { synced: 3, pending: 0, rejected: 0 },
  notices,
});

describe('the status word while a held source conflict waits', () => {
  test('a held conflict → Not saved + Compare (was: Saved)', () => {
    const s = saveStatus({ ...linked, held: ['ui-flag'] });
    expect(s).toMatchObject({ kind: 'not-saved', word: 'Not saved', tone: 'error' });
    expect(s.actions).toEqual([{ id: 'compare', label: 'Compare' }]);
    expect(s.conflict).toBe('ui-flag');
  });

  test('it outranks Syncing… and Offline: the work is not where the project is', () => {
    expect(saveStatus({ ...linked, pending: 2, held: ['a'] }).word).toBe('Not saved');
    expect(saveStatus({ ...linked, online: false, held: ['a'] }).word).toBe('Not saved');
  });

  test('a failed write AND a held conflict: Retry and Compare, both', () => {
    const s = saveStatus({ ...linked, writeFailed: { kind: 'failed' }, held: ['a'] });
    expect(s.actions.map((a: { id: string }) => a.id)).toEqual(['retry', 'compare']);
  });

  test('resolving it (the notice clears) → back to Saved', () => {
    const before = syncStatusWith(notice('ui-flag'));
    const after = syncStatusWith();
    const word = (st: unknown) =>
      saveStatus({
        ...linked,
        phase: syncPresentation(st as never)?.phase ?? null,
        held: heldConflicts(st).map((c) => c.slug),
      });
    expect(word(before).word).toBe('Not saved');
    expect(word(after)).toMatchObject({ kind: 'saved', word: 'Saved', actions: [] });
  });

  test('the cluster draws it: Not saved + a Compare button that runs the status action', async () => {
    const actions: string[] = [];
    const q = await mount(
      <ShareCluster
        faces={facesOf({ you: 'Michal' })}
        status={saveStatus({ ...linked, held: ['ui-flag'] })}
        ctx={menuCtx({ native: true, canvasOpen: true })}
        run={() => {}}
        onStatusAction={(id: string) => actions.push(id)}
      />
    );
    expect(q('share-cluster-status')?.getAttribute('data-status')).toBe('not-saved');
    expect(q('share-cluster-status')?.textContent).toContain('Not saved');
    const compare = q('share-cluster-compare');
    expect(compare?.textContent).toBe('Compare');
    await act(async () => compare?.click());
    expect(actions).toEqual(['compare']);
  });
});

describe('the one-time toast', () => {
  function Harness({ status, toast, onCompare }: Record<string, unknown>) {
    useHeldConflictToast({
      held: heldConflicts(status),
      names: new Map([['ui-flag', 'Flag']]),
      onCompare: onCompare as (slug: string) => void,
      toast: toast as (n: unknown) => void,
    });
    return null;
  }

  test('the words: "<canvas> differs from the project", action Compare', () => {
    const t = heldConflictToast({ slug: 'ui-flag', name: 'Flag', onCompare: () => {} });
    expect(t.title).toBe('Flag differs from the project');
    expect(t.action.label).toBe('Compare');
  });

  test('once per conflict, not per render; a new conflict toasts again', async () => {
    const shown: { title: string; action: { onClick: () => void } }[] = [];
    const compared: string[] = [];
    const toast = (n: never) => shown.push(n);
    const onCompare = (slug: string) => compared.push(slug);
    const st = syncStatusWith(notice('ui-flag'));
    await mount(<Harness status={st} toast={toast} onCompare={onCompare} />);
    for (let i = 0; i < 4; i++)
      await act(async () =>
        root?.render(<Harness status={{ ...st }} toast={toast} onCompare={onCompare} />)
      );
    expect(shown.map((s) => s.title)).toEqual(['Flag differs from the project']);
    // its Compare does what the status action does
    shown[0].action.onClick();
    expect(compared).toEqual(['ui-flag']);
    // the same canvas conflicts again later (a new notice): a new conflict, a new toast
    await act(async () =>
      root?.render(
        <Harness
          status={syncStatusWith(notice('ui-flag', 5000))}
          toast={toast}
          onCompare={onCompare}
        />
      )
    );
    expect(shown).toHaveLength(2);
  });
});

describe('Compare opens the comparison', () => {
  test('the registry has it: a hidden Sync row, reading only', () => {
    const def = ACTIONS_BY_ID.get('sync.compare' as never);
    expect(def?.search).toEqual({ hidden: true });
    expect(def?.visible).toBeUndefined();
  });

  test('sync.compare opens Diagnostics › Sync at that conflict', () => {
    const opened: unknown[] = [];
    const h = createDiagnosticsHandlers({}, { open: (...a: unknown[]) => opened.push(a) });
    (h as Record<string, (p?: unknown) => void>)['sync.compare']({ slug: 'ui-flag' });
    expect(opened).toEqual([['sync', { conflict: 'ui-flag' }]]);
  });

  test('the bus carries the conflict to the host (an unsafe slug is dropped)', () => {
    const seen: unknown[] = [];
    const target = new EventTarget();
    target.addEventListener(OPEN_DIAGNOSTICS_EVENT, (e) => seen.push((e as CustomEvent).detail));
    openDiagnostics('sync', { conflict: 'ui-flag' }, target as never);
    expect(takeDiagnosticsRequest()).toMatchObject({ view: 'sync', conflict: 'ui-flag' });
    openDiagnostics('sync', { conflict: '../x' }, target as never);
    expect(takeDiagnosticsRequest()).toMatchObject({ view: 'sync', conflict: null });
  });

  test('Sync details opened at a conflict shows its two versions without a click', async () => {
    const urls: string[] = [];
    const fetchImpl = (async (url: string) => {
      urls.push(url);
      return new Response(JSON.stringify({ ok: true, mine: 'a\nmine\n', theirs: 'a\ntheirs\n' }));
    }) as unknown as typeof fetch;
    const q = await mount(
      <SyncDetails
        status={syncStatusWith(notice('ui-flag'), notice('ui-other'))}
        project="Alligators"
        focusConflict="ui-flag"
        fetchImpl={fetchImpl}
      />
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(urls).toEqual(['/_api/project/conflict?file=ui-flag']);
    expect(q('diag-sync-compare-ui-flag')?.getAttribute('aria-expanded')).toBe('true');
    expect(q('diag-sync-compare-lines-ui-flag')?.textContent).toContain('mine');
    expect(q('diag-sync-compare-lines-ui-other')).toBeNull();
  });
});

describe('cloud-tab parity', () => {
  test('every editing shell (desktop, browser, cloud owner/member) lists Compare beside the status', () => {
    const sc = (id: string) => parityFor(id).parts['share-cluster'];
    for (const id of ['desktop', 'browser', 'cloud-owner', 'cloud-member']) {
      expect(sc(id)?.when?.['share-cluster-compare']).toMatch(/held source conflict/);
    }
    // a read-only session's slot is the access word — it has no status action
    for (const id of ['cloud-viewer', 'viewer'])
      expect(sc(id)?.when?.['share-cluster-compare']).toBeUndefined();
  });

  test('a cloud tab reads the same machine: the cell’s held conflict → Not saved + Compare', () => {
    // a cloud tab is `linked` by cfg.cloud; its /_sync-status is the cell's, with the same notices
    const st = syncStatusWith(notice('ui-flag'));
    const s = saveStatus({
      linked: true,
      online: true,
      phase: syncPresentation(st as never)?.phase ?? null,
      held: heldConflicts(st).map((c) => c.slug),
    });
    expect(s).toMatchObject({ word: 'Not saved', conflict: 'ui-flag' });
  });
});

describe('a real held conflict (scripts/dev/trash-sync-repro.mjs --scenario race)', () => {
  // The refused Mac's own GET /_sync-status, captured from the rig (tokens, paths and hosts scrubbed).
  const real = JSON.parse(
    readFileSync(join(import.meta.dir, 'fixtures', 'held-conflict-sync-status.json'), 'utf8')
  );
  test('drives the status: Not saved + Compare at that canvas', () => {
    const held = heldConflicts(real).map((c) => c.slug);
    expect(held.length).toBeGreaterThan(0);
    const s = saveStatus({
      linked: true,
      online: true,
      phase: syncPresentation(real)?.phase ?? null,
      pending: Number(real.queuedOps) || 0,
      held,
    });
    expect(s).toMatchObject({ kind: 'not-saved', word: 'Not saved', conflict: held[0] });
    expect(s.actions.map((a: { id: string }) => a.id)).toContain('compare');
  });
});
