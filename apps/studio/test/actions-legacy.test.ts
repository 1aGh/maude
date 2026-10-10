// V2-2.4 step 4 — the v1 surfaces (⌘K palette, menubar dropdowns, "?" sheet) render from the
// registry's v1 layouts (actions/legacy.ts). Their display strings stay verbatim (defect 8), so
// this proves they cannot drift from the bindings: every key a row shows is a binding of the
// action it names (or a recorded v1 defect), and every row names a registered action.
import { describe, expect, test } from 'bun:test';

import { ACTIONS_BY_ID } from '../actions/index.ts';
import { chord } from '../actions/keys.ts';
import { V1_MENUBAR, V1_PALETTE, V1_SHEET, type V1MenuItem } from '../actions/legacy.ts';

const chordsOf = (id: string) => new Set((ACTIONS_BY_ID.get(id)?.keys ?? []).map((b) => b.chord));
/** The canonical chord a v1 display string spells ('⌘ ⇧ M', '⇧⌘E', 'Esc', '⌘ +'). */
const shown = (s: string) => chord(s.replace(/\s+/g, ' '));

describe('"?" sheet (V1_SHEET)', () => {
  test('every row names registered actions', () => {
    for (const g of V1_SHEET)
      for (const r of g.items)
        for (const id of r.ids)
          expect(`${r.label}: ${id} ${ACTIONS_BY_ID.has(id)}`).toBe(`${r.label}: ${id} true`);
  });
  test('every key a row shows is bound to one of its actions', () => {
    for (const g of V1_SHEET)
      for (const r of g.items) {
        const keys = [r.kbd, ...(r.alt ? r.alt.split(' / ') : [])];
        for (const k of keys) {
          const c = shown(k);
          if (c === null) {
            // a pointer gesture: it names no action
            expect(r.ids).toEqual([]);
            continue;
          }
          const owners = r.ids.filter((id) => chordsOf(id).has(c));
          expect(`${r.label} ${k} → ${owners.length ? 'bound' : 'UNBOUND'}`).toBe(
            `${r.label} ${k} → bound`
          );
        }
      }
  });
  test('the layout is v1 verbatim (4 groups, 24 rows)', () => {
    expect(V1_SHEET.map((g) => g.label)).toEqual([
      'Canvas',
      'Tools · canvas focus',
      'Selection & zoom',
      'View',
    ]);
    expect(V1_SHEET.reduce((n, g) => n + g.items.length, 0)).toBe(24);
  });
});

describe('⌘K palette (V1_PALETTE)', () => {
  test('17 rows, each a registered action with a v1 palette label', () => {
    expect(V1_PALETTE.length).toBe(17);
    for (const r of V1_PALETTE) {
      const a = ACTIONS_BY_ID.get(r.id);
      expect(`${r.id} ${typeof a?.legacy?.palette}`).toBe(`${r.id} string`);
    }
  });
  test('every key a row shows is a binding of its action', () => {
    for (const r of V1_PALETTE.filter((x) => x.kbd)) {
      const c = shown(r.kbd as string);
      expect(`${r.id} ${r.kbd} ${c !== null && chordsOf(r.id).has(c)}`).toBe(
        `${r.id} ${r.kbd} true`
      );
    }
  });
});

describe('menubar (V1_MENUBAR)', () => {
  const items = Object.entries(V1_MENUBAR).flatMap(([menu, rows]) =>
    rows.filter((r): r is V1MenuItem => !('sep' in r)).map((r) => ({ menu, ...r }))
  );
  test('every row names a registered action with a v1 menu label', () => {
    for (const r of items) {
      const a = ACTIONS_BY_ID.get(r.id);
      expect(`${r.menu}/${r.id} ${typeof (r.label ?? a?.legacy?.menu)}`).toBe(
        `${r.menu}/${r.id} string`
      );
    }
  });
  test('every key a row shows is a binding — of its action, its keyOf, or a recorded defect', () => {
    for (const r of items.filter((x) => x.kbd)) {
      const c = shown(r.kbd as string);
      const owner = r.keyOf ?? r.id;
      const bound = c !== null && chordsOf(owner).has(c);
      if (r.dead) {
        // A recorded v1 defect: the key is shown, nothing binds it to THIS action. Pin it, so the
        // day it gets bound (Phase 4) this row's `dead` has to go.
        expect(`${r.menu}/${r.id} ${r.kbd} dead:${bound}`).toBe(
          `${r.menu}/${r.id} ${r.kbd} dead:false`
        );
        continue;
      }
      expect(`${r.menu}/${r.id} ${r.kbd} ${bound}`).toBe(`${r.menu}/${r.id} ${r.kbd} true`);
    }
  });
  test('Tools rows carry the v1 tool id the menu posts', () => {
    for (const r of items.filter((x) => x.menu === 'tools')) expect(typeof r.tool).toBe('string');
  });
});
