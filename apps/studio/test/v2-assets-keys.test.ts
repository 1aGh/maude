// S8.12 — ia-assets-keys: select an artboard, then a tile, and ↵ places it there; ⌘I opens its details. The two are
// registry actions (`assets.place`, `assets.details`) on the selection layer behind the fact `assetTileSelected`,
// so the key, the tile menu and the agent say the same thing. Role: Can view / Can comment cannot place (the press
// hears the one denial line; the server refuses the edit-op as well, test/edit-ops-image.test.ts).
import { describe, expect, test } from 'bun:test';
import { AGENT_PATHS } from '../actions/agents.ts';
import { type ShellKeyState, shellKeyCtx } from '../actions/ctx.ts';
import { documentIndex } from '../actions/documents.ts';
import { ACTIONS, ACTIONS_BY_ID } from '../actions/index.ts';
import { chordFromEvent, type KeyEventLike } from '../actions/keys.ts';
import { resolveChord } from '../actions/resolve.ts';
import {
  assetTileSelected,
  bindAssetsPanel,
  runAssetsAction,
} from '../client/v2/assets/assets-bus.js';
import { keyOutcome } from '../client/v2/shell/role-gate.js';

const SHELL = documentIndex(ACTIONS, 'shell', () => true);
const BASE: ShellKeyState = {
  canvasOpen: true,
  timelineVisible: false,
  presenting: false,
  native: true,
  readOnly: false,
  clipSelected: false,
  artboardSelected: true,
  commentFocused: false,
};
const ENTER: KeyEventLike = { key: 'Enter', code: 'Enter' };
const CMD_I: KeyEventLike = { key: 'i', code: 'KeyI', metaKey: true };
const press = (
  e: KeyEventLike,
  s: Partial<ShellKeyState> = {},
  probe: { tag?: string; type?: string } = { tag: 'BUTTON' }
) => {
  const ctx = shellKeyCtx(probe, { ...BASE, ...s });
  const r = resolveChord(SHELL, chordFromEvent(e), ctx);
  return { id: r?.action.id ?? null, outcome: r ? keyOutcome(r.action, ctx) : null };
};

describe('assets.place · assets.details — the keys', () => {
  test('↵ on a picked tile is assets.place; with no tile picked it is not', () => {
    expect(press(ENTER, { assetTileSelected: true }).id).toBe('assets.place');
    expect(press(ENTER, { assetTileSelected: false }).id).not.toBe('assets.place');
    expect(press(ENTER).id).not.toBe('assets.place');
  });

  test('⌘I on a picked tile is assets.details; without one it is nothing of ours', () => {
    expect(press(CMD_I, { assetTileSelected: true }).id).toBe('assets.details');
    expect(press(CMD_I).id).not.toBe('assets.details');
  });

  test('a text field keeps ↵ (the search box is not a tile)', () => {
    expect(press(ENTER, { assetTileSelected: true }, { tag: 'INPUT', type: 'search' }).id).not.toBe(
      'assets.place'
    );
  });

  test('Can comment: ↵ is refused with the denial line; ⌘I (a read) still runs', () => {
    expect(press(ENTER, { assetTileSelected: true, readOnly: true })).toEqual({
      id: 'assets.place',
      outcome: 'deny',
    });
    expect(press(CMD_I, { assetTileSelected: true, readOnly: true })).toEqual({
      id: 'assets.details',
      outcome: 'run',
    });
  });
});

describe('the agent path', () => {
  test('assets.place is the TSX edit through the edit-op route, Can edit and up', () => {
    const p = AGENT_PATHS['assets.place'];
    expect(p).toMatchObject({
      effect: 'project',
      minRole: 'edit',
      undo: 'step',
      server: { route: '/_api/edit-op', method: 'POST' },
      agent: { path: 'file', format: 'canvas-tsx', skill: 'design:design' },
    });
    expect(ACTIONS_BY_ID.get('assets.place')?.enabled?.minRole).toBe('edit');
  });

  test('assets.details is a read: `maude design assets --usage`', () => {
    expect(AGENT_PATHS['assets.details']).toMatchObject({
      effect: 'none',
      agent: { path: 'cli', verb: 'maude design assets --usage <asset>' },
    });
  });
});

describe('assets-bus — the mounted tab', () => {
  test('the fact is the tab’s own answer; actions run the tab’s functions; unbinding ends it', () => {
    const ran: string[] = [];
    expect(assetTileSelected()).toBe(false);
    expect(runAssetsAction('assets.place')).toBe(false);
    const unbind = bindAssetsPanel({
      tileSelected: () => true,
      place: () => ran.push('place'),
      details: () => ran.push('details'),
    });
    expect(assetTileSelected()).toBe(true);
    expect(runAssetsAction('assets.place')).toBe(true);
    expect(runAssetsAction('assets.details')).toBe(true);
    expect(runAssetsAction('assets.other')).toBe(false);
    expect(ran).toEqual(['place', 'details']);
    unbind();
    expect(assetTileSelected()).toBe(false);
  });

  test('a panel that throws while answering is "no tile", never a stuck key', () => {
    const unbind = bindAssetsPanel({
      tileSelected: () => {
        throw new Error('unmounted');
      },
      place: () => {},
      details: () => {},
    });
    expect(assetTileSelected()).toBe(false);
    unbind();
  });
});
