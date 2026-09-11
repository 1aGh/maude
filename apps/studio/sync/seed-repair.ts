// Both sync handlers must repair the live seed race before projecting (#121).
import type * as Y from 'yjs';
import {
  applyCssToDoc,
  applyHtmlToDoc,
  cssFromDoc,
  htmlFromDoc,
  markSeeded,
  seededByFromDoc,
  stampBodyEdit,
} from './codec.ts';
import { isExactRepeat } from './cold-start.ts';

export const SEED_REPAIR_WINDOW_MS = 10_000;
type Seed = { body: string; css: string | null; until: number };
const seeds = new WeakMap<Y.Doc, Seed>();

export function rememberSeed(doc: Y.Doc, body: string, css: string | null, origin: unknown): void {
  seeds.set(doc, { body, css, until: Date.now() + SEED_REPAIR_WINDOW_MS });
  markSeeded(doc, origin);
}

/** Exact repeats only; divergent seeds are preserved for conflict recovery. */
export function repairSeedDuplication(doc: Y.Doc, origin: unknown): ('body' | 'css')[] {
  const seed = seeds.get(doc);
  if (!seed) return [];
  if (Date.now() > seed.until) {
    seeds.delete(doc);
    return [];
  }
  if (seededByFromDoc(doc) !== doc.clientID) return [];
  const repaired: ('body' | 'css')[] = [];
  doc.transact(() => {
    if (isExactRepeat(htmlFromDoc(doc), seed.body)) {
      applyHtmlToDoc(doc, seed.body, origin);
      stampBodyEdit(doc, origin);
      repaired.push('body');
    }
    const css = cssFromDoc(doc);
    if (css !== null && seed.css !== null && isExactRepeat(css, seed.css)) {
      applyCssToDoc(doc, seed.css, origin);
      repaired.push('css');
    }
  }, origin);
  return repaired;
}
