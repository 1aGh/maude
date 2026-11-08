// #122 (122-A) — `freeRefsOf`: every name a range reads from around it, WITH its position and where it comes
// from (an import, a module-level declaration, a function around it, nothing). Today's `needsOf` missed JSX tag
// names (`<Card>`, `<Pill>`), so a copied object rendering a same-file component pasted as an error card.

import { describe, expect, test } from 'bun:test';

import { freeRefsOf, needsOf } from '../edit-ops/scope-names.ts';

const SRC = `import { Card } from '../components/Card';
import * as Icons from './icons';
type Size = { w: number };
const W = 1440;
let counter = 0;
function Pill({ children }) {
  return <span>{children}</span>;
}
export default function Home({ title }) {
  const items = ['a'];
  return (
    <section data-r="1">
      <Card title={title} width={W} />
      <Pill>New</Pill>
      <Icons.Star size={W as Size['w']} />
      <ul>{items.map((W) => <li key={W}>{W}</li>)}</ul>
      <b style={{ W, counter }}>{Math.max(1, 2)}</b>
      <my-tag />
    </section>
  );
}
`;
const from = SRC.indexOf('<section');
const to = SRC.indexOf('</section>') + '</section>'.length;

describe('freeRefsOf', () => {
  const refs = freeRefsOf(SRC, from, to) ?? [];
  const by = (name: string) => refs.filter((r) => r.name === name);

  test('JSX tag roots are reads: a component, its closing tag, a member tag’s object', () => {
    expect(by('Card').map((r) => r.jsx)).toEqual([true]);
    expect(by('Pill').length).toBe(2); // <Pill> and </Pill>
    expect(by('Pill').every((r) => r.jsx && r.scope === 'module')).toBe(true);
    expect(by('Icons').map((r) => r.scope)).toEqual(['import']);
    expect(by('Star')).toEqual([]);
    expect(refs.some((r) => r.name === 'section' || r.name === 'my-tag' || r.name === 'li')).toBe(
      false
    );
  });

  test('positions point at the name in the source', () => {
    for (const r of refs) expect(SRC.slice(r.start, r.end)).toBe(r.name);
  });

  test('each read says where it comes from', () => {
    expect(by('Card')[0]?.scope).toBe('import');
    expect(by('title').map((r) => r.scope)).toEqual(['function']);
    expect(by('items').map((r) => r.scope)).toEqual(['function']);
    expect(by('counter').map((r) => r.scope)).toEqual(['module']);
    expect(by('Math').map((r) => r.scope)).toEqual(['global']);
    expect(by('Size').map((r) => r.scope)).toEqual(['module']); // a TS type reference
  });

  test('a map callback’s parameter shadows the module name; a shorthand property is marked', () => {
    // W outside the callback: width={W}, size={W …}, { W } — never the three inside `(W) => …`
    expect(by('W').length).toBe(3);
    expect(by('W').filter((r) => r.shorthand).length).toBe(1);
    expect(by('W').every((r) => r.scope === 'module')).toBe(true);
  });

  test('needsOf keeps its signature and answers only the function-scope names', () => {
    expect(needsOf(SRC, from, to)).toEqual(['items', 'title']);
  });
});
