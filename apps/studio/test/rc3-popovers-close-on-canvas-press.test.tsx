// rc3 r4-12 follow-up — the shell popovers that closed on "the focus moving into the canvas" listened only for the
// shell window's blur, which WebKit (the packaged app) never sends for a press in the canvas iframe. Each now also
// closes on the canvas's press notice (`canvas-pointerdown` over the dgn bridge → client/v2/shell/canvas-pointer.js),
// with no blur at all, and the notice moves no focus (the press belongs to the canvas).

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

beforeAll(() => {
  if (GlobalRegistrator.isRegistered) GlobalRegistrator.unregister();
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => GlobalRegistrator.unregister());

const roots: Root[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
});

async function mount(node: unknown) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(node as never));
  return host;
}

type Row = {
  name: string;
  /** mounts the popover open; `isOpen` says whether it still is */
  open: () => Promise<{ isOpen: () => boolean }>;
};

const ROWS: Row[] = [
  {
    name: 'the project pill menu',
    async open() {
      const React = await import('react');
      const { ProjectPill } = await import('../client/v2/shell/project-pill.jsx');
      const { menuCtx } = await import('../client/v2/shell/project-menu-model.js');
      await mount(
        React.createElement(ProjectPill, {
          project: 'Studio site',
          canvas: 'Pricing',
          ctx: menuCtx({ native: true, canvasOpen: true }),
          state: {},
          run() {},
        })
      );
      const pill = document.querySelector('[data-testid="project-pill"]') as HTMLElement;
      await act(async () => pill.click());
      return { isOpen: () => !!document.querySelector('[data-testid="project-menu"]') };
    },
  },
  {
    name: 'the colour popover',
    async open() {
      const React = await import('react');
      const { ColourPopover } = await import('../client/v2/inspector/sections/colour-popover.jsx');
      let closed = false;
      await mount(
        React.createElement(ColourPopover, {
          name: 'background',
          label: 'Fill',
          current: null,
          colors: [],
          vals: {},
          themes: {},
          hasSystem: false,
          recent: [],
          anchorRef: { current: null },
          onPick() {},
          onCustom() {},
          onNone() {},
          onClose: () => {
            closed = true;
          },
        })
      );
      return { isOpen: () => !closed };
    },
  },
  {
    name: 'the size picker (F)',
    async open() {
      const React = await import('react');
      const { default: SizePicker } = await import('../client/v2/kinds/SizePicker.jsx');
      let closed = false;
      await mount(
        React.createElement(SizePicker, {
          canvas: '.design/ui/Home.tsx',
          anchor: null,
          load: () => new Promise(() => {}),
          onGhost() {},
          onPlace() {},
          onClose: () => {
            closed = true;
          },
        })
      );
      return { isOpen: () => !closed };
    },
  },
  {
    name: 'the section templates panel (pinned to the toolbar)',
    async open() {
      const React = await import('react');
      const { default: TemplatesPanel } = await import(
        '../client/v2/annotations/templates-panel.jsx'
      );
      let closed = false;
      await mount(
        React.createElement(TemplatesPanel, {
          anchor: { placement: 'above', left: 100, width: 640, bottom: 80, maxHeight: 500 },
          onClose: () => {
            closed = true;
          },
        })
      );
      return { isOpen: () => !closed };
    },
  },
];

describe('shell popovers close on a press in the canvas, with no window blur', () => {
  for (const row of ROWS) {
    test(row.name, async () => {
      const { announceCanvasPointer } = await import('../client/v2/shell/canvas-pointer.js');
      const { isOpen } = await row.open();
      expect(isOpen()).toBe(true);
      const focusedBefore = document.activeElement;
      await act(async () => announceCanvasPointer());
      expect(isOpen()).toBe(false);
      // the notice itself moves no focus — the press belongs to the canvas
      if (focusedBefore?.isConnected) expect(document.activeElement).toBe(focusedBefore);
    });
  }
});
