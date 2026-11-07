// #170 F34 — the project menu forgives the diagonal. Moving from File toward its open submenu crosses the Edit row;
// that hover must not switch the submenu away, unless the pointer comes to rest on Edit. A straight move down the menu
// switches at once, as before.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
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
import { AIM_DELAY_MS } from '../client/v2/shell/menu-aim.js';
import { menuCtx } from '../client/v2/shell/project-menu-model.js';
import { ProjectPill } from '../client/v2/shell/project-pill.jsx';

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
});

const rect = (left: number, top: number, right: number, bottom: number) =>
  ({
    left,
    top,
    right,
    bottom,
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
    toJSON: () => ({}),
  }) as DOMRect;
const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const stub = (el: HTMLElement | null, r: DOMRect) => {
  if (el) el.getBoundingClientRect = () => r;
};
const settle = (ms = 0) =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
const move = (x: number, y: number) =>
  act(async () => {
    q('project-pill')
      ?.parentElement?.querySelector('.sh-pm-root')
      ?.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: y }));
  });
const enter = (id: string) =>
  act(async () => {
    q(id)?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  });
const openSub = () =>
  document.querySelector('[data-sub][aria-expanded="true"]')?.getAttribute('data-sub');

async function rig() {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <ProjectPill
        project="Alligators brand"
        canvas="Combine-kampan"
        ctx={menuCtx({ native: true, canvasOpen: true })}
        state={{}}
        run={() => {}}
      />
    );
  });
  await act(async () => {
    q('project-pill')?.click();
  });
  // File's submenu open, with boxes: menu 0-200, File row y 100-130, Edit row 130-160, View row 160-190,
  // the submenu to the right, x 204-404, y 100-300
  await enter('project-menu-row-sub-file');
  expect(openSub()).toBe('File');
  stub(q('project-menu'), rect(0, 90, 200, 400));
  stub(
    document.querySelector('[data-sub="File"] ~ [role=menu]') as HTMLElement,
    rect(204, 100, 404, 300)
  );
  stub(q('project-menu-row-sub-edit'), rect(0, 130, 200, 160));
  stub(q('project-menu-row-sub-view'), rect(0, 160, 200, 190));
}

describe('the project menu forgives the diagonal', () => {
  test('a hover on Edit while heading for File’s submenu waits; reaching the submenu keeps File', async () => {
    await rig();
    await move(150, 110); // on the File row, near its right end
    await move(175, 140); // diagonal toward the submenu, over the Edit row's right end
    await enter('project-menu-row-sub-edit');
    expect(openSub()).toBe('File'); // not switched on the way
    await move(210, 150); // into the submenu (no longer on Edit)
    await settle(AIM_DELAY_MS + 80);
    expect(openSub()).toBe('File');
  });

  test('a pointer that comes to rest on Edit switches to it after the short wait', async () => {
    await rig();
    await move(150, 110);
    await move(175, 140);
    await enter('project-menu-row-sub-edit');
    expect(openSub()).toBe('File');
    await settle(AIM_DELAY_MS + 80);
    expect(openSub()).toBe('Edit');
  });

  test('moving straight down to View switches at once', async () => {
    await rig();
    await move(150, 110);
    await move(150, 175); // straight down: not aiming at the submenu
    await enter('project-menu-row-sub-view');
    expect(openSub()).toBe('View');
  });
});
