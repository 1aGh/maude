// Phase 8 C1-kit — every glyph a shell surface names exists. `StIcon` renders an EMPTY <svg> for an
// unknown name, so a missing glyph is silent: the Assets panel's group "›", the "‹ Assets" back on
// Browse and Details, and the Used-in "›" all drew nothing (12 critic R2 — `chevron` was never in
// STICONS). This walks every literal `<StIcon name="…">` under client/ and asserts STICONS has it.
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { STICONS } from '../client/shell/icons.jsx';

const CLIENT = join(import.meta.dir, '..', 'client');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(jsx|tsx|js|ts)$/.test(name)) out.push(p);
  }
  return out;
}

describe('StIcon vocabulary', () => {
  test('every literal StIcon name has a glyph', () => {
    const missing: string[] = [];
    for (const file of walk(CLIENT)) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(
        /<StIcon\b[^>]*?\bname=(?:"([a-z0-9-]+)"|'([a-z0-9-]+)'|\{\s*'([a-z0-9-]+)'\s*\})/g
      )) {
        const name = m[1] ?? m[2] ?? m[3];
        if (!(name in STICONS)) missing.push(`${file.slice(CLIENT.length + 1)}: ${name}`);
      }
    }
    expect(missing).toEqual([]);
  });

  test('the kit glyphs the boards draw are present (chevron, submenu, pin, duplicate, more, history)', () => {
    for (const n of [
      'chevron',
      'submenu',
      'pin',
      'duplicate',
      'more',
      'history',
      'home',
      'trash',
    ]) {
      expect(STICONS).toHaveProperty(n);
    }
  });
});
