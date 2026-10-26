// S3.12 — 04 md-model / md-edge-viewer in a RUNNING shell: the real mode lane (`useCanvasModeLane`), the real
// mode switch, the real Share cluster and panel layout, mounted in happy-dom and driven through the switch's own
// buttons. Every column of the what-shows table (bridge/mode-shows.ts) is read back from what the shell and the
// canvas's consumers actually do in that mode — the table is the expectation, the running pieces the evidence.
//
// The mode store is a module singleton shared by every file in a bun run, so the link-boot rule (a store nobody has
// chosen a mode in) is asserted on a fresh `createShellMode` and the lane's own `wantsFold`.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  // `document`, not `window`: a `window` stub another file left must not skip the DOM.
  if (typeof document === 'undefined') GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NO_CAPS, roleOfCaps, visibleSlots } from '../bridge/canvas-modes.ts';
import { type ModeKey, modeCell } from '../bridge/mode-shows.ts';
import { ASK_TO_EDIT_FALLBACK, askToEdit } from '../client/v2/shell/ask-to-edit.js';
import {
  capsFor,
  createShellMode,
  heldMode,
  shellEscDecision,
} from '../client/v2/shell/canvas-mode.js';
import { ModeSwitch } from '../client/v2/shell/mode-switch.jsx';
import { menuCtx } from '../client/v2/shell/project-menu-model.js';
import { accessStatus } from '../client/v2/shell/save-status.js';
import { ShareCluster } from '../client/v2/shell/share-cluster.jsx';
import {
  presentFrom,
  shellMode,
  useCanvasModeLane,
  wantsFold,
} from '../client/v2/shell/use-canvas-mode-lane.js';
import { panelLayout, usePanelLayout } from '../client/v2/shell/use-panel-layout.js';
import { linkFollowOf } from '../input-router.tsx';
import { inspectsSelection } from '../inspect-canvas.ts';

const ORIGIN = 'http://canvas.test';
const frameLog: Array<Record<string, unknown>> = [];
const frameWin = { postMessage: (m: Record<string, unknown>) => frameLog.push(m) };

interface Who {
  canEdit: boolean;
  role?: string;
}
const EDITOR: Who = { canEdit: true };
const CAN_COMMENT: Who = { canEdit: false, role: 'viewer' };
const CAN_VIEW: Who = { canEdit: false, role: 'observer' };

let lane: ReturnType<typeof useCanvasModeLane> | null = null;
let folded = false;
const asked: string[] = [];

function Harness({ who }: { who: Who }) {
  const iframesRef = { current: new Map([['ui/Campaign.tsx', { contentWindow: frameWin }]]) };
  lane = useCanvasModeLane({
    activePath: 'ui/Campaign.tsx',
    iframesRef,
    cfg: { canvasOrigin: ORIGIN },
    canEdit: who.canEdit,
    role: who.role,
  });
  folded = usePanelLayout().folded;
  const access = accessStatus({ canEdit: who.canEdit, role: who.role });
  return (
    <ShareCluster
      faces={[]}
      status={null}
      access={access}
      ctx={menuCtx({ native: true, canvasOpen: true })}
      run={() => {}}
      onAskToEdit={() => asked.push('ask')}
      mode={lane.mode}
      present={lane.presentSpec}
      modeSlot={
        <ModeSwitch
          mode={lane.mode}
          caps={lane.caps}
          onSelect={lane.select}
          onPresent={lane.present}
          canPresent
        />
      }
    />
  );
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;
function mount(who: Who) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(<Harness who={who} />));
}
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  lane = null;
  asked.length = 0;
  frameLog.length = 0;
});
const q = (id: string) => host?.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const click = (id: string) => act(() => q(id)?.click());

describe('md-edge-viewer · a view-only link, in a browser', () => {
  test('it opens in Preview; the panels stay where they are (a boot, not a choice)', () => {
    const boot = createShellMode(capsFor(CAN_VIEW));
    expect(boot.get()).toMatchObject({ mode: 'preview', nonce: 0 });
    expect(wantsFold('preview', boot.get())).toBe(false); // the Canvases list is there to open a canvas from
    boot.select('preview'); // chosen: now Preview folds them (md-model)
    expect(wantsFold('preview', boot.get())).toBe(true);
    expect(wantsFold('viewing', boot.get())).toBe(false);
    // the initial mode itself: an editor lands in Edit, anyone else in Preview
    expect(createShellMode(capsFor(EDITOR)).get().mode).toBe('edit');
    expect(createShellMode(capsFor(CAN_COMMENT)).get().mode).toBe('preview');
  });

  test('the switch offers Viewing · Preview · Present (no Edit, hidden and never greyed); Viewing is one click away', () => {
    act(() => shellMode.select('preview'));
    mount(CAN_VIEW);
    expect(lane?.mode).toBe('preview');
    expect(q('palette-mode-edit')).toBeNull();
    expect(q('palette-mode-viewing')).not.toBeNull();
    expect(q('palette-mode-preview')?.getAttribute('aria-pressed')).toBe('true');
    click('palette-mode-viewing');
    expect(lane?.mode).toBe('viewing');
    expect(q('palette-mode-viewing')?.getAttribute('aria-pressed')).toBe('true');
  });

  test('the cluster says "Can view" and offers Ask to edit — in Preview too, where it goes compact', () => {
    act(() => shellMode.select('preview'));
    mount(CAN_VIEW);
    const c = q('share-cluster');
    expect(c?.getAttribute('data-cluster')).toBe('compact');
    expect(q('share-cluster-status')?.getAttribute('data-status')).toBe('access'); // the word the CSS keeps
    expect(q('share-cluster-status')?.textContent).toBe('Can view');
    expect(q('share-cluster-ask')?.textContent).toBe('Ask to edit');
    expect(q('share-cluster-share')).toBeNull();
    click('share-cluster-ask');
    expect(asked).toEqual(['ask']);
  });

  test('Can comment reads "Can comment" and the same button', () => {
    act(() => shellMode.select('viewing'));
    mount(CAN_COMMENT);
    expect(q('share-cluster-status')?.textContent).toBe('Can comment');
    expect(q('share-cluster-ask')).not.toBeNull();
  });

  test('Ask to edit runs S9.21’s registry action when it exists, else says what to do', () => {
    const ran: string[] = [];
    const said: string[] = [];
    // S9.21 registered `share.ask-to-edit`: the button runs it (the flow says its own words); the fallback
    // line stays for a build without it, and is never said beside the action.
    expect(
      askToEdit(
        (id: string) => ran.push(id),
        (t: string) => said.push(t)
      )
    ).toBe('action');
    expect(ran).toEqual(['share.ask-to-edit']);
    expect(said).toEqual([]);
    expect(ASK_TO_EDIT_FALLBACK).toBe('Ask a project owner for edit access.');
  });
});

// ── md-model: every column, in the running shell ──────────────────────────────────────────────────────

interface Col {
  key: ModeKey;
  who: Who;
  enter: () => void;
}
const COLS: Col[] = [
  { key: 'edit', who: EDITOR, enter: () => click('palette-mode-edit') },
  { key: 'preview', who: EDITOR, enter: () => click('palette-mode-preview') },
  { key: 'present-artboards', who: EDITOR, enter: () => act(() => presentFrom('start')) },
  { key: 'present-canvas', who: EDITOR, enter: () => act(() => presentFrom('canvas')) },
  { key: 'viewing', who: CAN_COMMENT, enter: () => click('palette-mode-viewing') },
];
const modeOf = (k: ModeKey) =>
  (k.startsWith('present') ? 'present' : k) as 'edit' | 'preview' | 'present' | 'viewing';
const presentOf = (k: ModeKey) =>
  k === 'present-artboards'
    ? { kind: 'artboards' as const }
    : k === 'present-canvas'
      ? { kind: 'canvas' as const }
      : null;

describe('md-model · what each mode shows, per column of the table', () => {
  for (const col of COLS)
    describe(col.key, () => {
      const mode = modeOf(col.key);
      const present = presentOf(col.key);
      const cell = <R extends Parameters<typeof modeCell>[0]>(row: R) =>
        modeCell(row, mode, present);

      function enter() {
        // start every column from a clean store, in its role's base
        act(() => {
          shellMode.back();
          shellMode.select(col.who.canEdit ? 'edit' : 'viewing');
        });
        mount(col.who);
        col.enter();
      }

      test('the mode the switch lands in is the column', () => {
        enter();
        expect(lane?.mode).toBe(mode);
        expect(lane?.presentSpec?.kind ?? null).toBe(present?.kind ?? null);
      });

      test('Shell · the Share cluster takes the table’s form (and the access word only for a viewing role)', () => {
        enter();
        expect(q('share-cluster')?.getAttribute('data-cluster')).toBe(cell('share-cluster'));
        expect(q('share-cluster-status')?.getAttribute('data-status') === 'access').toBe(
          cell('share-cluster') === 'full-access'
        );
        expect(!!q('share-cluster-ask')).toBe(cell('share-cluster') === 'full-access');
      });

      test('Shell · Canvases / AI chat fold to their icons exactly where the table says folded', () => {
        enter();
        expect(folded).toBe(cell('left-panels') === 'folded');
        expect(folded).toBe(cell('ai-panel') === 'folded');
        expect(panelLayout.get().folded).toBe(folded);
      });

      test('Toolbar · the slots the role sees are the column’s bar', () => {
        enter();
        const slots = visibleSlots(lane?.mode ?? mode, roleOfCaps(lane?.caps ?? ({} as never)));
        const bar = cell('toolbar');
        if (bar === 'none') expect(slots).toEqual([]);
        else expect(slots.length).toBeGreaterThan(0);
        if (bar === 'edit') expect(slots[0]?.tool).toBe('move');
        if (bar === 'preview') expect(slots.map((s) => s.tool)).toContain('browse');
        if (bar === 'viewing')
          expect(slots.map((s) => s.tool)).toEqual(
            ['inspect', 'comment'].filter((t) => lane?.caps.comment || t !== 'comment')
          );
      });

      test('Clicks · a click on a link follows it only where the design is live; ⌘-click/click inspect only where specs show', () => {
        const el = document.createElement('div');
        el.innerHTML =
          '<div data-dc-screen="a"><button data-cd-link data-cd-id="cta-button">Go</button></div>';
        const target = el.querySelector('button');
        const followed = linkFollowOf(target, { mode, button: 0, mod: false });
        expect(!!followed).toBe(cell('clicks') === 'live');
        expect(inspectsSelection(mode, 'x')).toBe(cell('inspect').startsWith('panel'));
      });

      test('Esc · the shell’s own step (shell focused) is the table’s esc line', () => {
        const d = shellEscDecision({
          mode,
          presenting: mode === 'present',
          viewing: null,
          caps:
            lane?.caps ??
            (col.who.canEdit
              ? { edit: true, annotate: true, comment: true }
              : { edit: false, annotate: false, comment: true }),
        });
        const e = cell('esc');
        if (e === 'back-to-edit') expect(d).toEqual({ kind: 'set', mode: 'edit' });
        else if (e === 'settles-back' || e === 'same-view')
          expect(d).toEqual({ kind: 'exit-present' });
        else expect(d).toBeNull(); // Edit steps back inside the canvas; Viewing has nowhere to go
      });
    });
});

describe('the compact cluster keeps the access word', () => {
  test('Preview hides faces and status, never the word that says what this person may do', () => {
    const css = readFileSync(join(import.meta.dir, '../client/v2/shell/share-cluster.css'), 'utf8');
    expect(css).toContain(
      '.sh-share[data-cluster="compact"] > .sh-saved:not([data-status="access"])'
    );
    expect(css).not.toMatch(/\.sh-share\[data-mode="preview"\] > \.sh-saved/);
  });
});

describe('md-edge-viewer · what a Can view link may do', () => {
  test('the menu is built for the viewer’s rank: Can view is `view`, Can comment `comment`, an owner `owner`', () => {
    expect(menuCtx({ readOnly: true, observer: true }).role).toBe('view');
    expect(menuCtx({ readOnly: true }).role).toBe('comment');
    expect(menuCtx({}).role).toBe('owner');
  });

  test('Version history opens to LOOK: a held past version tells every canvas Viewing with no capabilities (no Restore)', () => {
    const editor = capsFor(EDITOR);
    const held = heldMode({ viewing: { at: 'r41' } }, 'edit', editor);
    expect(held).toEqual({ mode: 'viewing', caps: NO_CAPS });
    expect(visibleSlots('viewing', roleOfCaps(held.caps))).toEqual([]); // not even Hand's Comment: nothing to write
    // not held: the mode and caps as they are
    expect(heldMode({ viewing: null }, 'edit', editor)).toEqual({ mode: 'edit', caps: editor });
  });

  for (const [name, who] of [
    ['Can view', CAN_VIEW],
    ['Can comment', CAN_COMMENT],
  ] as const)
    test(`${name}: no Edit segment in the switch`, () => {
      act(() => shellMode.select('preview'));
      mount(who);
      expect(q('palette-mode-edit')).toBeNull();
      expect(q('palette-mode-viewing')).not.toBeNull();
    });
});
