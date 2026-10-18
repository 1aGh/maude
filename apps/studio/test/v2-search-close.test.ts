// S1.4 — ⌘K when the words are almost right (11 · pn-k-close): every word counts in any order, a swapped
// letter still finds the canvas and says so, the marks show what matched (in the name or in its canvas),
// a near miss with no word right is drawn quiet, and a misspelling reads "Did you mean".
import { describe, expect, test } from 'bun:test';
import {
  askRow,
  assemble,
  canvasMeta,
  closeCount,
  footerCount,
  remoteRows,
} from '../client/v2/search/search-model.js';
import { match } from '../index/match.ts';

// What the project index would answer (index/service.ts builds exactly these name / meta pairs)
const CORPUS = [
  {
    key: 'ui/2026/dresy/Uniformy-2027.tsx',
    name: 'Uniformy-2027',
    meta: '2026/dresy',
    group: 'canvases',
  },
  {
    key: 'ui/2026/dresy/Uniformy-2027.tsx#home',
    name: 'Domácí dres 2027 · přední',
    meta: 'Uniformy-2027 2026/dresy print',
    group: 'artboards',
  },
  {
    key: 'ui/2026/dresy/Uniformy-2027.tsx#away',
    name: 'Venkovní dres 2027 · přední',
    meta: 'Uniformy-2027 2026/dresy print',
    group: 'artboards',
  },
  {
    key: 'ui/legacy/uniformy-2026-stare.tsx',
    name: 'uniformy-2026-stare',
    meta: 'legacy',
    group: 'canvases',
  },
  { key: 'ui/2026/LetakA6.tsx', name: 'LetakA6', meta: '2026 print', group: 'canvases' },
  {
    key: 'ui/2026/LetakA6.tsx#front',
    name: 'A · přední FLAG',
    meta: 'LetakA6 2026 print',
    group: 'artboards',
  },
];

/** The ⌘K view for a query, the way the palette builds it (server rows → remoteRows → assemble). */
function view(query: string, canAskAI = true) {
  const rows = match(CORPUS, query).map((h) => ({
    group: h.row.group,
    key: h.row.key,
    name: h.row.name,
    meta: h.row.meta,
    score: h.score,
    close: h.close,
    marks: h.marks,
  }));
  const remote = remoteRows({ q: query, rows } as never, { query });
  return { remote, res: assemble({ query, local: [], remote, canAskAI }) };
}
const slice = (s: string, r: [number, number][] = []) => r.map(([a, b]) => s.slice(a, b));

describe('every word counts, in any order, and the marks say where', () => {
  test('"letak a6 predni": the artboard is marked in its name AND by the canvas it sits in', () => {
    const { remote, res } = view('letak a6 predni');
    expect(res.closeOnly).toBe(false);
    expect(res.didYouMean).toBe(false);
    const front = remote.find((r: { id: string }) => r.id.endsWith('#front'));
    expect(slice('A · přední FLAG', front.marks)).toEqual(['přední']);
    expect(slice(front.meta, front.metaMarks)).toEqual(['LetakA6']);
  });

  test('two words side by side in a name are one mark, not two', () => {
    const { remote } = view('letak a6');
    const canvas = remote.find((r: { id: string }) => r.id === 'canvas:ui/2026/LetakA6.tsx');
    expect(slice('LetakA6', canvas.marks)).toEqual(['LetakA6']);
  });

  test('a canvas found through its folder marks the folder words in the meta line', () => {
    const { remote } = view('dresy uniformy');
    const row = remote.find(
      (r: { id: string }) => r.id === 'canvas:ui/2026/dresy/Uniformy-2027.tsx'
    );
    expect(slice('Uniformy-2027', row.marks)).toEqual(['Uniformy']);
    expect(slice(row.meta, row.metaMarks)).toEqual(['dresy']); // a canvas's meta line is its folder
  });
});

describe('"unifromy 2027": close matches, said once', () => {
  const { remote, res } = view('unifromy 2027');

  test('the number is not a typo: uniformy-2026-stare is not offered for 2027', () => {
    expect(remote.map((r: { name: string }) => r.name)).not.toContain('uniformy-2026-stare');
    expect(res.total).toBe(3);
  });

  test('every row is close, the note names the word, and the typo’d token is marked', () => {
    expect(res.closeOnly).toBe(true);
    expect(res.didYouMean).toBe(false); // 2027 is right: this is not "nothing"
    expect(res.closeWord).toBe('Uniformy');
    const canvas = res.groups[0].rows[0];
    expect(canvas.name).toBe('Uniformy-2027');
    expect(slice(canvas.name, canvas.marks)).toEqual(['Uniformy', '2027']);
    const board = res.groups
      .flatMap((g: { rows: unknown[] }) => g.rows)
      .find((r: { id: string }) => r.id.endsWith('#home')) as {
      name: string;
      marks: [number, number][];
      meta: string;
      metaMarks: [number, number][];
    };
    expect(slice(board.name, board.marks)).toEqual(['2027']);
    expect(slice(board.meta, board.metaMarks)).toEqual(['Uniformy']);
  });

  test('the footer counts close matches: "3 close matches"', () => {
    expect(footerCount(res)).toBe('3 close matches');
    expect(closeCount(1)).toBe('1 close match');
  });
});

describe('a near miss with no word right is drawn quiet', () => {
  const rows = [
    { group: 'canvases', key: 'ui/Uniformy-letak.tsx', name: 'Uniformy-lteak', meta: 'a' },
    { group: 'canvases', key: 'ui/Unifromy-letak.tsx', name: 'Unifromy-letak', meta: 'b' },
  ].map((r) => ({ ...r, score: 1, close: false, marks: [] }));
  const remote = remoteRows({ q: 'uniformy lteak', rows } as never, { query: 'uniformy lteak' });
  const res = assemble({ query: 'uniformy lteak', local: [], remote, canAskAI: true });

  test('the row with a word right is not quiet; the all-typo row is', () => {
    const [a, b] = res.groups[0].rows;
    expect(a.name).toBe('Uniformy-lteak');
    expect(a.quiet).toBeUndefined();
    expect(b.name).toBe('Unifromy-letak');
    expect(b.quiet).toBe(true);
  });

  test('a list that holds one exact row is not "close matches" at all', () => {
    expect(res.closeOnly).toBe(false);
    expect(footerCount(res)).toBe('2 results');
  });
});

describe('a misspelling and no word right reads "Did you mean"', () => {
  const { res } = view('unifromy');

  test('the rows sit under "Did you mean", none quiet, and the footer says 0 results', () => {
    expect(res.didYouMean).toBe(true);
    expect(res.groups.map((g: { id: string }) => g.id)).toEqual(['did-you-mean']);
    expect(res.groups[0].title).toBe('Did you mean');
    expect(res.groups[0].rows.some((r: { quiet?: boolean }) => r.quiet)).toBe(false);
    expect(footerCount(res)).toBe('0 results · 4 close matches');
  });

  test('the rows still open their canvas or artboard (their own group stays)', () => {
    const groups = new Set(res.groups[0].rows.map((r: { group: string }) => r.group));
    expect([...groups].sort()).toEqual(['artboards', 'canvases']);
  });
});

describe('Ask AI says what it will do for this query', () => {
  test('hits: find it by what it looks like', () => {
    const { res } = view('letak a6 predni');
    expect(res.ask).toMatchObject({
      name: 'Ask AI',
      meta: ' — find “letak a6 predni” by what it looks like',
      keys: '⌘↵',
    });
  });

  test('nothing, or only a misspelling: "Ask AI to find “q”" and that it looks inside canvases', () => {
    for (const q of ['pricng qqqq', 'unifromy']) {
      const { res } = view(q);
      expect(res.ask).toMatchObject({
        name: `Ask AI to find “${q}”`,
        meta: ' — it looks inside canvases too',
      });
    }
  });

  test('nothing typed: describe it; nothing opened yet: say what to type', () => {
    expect(askRow('', 'idle').meta).toBe(' — describe what you want on the canvas');
    expect(askRow('', 'first').meta).toBe(' — type what to make, or what to find');
  });

  test('it is the last item and absent where there is no AI', () => {
    const { res } = view('letak');
    expect(res.items[res.items.length - 1].id).toBe('ask-ai');
    expect(view('letak', false).res.ask).toBeNull();
  });
});

describe('design-system pages are found like canvases and say what they are', () => {
  test('a specimen under system/<ds>/ reads "Design system · …", and its word is marked there', () => {
    expect(canvasMeta('system/maude-v2/preview/button.tsx', 'system/maude-v2/preview')).toBe(
      'Design system · maude-v2 · preview'
    );
    expect(canvasMeta('ui/2026/LetakA6.tsx', '2026')).toBe('2026');
    const rows = [
      {
        group: 'canvases',
        key: 'system/maude-v2/preview/button.tsx',
        name: 'button',
        meta: 'system/maude-v2/preview',
        score: 4,
        close: false,
        marks: [[0, 6]],
      },
    ];
    const remote = remoteRows({ q: 'button preview', rows } as never, { query: 'button preview' });
    expect(remote[0].group).toBe('canvases');
    expect(slice(remote[0].meta, remote[0].metaMarks)).toEqual(['preview']);
  });
});
