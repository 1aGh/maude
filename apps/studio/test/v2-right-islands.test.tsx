// V2-4.4b — the right side is separate islands (the AI chat, the Inspector, Comments), the left panel keeps
// its own header strip, and the old dock tab strip / CollapsedRail are gone with every feature rehomed.
// Real markup (renderToStaticMarkup of the actual DockSlot / ChatHeader), real registry, real source.
import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { ACTIONS_BY_ID } from '../actions/index.ts';
import { ChatHeader } from '../client/panels/chat-header.jsx';
import {
  DOCK_PANELS,
  DockSlot,
  hasPanelTabs,
  PANEL_SIDES_DEFAULTS,
  siblingsToClose,
} from '../client/shell/dock.jsx';
import { DOCK_RAIL_HOMES } from '../client/v2/shell/dock-rail-homes.js';
import {
  isFollowable,
  shouldCloseOnDeselect,
  shouldOpenOnSelect,
} from '../client/v2/shell/inspector-follow.js';
import { shellCss } from './_shell-css';

const STUDIO = join(import.meta.dir, '..');
const read = (rel: string) => readFileSync(join(STUDIO, rel), 'utf8');
const noop = () => {};

const slot = (side: 'left' | 'right', o: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    <DockSlot
      side={side}
      width={300}
      open
      ids={side === 'left' ? ['tree', 'layers', 'assets'] : ['inspector', 'comments']}
      activeId={side === 'left' ? 'tree' : 'inspector'}
      onPick={noop}
      onFold={noop}
      floating
      {...o}
    >
      <aside className="sh-sidebar" />
    </DockSlot>
  );

describe('no dock tab strip, no rail', () => {
  test('the markup carries neither hook, left or right', () => {
    for (const side of ['left', 'right'] as const) {
      const html = slot(side, { ai: <aside className="sh-rpanel" />, aiShown: true });
      expect(html).not.toContain('dock-tab-');
      expect(html).not.toContain('st-docktab');
      expect(html).not.toContain('st-rail');
    }
  });

  test('the component code and its CSS are gone', () => {
    expect(existsSync(join(STUDIO, 'client/shell/collapsed-rail.jsx'))).toBe(false);
    const app = read('client/app.jsx');
    expect(app).not.toContain('CollapsedRail');
    expect(app).not.toContain('collapsed-rail');
    for (const [css, src] of [['the shell stylesheet', shellCss()]]) {
      expect(src, css).not.toMatch(/\.st-rail\b/);
      expect(src, css).not.toMatch(/\.st-docktab/);
    }
    expect(read('client/shell/dock.jsx')).not.toContain('st-docktab');
  });
});

describe('the left panel keeps a strip — in its own header', () => {
  test('Canvases · Layers · Assets, a Hide icon, `panel-tab-<id>` hooks', () => {
    const html = slot('left');
    expect(html).toContain('data-testid="panel-head-left"');
    for (const id of ['tree', 'layers', 'assets'])
      expect(html).toContain(`data-testid="panel-tab-${id}"`);
    expect(html).toContain('>Canvases<');
    expect(html).toContain('data-testid="panel-fold-left"');
    expect(html).toContain('aria-selected="true"');
  });

  test('a lone left panel has no strip; neither has the default right side', () => {
    expect(hasPanelTabs(['tree'])).toBe(false);
    expect(hasPanelTabs(['inspector', 'comments', 'changes', 'sync'])).toBe(false);
    expect(hasPanelTabs(['tree', 'layers', 'assets', 'inspector'])).toBe(true);
    expect(slot('right')).not.toContain('role="tablist"');
  });
});

describe('the right side is separate islands', () => {
  test('the main panel and the AI chat are two islands, each declaring its edge', () => {
    const html = slot('right', { ai: <aside className="sh-rpanel" />, aiShown: true });
    expect(html).toContain('data-testid="dock-slot-right"');
    expect(html).toContain('data-testid="dock-ai-right"');
    expect(html.match(/data-occludes="right"/g)?.length).toBe(2);
    expect(html).toContain('has-ai');
  });

  test('a hidden AI chat stays mounted (the stream survives) but is not an island', () => {
    const html = slot('right', { ai: <aside className="sh-rpanel" />, aiShown: false });
    expect(html).toContain('data-testid="dock-ai-right"');
    expect(html).toMatch(/data-testid="dock-ai-right"[^>]*hidden/);
    expect(html.match(/data-occludes="right"/g)?.length).toBe(1);
    expect(html).not.toContain('has-ai');
  });

  test('the AI chat alone leaves no empty main island', () => {
    const html = slot('right', { open: false, ai: <aside className="sh-rpanel" />, aiShown: true });
    expect(html).not.toContain('data-testid="dock-slot-right"');
    expect(html).toContain('data-testid="dock-ai-right"');
    expect(html).not.toContain('is-collapsed');
  });

  test('Comments is a right island like the AI chat (CONTRACT §6, C7)', () => {
    expect(PANEL_SIDES_DEFAULTS.comments).toBe('right');
    expect(PANEL_SIDES_DEFAULTS.assistant).toBe('right');
    const html = slot('right', { activeId: 'comments', ids: ['inspector', 'comments'] });
    expect(html).toContain('data-testid="dock-slot-right"');
    expect(html).toContain('data-occludes="right"');
    expect(html).not.toContain('role="tablist"');
  });

  test('opening the AI chat closes nothing, and nothing closes it; the rest stay one per side', () => {
    const sideOf = (id: string) => PANEL_SIDES_DEFAULTS[id as keyof typeof PANEL_SIDES_DEFAULTS];
    expect(siblingsToClose('assistant', sideOf)).toEqual([]);
    expect(siblingsToClose('inspector', sideOf)).not.toContain('assistant');
    expect(siblingsToClose('inspector', sideOf).sort()).toEqual(['changes', 'comments', 'sync']);
    expect(siblingsToClose('tree', sideOf).sort()).toEqual(['assets', 'layers']);
    // a panel moved to the other side is independent of the old one
    const moved = (id: string) => (id === 'comments' ? 'left' : sideOf(id));
    expect(siblingsToClose('inspector', moved)).not.toContain('comments');
    expect(DOCK_PANELS.map((p) => p.id)).toContain('assistant');
  });
});

describe('the AI chat header is 03’s', () => {
  const render = (props: Record<string, unknown> = {}) =>
    renderToStaticMarkup(
      <ChatHeader connected running={0} onToggleList={noop} onNew={noop} onHide={noop} {...props}>
        <span className="chat-switch">Make it greener</span>
      </ChatHeader>
    );

  test('spark · title ⌄ · New chat · Hide', () => {
    const html = render();
    expect(html).toContain('data-testid="ai-chat-header"');
    expect(html).toContain('chat-hd-spark');
    expect(html).toContain('Make it greener');
    expect(html).toContain('data-testid="ai-chat-new"');
    expect(html).toContain('aria-label="Hide the AI chat panel"');
    // Hide, never close / collapse (CONTRACT §3)
    expect(html).not.toMatch(/Close assistant|Collapse/);
  });

  test('"✦ N" counts YOUR running chats and is absent at zero', () => {
    expect(render()).not.toContain('ai-chat-count');
    const html = render({ running: 2 });
    expect(html).toContain('data-testid="ai-chat-count"');
    expect(html).toContain('2 chats running');
    expect(render({ running: 1 })).toContain('1 chat running');
  });

  test('not connected: "AI" and Hide only', () => {
    const html = render({ connected: false, running: 3 });
    expect(html).toContain('>AI<');
    expect(html).not.toContain('ai-chat-new');
    expect(html).not.toContain('ai-chat-count');
    expect(html).toContain('ai-chat-hide');
  });

  test('ChatPanel mounts the header and drops the old strip', () => {
    const src = read('client/panels/ChatPanel.jsx');
    expect(src).toContain('<ChatHeader');
    expect(src).not.toContain('Close assistant');
    expect(src).not.toContain('chat-newbtn');
  });
});

describe('the Inspector follows the selection', () => {
  const on = { pref: true, viewer: false, hasId: true, anyMainOpen: false };
  test('appears on a selection', () => {
    expect(shouldOpenOnSelect(on)).toBe(true);
  });
  test('not with the pref off, for a viewer, without an id, or over an open main panel', () => {
    expect(shouldOpenOnSelect({ ...on, pref: false })).toBe(false);
    expect(shouldOpenOnSelect({ ...on, viewer: true })).toBe(false);
    expect(shouldOpenOnSelect({ ...on, hasId: false })).toBe(false);
    expect(shouldOpenOnSelect({ ...on, anyMainOpen: true })).toBe(false);
  });
  test('a whole-artboard pick while the AI chat is open is the ask scope, not an edit: no Inspector (board 03)', () => {
    expect(shouldOpenOnSelect({ ...on, askingAi: true })).toBe(false);
    // an element with an id still follows even with the chat open (01 cf-select-tweak)
    expect(shouldOpenOnSelect({ ...on, askingAi: false })).toBe(true);
    const src = read('client/hooks/use-shell-core.jsx');
    expect(src).toMatch(/askingAi: assistantOpenRef\.current && isArtboardSelection\(sel\)/);
  });
  test('goes away on deselect — only when the selection opened it, and only with the pref on', () => {
    const off = { pref: true, autoOpened: true, hasSelection: false };
    expect(shouldCloseOnDeselect(off)).toBe(true);
    expect(shouldCloseOnDeselect({ ...off, hasSelection: true })).toBe(false);
    expect(shouldCloseOnDeselect({ ...off, autoOpened: false })).toBe(false); // opened on purpose: stays
    expect(shouldCloseOnDeselect({ ...off, pref: false })).toBe(false);
  });
  test('the shell runs both halves, and the AI chat does not block the first', () => {
    const src = read('client/hooks/use-shell-core.jsx');
    expect(src).toContain('shouldOpenOnSelect(');
    expect(src).toContain('shouldCloseOnDeselect(');
    const guard = /anyRightPanelOpenRef\.current =[\s\S]*?;/.exec(src)?.[0] ?? '';
    expect(guard).toContain('inspectorOpen');
    expect(guard).not.toContain('assistantOpen');
  });
  test('the pref is a registered View › Advanced toggle', () => {
    const a = ACTIONS_BY_ID.get('view.inspector-on-select');
    expect(a?.label).toBe('Open inspector on select');
    expect(a?.kind).toBe('toggle');
    expect(ACTIONS_BY_ID.has('view.inspector')).toBe(true);
  });
});

describe('every feature of the dock strip and the rail resolves to a control', () => {
  test('the rehoming table: the file produces the hook, the registry knows the action', () => {
    expect(DOCK_RAIL_HOMES.length).toBeGreaterThanOrEqual(14);
    const testids = new Set(
      (JSON.parse(read('client/testids.json')) as { hook: string }[]).map((e) => e.hook)
    );
    for (const c of DOCK_RAIL_HOMES) {
      expect(c.home, c.was).toBeTruthy();
      expect(existsSync(join(STUDIO, c.file)), `${c.was}: ${c.file}`).toBe(true);
      const src = read(c.file);
      if (c.testid) {
        expect(testids.has(c.testid), `${c.was}: testids.json has ${c.testid}`).toBe(true);
        const stem = c.testid.replace(/<.*$/, '');
        expect(src.includes(stem), `${c.was}: ${c.file} produces ${c.testid}`).toBe(true);
      }
      if (c.actionId)
        expect(ACTIONS_BY_ID.has(c.actionId), `${c.was}: ${c.actionId} registered`).toBe(true);
    }
  });

  test('the old hooks are retired from testids.json, the new ones are in', () => {
    const hooks = (JSON.parse(read('client/testids.json')) as { hook: string }[]).map(
      (e) => e.hook
    );
    expect(hooks).not.toContain('dock-tab-<id>');
    expect(hooks).not.toContain('.st-docktab');
    for (const h of [
      'panel-tab-<id>',
      'panel-fold-<side>',
      'panel-grip-<side>',
      'panel-side-<id>',
      'dock-ai-<side>',
      'ai-chat-header',
      'ai-chat-new',
      'ai-chat-hide',
      'ai-chat-count',
    ])
      expect(hooks, h).toContain(h);
  });

  test('the panel-side swap (panelSides) is still persisted and still offered', () => {
    const settings = read('client/panels/SettingsPanel.jsx');
    expect(settings).toContain('onSetPanelSide');
    expect(settings).toContain('panel-side-');
    for (const id of ['tree', 'layers', 'assets', 'inspector', 'comments', 'assistant'])
      expect(PANEL_SIDES_DEFAULTS[id as keyof typeof PANEL_SIDES_DEFAULTS]).toBeTruthy();
  });

  test('the pinned layout keeps its way back: corner icons render in every layout', () => {
    const app = read('client/app.jsx');
    expect(app).toContain('<CornerIcons');
    expect(app).not.toMatch(/\(floating \|\| panelsHidden\) &&\s*\(\s*<CornerIcons/);
  });
});

// V2-8.5 c3 (01 cf-select-tweak · 14 ed-ab-select): the inspector comes with the selection — a whole artboard too
describe('inspector follows an artboard selection', () => {
  test('an element with an id, or a whole artboard (no id), is followable; nothing else', () => {
    expect(isFollowable({ id: 'hero' })).toBe(true);
    expect(isFollowable({ selector: '[data-dc-screen="desktop"]' })).toBe(true);
    expect(isFollowable({ selector: '[data-dc-screen="desktop"] > div' })).toBe(false);
    expect(isFollowable({})).toBe(false);
    expect(isFollowable(null)).toBe(false);
  });
  test('the shell asks that rule, not a bare element id', () => {
    expect(read('client/hooks/use-shell-core.jsx')).toContain('hasId: isFollowable(sel)');
  });
});
