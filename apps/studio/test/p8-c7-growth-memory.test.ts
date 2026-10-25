// V2-8.5 c7 (08 ak-web-hug) — a section written into the canvas file reloads the frame, so the page's last height and
// the fingerprint of its sections are remembered across the reload (sessionStorage); the new load can then say
// "+ 373 px" and name the section that arrived.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  readGrowthMemory,
  sectionSigs,
  writeGrowthMemory,
} from '../artboard-growth-memory.ts';
import { freshChildren } from '../artboard-new-section.tsx';

const store = new Map<string, string>();
const g = globalThis as Record<string, unknown>;

beforeEach(() => {
  store.clear();
  g.location = { pathname: '/canvas/Matchday.tsx', search: '?fc=abc' };
  g.sessionStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
});
afterEach(() => {
  g.location = undefined;
  g.sessionStorage = undefined;
});

describe('sectionSigs', () => {
  test('a tag and the first words, numbered when two look alike', () => {
    const sigs = sectionSigs([
      { tagName: 'SECTION', textContent: '  Tréninky  Krátký popis ' },
      { tagName: 'section', textContent: 'Tým' },
      { tagName: 'section', textContent: 'Tým' },
    ]);
    expect(sigs[0]).toBe('section|Tréninky Krátký popis#0');
    expect(sigs[1]).toBe('section|Tým#0');
    expect(sigs[2]).toBe('section|Tým#1');
  });

  test('a section added in the middle is the only fresh fingerprint', () => {
    const before = sectionSigs([
      { tagName: 'section', textContent: 'Tréninky' },
      { tagName: 'section', textContent: 'Tým' },
    ]);
    const after = sectionSigs([
      { tagName: 'section', textContent: 'Tréninky' },
      { tagName: 'section', textContent: 'Rozpis zápasů' },
      { tagName: 'section', textContent: 'Tým' },
    ]);
    expect(freshChildren(new Set(before), after)).toEqual(['section|Rozpis zápasů#0']);
  });
});

describe('the memory', () => {
  test('writes merge, reads are per canvas address and artboard', () => {
    writeGrowthMemory('nabor', { h: 784 });
    writeGrowthMemory('nabor', { sigs: ['a#0'] });
    expect(readGrowthMemory('nabor')).toEqual({ h: 784, sigs: ['a#0'] });
    expect(readGrowthMemory('other')).toBeNull();
    g.location = { pathname: '/canvas/Other.tsx', search: '' };
    expect(readGrowthMemory('nabor')).toBeNull();
  });

  test('junk or a blocked store is nothing remembered', () => {
    store.set('dc-grow:/canvas/Matchday.tsx?fc=abc#x', '{"h":"tall"}');
    expect(readGrowthMemory('x')).toBeNull();
    g.sessionStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readGrowthMemory('x')).toBeNull();
    expect(() => writeGrowthMemory('x', { h: 1 })).not.toThrow();
    expect(readGrowthMemory(undefined)).toBeNull();
  });
});

describe('wiring', () => {
  const root = new URL('../', import.meta.url);
  const read = (p: string) => readFileSync(new URL(p, root), 'utf8');

  test('the growth tag and the new-section frame both start from the remembered baseline', () => {
    expect(read('artboard-growth-tag.tsx')).toContain('readGrowthMemory(memoryKey)');
    expect(read('artboard-new-section.tsx')).toContain('readGrowthMemory(memoryKey)');
    const lib = read('canvas-lib.tsx');
    expect(lib).toContain("measured.height, id);");
  });
});
