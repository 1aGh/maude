// p8-v1-drop (decision maude/v2-michal-drop-v1-auto-convert) — the legacy lanes are gone, not just
// unused: the opt-outs back onto them (`MAUDE_SHARED_DOC=0`, `MAUDE_LOCAL_STORE=0`) do nothing, a linked
// project that still saves the old way is VIEW ONLY until it switches (no editing the old way), the
// canvas keeps no undo stack of its own (⌘Z is the projection over the op log, nothing to fall back to),
// and the legacy offline-overlap check has no module and no hooks. Reading a legacy hub project stays.

import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { isSaveModeOffer, SAVE_COPY, saveModeState } from '../client/v2/shell/format-update.js';
import { runUndoKey } from '../client/v2/undo/use-undo-projection.jsx';
import { editOpRecord } from '../editing/edit-op.ts';
import {
  FORMAT_COPY,
  formatConfigFields,
  formatGate,
  formatRefusalResponse,
  legacySaveMode,
} from '../format.ts';
import { resolveCellPairing, sharedDocEnabled } from '../sync/cell-pairing.ts';
import { attachLocalHome } from '../sync/local-kernel.ts';

const STUDIO = path.join(import.meta.dir, '..');
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const runtime = (accepted: boolean, known = true) => ({
  current: () => ({ acceptedMode: () => accepted, acceptedModeKnown: () => known }),
});
const linkedCtx = (syncControl?: unknown) => ({
  cfg: { formatVersion: 2, linkedHub: { url: 'https://hub.team.example' } },
  paths: { designRoot: '/nonexistent-design-root' },
  ...(syncControl ? { syncControl } : {}),
});

describe('editing the old way is gone: a legacy-mode project is view only', () => {
  test('the gate: save-mode while the hub says legacy; editable once accepted; pending is not legacy', () => {
    expect(legacySaveMode(linkedCtx(runtime(false)) as never)).toBe(true);
    expect(formatGate(linkedCtx(runtime(false)) as never)).toEqual({
      projectFormat: 2,
      supported: 2,
      source: 'save-mode',
    });
    expect(formatGate(linkedCtx(runtime(true)) as never)).toBe(null);
    expect(formatGate(linkedCtx(runtime(false, false)) as never)).toBe(null); // not answered yet
    expect(formatGate(linkedCtx() as never)).toBe(null); // solo / no runtime
    expect(formatConfigFields(linkedCtx(runtime(false)) as never, false)).toMatchObject({
      readOnly: true,
      readOnlyReason: 'format',
    });
  });

  test('a write is refused with the save-mode line', async () => {
    const gate = formatGate(linkedCtx(runtime(false)) as never);
    if (!gate) throw new Error('no gate');
    const res = formatRefusalResponse(gate);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { message: string }).message).toBe(FORMAT_COPY.saveModeStatus);
    expect(FORMAT_COPY.saveModeStatus).toBe(SAVE_COPY.status);
  });

  test('the shell: the save-mode gate is the second trigger; a non-owner is told, view only', () => {
    const cfg = {
      formatVersion: 2,
      formatGate: { projectFormat: 2, supported: 2, source: 'save-mode' },
      readOnly: true,
      readOnlyReason: 'format',
      saveMode: 'legacy',
    };
    expect(isSaveModeOffer(cfg)).toBe(true);
    const plan = {
      exitCode: 11,
      dryRun: true,
      project: { formatBefore: 2, linked: { hub: 'https://hub', role: 'member', hubFormat: 2 } },
      refusals: [{ path: '', reason: 'x', code: 'not-owner' }],
      steps: [],
    };
    expect(saveModeState({ cfg, plan })).toEqual({
      kind: 'non-owner',
      line: SAVE_COPY.nonOwner,
      action: null,
    });
    expect(SAVE_COPY.nonOwner).toMatch(/^View only — /);
  });
});

describe('the opt-outs back onto the legacy lanes do nothing', () => {
  test('MAUDE_SHARED_DOC=0: the shared doc stays on, and a cell still pairs', () => {
    for (const v of ['0', 'false', 'off', 'no', undefined]) {
      expect(sharedDocEnabled({ MAUDE_SHARED_DOC: v })).toBe(true);
    }
    const verdict = resolveCellPairing({
      MAUDE_WORKSPACE_MODE: '1',
      MAUDE_CELL_PAIRING: '1',
      MAUDE_LOOPBACK_SYNC_URL: 'ws://127.0.0.1:1234',
      MAUDE_LOOPBACK_SYNC_TOKEN: 'cell-token',
      MAUDE_SYNC_NO_AUTOCOMMIT: '1',
      MAUDE_SHARED_DOC: '0',
    });
    expect(verdict.refusal).toBeUndefined();
    expect(verdict.pairing).not.toBeNull();
  });

  test('MAUDE_LOCAL_STORE=0: a local project still gets its local home (the op log)', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'maude-v1drop-'));
    dirs.push(root);
    const designRoot = path.join(root, '.design');
    mkdirSync(path.join(designRoot, 'ui'), { recursive: true });
    writeFileSync(path.join(designRoot, 'config.json'), '{}\n');
    const prevMachine = process.env.MAUDE_MACHINE_FILE;
    process.env.MAUDE_MACHINE_FILE = path.join(root, 'machine.json');
    try {
      const att = attachLocalHome(
        {
          cfg: { canvasGroups: [{ path: 'ui' }] },
          paths: { designRoot, designRel: '.design' },
          bus: { on() {} },
        },
        { current: () => null },
        { MAUDE_LOCAL_STORE: '0' }
      );
      const home = att.home();
      expect(home).not.toBe(null);
      await home?.ready();
      att.close();
    } finally {
      if (prevMachine === undefined) delete process.env.MAUDE_MACHINE_FILE;
      else process.env.MAUDE_MACHINE_FILE = prevMachine;
    }
  });
});

describe('the canvas keeps no undo stack; ⌘Z is the projection', () => {
  test('editing/undo-mode.ts and the canvas HUD are gone; an edit-op pushes no record', () => {
    expect(existsSync(path.join(STUDIO, 'editing', 'undo-mode.ts'))).toBe(false);
    expect(existsSync(path.join(STUDIO, 'undo-hud.tsx'))).toBe(false);
    expect(editOpRecord('w_0123456789abcdef', 'Frame')).toBe(null);
  });

  test('an answer the projection does not handle falls back to nothing (no canvas ping-pong)', async () => {
    let calls = 0;
    const store = {
      undo: async () => {
        calls++;
        return { handled: false };
      },
      redo: async () => ({ handled: false }),
    };
    // the old signature's fallback would have been called here; the third argument is the store now
    const r = await runUndoKey('.design/ui/a.tsx', false, store as never);
    expect(r).toEqual({ handled: false });
    expect(calls).toBe(1);
    expect(await runUndoKey(null, false, store as never)).toEqual({ handled: false });
  });
});

describe('the legacy offline-overlap check is gone', () => {
  test('no module, no hooks on the projection or the provider', async () => {
    expect(existsSync(path.join(STUDIO, 'sync', 'offline-overlap.ts'))).toBe(false);
    const { createDocProjection } = await import('../sync/projection.ts');
    expect(String(createDocProjection)).not.toMatch(/noteRemoteUpdate|noteConfirmed|overlap\?\./);
    const { createCanvasSyncAgent } = await import('../sync/agent.ts');
    expect(String(createCanvasSyncAgent)).not.toMatch(/noteRemoteUpdate|createOverlapWatch/);
  });
});
