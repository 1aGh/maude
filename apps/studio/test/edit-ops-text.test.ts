// S2.12 (ed-text-edit, ed-text-style) — text in place, styles and the Czech ties.
//
// The writers: `text.set` (the typed copy), `text.set-language` (lang + ties + quotes), `text.set-case`,
// `text.use-style`, `text.reset-style`, `text.detach-style`. Every write is ONE request = ONE file write
// (one undo step), `data-cd-id` is never touched, and what lands is plain TSX a v1 peer reads: a `lang`
// attribute, a `t-<role>` class and ordinary inline style declarations.
// The Czech rules run on real strings — the same ones the canvas shows while you type.

import { describe, expect, test } from 'bun:test';

import { readAttributeState } from '../canvas-edit.ts';
import { NBSP, tieCzech, tiePositions } from '../edit-ops/czech-ties.ts';
import { type DispatchDeps, dispatchEditOp, EDIT_OPS, statusOf } from '../edit-ops/dispatch.ts';
import { createWriteLog } from '../edit-ops/revert.ts';
import type { EditOpResult } from '../edit-ops/types.ts';

const FILE = 'ui/Poster.tsx';

describe('tieCzech — a one-letter word never ends a line', () => {
  test('k s v z o u i a, any case, stay with the next word', () => {
    expect(tieCzech('Jdu v lese a s Petrem.')).toBe(`Jdu v${NBSP}lese a${NBSP}s${NBSP}Petrem.`);
    expect(tieCzech('Z Prahy k moři')).toBe(`Z${NBSP}Prahy k${NBSP}moři`);
    expect(tieCzech('Otevřeno o víkendu u nás i v neděli')).toBe(
      `Otevřeno o${NBSP}víkendu u${NBSP}nás i${NBSP}v${NBSP}neděli`
    );
  });

  test('every one-letter word, not only the eight — and a capital or an accented one', () => {
    expect(tieCzech('Ó my, I tak')).toBe(`Ó${NBSP}my, I${NBSP}tak`);
    expect(tieCzech('rozměr x y')).toBe(`rozměr x${NBSP}y`);
  });

  test('a longer word, a number and an abbreviation are left alone', () => {
    expect(tieCzech('Sraz je ve 12 hodin, p. Novák')).toBe('Sraz je ve 12 hodin, p. Novák');
  });

  test('the last word of the text and a line break have nothing to tie to', () => {
    expect(tieCzech('Dnes jedu v')).toBe('Dnes jedu v');
    expect(tieCzech('Jdu v\nlese')).toBe('Jdu v\nlese');
  });

  test('never inside a URL, an address or code', () => {
    expect(tieCzech('Spusť `npm i -g maude` v terminálu')).toBe(
      `Spusť \`npm i -g maude\` v${NBSP}terminálu`
    );
    expect(tieCzech('Napiš na info@x.cz a v pondělí')).toBe(
      `Napiš na info@x.cz a${NBSP}v${NBSP}pondělí`
    );
    expect(tieCzech('Najdeš to v https://x.cz/a/b?c=d a hotovo')).toBe(
      `Najdeš to v${NBSP}https://x.cz/a/b?c=d a${NBSP}hotovo`
    );
    // a code span keeps its own quotes too
    expect(tieCzech('Napiš `say "hi"` a "ahoj"')).toBe(`Napiš \`say "hi"\` a${NBSP}„ahoj“`);
  });

  test('"quotes" and “quotes” turn Czech: „ opens, “ closes', () => {
    expect(tieCzech('Řekl "ahoj" a odešel.')).toBe(`Řekl „ahoj“ a${NBSP}odešel.`);
    expect(tieCzech('Řekl “ahoj” světu')).toBe('Řekl „ahoj“ světu');
    expect(tieCzech('("ahoj")')).toBe('(„ahoj“)');
    expect(tieCzech('„už“ Czech')).toBe('„už“ Czech');
  });

  test('is idempotent and keeps a second space a second space', () => {
    const once = tieCzech('Jdu v lese a s "Petrem"');
    expect(tieCzech(once)).toBe(once);
    expect(tieCzech('Jdu v  lese')).toBe('Jdu v  lese');
  });

  test('tiePositions names the spaces the ties go on — the arcs the canvas draws', () => {
    const t = 'Jdu v lese a s Petrem';
    expect(tiePositions(t)).toEqual([5, 12, 14]);
    expect(tiePositions(tieCzech(t))).toEqual([5, 12, 14]); // already tied: the arcs stay
  });
});

// ── the writers ─────────────────────────────────────────────────────────────────────────

const POSTER = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
export default function Poster() {
  return (
    <DesignCanvas>
      <DCArtboard id="post" label="Post" width={1080} height={1080}>
        <h1 data-cd-id="title" className="t-heading card" style={{ color: "red" }}>Jdu v lese</h1>
        <p data-cd-id="over" className="t-body" style={{ fontSize: "20px", textTransform: "uppercase", color: "blue" }}>Over</p>
        <p data-cd-id="plain">Zpráva "o" tom, že a s tím</p>
        <p data-cd-id="cz" lang="cs">Plain</p>
        <p data-cd-id="dyn" className={cls}>Dyn</p>
        <p data-cd-id="locked" data-cd-locked="true" className="t-body">Locked</p>
      </DCArtboard>
    </DesignCanvas>
  );
}
`;

function harness(initial = POSTER, held: string[] = []) {
  const files = new Map<string, string>([[FILE, initial]]);
  const snapshots: string[] = [];
  const deps: DispatchDeps = {
    resolve: (f) => (files.has(f.replace(/^\.design\//, '')) ? f.replace(/^\.design\//, '') : null),
    read: (rel) => files.get(rel) ?? null,
    write: async (rel, before, after) => {
      snapshots.push(before);
      files.set(rel, after);
    },
    heldByAi: (_rel, element) => (held.includes(element) ? { mine: true } : null),
    log: createWriteLog(),
  };
  const run = (op: string, targets: string[], params?: Record<string, unknown>) =>
    dispatchEditOp(
      {
        file: FILE,
        op,
        targets: targets.map((element) => ({ artboard: 'post', element })),
        ...(params ? { params } : {}),
      },
      deps
    );
  return { files, snapshots, deps, run, src: () => files.get(FILE) as string };
}
const good = (r: EditOpResult) => {
  if (!r.ok) throw new Error(`expected ok, got ${r.code}: ${r.message}`);
  return r;
};
const bad = (r: EditOpResult) => {
  if (r.ok) throw new Error('expected a refusal');
  return r;
};
const attr = (src: string, id: string, a: string) => {
  const s = readAttributeState(FILE, src, id, a);
  return s.kind === 'literal' ? s.value : s.kind;
};
const textOf = (src: string, id: string) =>
  new RegExp(`data-cd-id="${id}"[^>]*>([^<]*)<`).exec(src)?.[1];

describe('the text ops are in the op table', () => {
  test('under their registry ids', () => {
    for (const id of [
      'text.set',
      'text.set-language',
      'text.set-case',
      'text.use-style',
      'text.reset-style',
      'text.detach-style',
    ])
      expect(EDIT_OPS.some((o) => o.id === id)).toBe(true);
  });
});

describe('text.set — the typed copy', () => {
  test('one write; the id and the style are untouched', async () => {
    const h = harness();
    const r = good(
      await h.run('text.set', ['title'], { text: 'Jdu do lesa', before: 'Jdu v lese' })
    );
    expect(h.snapshots).toHaveLength(1);
    expect(textOf(h.src(), 'title')).toBe('Jdu do lesa');
    expect(h.src()).toContain(
      'data-cd-id="title" className="t-heading card" style={{ color: "red" }}'
    );
    expect(r.refs[0]?.element).toBe('title');
  });

  test('in a Czech element the copy is tied and the quotes turn Czech, in the same write', async () => {
    const h = harness();
    good(await h.run('text.set', ['cz'], { text: 'Jdu v lese a "ahoj"' }));
    expect(textOf(h.src(), 'cz')).toBe(`Jdu v${NBSP}lese a${NBSP}„ahoj“`);
    expect(h.snapshots).toHaveLength(1);
  });

  test('elsewhere the copy is left exactly as typed', async () => {
    const h = harness();
    good(await h.run('text.set', ['plain'], { text: 'Jdu v lese "ahoj"' }));
    expect(textOf(h.src(), 'plain')).toBe('Jdu v lese "ahoj"');
  });

  test('the language the canvas sees (an ancestor’s lang) decides, not only the element’s own', async () => {
    const h = harness();
    good(await h.run('text.set', ['plain'], { text: 'Jdu v lese', lang: 'cs-CZ' }));
    expect(textOf(h.src(), 'plain')).toBe(`Jdu v${NBSP}lese`);
  });

  test('no text param is invalid; a locked element refuses', async () => {
    const h = harness();
    expect(bad(await h.run('text.set', ['title'], {})).code).toBe('invalid');
    expect(bad(await h.run('text.set', ['locked'], { text: 'x' })).code).toBe('locked');
  });

  test('an element AI holds refuses with the AI’s own line', async () => {
    const h = harness(POSTER, ['title']);
    const r = bad(await h.run('text.set', ['title'], { text: 'x' }));
    expect(r.code).toBe('held-by-ai');
    expect(statusOf(r)).toBe(409);
  });
});

describe('text.set-language', () => {
  test('Čeština writes lang="cs", ties the copy and turns the quotes — one write', async () => {
    const h = harness();
    good(await h.run('text.set-language', ['plain'], { lang: 'cs' }));
    expect(attr(h.src(), 'plain', 'lang')).toBe('cs');
    expect(textOf(h.src(), 'plain')).toBe(`Zpráva „o“ tom, že a${NBSP}s${NBSP}tím`);
    expect(h.snapshots).toHaveLength(1);
  });

  test('another language writes lang and leaves the copy exactly as it is (nothing is un-tied)', async () => {
    const h = harness();
    good(await h.run('text.set-language', ['plain'], { lang: 'cs' }));
    const tied = textOf(h.src(), 'plain');
    good(await h.run('text.set-language', ['plain'], { lang: 'en' }));
    expect(attr(h.src(), 'plain', 'lang')).toBe('en');
    expect(textOf(h.src(), 'plain')).toBe(tied);
  });

  test('a language that is not a language tag is refused', async () => {
    const h = harness();
    expect(bad(await h.run('text.set-language', ['plain'], { lang: 'x"y' })).code).toBe('invalid');
    expect(bad(await h.run('text.set-language', ['plain'], {})).code).toBe('invalid');
  });

  test('several objects: every one gets the language, one write', async () => {
    const h = harness();
    good(await h.run('text.set-language', ['plain', 'title'], { lang: 'cs' }));
    expect(attr(h.src(), 'title', 'lang')).toBe('cs');
    expect(textOf(h.src(), 'title')).toBe(`Jdu v${NBSP}lese`);
    expect(h.snapshots).toHaveLength(1);
  });
});

describe('text.set-case', () => {
  test('AA writes text-transform; As typed takes it out', async () => {
    const h = harness();
    good(await h.run('text.set-case', ['title'], { case: 'upper' }));
    expect(attr(h.src(), 'title', 'style.text-transform')).toBe('uppercase');
    good(await h.run('text.set-case', ['over'], { case: 'typed' }));
    expect(attr(h.src(), 'over', 'style.text-transform')).toBe('absent');
    expect(attr(h.src(), 'over', 'style.color')).toBe('blue');
  });

  test('As typed under a style that sets the case writes none — the style would put it back', async () => {
    const h = harness();
    good(await h.run('text.set-case', ['title'], { case: 'typed', explicit: true }));
    expect(attr(h.src(), 'title', 'style.text-transform')).toBe('none');
  });

  test('a case that is neither is refused', async () => {
    const h = harness();
    expect(bad(await h.run('text.set-case', ['title'], { case: 'lower' })).code).toBe('invalid');
  });
});

describe('text.use-style', () => {
  test('the role’s class replaces any other role class, keeps the others, and drops what overrides it', async () => {
    const h = harness();
    good(await h.run('text.use-style', ['over'], { role: 't-title' }));
    expect(attr(h.src(), 'over', 'className')).toBe('t-title');
    expect(attr(h.src(), 'over', 'style.font-size')).toBe('absent');
    expect(attr(h.src(), 'over', 'style.text-transform')).toBe('absent');
    // not part of the type: colour stays
    expect(attr(h.src(), 'over', 'style.color')).toBe('blue');
    good(await h.run('text.use-style', ['title'], { role: 't-subheading' }));
    expect(attr(h.src(), 'title', 'className')).toBe('card t-subheading');
  });

  test('an element with no class gets the role as its class', async () => {
    const h = harness();
    good(await h.run('text.use-style', ['plain'], { role: 't-body' }));
    expect(attr(h.src(), 'plain', 'className')).toBe('t-body');
  });

  test('a role that is not a t- class is refused; a computed className is refused', async () => {
    const h = harness();
    expect(bad(await h.run('text.use-style', ['plain'], { role: 'danger' })).code).toBe('invalid');
    expect(bad(await h.run('text.use-style', ['plain'], { role: 't-body"x' })).code).toBe(
      'invalid'
    );
    expect(bad(await h.run('text.use-style', ['dyn'], { role: 't-body' })).code).toBe('invalid');
  });
});

describe('text.reset-style', () => {
  test('takes the overrides of the style out and nothing else', async () => {
    const h = harness();
    good(await h.run('text.reset-style', ['over'], {}));
    expect(attr(h.src(), 'over', 'style.font-size')).toBe('absent');
    expect(attr(h.src(), 'over', 'style.text-transform')).toBe('absent');
    expect(attr(h.src(), 'over', 'style.color')).toBe('blue');
    expect(attr(h.src(), 'over', 'className')).toBe('t-body');
  });

  test('a named property resets only that one', async () => {
    const h = harness();
    good(await h.run('text.reset-style', ['over'], { props: ['font-size'] }));
    expect(attr(h.src(), 'over', 'style.font-size')).toBe('absent');
    expect(attr(h.src(), 'over', 'style.text-transform')).toBe('uppercase');
  });

  test('nothing to reset is no write at all', async () => {
    const h = harness();
    const r = good(await h.run('text.reset-style', ['plain'], {}));
    expect(h.snapshots).toHaveLength(0);
    expect(r.actionId).toBeNull();
  });
});

describe('text.detach-style — keeps the look exactly', () => {
  const ROLE = { 'font-size': '28px', 'font-weight': '700', 'line-height': '32px' };

  test('the role’s values are inlined, the role class goes, the other classes stay', async () => {
    const h = harness();
    good(await h.run('text.detach-style', ['title'], { values: ROLE }));
    expect(attr(h.src(), 'title', 'className')).toBe('card');
    expect(attr(h.src(), 'title', 'style.font-size')).toBe('28px');
    expect(attr(h.src(), 'title', 'style.font-weight')).toBe('700');
    expect(attr(h.src(), 'title', 'style.line-height')).toBe('32px');
    expect(attr(h.src(), 'title', 'style.color')).toBe('red');
  });

  test('what was already overridden keeps its own value; the rest comes from the style', async () => {
    const h = harness();
    good(await h.run('text.detach-style', ['over'], { values: ROLE }));
    expect(attr(h.src(), 'over', 'style.font-size')).toBe('20px');
    expect(attr(h.src(), 'over', 'style.font-weight')).toBe('700');
    expect(attr(h.src(), 'over', 'className')).toBe('absent');
  });

  test('a value that could close the style object is refused', async () => {
    const h = harness();
    expect(
      bad(await h.run('text.detach-style', ['title'], { values: { 'font-size': '28px }, x: {' } }))
        .code
    ).toBe('invalid');
    expect(
      bad(await h.run('text.detach-style', ['title'], { values: { 'z-index': '4' } })).code
    ).toBe('invalid');
  });

  test('then Use a style takes it back to following the style', async () => {
    const h = harness();
    good(await h.run('text.detach-style', ['title'], { values: ROLE }));
    good(await h.run('text.use-style', ['title'], { role: 't-heading' }));
    expect(attr(h.src(), 'title', 'className')).toBe('card t-heading');
    expect(attr(h.src(), 'title', 'style.font-size')).toBe('absent');
    expect(attr(h.src(), 'title', 'style.color')).toBe('red');
  });
});
