// S3.14 — the fidelity gaps the S3.13 verifier found between canvas 04 (Modes) and the built shell.
// One file, one describe per gap (G1…G7), each written to fail first.
//
// G1  Preview's compact cluster hides the faces (the wrapper is `.sh-faces-host`, not `.sh-faces`)
// G3  Present ⌄ has "Copy presentation link — follows you live" (editors; enabled on the online fact)
// G5  the View menu draws Preview ⌥⌘P and Actual size ⌘1 (registry, one binding per scope)
// G6  esc from Sticky armed with N in Preview goes to Hand first (md-esc), then Edit

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  if (typeof document === 'undefined') GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ALL_CAPS } from '../bridge/canvas-modes.ts';
import { REPLAY_KEYS, replayActionKey } from '../canvas-replay-keys.ts';
import { DockSlot } from '../client/shell/dock.jsx';
import {
  COPY_PRESENTATION_LINK_NOTE,
  COPY_PRESENTATION_LINK_WAITS,
  copyRowState,
} from '../client/v2/present/copy-link.js';
import { spawnFoldGhost } from '../client/v2/shell/fold-ghost.js';
import { ModeSwitch } from '../client/v2/shell/mode-switch.jsx';
import { menuCtx } from '../client/v2/shell/project-menu-model.js';
import { ShareCluster } from '../client/v2/shell/share-cluster.jsx';
import { shellMode, shellStepBack } from '../client/v2/shell/use-canvas-mode-lane.js';

let root: Root | null = null;
let host: HTMLElement | null = null;
function mount(ui: ReactNode): void {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root?.render(ui));
}
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});
const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);

const CLUSTER_CSS = readFileSync(
  join(import.meta.dir, '../client/v2/shell/share-cluster.css'),
  'utf8'
);

describe('G1 · Preview’s compact cluster hides the faces', () => {
  /** The selectors of the rule that carries `display: none` for `data-cluster="compact"`. */
  const compactHidden = (): string[] => {
    const rule = CLUSTER_CSS.match(
      /((?:\s*\.sh-share\[data-cluster="compact"\][^{,]+,?)+)\{\s*display:\s*none;/
    );
    expect(rule).not.toBeNull();
    return (rule?.[1] ?? '').split(',').map((s) => s.trim());
  };

  const faces = [{ initials: 'IA', name: 'Ia', you: true }];
  const clusterWith = (presence: unknown) =>
    mount(
      <ShareCluster
        faces={faces}
        presence={presence as never}
        status={null}
        ctx={menuCtx({ native: true, canvasOpen: true })}
        run={() => {}}
        mode="preview"
      />
    );

  for (const [name, presence] of [
    [
      'the strip with the face menu (presence)',
      { run() {}, labelOf: () => null, roleOf: () => null },
    ],
    ['the legacy strip (no presence)', null],
  ] as const) {
    test(`the direct child of the cluster that holds ${name} is a hidden one`, () => {
      clusterWith(presence);
      expect(q('share-cluster')?.getAttribute('data-cluster')).toBe('compact');
      const strip = q('share-cluster-faces') as HTMLElement;
      let child: HTMLElement = strip;
      while (child.parentElement && child.parentElement !== q('share-cluster'))
        child = child.parentElement;
      const cls = [...child.classList];
      expect(cls.length).toBeGreaterThan(0);
      const hidden = compactHidden();
      expect(cls.some((c) => hidden.includes(`.sh-share[data-cluster="compact"] > .${c}`))).toBe(
        true
      );
    });
  }
});

describe('G3 · Present ⌄ › Copy presentation link', () => {
  test('copyRowState: a cloud project online → enabled, "follows you live"; else greyed with why', () => {
    expect(copyRowState({ cloud: true, online: true })).toEqual({
      enabled: true,
      note: 'follows you live',
    });
    expect(copyRowState({ cloud: true, online: false })).toEqual({
      enabled: false,
      note: COPY_PRESENTATION_LINK_WAITS,
    });
    // no cloud link outranks offline (copyAvailability's own order)
    expect(copyRowState({ cloud: false, online: false })).toEqual({
      enabled: false,
      note: COPY_PRESENTATION_LINK_NOTE,
    });
    expect(copyRowState({ cloud: false, online: true }).enabled).toBe(false);
  });

  const mountSwitch = (props: Partial<Parameters<typeof ModeSwitch>[0]> = {}) => {
    const asked: string[] = [];
    mount(
      <ModeSwitch
        mode="edit"
        caps={ALL_CAPS}
        onSelect={() => {}}
        onPresent={(k: string) => asked.push(k)}
        {...props}
      />
    );
    act(() => q('mode-present-menu')?.click());
    return asked;
  };

  test('an editor in a cloud project: the row sits last, under its own rule, and copies', () => {
    const asked = mountSwitch({ copyLink: { enabled: true, note: 'follows you live' } });
    const row = q('mode-present-copy-link');
    expect(row?.getAttribute('role')).toBe('menuitem');
    expect(row?.textContent).toContain('Copy presentation link');
    expect(row?.textContent).toContain('follows you live');
    expect(row?.closest('.sh-pm-li')?.previousElementSibling?.tagName).toBe('HR');
    expect(row?.closest('.sh-pm-li')?.nextElementSibling).toBeNull();
    act(() => row?.click());
    expect(asked).toEqual(['copy-link']);
    expect(q('mode-present-list')).toBeNull(); // the menu closes
  });

  test('not enabled: the row is there, greyed, says why, and does nothing', () => {
    const asked = mountSwitch({ copyLink: { enabled: false, note: 'in a cloud project' } });
    const row = q('mode-present-copy-link') as HTMLButtonElement;
    expect(row.getAttribute('aria-disabled')).toBe('true');
    expect(row.textContent).toContain('in a cloud project');
    act(() => row.click());
    expect(asked).toEqual([]);
    expect(q('mode-present-list')).not.toBeNull();
  });

  test('Can view / Can comment: hidden, never greyed (an editor’s row)', () => {
    mountSwitch({
      caps: { edit: false, annotate: false, comment: true },
      mode: 'viewing',
      copyLink: { enabled: true, note: 'follows you live' },
    });
    expect(q('mode-present-copy-link')).toBeNull();
  });

  test('no copyLink prop: no row (the host decides)', () => {
    mountSwitch();
    expect(q('mode-present-copy-link')).toBeNull();
  });
});

describe('G6 · esc with the shell focused hands the press to the canvas (md-esc: Sticky → Hand → Edit)', () => {
  const sent: unknown[] = [];
  const forward =
    (took = true) =>
    () => {
      sent.push('forwarded');
      return took;
    };
  afterEach(() => {
    sent.length = 0;
    act(() => shellMode.select('edit'));
  });

  test('Preview: the canvas takes the press; the shell stays in Preview', () => {
    act(() => shellMode.select('preview'));
    expect(shellStepBack({ canEdit: true, forward: forward() })).toBe('forward');
    expect(sent).toEqual(['forwarded']);
    expect(shellMode.get().mode).toBe('preview');
  });

  test('no canvas to take it: the shell takes the terminal step itself (Preview → Edit)', () => {
    act(() => shellMode.select('preview'));
    expect(shellStepBack({ canEdit: true, forward: forward(false) })).toBe('set');
    expect(shellMode.get().mode).toBe('edit');
  });

  test('Present leaves to where it came from — the canvas is not asked', () => {
    act(() => shellMode.select('preview'));
    act(() => shellMode.present({ kind: 'artboards', from: 'start' } as never));
    expect(shellStepBack({ canEdit: true, forward: forward() })).toBe('exit-present');
    expect(sent).toEqual([]);
    expect(shellMode.get().mode).toBe('preview');
  });

  test('a text field or an open menu keeps its own esc: nothing is handed over', () => {
    act(() => shellMode.select('preview'));
    expect(shellStepBack({ canEdit: true, typing: true, forward: forward() })).toBeNull();
    expect(sent).toEqual([]);
  });

  test('the canvas replays esc on its document (its router and the ladder are the one implementation)', () => {
    expect(REPLAY_KEYS['ui.step-back']).toMatchObject({ key: 'Escape' });
    const seen: string[] = [];
    const doc = {
      body: { dispatchEvent: (e: KeyboardEvent) => seen.push(e.key) },
    } as unknown as Document;
    expect(replayActionKey('ui.step-back', doc)).toBe(true);
    expect(seen).toEqual(['Escape']);
  });
});

describe('G4 · a floating panel folds toward its corner icon (04 md-motion), it does not cut', () => {
  const BOX = { left: 16, top: 68, right: 336, bottom: 468, width: 320, height: 400, x: 16, y: 68 };
  const withBox = (el: Element, box = BOX) => {
    (el as HTMLElement).getBoundingClientRect = () => box as DOMRect;
    return el as HTMLElement;
  };
  const stage = () => {
    const body = document.createElement('div');
    body.className = 'sh-body sh-body--float';
    withBox(body, { ...BOX, left: 0, top: 0, right: 1000, bottom: 800, width: 1000, height: 800 });
    document.body.append(body);
    return body;
  };
  afterEach(() => {
    for (const el of document.querySelectorAll('.sh-body')) el.remove();
  });

  test('the ghost is a picture of the island: no hook, no id, no focus, no click — placed where it was', () => {
    const body = stage();
    const island = document.createElement('div');
    island.className = 'sh-dockslot-inner island';
    island.setAttribute('data-testid', 'dock-slot-left');
    island.innerHTML = '<button id="x" data-testid="canvas-row-a">A</button>';
    body.append(island);
    withBox(island);
    const ghost = spawnFoldGhost(island, body, 'top-left') as HTMLElement;
    expect(ghost).not.toBeNull();
    expect(body.contains(ghost)).toBe(true);
    expect(ghost.classList.contains('sh-fold-ghost')).toBe(true);
    expect(ghost.getAttribute('aria-hidden')).toBe('true');
    expect(ghost.hasAttribute('inert')).toBe(true);
    expect(ghost.getAttribute('data-fold')).toBe('top-left');
    expect(ghost.querySelector('[data-testid], [id]')).toBeNull();
    expect(ghost.hasAttribute('data-testid')).toBe(false);
    expect(ghost.style.left).toBe('16px');
    expect(ghost.style.top).toBe('68px');
    expect(ghost.style.width).toBe('320px');
    expect(ghost.style.pointerEvents).toBe('none');
    // gone when its animation ends
    act(() => {
      ghost.dispatchEvent(new Event('animationend'));
    });
    expect(body.contains(ghost)).toBe(false);
  });

  test('a node that was never laid out folds nothing; reduced motion is a cut (no ghost at all)', () => {
    const body = stage();
    const island = document.createElement('div');
    body.append(island);
    withBox(island, { ...BOX, width: 0, height: 0 });
    expect(spawnFoldGhost(island, body)).toBeNull();
    withBox(island);
    const mm = window.matchMedia;
    window.matchMedia = ((q: string) => ({ matches: q.includes('reduce'), media: q })) as never;
    try {
      expect(spawnFoldGhost(island, body)).toBeNull();
    } finally {
      window.matchMedia = mm;
    }
  });

  test('DockSlot: the left panel closing leaves a ghost in the window body, not a cut', () => {
    const body = stage();
    const r = createRoot(body);
    const slot = (open: boolean) => (
      <DockSlot
        side="left"
        width={320}
        open={open}
        ids={['tree']}
        activeId="tree"
        onPick={() => {}}
        onFold={() => {}}
        floating
      >
        <div data-testid="canvas-list">Canvases</div>
      </DockSlot>
    );
    act(() => r.render(slot(true)));
    withBox(body.querySelector('[data-testid="dock-slot-left"]') as Element);
    expect(body.querySelector('.sh-fold-ghost')).toBeNull();
    act(() => r.render(slot(false)));
    expect(body.querySelector('[data-testid="dock-slot-left"]')).toBeNull(); // the real panel is gone at once
    const ghost = body.querySelector('.sh-fold-ghost') as HTMLElement | null;
    expect(ghost).not.toBeNull();
    expect(ghost?.getAttribute('data-fold')).toBe('top-left');
    expect(ghost?.textContent).toContain('Canvases');
    expect(ghost?.querySelector('[data-testid]')).toBeNull();
    act(() => r.unmount());
  });

  test('DockSlot: Preview folds the panels (the slot stays mounted, `hidden`): the ghost folds from the rect it had', () => {
    const body = stage();
    const r = createRoot(body);
    const slot = (hidden: boolean) => (
      <DockSlot
        side="right"
        width={320}
        open
        ids={['inspector']}
        activeId="inspector"
        onPick={() => {}}
        onFold={() => {}}
        floating
        hidden={hidden}
      >
        <div>Inspector body</div>
      </DockSlot>
    );
    act(() => r.render(slot(false)));
    withBox(body.querySelector('[data-testid="dock-slot-right"]') as Element); // the rect a commit measures
    act(() => r.render(slot(false))); // a commit while visible keeps the rect
    expect(body.querySelector('.sh-fold-ghost')).toBeNull();
    act(() => r.render(slot(true)));
    const ghost = body.querySelector('.sh-fold-ghost') as HTMLElement | null;
    expect(ghost).not.toBeNull();
    expect(ghost?.getAttribute('data-fold')).toBe('top-right');
    expect(ghost?.textContent).toContain('Inspector body');
    expect(ghost?.style.width).toBe('320px');
    // coming back is not a fold
    body.querySelector('.sh-fold-ghost')?.remove();
    act(() => r.render(slot(false)));
    expect(body.querySelector('.sh-fold-ghost')).toBeNull();
    act(() => r.unmount());
  });

  test('the pinned layout is not floating: no ghost (today’s docked column stays a cut)', () => {
    const body = stage();
    const r = createRoot(body);
    const slot = (open: boolean) => (
      <DockSlot
        side="left"
        width={320}
        open={open}
        ids={['tree']}
        activeId="tree"
        onPick={() => {}}
        onFold={() => {}}
      >
        <div>Canvases</div>
      </DockSlot>
    );
    act(() => r.render(slot(true)));
    withBox(body.querySelector('[data-testid="dock-slot-left"]') as Element);
    act(() => r.render(slot(false)));
    expect(body.querySelector('.sh-fold-ghost')).toBeNull();
    act(() => r.unmount());
  });

  test('CSS: it shrinks on --dur-panel / --ease-out toward its corner; reduced motion removes it', () => {
    const css = readFileSync(
      join(import.meta.dir, '../client/v2/shell/floating-panels.css'),
      'utf8'
    );
    expect(css).toMatch(
      /\.sh-fold-ghost\s*\{[^}]*animation:\s*sh-island-fold var\(--dur-panel\) var\(--ease-out\)/
    );
    expect(css).toContain('@keyframes sh-island-fold');
    expect(css).toMatch(/prefers-reduced-motion[\s\S]*\.sh-fold-ghost\s*\{\s*display:\s*none/);
    for (const o of ['top-right', 'bottom-left', 'bottom-right'])
      expect(css).toContain(`.sh-fold-ghost[data-fold="${o}"]`);
  });
});
