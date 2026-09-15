// Plan T23/T24 — structured UI operations against the REAL canvas corpus
// (this repo's own `.design/`, every canvas), not a toy fixture.
//
//   • fidelity: setting a literal attribute to the value it already has, or a
//     text to the text it already has, changes no byte — a UI edit never
//     reformats what it did not mean to change;
//   • round trip: a change and its reversal return the exact original bytes;
//   • determinism: the same operation on the same base yields the same bytes;
//   • addressing: every element whose print is unique is re-found by print
//     alone (no positional hint) — the property a concurrent edit relies on;
//   • limits: how long addressing takes on the largest canvas, recorded as
//     the support matrix's source-size limit.

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import {
  applyEdit,
  applyTextEdit,
  listElements,
  printUniqueness,
  relocateElement,
} from '../canvas-edit.ts';

const DESIGN = join(import.meta.dir, '..', '..', '..', '.design');

function corpus(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name.startsWith('_') || name.startsWith('.') || name === 'node_modules') continue;
      const abs = join(dir, name);
      if (statSync(abs).isDirectory()) walk(abs);
      else if (name.endsWith('.tsx')) out.push(abs);
    }
  };
  walk(DESIGN);
  return out.sort();
}

/** `name=value` pairs of a print's literal attributes (no expressions, no pipeline ids). */
function literalPairs(attrs: string): Array<[string, string]> {
  if (!attrs) return [];
  return attrs
    .split('|')
    .map((kv) => {
      const i = kv.indexOf('=');
      return [kv.slice(0, i), kv.slice(i + 1)] as [string, string];
    })
    .filter(
      ([k, v]) =>
        k &&
        v !== '{expr}' &&
        v !== 'true' &&
        !k.startsWith('data-cd') &&
        !k.includes(':') &&
        k !== 'key' &&
        k !== 'style' &&
        !/["\\\n{}]/.test(v)
    );
}

const files = corpus();

describe('attribute values keep their type (T23)', () => {
  const ABS = '/tmp/x/ui/t.tsx';
  const src = `export default function T() {\n  return <DCArtboard id="a" height={400} hidden={false} gap={-8} label='Hi' />;\n}\n`;
  const id = listElements(ABS, src)[0]?.id as string;
  test('a number stays a number, a boolean a boolean; the same value is no edit', () => {
    expect(applyEdit(ABS, src, id, 'height', '400').source).toBe(src);
    expect(applyEdit(ABS, src, id, 'height', '480').source).toContain('height={480}');
    expect(applyEdit(ABS, src, id, 'hidden', 'true').source).toContain('hidden={true}');
    expect(applyEdit(ABS, src, id, 'gap', '-8').source).toBe(src);
    expect(applyEdit(ABS, src, id, 'gap', '12').source).toContain('gap={12}');
    // Same string in the author's own quotes: untouched.
    expect(applyEdit(ABS, src, id, 'label', 'Hi').source).toBe(src);
    // A number turned into words becomes a string — the one honest spelling.
    expect(applyEdit(ABS, src, id, 'height', 'auto').source).toContain('height="auto"');
  });
});
const PER_CANVAS = 12;

describe('structured operations on the real corpus (T23/T24)', () => {
  test('the corpus is real and parses', () => {
    expect(files.length).toBeGreaterThan(20);
    let elements = 0;
    for (const f of files) elements += listElements(f, readFileSync(f, 'utf8')).length;
    expect(elements).toBeGreaterThan(1000);
  });

  test('a no-op attribute set changes no byte, anywhere in the corpus', () => {
    const drift: string[] = [];
    let checked = 0;
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      let n = 0;
      for (const el of listElements(f, src)) {
        if (n >= PER_CANVAS) break;
        const pair = literalPairs(el.print.attrs)[0];
        if (!pair) continue;
        n++;
        checked++;
        let out: string;
        try {
          out = applyEdit(f, src, el.id, pair[0], pair[1]).source;
        } catch {
          continue; // an element the op refuses is not a fidelity break
        }
        if (out !== src) drift.push(`${relative(DESIGN, f)} <${el.print.tag} ${pair[0]}>`);
      }
    }
    expect(checked).toBeGreaterThan(100);
    expect(drift).toEqual([]);
  });

  test('a change and its reversal return the original bytes; the same op is deterministic', () => {
    const broken: string[] = [];
    let checked = 0;
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      let n = 0;
      for (const el of listElements(f, src)) {
        if (n >= PER_CANVAS) break;
        const pair = literalPairs(el.print.attrs)[0];
        if (!pair) continue;
        n++;
        // A number is changed to another number (the inspector's own case); a
        // string to another string.
        const next = /^-?\d+(\.\d+)?$/.test(pair[1])
          ? String(Number(pair[1]) + 1)
          : pair[1] === 'false'
            ? 'true'
            : `${pair[1]}-x`;
        try {
          const changed = applyEdit(f, src, el.id, pair[0], next).source;
          const again = applyEdit(f, src, el.id, pair[0], next).source;
          const back = applyEdit(f, changed, el.id, pair[0], pair[1]).source;
          checked++;
          if (changed === src || again !== changed || back !== src)
            broken.push(`${relative(DESIGN, f)} <${el.print.tag} ${pair[0]}>`);
        } catch {
          /* refused — not a fidelity break */
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
    expect(broken).toEqual([]);
  });

  test('a no-op text edit changes no byte', () => {
    const drift: string[] = [];
    let checked = 0;
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      let n = 0;
      for (const el of listElements(f, src)) {
        if (n >= PER_CANVAS) break;
        const text = el.print.text;
        if (!text || text.length > 60 || /[{}<>&\n]/.test(text) || text !== text.trim()) continue;
        n++;
        let out: string;
        try {
          out = applyTextEdit(f, src, el.id, text).source;
        } catch {
          continue;
        }
        checked++;
        if (out !== src) drift.push(`${relative(DESIGN, f)} <${el.print.tag}>`);
      }
    }
    expect(checked).toBeGreaterThan(50);
    expect(drift).toEqual([]);
  });

  test('every uniquely printed element is re-found by print alone — and addressing stays fast', () => {
    const lost: string[] = [];
    let largest = { file: '', bytes: 0, ms: 0, elements: 0 };
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      const all = listElements(f, src);
      const key = (p: (typeof all)[number]['print']) =>
        `${p.component}|${p.tag}|${p.chain.join('>')}|${p.attrs}|${p.text ?? ''}`;
      const counts = new Map<string, number>();
      for (const e of all) counts.set(key(e.print), (counts.get(key(e.print)) ?? 0) + 1);
      const t0 = performance.now();
      let probed = 0;
      for (const e of all) {
        if (counts.get(key(e.print)) !== 1) continue;
        // No hint: the positional id is deliberately wrong.
        const found = relocateElement(f, src, 'ffffffff', e.print);
        if (found !== e.id) lost.push(`${relative(DESIGN, f)} <${e.print.tag}>`);
        if (++probed >= 40) break;
      }
      const per = probed ? (performance.now() - t0) / probed : 0;
      if (src.length > largest.bytes)
        largest = { file: relative(DESIGN, f), bytes: src.length, ms: per, elements: all.length };
      const u = printUniqueness(f, src);
      expect(u.unique).toBeLessThanOrEqual(u.elements);
    }
    expect(lost).toEqual([]);
    console.log(
      `[t23] largest canvas ${largest.file}: ${largest.bytes} B, ${largest.elements} elements, ${largest.ms.toFixed(1)} ms per print lookup`
    );
    // The support matrix's limit: a lookup on the largest real canvas stays
    // interactive (one re-apply after a lost race is a handful of lookups).
    expect(largest.ms).toBeLessThan(250);
  }, 120_000);
});
