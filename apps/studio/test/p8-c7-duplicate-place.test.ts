// V2-8.5 c7 — where a "Duplicate at another width" copy lands depends on who asked: the artboard MENU (01 cf-duplicate-done)
// puts it UNDER the source, left edges aligned; the inspector's Add a width and ⌘K's `run-action` (08 ak-web-widths: "side by
// side") keep the row. Wiring pins — the maths is in v2-artboard-menu.test.tsx (copyPlacesBelow).
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const E = join(import.meta.dir, '../editing');
const actions = readFileSync(join(E, 'artboard-actions.ts'), 'utf8');
const commands = readFileSync(join(E, 'artboard-commands.tsx'), 'utf8');

describe('who asks decides where the copy lands', () => {
  test("the menu's rows ask for 'below'", () => {
    expect(actions).toMatch(
      /duplicateAtWidth: \(t, width\) => void duplicateAtWidth\(idsFor\(t\.artboardId\), width, 'below'\)/
    );
    expect(commands).toContain("duplicateAtWidth(field.ids, w, 'below')");
  });
  test('a run-action width (the inspector, ⌘K) passes no place: it stays beside', () => {
    expect(commands).toContain('void a.duplicateAtWidth(ids, p.width);');
  });
  test("'below' is the only place that uses copyPlacesBelow", () => {
    const body = actions.slice(actions.indexOf('const duplicateAtWidth:'));
    const below = body.slice(0, body.indexOf('const duplicateAtWidths'));
    expect(below).toContain("place === 'below'");
    expect(below).toContain('copyPlacesBelow(');
    expect(below).toContain('duplicatePlaces(list, boards(), width)');
  });
});
