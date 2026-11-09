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

  // ── r4-12, second sweep: every shell menu that already closed on an outside press ──────────────────────────
  {
    name: 'the mode switch Present ⌄ menu',
    async open() {
      const React = await import('react');
      const { ModeSwitch } = await import('../client/v2/shell/mode-switch.jsx');
      await mount(
        React.createElement(ModeSwitch, {
          mode: 'edit',
          caps: { edit: true, preview: true, present: true },
          onSelect() {},
          onPresentCanvas() {},
        })
      );
      const chev = document.querySelector('[data-testid="mode-present-menu"]') as HTMLElement;
      await act(async () => chev.click());
      return { isOpen: () => chev.getAttribute('aria-expanded') === 'true' };
    },
  },
  {
    name: 'the undo history popover',
    async open() {
      const React = await import('react');
      const { UndoHistoryHost, undoHistoryOpen } = await import(
        '../client/v2/undo/undo-history.jsx'
      );
      const { createUndoProjection } = await import('../client/v2/undo/use-undo-projection.jsx');
      const store = createUndoProjection({
        request: async () => ({ ok: true, entries: [], others: [] }),
        now: () => 0,
        announce: () => {},
      });
      await mount(
        React.createElement(UndoHistoryHost, {
          activePath: '.design/ui/a.tsx',
          store,
          now: () => 0,
          postToActiveCanvas() {},
          onVersionHistory() {},
        })
      );
      await act(async () => undoHistoryOpen.open());
      return { isOpen: () => undoHistoryOpen.get() };
    },
  },
  {
    // 2.1.1 T2/T4 — the account menu (the chip's popover)
    name: 'the account menu',
    async open() {
      const React = await import('react');
      const { ProjectAccountMenu, ProjectAccountPopover } = await import(
        '../client/v2/shell/project-account-card.jsx'
      );
      const { accountFace, accountMenu } = await import(
        '../client/v2/shell/project-account-model.js'
      );
      const conn = { state: 'local', kind: 'local', host: null, url: null, badge: null };
      const face = accountFace({ conn, profile: { id: 'work', label: 'Work' } });
      let open = true;
      function Host() {
        const [o, setO] = React.useState(true);
        open = o;
        return React.createElement(
          ProjectAccountPopover,
          { open: o, onClose: () => setO(false) },
          React.createElement(ProjectAccountMenu, {
            menu: accountMenu({ native: true, project: 'Studio site', conn, face }),
            face,
            onAction() {},
          })
        );
      }
      await mount(React.createElement(Host));
      return {
        isOpen: () => open && !!document.querySelector('[data-testid="account-menu"]'),
      };
    },
  },
  {
    name: 'a token chip menu (useDismiss)',
    async open() {
      const React = await import('react');
      const { useDismiss } = await import('../client/v2/inspector/token-chip.jsx');
      let closed = false;
      function Probe() {
        const ref = React.useRef(null);
        useDismiss(true, () => (closed = true), ref);
        return React.createElement('div', { ref });
      }
      await mount(React.createElement(Probe));
      return { isOpen: () => !closed };
    },
  },
  {
    name: 'the AI scope chip menu',
    async open() {
      const React = await import('react');
      const { ScopeChip } = await import('../client/v2/ai/ScopeChip.jsx');
      await mount(
        React.createElement(ScopeChip, {
          scope: { kind: 'whole' },
          artboards: [{ id: 'post', label: 'Post 1:1' }],
          onChoose() {},
          onRemove() {},
        })
      );
      const chip = document.querySelector('[data-testid="ai-scope-chip"]') as HTMLElement;
      await act(async () => chip.click());
      return { isOpen: () => !!document.querySelector('[data-testid="ai-scope-menu"]') };
    },
  },
  {
    name: 'the AI attach menu',
    async open() {
      const React = await import('react');
      const { AttachMenu } = await import('../client/v2/ai/AttachMenu.jsx');
      await mount(React.createElement(AttachMenu, { attach: { add() {}, files: [] } }));
      const clip = document.querySelector('[data-testid="ai-attach-clip"]') as HTMLElement;
      await act(async () => clip.click());
      return { isOpen: () => !!document.querySelector('[data-testid="ai-attach-menu"]') };
    },
  },
  {
    name: 'the AI run list',
    async open() {
      const React = await import('react');
      const { RunsCount } = await import('../client/v2/ai/RunList.jsx');
      const { createRunsStore } = await import('../client/v2/ai/runs-store.js');
      const FILE = '.design/ui/combine.tsx';
      const run = {
        v: 1,
        runId: 'r_1aaaaaa',
        askId: 'a_1aaaaaa',
        chatId: 'c1',
        origin: 'maude-chat',
        actor: 'you',
        label: 'Make it greener',
        scope: { canvas: 'ui/combine.tsx', artboards: ['post'] },
        state: 'running',
        leases: [{ canvas: `path:${FILE}`, artboard: 'post', token: 1 }],
        waiting: [],
        touched: {},
        objects: [],
        createdAt: 1,
      };
      const fetchImpl = (async () =>
        new Response(JSON.stringify({ seq: 1, mine: [run], others: [] }), {
          status: 200,
        })) as unknown as typeof fetch;
      const store = createRunsStore({ fetchImpl, target: new EventTarget() as unknown as Window });
      await store.refresh();
      await mount(
        React.createElement(RunsCount, { store, activeCanvas: FILE, designRel: '.design' })
      );
      const count = document.querySelector('[data-testid="ai-chat-count"]') as HTMLElement;
      await act(async () => count.click());
      return { isOpen: () => !!document.querySelector('[data-testid="ai-runs-list"]') };
    },
  },
  {
    name: 'the AI chat list row ⋯ menu',
    async open() {
      const React = await import('react');
      const { ChatList } = await import('../client/v2/ai/ChatList.jsx');
      const { menuCtx } = await import('../client/v2/shell/project-menu-model.js');
      const now = Date.now();
      const fetchImpl = (async (url: string) =>
        url.startsWith('/_api/acp/chats')
          ? Response.json({
              groups: [
                { canvas: 'ui/A.tsx', chats: [{ id: 'c1', title: 'Greener', updated: now }] },
              ],
            })
          : new Response('{}', { status: 404 })) as unknown as typeof fetch;
      await mount(
        React.createElement(ChatList, {
          projectName: 'Studio site',
          busy: {},
          ctx: menuCtx({ native: true }),
          fetchImpl,
          onOpen() {},
          onBack() {},
          onRename() {},
          onCopyTranscript() {},
          onArchive() {},
          onTrashed() {},
        })
      );
      await act(async () => new Promise((r) => setTimeout(r, 5)));
      const dots = document.querySelector('[aria-label="More options"]') as HTMLElement;
      await act(async () => dots.click());
      return { isOpen: () => !!document.querySelector('[data-testid="chat-overflow-menu"]') };
    },
  },
  {
    name: 'the export Other formats menu',
    async open() {
      const React = await import('react');
      const { OtherFormats } = await import('../client/v2/export/other-formats.jsx');
      let open = true;
      await mount(
        React.createElement(OtherFormats, {
          groups: [
            { group: 'Images', items: [{ id: 'png', label: 'PNG', format: 'png', note: 'n' }] },
          ],
          format: 'png',
          onPick() {},
          open: true,
          setOpen: (v: boolean) => {
            open = v;
          },
        })
      );
      return { isOpen: () => open };
    },
  },
  {
    name: 'an export job row menu',
    async open() {
      const React = await import('react');
      const { JobRow } = await import('../client/v2/export/job-row.jsx');
      const noop = () => {};
      await mount(
        React.createElement(JobRow, {
          job: {
            id: 'j9',
            format: 'png',
            scope: 'canvas-as-separate',
            status: 'done',
            createdAt: '2026-10-18T11:40:00',
            filename: 'Hype.zip',
            spec: { v: 2, scope: 'canvas', canvas: 'ui/Hype.tsx', format: 'png' },
          },
          native: true,
          on: {
            reveal: noop,
            download: noop,
            again: noop,
            retry: noop,
            againWith: noop,
            copyNames: noop,
            remove: noop,
          },
        })
      );
      const more = document.querySelector('[data-testid="export-job-more-j9"]') as HTMLElement;
      await act(async () => more.click());
      return { isOpen: () => !!document.querySelector('[data-testid="export-job-menu-j9"]') };
    },
  },
  {
    name: 'the share role menu',
    async open() {
      const React = await import('react');
      const { RoleMenu } = await import('../client/v2/share/role-menu.jsx');
      let closed = false;
      await mount(
        React.createElement(RoleMenu, {
          row: { id: 'tereza', name: 'Tereza', role: 'member' },
          roles: ['member', 'viewer'],
          scopeName: 'Studio site',
          anchor: { left: 10, top: 10, bottom: 30, right: 100, width: 90, height: 20 },
          onPick() {},
          onClose: () => {
            closed = true;
          },
        })
      );
      return { isOpen: () => !closed };
    },
  },
  {
    name: 'a presence face menu',
    async open() {
      const React = await import('react');
      const { PresenceFaces } = await import('../client/v2/presence/faces.jsx');
      const presence = {
        labelOf: () => 'Pricing',
        roleOf: () => 'member',
        canvasLabel: () => 'Pricing',
        canSummon: () => false,
        run() {},
        follow() {},
        go() {},
        bring() {},
      };
      await mount(
        React.createElement(PresenceFaces, {
          faces: [{ clientID: 7, name: 'Tereza', initials: 'T' }],
          presence,
          onFollow() {},
        })
      );
      const face = document.querySelector('[data-testid="share-cluster-face-7"]') as HTMLElement;
      await act(async () => face.click());
      const host = document.querySelector('.sh-faces-host') as HTMLElement;
      const opened = host.querySelectorAll('[role="menu"], [role="dialog"]').length;
      expect(opened).toBeGreaterThan(0);
      return { isOpen: () => host.querySelectorAll('[role="menu"], [role="dialog"]').length > 0 };
    },
  },
  {
    name: 'the timeline transition picker',
    async open() {
      const React = await import('react');
      const { TransitionPicker } = await import(
        '../client/v2/timeline/joins/transition-picker.jsx'
      );
      let closed = false;
      await mount(
        React.createElement(TransitionPicker, {
          title: 'Join',
          tile: 'fade',
          frames: 12,
          fps: 24,
          a: { url: null },
          b: { url: null },
          x: 10,
          y: 10,
          onPick() {},
          onLength() {},
          onClose: () => {
            closed = true;
          },
        })
      );
      return { isOpen: () => !closed };
    },
  },
  {
    name: 'the Move to… picker (TreeRowMenu, the project menu’s move)',
    async open() {
      const React = await import('react');
      const { TreeRowMenu } = await import('../client/tree-row-menu.jsx');
      let closed = false;
      await mount(
        React.createElement(TreeRowMenu, {
          state: { x: 10, y: 10, view: 'root', path: 'ui/a.tsx' },
          rootItems: [{ id: 'open', label: 'Open', onSelect() {} }],
          destinations: [],
          onPickDestination() {},
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
