// S5.12 (03 `ai-chat-list`, `ai-advanced`, `ai-adv-edges`) — the chat list and the Advanced fold as data,
// their registry rows, ⌘K, and "nothing deleted" for every v1 chat control the move carried.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ACTIONS, ACTIONS_BY_ID } from '../actions/index.ts';
import { parseUsage } from '../client/panels/acp-usage.js';
import {
  ADVANCED_ROWS,
  ADVANCED_WHERE,
  AI_FOLD_PANEL,
  contextMeter,
  limitMeter,
  modeBanner,
  modeOptions,
  rawLogLines,
  rawLogText,
  rowForAction,
} from '../client/v2/ai/advanced-model.js';
import {
  buildChatList,
  buildSearchList,
  canvasName,
  footLine,
  markParts,
  queuedPromptsOf,
  rowMenu,
  trashDialog,
  VISIBLE_PER_GROUP,
  whenLabel,
} from '../client/v2/ai/chat-list-model.js';
import { createFoldStore, FOLD_PANELS } from '../client/v2/fold/fold-store.js';
import { actionSearchRows } from '../client/v2/search/search-model.js';
import { createMenuHandlers, runnableIds } from '../client/v2/shell/menu-runner.js';
import { menuCtx } from '../client/v2/shell/project-menu-model.js';

const STUDIO = join(import.meta.dir, '..');
const read = (rel: string) => readFileSync(join(STUDIO, rel), 'utf8');
const NOW = new Date(2026, 9, 18, 15, 0, 0).getTime(); // Sun 18 Oct 2026, 15:00
const ago = (ms: number) => NOW - ms;
const MIN = 60_000;
const H = 60 * MIN;
const D = 24 * H;

const desktop = menuCtx({ native: true, canvasOpen: true });
const viewer = menuCtx({ native: true, readOnly: true });
const browser = menuCtx({ native: false });

describe('what a row says instead of a stamp', () => {
  test('now · minutes · hours · yesterday · weekday · date', () => {
    expect(whenLabel(ago(10_000), NOW)).toBe('now');
    expect(whenLabel(ago(12 * MIN), NOW)).toBe('12 min ago');
    expect(whenLabel(ago(3 * H), NOW)).toBe('3 h ago');
    expect(whenLabel(NOW - D, NOW)).toBe('yesterday');
    expect(whenLabel(NOW - 3 * D, NOW)).toBe('Thursday'); // 15 Oct 2026
    expect(whenLabel(new Date(2026, 9, 2, 9).getTime(), NOW)).toBe('2 Oct');
  });

  test('a canvas path is named by its file, none is "No canvas"', () => {
    expect(canvasName('ui/Combine-kampan.tsx')).toBe('Combine-kampan');
    expect(canvasName(null)).toBe('No canvas');
  });
});

describe('the list: Running first, Earlier by canvas, "N more"', () => {
  const chat = (id: string, title: string, updated: number, extra = {}) => ({
    id,
    title,
    updated,
    ...extra,
  });
  const groups = [
    {
      canvas: 'ui/Combine-kampan.tsx',
      chats: [
        chat('a1', 'Make it greener', NOW - 5_000),
        chat('a2', 'Translate the poster', NOW - 12 * MIN),
        chat('a3', 'Is the poster readable?', NOW - D),
        chat('a4', 'Older one', NOW - 9 * D),
      ],
    },
    { canvas: 'ui/Uniformy-2027.tsx', chats: [chat('b1', 'New team photos', NOW - H)] },
    { canvas: null, chats: [chat('c1', 'Just a question', NOW - 2 * D)] },
  ];

  test('a running chat sits in Running and is not repeated under Earlier', () => {
    const v = buildChatList({ groups, busy: { a1: true }, now: NOW });
    expect(v.running.map((r: { id: string }) => r.id)).toEqual(['a1']);
    expect(v.running[0]).toMatchObject({ title: 'Make it greener', state: 'working', when: 'now' });
    const ids = v.groups.flatMap((g: { rows: { id: string }[] }) => g.rows.map((r) => r.id));
    expect(ids).not.toContain('a1');
  });

  test('a chat that needs you comes first and says so instead of a time', () => {
    const v = buildChatList({
      groups,
      busy: { a1: true, b1: true },
      needs: new Set(['b1']),
      now: NOW,
    });
    expect(v.running.map((r: { id: string }) => r.id)).toEqual(['b1', 'a1']);
    expect(v.running[0]).toMatchObject({ state: 'needs', when: '' });
  });

  test('a canvas shows two rows and "N more"; expanding shows them all', () => {
    expect(VISIBLE_PER_GROUP).toBe(2);
    const v = buildChatList({ groups, now: NOW });
    const g = v.groups[0];
    expect(g).toMatchObject({ name: 'Combine-kampan', count: 4, more: 2 });
    expect(g.rows).toHaveLength(2);
    const all = buildChatList({ groups, expanded: new Set(['ui/Combine-kampan.tsx']), now: NOW });
    expect(all.groups[0].rows).toHaveLength(4);
    expect(all.groups[0].more).toBe(0);
  });

  test('the footer counts every chat, and the trash is not in it', () => {
    const withTrashed = [
      ...groups,
      { canvas: null, chats: [chat('t1', 'Gone', NOW, { trashedAt: NOW })] },
    ];
    const v = buildChatList({ groups: withTrashed, now: NOW });
    expect(v.total).toBe(6);
    expect(v.foot).toBe('6 chats · kept with the project');
    expect(footLine(1)).toBe('1 chat · kept with the project');
  });

  test('a running chat the server has not listed yet is still shown, by the host title', () => {
    const v = buildChatList({
      groups: [],
      busy: { zz: true },
      titles: { zz: 'Brand new' },
      now: NOW,
    });
    expect(v.running[0]).toMatchObject({ id: 'zz', title: 'Brand new' });
  });
});

describe('search: words inside chats, marked', () => {
  test('markParts clamps, sorts and merges ranges', () => {
    expect(markParts('Dres venku', [[0, 4]])).toEqual([
      { text: 'Dres', mark: true },
      { text: ' venku', mark: false },
    ]);
    expect(
      markParts('abcdef', [
        [2, 4],
        [3, 6],
        [-3, 1],
      ])
    ).toEqual([
      { text: 'a', mark: true },
      { text: 'b', mark: false },
      { text: 'cdef', mark: true },
    ]);
    expect(markParts('x', [])).toEqual([{ text: 'x', mark: false }]);
  });

  test('hits group by canvas; the title and the snippet carry their marks; the footer counts', () => {
    const hits = [
      {
        id: 'h1',
        title: 'Darker green for Dres doma',
        updated: NOW - D,
        canvas: 'ui/Uniformy-2027.tsx',
        titleRanges: [[17, 21]],
        snippet: null,
        matches: 0,
      },
      {
        id: 'h2',
        title: 'Helmet side view',
        updated: NOW - D,
        canvas: 'ui/Uniformy-2027.tsx',
        titleRanges: [],
        snippet: { text: 'match the dres venku stripes', ranges: [[10, 14]] },
        matches: 1,
      },
    ];
    const v = buildSearchList(hits, 'dres', NOW);
    expect(v.groups).toHaveLength(1);
    expect(v.groups[0].rows[0].title.some((p: { mark: boolean }) => p.mark)).toBe(true);
    expect(v.groups[0].rows[1].via.find((p: { mark: boolean }) => p.mark)?.text).toBe('dres');
    expect(v.foot).toBe('2 results');
    expect(buildSearchList([], 'zzz', NOW).foot).toBe('Nothing in your chats matches "zzz".');
  });
});

describe('the row ⋯ menu: Open · Rename… · Copy transcript · Archive · Move to trash', () => {
  const labels = (items: unknown[]) =>
    items.map((i) => (i === 'sep' ? '—' : (i as { label: string }).label));

  test('an editor on the desktop sees all five, in the canvas order', () => {
    expect(labels(rowMenu(desktop))).toEqual([
      'Open',
      'Rename…',
      'Copy transcript',
      '—',
      'Archive',
      'Move to trash',
    ]);
  });

  test('the verbs are the registry labels, and the trash row is the danger one', () => {
    const items = rowMenu(desktop) as Array<{ id: string; label: string; danger?: boolean }>;
    for (const it of items) {
      if (typeof it === 'string' || it.id === 'open') continue;
      expect(ACTIONS_BY_ID.get(it.id)?.label).toBe(it.label);
    }
    expect(items.find((i) => i.id === 'chat.trash')?.danger).toBe(true);
  });

  test('a viewer is offered neither rename, archive nor trash (the server refuses them too)', () => {
    expect(labels(rowMenu(viewer))).toEqual(['Open', 'Copy transcript']);
  });

  test('outside the desktop app a chat is only openable', () => {
    expect(labels(rowMenu(browser))).toEqual(['Open']);
  });
});

describe('the trash dialog asks with the verb the button carries', () => {
  test('it names a queued prompt first (G22)', () => {
    const d = trashDialog('Three reel covers', { queued: ['Make the badge rounder'] });
    expect(d.title).toBe('Move "Three reel covers" to the trash?');
    expect(d.body).toContain("queued prompt won't send");
    expect(d.body).toContain('Make the badge rounder');
    expect(d.confirm).toBe(ACTIONS_BY_ID.get('chat.trash')?.label);
  });

  test('several queued prompts are counted; none says the trash keeps it', () => {
    expect(trashDialog('x', { queued: ['a', 'b'] }).body).toContain('2 queued prompts');
    expect(trashDialog('x').body).toContain('Trash keeps it');
  });

  test('a chat with a turn in flight cannot be trashed: no verb, and it says to stop first', () => {
    const d = trashDialog('Make it greener', { running: true });
    expect(d.confirm).toBeNull();
    expect(d.body).toContain('Stop it first');
  });

  test('the queued prompts come from the outbox view: this chat, still waiting, ai.prompt only', () => {
    const view = {
      intents: [
        { kind: 'ai.prompt', lane: 'ai:c1', state: 'queued', label: 'Make it greener' },
        { kind: 'ai.prompt', lane: 'ai:c1', state: 'dropped', label: 'old' },
        { kind: 'ai.prompt', lane: 'ai:c2', state: 'queued', label: 'someone else' },
        { kind: 'share.invite', lane: 'share', state: 'queued', label: 'Invite' },
      ],
    };
    expect(queuedPromptsOf(view, 'c1')).toEqual(['Make it greener']);
    expect(queuedPromptsOf(null, 'c1')).toEqual([]);
  });
});

describe('Advanced: context % = used / size', () => {
  test('the percent is exactly used over size, rounded and clamped', () => {
    const u = parseUsage({ usage: { used: 38_000, size: 100_000 } });
    expect(contextMeter(u)).toMatchObject({ pct: 38, label: '38%', used: 38_000, size: 100_000 });
    expect(contextMeter(parseUsage({ usage: { used: 1, size: 3 } }))?.pct).toBe(33);
    expect(contextMeter({ context: { used: 5, size: 4 } })?.pct).toBe(100);
  });

  test('no window reported, no meter', () => {
    expect(contextMeter(parseUsage({ usage: {} }))).toBeNull();
    expect(contextMeter(null)).toBeNull();
  });

  test('the one rate-limit window reads "64% · resets 18:40"', () => {
    const u = {
      rateLimit: { label: '5-hour limit', pct: 64, resetsAt: 1, status: 'allowed_warning' },
    };
    expect(limitMeter(u, () => '18:40')).toEqual({
      name: '5-hour limit',
      pct: 64,
      label: '64% · resets 18:40',
    });
    expect(limitMeter({ rateLimit: null }, () => '')).toBeNull();
  });
});

describe('Advanced: modes read as what AI may do', () => {
  const modes = {
    currentModeId: 'default',
    availableModes: [
      { id: 'plan', name: 'Plan Mode' },
      { id: 'default', name: 'Default' },
      { id: 'acceptEdits', name: 'Accept Edits' },
      { id: 'mystery', name: 'Mystery' },
    ],
  };

  test('plain words in the canvas order; the agent name is the grey note; unknown ids are kept', () => {
    const o = modeOptions(modes);
    expect(o.map((m: { label: string }) => m.label)).toEqual([
      'Replace or move to the trash',
      'Nothing — change freely',
      'Suggest only',
      'Mystery',
    ]);
    expect(o[0].note).toBe('default');
    expect(o.find((m: { id: string }) => m.id === 'plan')?.group).toBe('nochange');
  });

  test('only what the session offers is listed ("Skip every check" shows only where the agent allows it)', () => {
    expect(modeOptions(modes).some((m: { id: string }) => m.id === 'bypassPermissions')).toBe(
      false
    );
  });

  test('suggest-only is said up front, with one verb to undo it', () => {
    const b = modeBanner({ ...modes, currentModeId: 'plan' });
    expect(b).toMatchObject({
      title: 'AI is set to suggest only.',
      body: "The canvas won't change.",
      action: 'Allow changes',
      target: 'acceptEdits',
    });
    expect(modeBanner({ ...modes, currentModeId: 'dontAsk' })?.title).toBe(
      'AI is set to skip what needs asking.'
    );
    expect(modeBanner(modes)).toBeNull();
  });

  test('no edit-capable mode offered: the banner still speaks but has no verb to offer', () => {
    const only = { currentModeId: 'plan', availableModes: [{ id: 'plan', name: 'Plan' }] };
    expect(modeBanner(only)?.action).toBeNull();
  });
});

describe('Advanced: the raw log', () => {
  const messages = [
    { role: 'user', content: [{ type: 'text', text: 'hi' }] },
    {
      role: 'assistant',
      content: [
        { type: 'text', text: 'ok' },
        { type: 'tool-call', toolName: 'Read', args: { file_path: 'a/Kampan.tsx' }, result: {} },
        {
          type: 'tool-call',
          toolName: 'Bash',
          args: { command: 'maude design   screenshot' },
          result: {},
        },
        { type: 'tool-call', toolName: 'mcp__srv__lookup', args: {}, result: undefined },
        { type: 'tool-call', toolName: 'Edit', args: { path: 'b' }, result: 'x', isError: true },
      ],
    },
  ];

  test('one line per tool call, in order, with the path or command and its state', () => {
    const log = rawLogLines(messages);
    expect(log.lines.map((l: { verb: string }) => l.verb)).toEqual([
      'Read',
      'Bash',
      'lookup',
      'Edit',
    ]);
    expect(log.lines[0]).toMatchObject({ text: 'a/Kampan.tsx', state: 'done' });
    expect(log.lines[1].text).toBe('maude design screenshot');
    expect(log.lines[2].state).toBe('running');
    expect(log.lines[3].state).toBe('failed');
    expect(log.summary).toBe('4 tool calls so far');
  });

  test('it is capped, newest kept, and copies as plain text', () => {
    const many = [
      {
        role: 'assistant',
        content: Array.from({ length: 250 }, (_, i) => ({
          type: 'tool-call',
          toolName: 'Read',
          args: { path: `f${i}` },
          result: {},
        })),
      },
    ];
    const log = rawLogLines(many);
    expect(log.lines).toHaveLength(200);
    expect(log.truncated).toBe(true);
    expect(log.lines.at(-1)?.text).toBe('f249');
    expect(rawLogText(rawLogLines(messages).lines ? rawLogLines(messages) : log)).toContain(
      'Read a/Kampan.tsx'
    );
    expect(rawLogLines([]).summary).toBe('0 tool calls');
  });
});

describe('⌘K finds the Advanced rows', () => {
  const proxy = new Proxy({}, { get: () => () => {} });
  const handlers = createMenuHandlers(proxy);
  const can = runnableIds(handlers);
  const rows = actionSearchRows(desktop, { isRunnable: (id: string) => can.has(id) });
  const find = (name: string) => rows.filter((r: { name: string }) => r.name === name);

  test('every row has a registry action, desktop only, with the "AI chat panel › Advanced" path', () => {
    for (const r of ADVANCED_ROWS) {
      const def = ACTIONS_BY_ID.get(r.action);
      expect(def, r.action).toBeDefined();
      expect(def?.search?.where).toBe(ADVANCED_WHERE);
      expect(def?.visible?.shell).toEqual(['desktop']);
      expect(rowForAction(r.action)?.row).toBe(r.row);
    }
  });

  test('"model", "raw log" and "terminal" are findable by name, each with a runner', () => {
    for (const name of ['Model', 'Raw log', 'Open in terminal']) {
      const hit = find(name);
      expect(hit, name).toHaveLength(1);
      expect(hit[0].where).toBe('AI chat panel › Advanced');
    }
  });

  test("a browser tab does not offer them (the chat is the desktop app's)", () => {
    const none = actionSearchRows(browser, { isRunnable: (id: string) => can.has(id) });
    expect(none.some((r: { name: string }) => r.name === 'Raw log')).toBe(false);
  });

  test('the fold remembers per Mac under one key, and "Open all" reaches it', () => {
    expect(AI_FOLD_PANEL).toBe('ai.chat');
    expect(FOLD_PANELS).toContain(AI_FOLD_PANEL);
    const store = createFoldStore();
    expect(store.get(AI_FOLD_PANEL)).toBe(false);
    store.openAll();
    expect(store.get(AI_FOLD_PANEL)).toBe(true);
  });

  test('every Advanced action is in the registry exactly once', () => {
    const ids = ACTIONS.map((a: { id: string }) => a.id).filter((id: string) =>
      id.startsWith('chat.advanced.')
    );
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(
      ADVANCED_ROWS.filter((r) => r.action.startsWith('chat.advanced.')).length
    );
  });
});

describe('nothing deleted: every v1 chat control has its v2 home', () => {
  // Every testid / label the v1 chat switcher and capability bar put on screen → the v2 file that owns it now.
  const HOMES: Array<[string, string]> = [
    ['v2/ai/ChatList.jsx', 'chat-overflow-menu'],
    ['v2/ai/ChatList.jsx', 'More options'],
    ['v2/ai/Advanced.jsx', 'chat-caps-bar'],
    ['v2/ai/Advanced.jsx', 'chat-mode-picker'],
    ['v2/ai/Advanced.jsx', 'chat-transcript-menu'],
    ['v2/ai/Advanced.jsx', 'chat-mode-banner'],
    ['v2/ai/Advanced.jsx', 'chat-mode-banner-switch'],
    ['v2/ai/Advanced.jsx', 'ChatFootInfo'],
  ];
  for (const [file, hook] of HOMES) {
    test(`${hook} lives in ${file}`, () => {
      expect(read(`client/${file}`)).toContain(hook);
    });
  }

  test('Rename, Archive, Copy transcript and Move to trash are registry actions the list calls', () => {
    const src = read('client/v2/ai/ChatList.jsx');
    for (const id of ['chat.rename', 'chat.archive', 'chat.copy-transcript', 'chat.trash'])
      expect(ACTIONS_BY_ID.has(id)).toBe(true);
    expect(src).toContain('rowMenu(');
    expect(src).toContain('trashChat');
  });

  test('the Composer no longer carries the capability bar or the info button; ChatPanel the old switcher', () => {
    const composer = read('client/v2/ai/Composer.jsx');
    expect(composer).not.toContain('<CapabilityBar');
    expect(composer).not.toContain('<ChatFootInfo');
    const host = read('client/panels/ChatPanel.jsx');
    expect(host).not.toContain('chat-menu-overflow');
    expect(host).not.toContain('function ModeBanner');
    expect(host).toContain('v2/ai/ChatList.jsx');
    expect(host).toContain('v2/ai/Advanced.jsx');
  });

  test('the transcript view select moved out of the status row', () => {
    const feed = read('client/v2/ai/Feed.jsx');
    expect(feed).not.toContain('data-testid="chat-transcript-menu"');
  });
});
