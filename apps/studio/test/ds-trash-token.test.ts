// S10.2 (V2-1.6 §5.11 e, §5.3 `trashed`): a token moved to the trash is a publish with every
// follower ticked — tokens.json keeps a tombstone, the CSS keeps `--name: var(--replacement)` so
// canvases follow the replacement with no source edits. Restore puts `previous` back; Clear out
// drops the tombstone but keeps the alias line. Tier-1 roles can't be trashed.
import { afterAll, describe, expect, test } from 'bun:test';

import { resolveColour } from '../ds/contrast.ts';
import { DsEngineError } from '../ds/engine.ts';
import { cleanup, DS, DS_PATH, makeProject, PERSON } from './_ds-engine-fixture.ts';

afterAll(cleanup);

const CSS = `${DS_PATH}/colors_and_type.css`;
const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (err) {
    return err instanceof DsEngineError ? err.code : String(err);
  }
};
const leaf = (tokensJson: string | null) =>
  JSON.parse(tokensJson ?? '{}').x['line-fine'].$extensions['sh.maude'] as Record<string, unknown>;

describe('ds trash token', () => {
  test('trash → tombstone + alias line, every follower ticked; listed for the Trash', async () => {
    const p = await makeProject();
    await p.engine.canvasLeave('ui/Landing.tsx', { by: PERSON });
    const r = await p.engine.trashToken(DS, {
      css: '--x-line-fine',
      replacement: '--x-line-mid',
      expectHead: p.R0,
      by: { kind: 'person', name: 'Tereza' },
    });
    expect(r.action).toBe('publish');
    const css = p.read(CSS) as string;
    expect(css.match(/--x-line-fine: var\(--x-line-mid\);/g)?.length).toBe(2);
    expect(css).toContain('--x-line-mid: #bbbbbb;');
    const t = leaf(p.read(`${DS_PATH}/tokens.json`));
    expect(t.trashed).toMatchObject({
      replacement: '--x-line-mid',
      by: { kind: 'person', name: 'Tereza' },
      previous: { light: '#dddddd', dark: '#333333' },
    });
    const st = p.engine.state(DS);
    expect(st.trashed).toEqual([
      expect.objectContaining({
        kind: 'token',
        system: DS,
        css: '--x-line-fine',
        replacement: '--x-line-mid',
      }),
    ]);
    expect(p.head().head).toBe(r.rev);
    // the follower ticks are the defaults: a canvas the person had left out stays out
    expect(p.meta('ui/Home.tsx').dsRev).toBeUndefined();
    expect(p.meta('ui/Landing.tsx').dsRev).toBe(p.R0);
  });

  test('restore puts the previous values back; clear out keeps the alias line', async () => {
    const p = await makeProject();
    const t1 = await p.engine.trashToken(DS, {
      css: '--x-line-fine',
      replacement: '--x-line-mid',
      expectHead: p.R0,
      by: PERSON,
    });
    const r = await p.engine.restoreToken(DS, {
      css: '--x-line-fine',
      expectHead: t1.rev,
      by: PERSON,
    });
    expect(p.read(CSS)).toContain('--x-line-fine: #dddddd;');
    expect(p.read(CSS)).toContain('--x-line-fine: #333333;');
    expect(leaf(p.read(`${DS_PATH}/tokens.json`)).trashed).toBeUndefined();
    expect(p.engine.state(DS).trashed).toEqual([]);
    const t2 = await p.engine.trashToken(DS, {
      css: '--x-line-fine',
      replacement: '--x-line-mid',
      expectHead: r.rev,
      by: PERSON,
    });
    await p.engine.clearToken(DS, { css: '--x-line-fine', expectHead: t2.rev, by: PERSON });
    expect(leaf(p.read(`${DS_PATH}/tokens.json`)).trashed).toBeUndefined();
    expect(p.read(CSS)?.match(/--x-line-fine: var\(--x-line-mid\);/g)?.length).toBe(2);
    expect(p.engine.state(DS).trashed).toEqual([]);
  });

  test('refusals: a Tier-1 role, an unknown token, a bad replacement, restore of a live token', async () => {
    const p = await makeProject();
    const t = (css: string, replacement: string) =>
      code(p.engine.trashToken(DS, { css, replacement, expectHead: p.R0, by: PERSON }));
    expect(await t('--accent', '--x-line-mid')).toBe('ds-trash-tier1');
    expect(await t('--x-nope', '--x-line-mid')).toBe('ds-unknown-token');
    expect(await t('--x-line-fine', '--x-line-fine')).toBe('ds-pending-invalid');
    expect(await t('--x-line-fine', '--x-nope')).toBe('ds-pending-invalid');
    expect(
      await code(p.engine.restoreToken(DS, { css: '--x-line-fine', expectHead: p.R0, by: PERSON }))
    ).toBe('ds-not-trashed');
    expect(p.head().head).toBe(p.R0);
  });

  test('⌘Z after the trash takes it back on both planes', async () => {
    const p = await makeProject();
    const { registerDsUndoHook } = await import('../ds/undo-hook.ts');
    const off = registerDsUndoHook(p.engine);
    try {
      await p.engine.canvasLeave('ui/Pricing.tsx', { by: PERSON });
      const r = await p.engine.trashToken(DS, {
        css: '--x-line-fine',
        replacement: '--x-line-mid',
        expectHead: p.R0,
        by: PERSON,
      });
      const u = await p.undo({ actionId: r.actionId });
      expect(u.status).toBe(200);
      expect(p.head().head).toBe(p.R0);
      expect(p.read(CSS)).toContain('--x-line-fine: #dddddd;');
      expect(p.meta('ui/Pricing.tsx').dsRev).toBe(p.R0);
    } finally {
      off();
    }
  });

  // S10.17 (13 · ds-edge-trash, canvas 27): nothing breaks — a canvas that reads the trashed name, in either mode,
  // still resolves to a colour: the replacement's. Restore puts the token's own values back everywhere.
  test('no canvas breaks: the trashed name resolves to the replacement in both modes; Restore brings its own back', async () => {
    const p = await makeProject();
    const declared = (css: string, block: 'light' | 'dark') => {
      const dark = css.split('[data-theme="dark"]');
      const part = block === 'dark' ? (dark.at(-1) ?? '') : (dark[0] ?? '');
      const map: Record<string, string> = {};
      for (const m of part.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) map[m[1]] = m[2].trim();
      return map;
    };
    const colourOf = (css: string, block: 'light' | 'dark', name: string) => {
      const map = declared(css, block);
      const rgb = resolveColour(`var(${name})`, (n) => map[n]);
      return rgb ? `${rgb.r},${rgb.g},${rgb.b}` : null;
    };
    const before = p.read(CSS) as string;
    const t = await p.engine.trashToken(DS, {
      css: '--x-line-fine',
      replacement: '--x-line-mid',
      expectHead: p.R0,
      by: PERSON,
    });
    const trashed = p.read(CSS) as string;
    for (const mode of ['light', 'dark'] as const) {
      const gone = colourOf(trashed, mode, '--x-line-fine');
      expect(gone).not.toBeNull();
      expect(gone).toBe(colourOf(trashed, mode, '--x-line-mid'));
      expect(gone).not.toBe(colourOf(before, mode, '--x-line-fine'));
    }
    await p.engine.restoreToken(DS, { css: '--x-line-fine', expectHead: t.rev, by: PERSON });
    const restored = p.read(CSS) as string;
    for (const mode of ['light', 'dark'] as const)
      expect(colourOf(restored, mode, '--x-line-fine')).toBe(
        colourOf(before, mode, '--x-line-fine')
      );
  });
});
