// Plan T23/T24 — a UI operation re-applied onto the version that won.

import { describe, expect, test } from 'bun:test';

import { applyEdit, elementPrint, relocateElement } from '../canvas-edit.ts';
import { describeSourceOp, replaySourceOp } from '../sync/source-ops.ts';

const ABS = '/tmp/x/ui/card.tsx';
const canvas = (body: string) =>
  `export default function Card() {\n  return (\n    <section>\n${body}\n    </section>\n  );\n}\n`;
const H1 = `      <h1 title="Hello" style={{ color: 'red' }}>Card</h1>`;
const P = `      <p className="lede">Body</p>`;

// Ids as the pipeline computes them: Bun.hash("<Component>:<pre-order idx>").
const computeId = (idx: number) => Bun.hash(`Card:${idx}`).toString(16).padStart(16, '0').slice(0, 8);
function idOf(src: string, tag: string): string {
  for (let idx = 0; idx < 20; idx++) {
    const id = computeId(idx);
    if (elementPrint(ABS, src, id)?.tag === tag) return id;
  }
  throw new Error(`no ${tag}`);
}

describe('source operations', () => {
  test('a style set lost to a teammate’s change of the same property wins by acceptance order, keeping their other edit', () => {
    const base = canvas(`${H1}\n${P}`);
    const id = idOf(base, 'h1');
    const op = describeSourceOp(ABS, base, { kind: 'set', id, attr: 'style.color', value: JSON.stringify('blue') });
    expect(op).not.toBeNull();
    // The teammate changed the same colour AND inserted a sibling before it —
    // which renumbers every positional id after it.
    const theirs = canvas(`      <hr />\n${H1.replace("'red'", "'green'")}\n${P}`);
    const r = replaySourceOp(ABS, op!, theirs);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.source).toContain('<hr />'); // their structure kept
    expect(r.source).toContain('"blue"'); // my later value
    expect(r.source).not.toContain("'green'");
    expect(r.source).toContain('title="Hello"');
  });

  test('a text edit follows its element even after it moved position', () => {
    const base = canvas(`${H1}\n${P}`);
    const id = idOf(base, 'p');
    const op = describeSourceOp(ABS, base, { kind: 'text', id, text: 'New body' });
    const theirs = canvas(`${P}\n${H1}`); // reordered
    const r = replaySourceOp(ABS, op!, theirs);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.source).toContain('>New body</p>');
  });

  test('a target the teammate deleted is not guessed at', () => {
    const base = canvas(`${H1}\n${P}`);
    const op = describeSourceOp(ABS, base, { kind: 'set', id: idOf(base, 'p'), attr: 'className', value: 'x' });
    const r = replaySourceOp(ABS, op!, canvas(H1));
    expect(r).toEqual({ ok: false, reason: 'target-missing' });
  });

  test('two identical elements make the target ambiguous', () => {
    const base = canvas(`${P}`);
    const op = describeSourceOp(ABS, base, { kind: 'text', id: idOf(base, 'p'), text: 'x' });
    const theirs = canvas(`      <hr />\n${P}\n${P}`);
    expect(replaySourceOp(ABS, op!, theirs)).toEqual({ ok: false, reason: 'target-missing' });
  });

  test('relocateElement prefers the hint when nothing moved', () => {
    const src = canvas(`${H1}\n${P}`);
    const id = idOf(src, 'h1');
    const print = elementPrint(ABS, src, id, 'style');
    expect(relocateElement(ABS, applyEdit(ABS, src, id, 'style.color', '"x"').source, id, print!, 'style')).toBe(id);
  });
});

describe('structural operations (T25)', () => {
  test('a delete follows its element past a teammate’s insertion', () => {
    const base = canvas(`${H1}\n${P}`);
    const op = describeSourceOp(ABS, base, { kind: 'delete', id: idOf(base, 'p') });
    const theirs = canvas(`      <hr />\n${H1}\n${P}`);
    const r = replaySourceOp(ABS, op!, theirs);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.source).toContain('<hr />');
    expect(r.source).toContain('<h1');
    expect(r.source).not.toContain('className="lede"');
  });

  test('a duplicate lands once, on the right element', () => {
    const base = canvas(`${H1}\n${P}`);
    const op = describeSourceOp(ABS, base, { kind: 'duplicate', id: idOf(base, 'p') });
    const r = replaySourceOp(ABS, op!, canvas(`      <hr />\n${H1}\n${P}`));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.source.match(/className="lede"/g)?.length).toBe(2);
  });

  test('an artboard change is re-applied by its authored id', () => {
    const board = (w: number, extra = '') =>
      `import { DCArtboard, DesignCanvas } from "@maude/canvas-lib";\nexport default function B() {\n  return (\n    <DesignCanvas>\n      <DCArtboard id="home" label="Home" width={${w}} height={300}>${extra}<p>x</p></DCArtboard>\n    </DesignCanvas>\n  );\n}\n`;
    const op = describeSourceOp(ABS, board(400), { kind: 'artboard', fn: 'resize', artboardId: 'home', args: [640, undefined] });
    const r = replaySourceOp(ABS, op!, board(400, '<hr />'));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.source).toContain('width={640}');
      expect(r.source).toContain('<hr />');
    }
  });
});
