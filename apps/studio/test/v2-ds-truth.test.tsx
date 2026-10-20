// S10.11 (13 · ds-truth-outside, ds-truth-conflict) — the design system's files changed behind the app's back:
// the change arrives as a review ("2 tokens changed outside the app", Keep / Undo), never silently; a clash keeps
// both values side by side until one is picked; "Published in two places" is the same pick between two heads.
// Pinned: the attribution words (agent / git / peer / unknown), the words of both cards, which button is held
// while a pick waits, what each button sends, what the canvas is told to mark, and that the inspector's empty
// place draws the cards.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  conflictCards,
  fileLines,
  headValueName,
  movedWords,
  otherWords,
  outsideRows,
  outsideTitle,
  ownSystemOf,
  refusalWords,
  sourceWords,
  TRUTH_WORDS,
  truthOf,
  whoWords,
} from '../client/v2/ds/truth-model.js';
import { getTruth, resetTruth } from '../client/v2/ds/truth-store.js';
import { forgetRevisions } from '../client/v2/ds/update-available.jsx';
import { DSSection } from '../ds/board/index.tsx';
import {
  __registerBoardModel,
  __resetBoardState,
  getBoardMarks,
  setBoardMarks,
} from '../ds/board/state.ts';
import { type BoardModel, cleanMarks, marksCss } from '../ds/board/types.ts';

const H = 'a'.repeat(64);
const B = 'b'.repeat(64);
const MIN = 60_000;
const NOW = Date.parse('2026-10-20T10:00:00Z');
const ago = (min: number) => new Date(NOW - min * MIN).toISOString();

const QUIET = {
  css: '--fg-3',
  label: 'Quiet',
  before: { light: 'oklch(0.62 0.02 255)', dark: 'oklch(0.7 0.02 255)' },
  after: { light: 'oklch(0.5 0.02 255)', dark: 'oklch(0.7 0.02 255)' },
};
const CORNER = {
  css: '--radius-md',
  label: 'Corner M',
  before: { light: '10px' },
  after: { light: '12px' },
};
const ACCENT_CONFLICT = {
  css: '--accent',
  label: 'Accent',
  canvas: { light: 'oklch(0.5 0.19 255)' },
  file: { light: 'oklch(0.6 0.12 235)' },
};
const OUTSIDE = (kind = 'agent', name: string | undefined = 'Claude Code') => ({
  files: [{ path: 'colors_and_type.css', source: { kind, ...(name ? { name } : {}) }, at: ago(4) }],
  changes: [QUIET, CORNER],
  otherChanges: [],
});
const ROW = (over: Record<string, unknown> = {}) => ({
  name: 'studio',
  converted: true,
  head: H,
  base: B,
  pending: {},
  outside: OUTSIDE(),
  conflicts: [],
  publishedInTwoPlaces: null,
  library: null,
  ...over,
});

// ── the model: words ────────────────────────────────────────────────────────────────────────

describe('attribution words — agent / git / peer / unknown', () => {
  test('each source says how the file came to differ', () => {
    expect(sourceWords({ kind: 'agent', name: 'Claude Code' })).toBe('edited by Claude Code');
    expect(sourceWords({ kind: 'agent' })).toBe('edited by Claude Code');
    expect(sourceWords({ kind: 'git', name: 'Jonas' })).toBe('changed by Jonas · git pull');
    expect(sourceWords({ kind: 'git' })).toBe('changed by a git pull');
    expect(sourceWords({ kind: 'peer', name: 'Tereza' })).toBe('came from Tereza’s Mac');
    expect(sourceWords({ kind: 'peer' })).toBe('came from another Mac');
    expect(sourceWords({ kind: 'unknown' })).toBe('changed outside the app');
    expect(sourceWords(undefined)).toBe('changed outside the app');
    expect(sourceWords({ kind: 'something-new', name: 'x' })).toBe('changed outside the app');
  });

  test('the conflict card names the same people without the verb', () => {
    expect(whoWords({ kind: 'git', name: 'Jonas' })).toBe('Jonas · git pull');
    expect(whoWords({ kind: 'agent' })).toBe('Claude Code');
    expect(whoWords({ kind: 'peer', name: 'Tereza' })).toBe('Tereza’s Mac');
    expect(whoWords({ kind: 'person' })).toBe('You');
    expect(whoWords({ kind: 'person', name: 'Michal' })).toBe('Michal');
    expect(whoWords({ kind: 'unknown' })).toBe('Outside the app');
  });

  test('a name is plain text, capped, never markup', () => {
    const long = 'x'.repeat(300);
    expect(sourceWords({ kind: 'git', name: long }).length).toBeLessThan(100);
    expect(sourceWords({ kind: 'git', name: '<img onerror=x>' })).toBe(
      'changed by <img onerror=x> · git pull'
    );
  });

  test('"colors_and_type.css was edited by Claude Code, 4 min ago" — parts, with the times in CONTRACT words', () => {
    const { lines, more } = fileLines(OUTSIDE().files, NOW);
    expect(lines).toEqual([
      { file: 'colors_and_type.css', how: 'edited by Claude Code', ago: '4 min ago' },
    ]);
    expect(more).toBe(0);
    const many = fileLines(
      ['a.css', 'b.css', 'c.css', 'd.css', 'e.css'].map((p) => ({
        path: `sys/${p}`,
        source: { kind: 'unknown' },
        at: null,
      })),
      NOW
    );
    expect(many.lines).toHaveLength(3);
    expect(many.more).toBe(2);
    expect(many.lines[0]).toMatchObject({ file: 'a.css', ago: null });
  });
});

describe('the outside card — rows and words', () => {
  test('the title counts tokens, with the noun for 1 and for many', () => {
    expect(outsideTitle(2, 0)).toBe('2 tokens changed outside the app');
    expect(outsideTitle(1, 0)).toBe('1 token changed outside the app');
    expect(outsideTitle(0, 1)).toBe('Files changed outside the app');
  });

  test('a colour says which mode moved; a length says 10 → 12 px', () => {
    const { shown } = outsideRows(OUTSIDE(), new Set());
    expect(shown.map((r) => [r.label, r.kind, r.detail])).toEqual([
      ['Quiet', 'colour', 'Light value'],
      ['Corner M', 'length', '10 → 12 px'],
    ]);
    expect(
      movedWords({ before: { light: 'a', dark: 'b' }, after: { light: 'c', dark: 'd' } })
    ).toBe('Light and Dark values');
    expect(movedWords({ before: { light: 'a' }, after: { light: 'a' } })).toBeNull();
  });

  test('a token that is in a conflict has its own card, not a row here', () => {
    const o = { ...OUTSIDE(), changes: [QUIET, { ...CORNER, css: '--accent', label: 'Accent' }] };
    const { all } = outsideRows(o, new Set(['--accent']));
    expect(all.map((r) => r.css)).toEqual(['--fg-3']);
  });

  test('a byte change that moved no token is never silent', () => {
    expect(otherWords([{ path: 'colors_and_type.css', count: 1 }])).toBe(
      '1 other change in colors_and_type.css — comments or new rules'
    );
    expect(otherWords([])).toBeNull();
  });

  test('a value that is not a colour is never painted as one', () => {
    const o = {
      files: [],
      otherChanges: [],
      changes: [
        {
          css: '--x',
          label: 'X',
          before: { light: 'url(http://evil/x.png)' },
          after: { light: '#fff' },
        },
      ],
    };
    expect(outsideRows(o).shown[0].kind).toBe('colour');
    const bad = {
      ...o,
      changes: [
        {
          css: '--y',
          label: 'Y',
          before: { light: 'url(http://evil/x.png)' },
          after: { light: 'url(a)' },
        },
      ],
    };
    expect(outsideRows(bad).shown[0].kind).toBe('text');
  });
});

describe('what the state says → what to show and mark', () => {
  test('nothing outside, nothing in conflict → no cards, no marks', () => {
    expect(truthOf(ROW({ outside: null }))).toBeNull();
    expect(truthOf(ROW({ converted: false }))).toBeNull();
    expect(truthOf(null)).toBeNull();
  });

  test('the outside tokens are marked; a conflict is marked "2 versions" instead', () => {
    const t = truthOf(
      ROW({
        outside: {
          ...OUTSIDE(),
          changes: [QUIET, CORNER, { ...ACCENT_CONFLICT, before: {}, after: {} }],
        },
        conflicts: [ACCENT_CONFLICT],
      })
    );
    expect(t?.marks).toEqual({ outside: ['--fg-3', '--radius-md'], conflicts: ['--accent'] });
  });

  test('a linked library is shown, with its view-only line', () => {
    expect(truthOf(ROW({ library: { url: 'x' } }))?.linked).toBe(true);
  });

  test('two heads → "Published in two places"', () => {
    const t = truthOf(
      ROW({
        outside: null,
        publishedInTwoPlaces: [
          {
            file: null,
            head: H,
            by: { kind: 'person', name: 'You' },
            at: ago(3),
            summary: 'Accent',
          },
          {
            file: 'revisions/head.sync-conflict.json',
            head: B,
            by: { kind: 'person', name: 'Jonas' },
            at: ago(2),
            summary: 'Corners',
          },
        ],
      })
    );
    expect(t?.twice).toHaveLength(2);
  });

  test('the conflict cards: canvas side from the waiting edit, file side from who changed the file', () => {
    const board = {
      themes: { light: 'light' },
      tokens: [{ css: '--accent', valueNames: { light: 'Sea blue' } }],
    };
    const [c] = conflictCards({
      conflicts: [ACCENT_CONFLICT],
      pending: {
        tokens: {
          '--accent': {
            light: 'oklch(0.5 0.19 255)',
            valueNames: { light: 'Deeper azure' },
            by: { kind: 'person', name: 'You' },
            at: ago(10),
          },
        },
      },
      outside: OUTSIDE('git', 'Jonas'),
      board,
      headNames: { '--accent': 'Azure' },
      themes: board.themes,
      now: NOW,
    });
    expect(c.label).toBe('Accent');
    expect(c.canvas).toMatchObject({ name: 'Deeper azure', who: 'You', ago: '10 min ago' });
    expect(c.file).toMatchObject({ name: 'Sea blue', who: 'Jonas · git pull', ago: '4 min ago' });
    expect(c.keeps).toBe('Azure');
  });

  test('the value name canvases keep comes from the head revision', () => {
    const tokens = {
      $extensions: { 'sh.maude': { css: '--accent', valueNames: { light: 'Azure' } } },
    };
    const body = {
      files: { 'tokens.json': { text: JSON.stringify({ color: { accent: tokens } }) } },
    };
    expect(headValueName(body, '--accent', 'light')).toBe('Azure');
    expect(headValueName(body, '--accent', 'dark')).toBeNull();
    expect(
      headValueName({ files: { 'tokens.json': { text: '{' } } }, '--accent', 'light')
    ).toBeNull();
    expect(headValueName(null, '--accent', 'light')).toBeNull();
  });

  test('a refusal is words, never a code', () => {
    expect(refusalWords('forbidden')).toBe(TRUTH_WORDS.forbidden);
    expect(refusalWords('unreachable')).toBe(TRUTH_WORDS.offline);
    expect(refusalWords('ds-no-outside')).toBe(TRUTH_WORDS.gone);
    expect(refusalWords('ds-conflict')).toBe('Pick one of the two values first.');
    expect(refusalWords('whatever')).toBe(TRUTH_WORDS.failed);
  });

  test('only a system’s own canvas carries the cards', () => {
    const cfg = {
      designRel: '.design',
      designSystems: [{ name: 'studio', path: 'system/studio' }],
      dsConverted: { studio: true },
    };
    expect(ownSystemOf('system/studio/design-system.tsx', cfg)).toBe('studio');
    expect(ownSystemOf('.design/system/studio/design-system.tsx', cfg)).toBe('studio');
    expect(ownSystemOf('ui/Homepage.tsx', cfg)).toBeNull();
    expect(ownSystemOf('system/studio/design-system.tsx', { ...cfg, dsConverted: {} })).toBeNull();
  });
});

// ── the cards ────────────────────────────────────────────────────────────────────────────────

let OutsideBanner: typeof import('../client/v2/ds/outside-banner.jsx').OutsideBanner;
let ConflictPick: typeof import('../client/v2/ds/conflict-pick.jsx').ConflictPick;
let PublishedTwice: typeof import('../client/v2/ds/conflict-pick.jsx').PublishedTwice;
let DsTruthCards: typeof import('../client/v2/ds/truth-card.jsx').DsTruthCards;
let truth: typeof import('../client/v2/ds/truth-host.jsx');
const roots: Root[] = [];
beforeAll(async () => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  OutsideBanner = (await import('../client/v2/ds/outside-banner.jsx')).OutsideBanner;
  ({ ConflictPick, PublishedTwice } = await import('../client/v2/ds/conflict-pick.jsx'));
  DsTruthCards = (await import('../client/v2/ds/truth-card.jsx')).DsTruthCards;
  truth = await import('../client/v2/ds/truth-host.jsx');
});
afterAll(() => GlobalRegistrator.unregister());
const realFetch = globalThis.fetch;
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
  globalThis.fetch = realFetch;
  resetTruth();
  forgetRevisions();
});

async function render(node: React.ReactElement) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(node));
  return host;
}
const q = (host: ParentNode, id: string) =>
  host.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const all = (host: ParentNode, id: string) =>
  [...host.querySelectorAll(`[data-testid="${id}"]`)] as HTMLElement[];
const click = (el: Element | null) =>
  act(async () => void el?.dispatchEvent(new window.MouseEvent('click', { bubbles: true })));

describe('13 · ds-truth-outside — the card', () => {
  const t = (over: Record<string, unknown> = {}) =>
    truthOf(ROW(over)) as NonNullable<ReturnType<typeof truthOf>>;

  test('words: title, source, two changes marked old → new, the fine print, Undo and Keep', async () => {
    const host = await render(
      <OutsideBanner truth={t()} onKeep={() => {}} onUndo={() => {}} now={NOW} />
    );
    expect(q(host, 'ds-outside-title')?.textContent).toBe('2 tokens changed outside the app');
    expect(q(host, 'ds-outside-source')?.textContent).toBe(
      'colors_and_type.css was edited by Claude Code, 4 min ago'
    );
    const rows = all(host, 'ds-outside-change');
    expect(rows.map((r) => r.querySelector('b')?.textContent)).toEqual(['Quiet', 'Corner M']);
    expect(rows[0].querySelector('[data-testid="ds-outside-chip-before"]')).not.toBeNull();
    expect(rows[0].querySelector('em')?.textContent).toBe('Light value');
    expect(rows[1].querySelector('em')?.textContent).toBe('10 → 12 px');
    expect(q(host, 'ds-outside-fine')?.textContent).toBe(
      'Keep makes them part of the system. Canvases then follow after the usual review.'
    );
    expect(q(host, 'ds-outside-undo')?.textContent).toBe('Undo');
    expect(q(host, 'ds-outside-keep')?.textContent).toBe('Keep');
  });

  test('the contrast line of a colour rides on its row', async () => {
    const host = await render(
      <OutsideBanner
        truth={t()}
        contrast={{ '--fg-3': 'Light 5.6:1 · Dark 4.8:1' }}
        onKeep={() => {}}
        onUndo={() => {}}
        now={NOW}
      />
    );
    expect(all(host, 'ds-outside-change')[0].querySelector('em')?.textContent).toBe(
      'Light value · Light 5.6:1 · Dark 4.8:1'
    );
  });

  test.each([
    [{ kind: 'agent', name: 'Claude Code' }, 'edited by Claude Code'],
    [{ kind: 'git', name: 'Jonas' }, 'changed by Jonas · git pull'],
    [{ kind: 'peer', name: 'Tereza' }, 'came from Tereza’s Mac'],
    [{ kind: 'unknown' }, 'changed outside the app'],
  ])('attribution %j reads "%s"', async (source, how) => {
    const row = ROW({
      outside: { ...OUTSIDE(), files: [{ path: 'colors_and_type.css', source, at: ago(2) }] },
    });
    const host = await render(
      <OutsideBanner truth={truthOf(row) as never} onKeep={() => {}} onUndo={() => {}} now={NOW} />
    );
    expect(q(host, 'ds-outside-source')?.textContent).toBe(
      `colors_and_type.css was ${how}, 2 min ago`
    );
  });

  test('Keep and Undo call their handlers once each; busy holds both', async () => {
    const calls: string[] = [];
    const host = await render(
      <OutsideBanner
        truth={t()}
        onKeep={() => calls.push('keep')}
        onUndo={() => calls.push('undo')}
        now={NOW}
      />
    );
    await click(q(host, 'ds-outside-keep'));
    await click(q(host, 'ds-outside-undo'));
    expect(calls).toEqual(['keep', 'undo']);
    const busy = await render(
      <OutsideBanner
        truth={t()}
        busy
        onKeep={() => calls.push('x')}
        onUndo={() => calls.push('y')}
        now={NOW}
      />
    );
    expect((q(busy, 'ds-outside-keep') as HTMLButtonElement).disabled).toBe(true);
    expect((q(busy, 'ds-outside-undo') as HTMLButtonElement).disabled).toBe(true);
  });

  test('while a pick waits, Keep is held and says which; Undo stays', async () => {
    const held = t({ conflicts: [ACCENT_CONFLICT] });
    const host = await render(
      <OutsideBanner truth={held} onKeep={() => {}} onUndo={() => {}} now={NOW} />
    );
    expect((q(host, 'ds-outside-keep') as HTMLButtonElement).disabled).toBe(true);
    expect((q(host, 'ds-outside-undo') as HTMLButtonElement).disabled).toBe(false);
    expect(q(host, 'ds-outside-fine')?.textContent).toBe('Pick Accent first, then Keep the rest.');
  });

  test('a linked library offers only Undo, and says it is view only', async () => {
    const host = await render(
      <OutsideBanner
        truth={t({ library: { url: 'u' } })}
        onKeep={() => {}}
        onUndo={() => {}}
        now={NOW}
      />
    );
    expect(q(host, 'ds-outside-keep')).toBeNull();
    expect(q(host, 'ds-outside-undo')).not.toBeNull();
    expect(q(host, 'ds-outside-fine')?.textContent).toContain('Linked library — view only');
  });

  test('comments or a new rule: the card exists and says so, even with no token moved', async () => {
    const row = ROW({
      outside: {
        ...OUTSIDE(),
        changes: [],
        otherChanges: [{ path: 'colors_and_type.css', count: 2 }],
      },
    });
    const host = await render(
      <OutsideBanner truth={truthOf(row) as never} onKeep={() => {}} onUndo={() => {}} now={NOW} />
    );
    expect(q(host, 'ds-outside-title')?.textContent).toBe('Files changed outside the app');
    expect(q(host, 'ds-outside-other')?.textContent).toContain(
      '2 other changes in colors_and_type.css'
    );
  });

  test('a hostile value paints nothing and a name is text', async () => {
    const row = ROW({
      outside: {
        files: [{ path: 'x.css', source: { kind: 'git', name: '<b id=pwn>x</b>' }, at: ago(1) }],
        changes: [
          {
            css: '--x',
            label: '<i>L</i>',
            before: { light: 'url(http://evil/a)' },
            after: { light: 'red' },
          },
        ],
        otherChanges: [],
      },
    });
    const host = await render(
      <OutsideBanner truth={truthOf(row) as never} onKeep={() => {}} onUndo={() => {}} now={NOW} />
    );
    expect(host.querySelector('#pwn')).toBeNull();
    expect(host.innerHTML).not.toContain('evil');
  });
});

describe('13 · ds-truth-conflict — the pick', () => {
  const card = {
    css: '--accent',
    label: 'Accent',
    canvas: { value: 'oklch(0.5 0.19 255)', name: 'Deeper azure', who: 'You', ago: '10 min ago' },
    file: {
      value: 'oklch(0.6 0.12 235)',
      name: 'Sea blue',
      who: 'Jonas · git pull',
      ago: '2 min ago',
    },
    keeps: 'Azure',
  };

  test('side by side: the canvas value and the file value, who and when, canvases keep head', async () => {
    const host = await render(
      <ConflictPick card={card} fileName="colors_and_type.css" onPick={() => {}} />
    );
    expect(q(host, 'ds-conflict-title')?.textContent).toBe('Accent changed in two places');
    expect(q(host, 'ds-conflict-lead')?.textContent).toBe(
      'Pick one. Until then canvases keep Azure.'
    );
    const canvas = q(host, 'ds-conflict-canvas');
    const file = q(host, 'ds-conflict-file');
    expect(canvas?.textContent).toContain('On this canvas');
    expect(canvas?.textContent).toContain('Deeper azure');
    expect(canvas?.textContent).toContain('You · 10 min ago');
    expect(file?.textContent).toContain('In colors_and_type.css');
    expect(file?.textContent).toContain('Sea blue');
    expect(file?.textContent).toContain('Jonas · git pull · 2 min ago');
    expect(q(host, 'ds-conflict-fine')?.textContent).toBe(
      'Both stay on the swatch, marked “2 versions”. The one you don’t pick stays in Version history.'
    );
  });

  test('"Use this" on each side sends that side', async () => {
    const picks: unknown[][] = [];
    const host = await render(
      <ConflictPick card={card} fileName="x.css" onPick={(...a: unknown[]) => picks.push(a)} />
    );
    await click(q(host, 'ds-conflict-canvas-use'));
    await click(q(host, 'ds-conflict-file-use'));
    expect(picks).toEqual([
      ['--accent', 'canvas'],
      ['--accent', 'file'],
    ]);
  });

  test('without a name for the head value it still reads', async () => {
    const host = await render(
      <ConflictPick card={{ ...card, keeps: null }} fileName="x.css" onPick={() => {}} />
    );
    expect(q(host, 'ds-conflict-lead')?.textContent).toBe(
      'Pick one. Until then canvases keep the value they have.'
    );
  });

  test('"Published in two places": two copies, each can be used', async () => {
    const places = [
      {
        file: null,
        head: H,
        by: { kind: 'person', name: 'You' },
        at: ago(3),
        summary: 'Accent: Deeper azure',
      },
      {
        file: 'revisions/head.sync-conflict.json',
        head: B,
        by: { kind: 'person', name: 'Jonas' },
        at: ago(2),
        summary: null,
      },
    ];
    const picked: string[] = [];
    const host = await render(
      <PublishedTwice places={places} onPick={(h: string) => picked.push(h)} now={NOW} />
    );
    expect(q(host, 'ds-twice-title')?.textContent).toBe('Published in two places');
    const cols = all(host, 'ds-twice-place');
    expect(cols).toHaveLength(2);
    expect(cols[0].textContent).toContain('Accent: Deeper azure');
    expect(cols[0].textContent).toContain('You · 3 min ago');
    expect(cols[1].textContent).toContain(`Version ${B.slice(0, 8)}`);
    await click(all(host, 'ds-twice-use')[1]);
    expect(picked).toEqual([B]);
    expect(renderToStaticMarkup(<PublishedTwice places={[places[0]]} onPick={() => {}} />)).toBe(
      ''
    );
  });
});

// ── the host: what it reads, what it sends, what the canvas is told ──────────────────────────

type Rec = { method: string; url: string; body: Record<string, unknown> | null };
function fake(
  opts: {
    row?: Record<string, unknown>;
    board?: unknown;
    write?: { status: number; body?: unknown };
  } = {}
) {
  const calls: Rec[] = [];
  let row = opts.row ?? ROW();
  const impl = (async (url: string, init?: { method?: string; body?: string }) => {
    const body = init?.body ? JSON.parse(init.body) : null;
    calls.push({ method: init?.method ?? 'GET', url, body });
    const json = (status: number, b: unknown) =>
      ({ ok: status < 400, status, json: async () => b }) as Response;
    if (url.startsWith('/_api/ds/state')) return json(200, { systems: [row] });
    if (url.startsWith('/_api/ds/board'))
      return json(
        200,
        opts.board ?? {
          format: 'maude.ds-board',
          v: 1,
          themes: { all: ['light', 'dark'], default: 'light', light: 'light', dark: 'dark' },
          tokens: [],
        }
      );
    if (url.startsWith('/_api/ds/revision')) return json(404, {});
    if (init?.method === 'POST') {
      if ((opts.write?.status ?? 200) < 400) row = ROW({ outside: null });
      return json(
        opts.write?.status ?? 200,
        opts.write?.body ?? { action: 'keep', rev: H, actionId: null }
      );
    }
    return json(404, {});
  }) as unknown as typeof fetch;
  return { calls, impl };
}
const CFG = {
  designRel: '.design',
  canvasOrigin: 'http://canvas.test',
  designSystems: [{ name: 'studio', path: 'system/studio' }],
  dsConverted: { studio: true },
};
const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 25));
  });

describe('the host', () => {
  beforeEach(() => resetTruth());

  test('loadTruth: the state row, the board for contrast, and nothing when nothing is outside', async () => {
    const f = fake();
    const got = await truth.loadTruth('studio', f.impl);
    expect(got?.truth.marks.outside).toEqual(['--fg-3', '--radius-md']);
    expect(f.calls.map((c) => c.url.split('?')[0])).toEqual(['/_api/ds/state', '/_api/ds/board']);
    const quiet = fake({ row: ROW({ outside: null }) });
    expect(await truth.loadTruth('studio', quiet.impl)).toBeNull();
    expect(quiet.calls).toHaveLength(1);
  });

  test('the writers send exactly what the routes read', async () => {
    const f = fake();
    await truth.writeOutside('studio', 'keep', f.impl);
    await truth.writeOutside('studio', 'undo', f.impl);
    await truth.writePick('studio', '--accent', 'file', f.impl);
    await truth.writePickHead('studio', B, f.impl);
    expect(f.calls.map((c) => [c.method, c.url, c.body])).toEqual([
      ['POST', '/_api/ds/outside', { ds: 'studio', action: 'keep' }],
      ['POST', '/_api/ds/outside', { ds: 'studio', action: 'undo' }],
      ['POST', '/_api/ds/pick', { ds: 'studio', css: '--accent', use: 'file' }],
      ['POST', '/_api/ds/pick', { ds: 'studio', head: B }],
    ]);
  });

  test('a refusal comes back as words', async () => {
    const f = fake({ write: { status: 403, body: { code: 'forbidden' } } });
    expect(await truth.writeOutside('studio', 'keep', f.impl)).toMatchObject({
      ok: false,
      message: TRUTH_WORDS.forbidden,
    });
    const g = fake({ write: { status: 409, body: { code: 'ds-conflict' } } });
    expect(await truth.writeOutside('studio', 'keep', g.impl)).toMatchObject({
      message: 'Pick one of the two values first.',
    });
  });

  test('postDsMarks goes to the canvas origin, never "*", and only names', () => {
    const posted: unknown[][] = [];
    const frame = { contentWindow: { postMessage: (...a: unknown[]) => posted.push(a) } } as never;
    expect(
      truth.postDsMarks(
        frame,
        { outside: ['--fg-3'], conflicts: ['--accent'] },
        'http://canvas.test'
      )
    ).toBe(true);
    expect(posted).toEqual([
      [
        { dgn: 'ds-marks', outside: ['--fg-3'], conflicts: ['--accent'] },
        'http://canvas.test',
      ],
    ]);
    expect(truth.postDsMarks(null, { outside: [], conflicts: [] }, 'http://canvas.test')).toBe(
      false
    );
  });

  async function mountHost(f: ReturnType<typeof fake>, activePath: string | null) {
    const toasts: string[] = [];
    const posted: unknown[][] = [];
    const frame = { contentWindow: { postMessage: (...a: unknown[]) => posted.push(a) } };
    globalThis.fetch = f.impl; // the head revision is read through the page's own fetch
    await render(
      <truth.DsTruthHost
        cfg={CFG}
        activePath={activePath}
        toast={(m: string) => toasts.push(m)}
        frameFor={() => frame as never}
        fetchImpl={f.impl}
        pollMs={60_000}
      />
    );
    await settle();
    return { toasts, posted };
  }

  test('on the Design system canvas it reads the state, tells the canvas what to mark, and fills the store', async () => {
    const f = fake();
    const { posted } = await mountHost(f, 'system/studio/design-system.tsx');
    expect(getTruth()?.ds).toBe('studio');
    expect(posted).toEqual([
      [
        { dgn: 'ds-marks', outside: ['--fg-3', '--radius-md'], conflicts: [] },
        'http://canvas.test',
      ],
    ]);
  });

  test('on any other canvas it reads nothing', async () => {
    const f = fake();
    await mountHost(f, 'ui/Homepage.tsx');
    expect(f.calls).toEqual([]);
    expect(getTruth()).toBeNull();
  });

  test('Keep: one POST, the words, then the card goes and the marks clear', async () => {
    const f = fake();
    const { toasts, posted } = await mountHost(f, 'system/studio/design-system.tsx');
    const { getTruthActions } = await import('../client/v2/ds/truth-store.js');
    await act(async () => void getTruthActions()?.keep());
    await settle();
    expect(f.calls.filter((c) => c.method === 'POST').map((c) => c.body)).toEqual([
      { ds: 'studio', action: 'keep' },
    ]);
    expect(toasts).toEqual(['Kept 2 tokens. Canvases follow after the next update.']);
    expect(getTruth()).toBeNull();
    expect(posted.at(-1)?.[0]).toEqual({ dgn: 'ds-marks', outside: [], conflicts: [] });
  });

  test('Undo says the old values are back in the file', async () => {
    const f = fake();
    const { toasts } = await mountHost(f, 'system/studio/design-system.tsx');
    const { getTruthActions } = await import('../client/v2/ds/truth-store.js');
    await act(async () => void getTruthActions()?.undo());
    await settle();
    expect(f.calls.filter((c) => c.method === 'POST').map((c) => c.body)).toEqual([
      { ds: 'studio', action: 'undo' },
    ]);
    expect(toasts).toEqual(['Old values are back in colors_and_type.css.']);
  });

  test('a refused Keep keeps the card, says why, and lets go of the buttons', async () => {
    const f = fake({ write: { status: 403, body: { code: 'forbidden' } } });
    const { toasts } = await mountHost(f, 'system/studio/design-system.tsx');
    const { getTruthActions } = await import('../client/v2/ds/truth-store.js');
    await act(async () => void getTruthActions()?.keep());
    await settle();
    expect(toasts).toEqual([]);
    expect(getTruth()).toMatchObject({ busy: false, note: TRUTH_WORDS.forbidden });
  });

  test('"Use this": the canvas side and the file side post their pick', async () => {
    const f = fake({
      row: ROW({
        conflicts: [ACCENT_CONFLICT],
        outside: {
          ...OUTSIDE(),
          changes: [{ ...QUIET }, { css: '--accent', label: 'Accent', before: {}, after: {} }],
        },
      }),
    });
    const { toasts } = await mountHost(f, 'system/studio/design-system.tsx');
    const { getTruthActions } = await import('../client/v2/ds/truth-store.js');
    await act(async () => void getTruthActions()?.pick('--accent', 'canvas'));
    await settle();
    expect(f.calls.filter((c) => c.method === 'POST').map((c) => c.body)).toEqual([
      { ds: 'studio', css: '--accent', use: 'canvas' },
    ]);
    expect(toasts).toEqual(['Accent: the canvas value is in the file now.']);
  });

  test('the cards draw from the store and nothing else', async () => {
    const f = fake({
      row: ROW({
        conflicts: [ACCENT_CONFLICT],
        pending: {
          tokens: {
            '--accent': {
              light: 'oklch(0.5 0.19 255)',
              valueNames: { light: 'Deeper azure' },
              at: ago(10),
            },
          },
        },
        outside: {
          ...OUTSIDE('git', 'Jonas'),
          changes: [QUIET, { css: '--accent', label: 'Accent', before: {}, after: {} }],
        },
      }),
    });
    await mountHost(f, 'system/studio/design-system.tsx');
    const host = await render(<DsTruthCards value={getTruth()} actions={null} now={Date.now()} />);
    expect(q(host, 'ds-conflict-title')?.textContent).toBe('Accent changed in two places');
    // the outside card lists the token that is NOT in a clash; Keep waits for the pick
    expect(all(host, 'ds-outside-change').map((r) => r.getAttribute('data-css'))).toEqual([
      '--fg-3',
    ]);
    expect((q(host, 'ds-outside-keep') as HTMLButtonElement).disabled).toBe(true);
  });
});

// ── the canvas: the flags on the swatches ───────────────────────────────────────────────────

const model = (): BoardModel => ({
  format: 'maude.ds-board',
  v: 1,
  system: 'studio',
  label: 'Studio site',
  rootClass: null,
  themes: { all: ['light', 'dark'], default: 'light', light: 'light', dark: 'dark' },
  converted: true,
  tokens: [
    {
      css: '--fg-3',
      section: 'colour',
      group: 'text',
      kind: 'color',
      label: 'Quiet',
      valueNames: {},
      locked: false,
      darkFollows: null,
      values: { light: '#444', dark: '#bbb' },
      used: null,
      pending: null,
    },
    {
      css: '--accent',
      section: 'colour',
      group: 'accent',
      kind: 'color',
      label: 'Accent',
      valueNames: {},
      locked: false,
      darkFollows: null,
      values: { light: '#25d', dark: '#58f' },
      used: null,
      pending: null,
    },
  ],
  typeRoles: [],
  components: [],
  logos: [],
  pendingCount: 0,
  canvases: null,
});

describe('the Design system canvas flags what is in review', () => {
  beforeEach(() => __resetBoardState());

  test('only registry-shaped names get through, deduped and capped', () => {
    expect(
      cleanMarks({ outside: ['--fg-3', '--fg-3', 'x"]{}', 5, '--a b'], conflicts: ['--accent'] })
    ).toEqual({
      outside: ['--fg-3'],
      conflicts: ['--accent'],
    });
    expect(cleanMarks(null)).toEqual({ outside: [], conflicts: [] });
    expect(
      cleanMarks({ outside: Array.from({ length: 500 }, (_, i) => `--t${i}`) }).outside
    ).toHaveLength(200);
  });

  test('"Changed outside" on an outside token, "2 versions" on a clash — never both words on one token', () => {
    const css = marksCss(model(), { outside: ['--fg-3', '--accent'], conflicts: ['--accent'] });
    expect(css).toContain('[data-ds-token="--fg-3"]::after{content:"Changed outside"');
    expect(css).toContain('[data-ds-token="--accent"]::after{content:"2 versions"');
    expect(css).not.toContain('--accent"]::after{content:"Changed outside"');
    expect(css).toContain('.ds-board[data-ds-board="studio"]');
    expect(marksCss(model(), { outside: [], conflicts: [] })).toBe('');
  });

  test('a section draws the flags it was told, and none when nothing is in review', () => {
    __registerBoardModel(model());
    const none = renderToStaticMarkup(<DSSection kind="colour" />);
    expect(none).not.toContain('data-ds-marks');
    setBoardMarks({ outside: ['--fg-3'], conflicts: ['--accent'] });
    expect(getBoardMarks()).toEqual({ outside: ['--fg-3'], conflicts: ['--accent'] });
    const html = renderToStaticMarkup(<DSSection kind="colour" />);
    expect(html).toContain('data-ds-marks');
    expect(html).toContain('content:"Changed outside"');
    expect(html).toContain('content:"2 versions"');
    setBoardMarks({ outside: [], conflicts: [] });
    expect(renderToStaticMarkup(<DSSection kind="colour" />)).not.toContain('data-ds-marks');
  });
});

// ── the wiring ──────────────────────────────────────────────────────────────────────────────

describe('the inspector’s empty place', () => {
  test('draws the cards when there are any, else its own hint — and the host rides on the review host', () => {
    const panel = readFileSync(
      new URL('../client/inspector/inspector-panel.jsx', import.meta.url),
      'utf8'
    );
    expect(panel).toContain("from '../v2/ds/truth-card.jsx'");
    expect(panel).toMatch(
      /!el && !\(effTab === 'layers' && layersTree\?\.nodes\?\.length\) && \(dsTruth(?: \|\| dsSystem)?\)? \?/
    );
    const host = readFileSync(new URL('../client/v2/ds/review-host.jsx', import.meta.url), 'utf8');
    expect(host).toContain('<DsTruthHost');
  });
});
