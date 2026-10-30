// S10.16a — making a design system (contract S10-slices §3 · V2-1.6 §5.7 `drafts[]` · S10 Q7/Q8).
// A fixture agent script that does only what the verbs let an AI do: make the system, write three
// directions, use one, mix another's type + a third's colour, fill the rest through the working
// files, and finish. Never this repo's `.design`; the kernel is a real local home.
import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { canvasUrl } from '../client/canvas-url.js';
import { DsEngineError } from '../ds/engine.ts';
import { emitTokensJson, parseSystem } from '../ds/generate.ts';
import { readHead } from '../ds/head.ts';
import { createDsMake, deriveSectionStates, MIX_WORDS } from '../ds/make.ts';
import { indexRegistry, loadRegistry } from '../ds/registry.ts';
import { dsRenderIndex } from '../ds/render-rev.ts';
import { verifyRevision } from '../ds/revision.ts';
import { cleanup, makeProject, PERSON, type Project } from './_ds-engine-fixture.ts';
import { conformantFiles, fixtureConfig } from './_ds-fixture.ts';

afterAll(cleanup);

const NEW = 'forge';
const AI = { kind: 'ai', name: 'Claude' } as const;
const idx = indexRegistry(loadRegistry());

// a complete direction's tokens, every value tagged by direction `k` so a mix is traceable
const cfg = fixtureConfig({ name: NEW, path: `system/${NEW}`, rootClass: NEW });
const seed = conformantFiles({ ...cfg, tokensCssRel: `system/${NEW}/colors_and_type.css` });
const seedModel = parseSystem({
  config: { name: NEW, rootClass: NEW, themes: ['light', 'dark'], defaultTheme: 'light' },
  tokensCss: seed[`system/${NEW}/colors_and_type.css`],
});

function tweak(type: string, value: string, k: number, letter: string): string {
  switch (type) {
    case 'color':
      return value.replace(
        /(oklch\([^ ]+ [^ ]+ )(\d+)\)/,
        (_, a, h) => `${a}${Number(h) + k * 40})`
      );
    case 'length':
    case 'length-or-none':
      return value === '0' ? value : `${4 + k}px`;
    case 'duration':
      return `${120 + k}ms`;
    case 'easing':
      return `cubic-bezier(0.${2 + k}, 0, 0, 1)`;
    case 'number':
      return String(500 + k);
    case 'line-height':
      return `1.${4 + k}`;
    case 'font-family':
      return `"Font ${letter}", system-ui, sans-serif`;
    case 'shadow':
      return `0 ${1 + k}px 2px oklch(0 0 0 / 0.1)`;
    default:
      return value;
  }
}
const LETTERS = ['a', 'b', 'c'];
function direction(letter: string): Record<string, { light: string; dark: string }> {
  const k = LETTERS.indexOf(letter) + 1;
  const out: Record<string, { light: string; dark: string }> = {};
  for (const r of idx.reg.roles) {
    const tok = seedModel.tokens[r.name];
    if (!tok) continue;
    out[r.name] = {
      light: tweak(r.type, tok.values.light, k, letter),
      dark: tweak(r.type, tok.values.dark ?? tok.values.light, k, letter),
    };
  }
  return out;
}

const rejects = async (p: Promise<unknown>, code: string) => {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(DsEngineError);
    expect((e as DsEngineError).code).toBe(code as never);
    return;
  }
  throw new Error(`expected ${code}`);
};

async function fresh() {
  const p = await makeProject();
  const mk = createDsMake(p.engine);
  return { p, mk };
}
const abs = (p: Project, rel: string) => path.join(p.dsAbs, '..', NEW, rel);
const cssOf = (p: Project) => p.read(`system/${NEW}/colors_and_type.css`) as string;

/** what the agent does through the working files (Q13): components, logo, icons */
function fill(p: Project) {
  for (const k of [
    'components.json',
    'preview/_components.css',
    'preview/logo.tsx',
    'assets/logos/mark.svg',
  ]) {
    const rel = `system/${NEW}/${k}`;
    const abs2 = path.join(p.designRoot, rel);
    mkdirSync(path.dirname(abs2), { recursive: true });
    writeFileSync(abs2, seed[rel] as string);
  }
}

describe('make — a system with nothing in it yet', () => {
  test('a config entry, the folder, the canvas with its seven outlines, head.json {head: null}', async () => {
    const { p, mk } = await fresh();
    const r = await mk.make({ ds: NEW, label: 'Forge', by: AI });
    expect(r.action).toBe('make');
    expect(r.actionId).toBeNull(); // a new canvas is a file, not a kernel edit
    const cfgJson = JSON.parse(p.read('config.json') as string);
    expect(cfgJson.designSystems.find((s: { name: string }) => s.name === NEW)).toMatchObject({
      path: `system/${NEW}`,
      label: 'Forge',
      themes: ['light', 'dark'],
      rootClass: NEW,
    });
    // the existing system and the default are untouched until `done`
    expect(cfgJson.defaultDesignSystem).toBe('acme');
    expect(p.read(`system/${NEW}/design-system.tsx`)).toContain('<DSSection kind="patterns" />');
    const meta = p.meta(`system/${NEW}/design-system.tsx`);
    expect(meta.designSystem).toBe(NEW);
    expect((meta.layout as { artboards: unknown[] }).artboards).toHaveLength(10); // 7 sections + the 3 ds-dir-* directions (S10.16b)
    const h = readHead(abs(p, ''));
    expect(h.state).toBe('ok');
    if (h.state === 'ok') {
      expect(h.doc.head).toBeNull();
      expect(h.doc.base).toBeNull();
      expect(h.doc.drafts).toEqual([]);
      expect(h.doc.log).toEqual([]);
    }
  });

  test('the made system is listed: a project that groups no system folder gets the Design system group (p8-c3-dsboard)', async () => {
    const { p, mk } = await fresh();
    const before = JSON.parse(p.read('config.json') as string);
    before.canvasGroups = [{ label: 'UI kit', path: 'ui' }];
    writeFileSync(path.join(p.designRoot, 'config.json'), JSON.stringify(before));
    await mk.make({ ds: NEW, label: 'Forge', by: AI });
    const after = JSON.parse(p.read('config.json') as string);
    expect(after.canvasGroups).toEqual([
      { label: 'Design system', path: 'system' },
      { label: 'UI kit', path: 'ui' },
    ]);
    // a project that already groups system/ is left alone
    const p2 = await fresh();
    const c2 = JSON.parse(p2.p.read('config.json') as string);
    c2.canvasGroups = [{ label: 'Systems', path: 'system' }];
    writeFileSync(path.join(p2.p.designRoot, 'config.json'), JSON.stringify(c2));
    await p2.mk.make({ ds: NEW, label: 'Forge', by: AI });
    expect(JSON.parse(p2.p.read('config.json') as string).canvasGroups).toEqual([
      { label: 'Systems', path: 'system' },
    ]);
  });

  test('refuses a name in use and a bad name, and a failed make leaves nothing behind', async () => {
    const { p, mk } = await fresh();
    await rejects(mk.make({ ds: 'acme', label: 'x', by: AI }), 'ds-exists');
    await rejects(mk.make({ ds: 'Not Ok', label: 'x', by: AI }), 'ds-make-invalid');
    await rejects(mk.make({ ds: NEW, label: 'x\u0007', by: AI }), 'ds-make-invalid');
    expect(existsSync(path.join(p.designRoot, 'system', NEW))).toBe(false);
    const before = p.read('config.json');
    await mk.make({ ds: NEW, label: 'Forge', by: AI });
    await rejects(mk.make({ ds: NEW, label: 'Forge', by: AI }), 'ds-exists');
    expect(p.read('config.json')).not.toBe(before);
    // a make that dies half-way (head.json already there) restores the config and the folder
    const q = await makeProject();
    const cfgBefore = q.read('config.json');
    mkdirSync(path.join(q.designRoot, 'system', NEW, 'revisions'), { recursive: true });
    writeFileSync(path.join(q.designRoot, 'system', NEW, 'revisions', 'head.json'), '{}');
    await rejects(createDsMake(q.engine).make({ ds: NEW, label: 'Forge', by: AI }), 'ds-exists');
    expect(q.read('config.json')).toBe(cfgBefore);
  });

  test('head null renders the working files and cannot be reviewed or published', async () => {
    const { p, mk } = await fresh();
    await mk.make({ ds: NEW, label: 'Forge', by: AI });
    const systems = p.engine.systems().map((s) => ({ name: s.name, path: s.path }));
    const index = dsRenderIndex(p.designRoot, systems, {});
    expect(index.dsConverted[NEW]).toBe(true);
    expect(index.systemHeads[NEW]).toBeNull();
    expect(index.dsRevGaps).toEqual({});
    const url = canvasUrl('.design/ui/Home.tsx', {
      designRel: '.design',
      designSystems: p.engine
        .systems()
        .map((s) => ({ name: s.name, path: s.path, tokensCssRel: s.tokensCssRel })),
      dsConverted: index.dsConverted,
      systemHeads: index.systemHeads,
      canvasDesignSystems: { '.design/ui/Home.tsx': NEW },
    });
    const q = new URLSearchParams(url.split('?')[1]);
    expect(q.get('tokens')).toBe(`system/${NEW}/colors_and_type.css`);
    await rejects(p.engine.publish(NEW, { expectHead: null, by: PERSON }), 'ds-making');
    const st = p.engine.state(NEW);
    expect(st.converted).toBe(true);
    expect(st.baseMissing).toBe(false);
    expect(st.head).toBeNull();
  });
});

describe('draft · use · mix', () => {
  test('three directions are three draft revisions on the same system', async () => {
    const { p, mk } = await fresh();
    await mk.make({ ds: NEW, label: 'Forge', by: AI });
    for (const l of LETTERS)
      await mk.draft({
        ds: NEW,
        direction: l,
        label: `Direction ${l}`,
        tokens: direction(l),
        by: AI,
      });
    const h = readHead(abs(p, ''));
    if (h.state !== 'ok') throw new Error('head');
    expect(h.doc.drafts.map((d) => d.direction)).toEqual(['a', 'b', 'c']);
    expect(h.doc.drafts[0]).toMatchObject({ label: 'Direction a', by: AI });
    expect(h.doc.head).toBeNull(); // a direction is not the system
    for (const d of h.doc.drafts) {
      const text = readFileSync(abs(p, `revisions/${d.rev}.json`), 'utf8');
      expect(verifyRevision(d.rev, text).ok).toBe(true);
      expect(existsSync(abs(p, `revisions/${d.rev}.tokens.css`))).toBe(true);
    }
    expect(new Set(h.doc.drafts.map((d) => d.rev)).size).toBe(3);
    // the same direction again replaces it (in place), and nothing is lost
    const again = await mk.draft({
      ds: NEW,
      direction: 'b',
      label: 'Warm paper',
      tokens: direction('c'),
      by: AI,
    });
    const h2 = readHead(abs(p, ''));
    if (h2.state !== 'ok') throw new Error('head');
    expect(h2.doc.drafts.map((d) => [d.direction, d.label])).toEqual([
      ['a', 'Direction a'],
      ['b', 'Warm paper'],
      ['c', 'Direction c'],
    ]);
    expect(h2.doc.drafts[1].rev).toBe(again.rev as string);
    // the working files are not touched by a draft
    expect(cssOf(p)).toContain('being made');
  });

  test('refuses what is not a direction: bad letter, missing theme, an unsafe value, no tokens', async () => {
    const { mk } = await fresh().then(
      async (x) => (await x.mk.make({ ds: NEW, label: 'F', by: AI }), x)
    );
    const ok = direction('a');
    await rejects(mk.draft({ ds: NEW, direction: 'A1', tokens: ok, by: AI }), 'ds-make-invalid');
    await rejects(mk.draft({ ds: NEW, direction: 'a', tokens: {}, by: AI }), 'ds-make-invalid');
    await rejects(
      mk.draft({ ds: NEW, direction: 'a', tokens: { '--accent': { light: '#fff' } }, by: AI }),
      'ds-make-invalid'
    );
    await rejects(
      mk.draft({ ds: NEW, direction: 'a', tokens: { '--accent': 'red; } body { x: y' }, by: AI }),
      'ds-make-invalid'
    );
    await rejects(
      mk.draft({ ds: NEW, direction: 'a', tokens: { accent: '#fff' }, by: AI }),
      'ds-make-invalid'
    );
    await rejects(
      mk.draft({ ds: 'nope', direction: 'a', tokens: ok, by: AI }),
      'ds-unknown-system'
    );
  });

  test('use materialises the direction into the working files byte for byte', async () => {
    const { p, mk } = await fresh();
    await mk.make({ ds: NEW, label: 'Forge', by: AI });
    for (const l of LETTERS)
      await mk.draft({ ds: NEW, direction: l, tokens: direction(l), by: AI });
    const h = readHead(abs(p, ''));
    if (h.state !== 'ok') throw new Error('head');
    const a = h.doc.drafts.find((d) => d.direction === 'a')!;
    const body = verifyRevision(a.rev, readFileSync(abs(p, `revisions/${a.rev}.json`), 'utf8'));
    if (!body.ok) throw new Error('rev');
    const r = await mk.use({ ds: NEW, direction: 'a', by: AI });
    expect(r.rev).toBe(a.rev);
    expect(cssOf(p)).toBe(body.body.files['colors_and_type.css'].text);
    expect(p.read(`system/${NEW}/tokens.json`)).toBe(body.body.files['tokens.json'].text);
    await rejects(mk.use({ ds: NEW, direction: 'z', by: AI }), 'ds-unknown-direction');
  });

  test('mix golden: B everywhere except colour from C and type from A — whole groups, nothing else', async () => {
    const { p, mk } = await fresh();
    await mk.make({ ds: NEW, label: 'Forge', by: AI });
    for (const l of LETTERS)
      await mk.draft({ ds: NEW, direction: l, tokens: direction(l), by: AI });
    await mk.mix({ ds: NEW, base: 'b', take: { colour: 'c', type: 'a' }, by: AI });
    const model = parseSystem({
      config: { name: NEW, rootClass: NEW, themes: ['light', 'dark'], defaultTheme: 'light' },
      tokensCss: cssOf(p),
    });
    const winner = (css: string): string => {
      const v = model.tokens[css]?.values.light;
      const hits = LETTERS.filter((l) => direction(l)[css]?.light === v);
      return hits.join('');
    };
    const bySource: Record<string, string[]> = {};
    for (const r of idx.reg.roles) {
      if (!model.tokens[r.name]) continue;
      const w = winner(r.name);
      const want = MIX_WORDS.colour.includes(r.group)
        ? 'c'
        : MIX_WORDS.type.includes(r.group)
          ? 'a'
          : 'b';
      // a token that is the same in every direction (a zero) can't tell — it must at least not be wrong
      expect(w === want || w.includes(want)).toBe(true);
      bySource[want] = [...(bySource[want] ?? []), r.group];
    }
    // the golden: which registry groups each side supplied
    const groups = (l: string) => [...new Set(bySource[l])].sort();
    expect(groups('c')).toEqual([
      'accent',
      'borders',
      'focus',
      'overlay',
      'presence',
      'selection',
      'status',
      'surfaces',
      'text',
    ]);
    expect(groups('a')).toEqual(['fonts', 'tracking', 'type', 'weight']);
    expect(groups('b')).toEqual(['elevation', 'layout', 'motion', 'radius', 'space']);
    expect(model.tokens['--accent'].values.light).toBe(direction('c')['--accent'].light);
    expect(model.tokens['--font-body'].values.light).toBe(direction('a')['--font-body'].light);
    expect(model.tokens['--radius-md'].values.light).toBe(direction('b')['--radius-md'].light);
    // a registry group by its own name; an unknown word; an unknown direction
    await mk.mix({ ds: NEW, base: 'b', take: { radius: 'a' }, by: AI });
    expect(
      parseSystem({
        config: { name: NEW, rootClass: NEW, themes: ['light', 'dark'], defaultTheme: 'light' },
        tokensCss: cssOf(p),
      }).tokens['--radius-md'].values.light
    ).toBe(direction('a')['--radius-md'].light);
    await rejects(mk.mix({ ds: NEW, base: 'b', take: { vibes: 'a' }, by: AI }), 'ds-unknown-group');
    await rejects(
      mk.mix({ ds: NEW, base: 'b', take: { colour: 'q' }, by: AI }),
      'ds-unknown-direction'
    );
    await rejects(mk.mix({ ds: NEW, base: 'b', take: {}, by: AI }), 'ds-make-invalid');
  });
});

describe('section states (Q7) — derived, never stored', () => {
  test('waiting → done by ds-check group; drawing while a run holds the artboard', async () => {
    const { p, mk } = await fresh();
    await mk.make({ ds: NEW, label: 'Forge', by: AI });
    const all = (s: string) => ({
      brand: s,
      colour: s,
      type: s,
      space: s,
      motion: s,
      components: s,
      patterns: s,
    });
    expect(mk.sections(NEW).sections).toEqual(all('waiting'));
    expect(mk.sections(NEW).making).toBe(true);

    // a direction without its colours: Type, Space and Motion pass, Colour does not
    const noColour = Object.fromEntries(
      Object.entries(direction('a')).filter(
        ([n]) => !MIX_WORDS.colour.includes(idx.roles.get(n)?.group ?? '')
      )
    );
    await mk.draft({ ds: NEW, direction: 'a', tokens: noColour, by: AI });
    await mk.use({ ds: NEW, direction: 'a', by: AI });
    expect(mk.sections(NEW).sections).toEqual({
      ...all('waiting'),
      type: 'done',
      space: 'done',
      motion: 'done',
    });

    // the colours land
    await mk.draft({ ds: NEW, direction: 'b', tokens: direction('b'), by: AI });
    await mk.use({ ds: NEW, direction: 'b', by: AI });
    expect(mk.sections(NEW).sections.colour).toBe('done');

    // a run holds Type: it is being drawn, whatever it passes
    const held = createDsMake(p.engine, { held: () => new Set(['ds-type']) });
    expect(held.sections(NEW).sections.type).toBe('drawing');
    expect(held.sections(NEW).sections.colour).toBe('done');

    // the rest through the working files → every section, patterns last
    expect(mk.sections(NEW).sections.patterns).toBe('waiting');
    fill(p);
    expect(mk.sections(NEW).sections).toEqual(all('done'));
  });

  test('the derivation is pure: held beats passing, patterns wait for the rest', () => {
    const report = {
      reasons: [],
      tier1: { missing: [], themeGaps: [], typeErrors: [], unresolvedRefs: [] },
      components: { manifest: 'ok', brand: { logo: true } },
    } as never;
    const s = deriveSectionStates(report, new Set(['ds-colour']), () => undefined);
    expect(s.colour).toBe('drawing');
    expect(s.patterns).toBe('done');
    const s2 = deriveSectionStates(
      {
        ...(report as object),
        tier1: { missing: ['--radius-md'], themeGaps: [], typeErrors: [], unresolvedRefs: [] },
      } as never,
      new Set(),
      (n) => idx.roles.get(n)?.group
    );
    expect(s2.space).toBe('waiting');
    expect(s2.patterns).toBe('waiting');
  });
});

describe('done — the system is made', () => {
  test('a level-0 system, one `make` log entry, the project default, nothing waiting', async () => {
    const { p, mk } = await fresh();
    await mk.make({ ds: NEW, label: 'Forge', by: AI });
    for (const l of LETTERS)
      await mk.draft({ ds: NEW, direction: l, tokens: direction(l), by: AI });
    await mk.mix({ ds: NEW, base: 'b', take: { colour: 'c', type: 'a' }, by: AI });
    fill(p);
    const r = await mk.done({ ds: NEW, by: AI });
    expect(r.reasons).toEqual([]);
    expect(r.level).toBe(0);
    expect(r.defaultSet).toBe(true);
    const h = readHead(abs(p, ''));
    if (h.state !== 'ok') throw new Error('head');
    expect(h.doc.head).toBe(r.rev as string);
    expect(h.doc.base).toBe(r.rev as string);
    expect(h.doc.log).toHaveLength(1);
    expect(h.doc.log[0]).toMatchObject({
      action: 'make',
      rev: r.rev,
      summary: 'Made Forge',
      by: AI,
    });
    expect(h.doc.drafts).toHaveLength(3); // the directions stay
    expect(JSON.parse(p.read('config.json') as string).defaultDesignSystem).toBe(NEW);
    // the tokens.json is the generator's, so the manifest is fresh
    const model = parseSystem({
      config: { name: NEW, rootClass: NEW, themes: ['light', 'dark'], defaultTheme: 'light' },
      tokensCss: cssOf(p),
      tokensJson: p.read(`system/${NEW}/tokens.json`),
    });
    expect(p.read(`system/${NEW}/tokens.json`)).toBe(emitTokensJson(model));
    // it is an ordinary converted system now: nothing outside, nothing waiting, nothing to publish
    const st = p.engine.state(NEW);
    expect(st.outside).toBeNull();
    expect(st.waiting).toEqual([]);
    await rejects(p.engine.publish(NEW, { expectHead: st.head, by: PERSON }), 'ds-nothing-waiting');
    expect(mk.sections(NEW).making).toBe(false);
    // …and no longer takes a direction
    await rejects(mk.use({ ds: NEW, direction: 'a', by: AI }), 'ds-not-making');
    await rejects(mk.done({ ds: NEW, by: AI }), 'ds-not-making');
    // a direction can still be drafted on a made system (restyle, S10.17); it changes nothing live
    await mk.draft({ ds: NEW, direction: 'd', tokens: direction('a'), by: AI });
    expect(p.engine.state(NEW).head).toBe(r.rev as string);
  });

  test('--no-default leaves the default; an unfinished system finishes and says what is missing', async () => {
    const { p, mk } = await fresh();
    await mk.make({ ds: NEW, label: 'Forge', by: AI });
    await rejects(mk.done({ ds: NEW, by: AI }), 'ds-nothing-made');
    await mk.draft({ ds: NEW, direction: 'a', tokens: direction('a'), by: AI });
    await mk.use({ ds: NEW, direction: 'a', by: AI });
    const r = await mk.done({ ds: NEW, by: AI, setDefault: false });
    expect(r.defaultSet).toBe(false);
    expect(JSON.parse(p.read('config.json') as string).defaultDesignSystem).toBe('acme');
    expect(r.level).not.toBe(0); // no components, no logo yet
    expect(r.reasons.length).toBeGreaterThan(0);
  });
});
