// S2.2 — the Inspector frame's pure parts: the ten sections, the kind chip registry, the append-only slot
// registry later slices fill (S2.3–S2.5, S8), and the model (title, crumbs, tokens it uses, Copy CSS, the id rule).
// The frame itself is rendered in v2-inspector-render.test.tsx.
import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AGENT_PATHS } from '../actions/agents.ts';
import { ACTIONS_BY_ID } from '../actions/index.ts';
import { renameElementId } from '../client/v2/inspector/element-id.js';
import { INSPECTOR_ACTION_IDS } from '../client/v2/inspector/inspector-actions.js';
import {
  ARTBOARD_KIND_CHIPS,
  KIND_FALLBACK,
  kindChipOf,
  registerKind,
  resolveKind,
} from '../client/v2/inspector/kinds/index.js';
import {
  COMPUTED_ID_RE,
  crumbsOf,
  cssTextOf,
  ELEMENT_ID_MAX,
  ELEMENT_ID_RE,
  hasUsableId,
  propertyCount,
  titleOf,
  tokensUsed,
  validateElementId,
} from '../client/v2/inspector/model.js';
import { SECTION_IDS, SECTIONS, sectionById } from '../client/v2/inspector/sections.js';
import { hasAnySlot, registerSlot, slotsFor } from '../client/v2/inspector/slots.js';
import { createMenuHandlers } from '../client/v2/shell/menu-runner.js';
import {
  COMPUTED_ID_RE as SERVER_COMPUTED,
  ELEMENT_ID_MAX as SERVER_MAX,
  ELEMENT_ID_RE as SERVER_RE,
} from '../element-ids.ts';

const STUDIO = join(import.meta.dir, '..');
const read = (rel: string) => readFileSync(join(STUDIO, rel), 'utf8');

describe('the sections (14 Editing, ed-inspector)', () => {
  test('in the drawn order, numbered 1 to 10; Combine shapes (11, S2.14) and a picture’s Image and Adjust (12, 13; S2.15) are numbered after the ten drawn ones', () => {
    expect(SECTIONS.map((s) => [s.n, s.id, s.title])).toEqual([
      [12, 'image', 'Image'],
      [13, 'adjust', 'Adjust'],
      [1, 'position', 'Position'],
      [2, 'size', 'Size'],
      [3, 'layout', 'Layout'],
      [4, 'fill', 'Fill'],
      [5, 'corners', 'Corners'],
      [6, 'border', 'Border'],
      [7, 'effects', 'Effects'],
      [8, 'type', 'Type'],
      [11, 'combine', 'Combine shapes'], // S2.14
      [9, 'interaction', 'Interaction'],
      [10, 'export', 'Export'],
    ]);
    expect(SECTION_IDS).toHaveLength(13);
  });

  test('every section carries its one-line explainer, in CONTRACT words (no "island", no "screen")', () => {
    for (const s of SECTIONS) {
      expect(s.explain.length).toBeGreaterThan(20);
      expect(s.explain).not.toMatch(/\b(island|screen|container)\b/i);
    }
    expect(sectionById('border')?.explain).toContain('Empty until you add one');
  });

  test('"+" adders sit on Fill, Border, Effects, Interaction and Export; Corners offers unlink, Type says "text inside"', () => {
    const adders = SECTIONS.filter((s) => s.adder).map((s) => s.id);
    expect(adders).toEqual(['fill', 'border', 'effects', 'interaction', 'export']);
    expect(sectionById('type')?.aside).toBe('text inside');
    expect(sectionById('corners')?.aside).toBe('unlink');
  });
});

describe('the kind chip', () => {
  test('an artboard shows its artboard kind (C16): Web page · Fixed size · Print · Video', () => {
    expect(ARTBOARD_KIND_CHIPS).toEqual({
      web: 'Web page',
      digital: 'Fixed size',
      print: 'Print',
      video: 'Video',
    });
    const art = (kind?: string) => ({
      selector: '[data-dc-screen="desktop"]',
      attrs: kind ? { 'data-dc-kind': kind } : {},
    });
    expect(kindChipOf(art('web'))).toBe('Web page');
    expect(kindChipOf(art('print'))).toBe('Print');
    expect(kindChipOf(art('video'))).toBe('Video');
    // no resolved kind = DCArtboard's implicit default
    expect(kindChipOf(art())).toBe('Fixed size');
    expect(resolveKind(art('web')).id).toBe('artboard');
  });

  test('objects: Button · Text · Image · Frame (the fallback); several objects are Mixed', () => {
    expect(kindChipOf({ id: 'a', tag: 'button' })).toBe('Button');
    expect(kindChipOf({ id: 'a', tag: 'div', attrs: { role: 'button' } })).toBe('Button');
    expect(kindChipOf({ id: 'a', tag: 'h1', text: 'Headline' })).toBe('Text');
    expect(kindChipOf({ id: 'a', tag: 'img' })).toBe('Image');
    expect(kindChipOf({ id: 'a', tag: 'div', photoAsset: 'assets/0123abcd.png' })).toBe('Image');
    expect(kindChipOf({ id: 'a', tag: 'div' })).toBe('Frame');
    expect(KIND_FALLBACK).toBe('frame');
    expect(kindChipOf([{ id: 'a' }, { id: 'b' }, { id: 'c' }])).toBe('Mixed');
    expect(resolveKind([{ id: 'a' }, { id: 'b' }]).id).toBe('multi');
    // a one-element array is that element
    expect(resolveKind([{ id: 'a', tag: 'button' }]).id).toBe('button');
  });

  test('append-only: a later slice registers its kind; a duplicate id is refused; unregistering restores', () => {
    const off = registerKind({
      id: 'shape-test',
      label: 'Shape',
      order: 5,
      match: (s: { tag?: string }) => s.tag === 'rect',
    });
    expect(kindChipOf({ id: 'a', tag: 'rect' })).toBe('Shape');
    expect(() => registerKind({ id: 'shape-test', label: 'x', match: () => true })).toThrow(
      /already registered/
    );
    off();
    expect(kindChipOf({ id: 'a', tag: 'rect' })).toBe('Frame');
  });
});

describe('the slot registry (S2.3–S2.5 and S8 fill sections without touching each other)', () => {
  const offs: Array<() => void> = [];
  afterEach(() => {
    for (const off of offs.splice(0)) off();
  });
  const Body = () => null;

  test('empty until a slice registers a body', () => {
    expect(hasAnySlot()).toBe(false);
    expect(slotsFor('size', 'frame')).toEqual([]);
  });

  test('entries come back in `order`, filtered by kind; unknown sections and duplicate ids are refused', () => {
    offs.push(registerSlot('size', { id: 'size.b', order: 20, Body }));
    offs.push(registerSlot('size', { id: 'size.a', order: 10, kinds: ['frame', 'text'], Body }));
    expect(slotsFor('size', 'frame').map((e) => e.id)).toEqual(['size.a', 'size.b']);
    expect(slotsFor('size', 'image').map((e) => e.id)).toEqual(['size.b']);
    expect(hasAnySlot()).toBe(true);
    expect(() => registerSlot('size', { id: 'size.a', Body })).toThrow(/already registered/);
    expect(() => registerSlot('nonsense', { id: 'x', Body })).toThrow(/unknown section/);
    expect(() => registerSlot('size', { id: 'size.nobody' } as never)).toThrow(/Body/);
  });

  test('unregistering removes only that entry', () => {
    const off = registerSlot('fill', { id: 'fill.one', Body });
    offs.push(registerSlot('fill', { id: 'fill.two', Body }));
    off();
    expect(slotsFor('fill', 'frame').map((e) => e.id)).toEqual(['fill.two']);
  });
});

describe('the model', () => {
  const TREE = {
    artboardId: 'desktop',
    nodes: [
      {
        id: 'nav',
        index: 0,
        label: 'Nav',
        children: [
          { id: 'book-call', index: 0, label: 'Book a call', children: [] },
          { id: 'book-call', index: 1, label: 'Book a call (2)', children: [] },
        ],
      },
    ],
  };

  test('title: the layer name, else the element text, else its tag', () => {
    expect(titleOf({ id: 'book-call', index: 0 }, TREE)).toBe('Book a call');
    expect(titleOf({ id: 'x', text: '  See   pricing  ', tag: 'a' }, null)).toBe('See pricing');
    expect(titleOf({ id: 'x', tag: 'section' }, null)).toBe('section');
    expect(titleOf([{ id: 'a' }, { id: 'b' }, { id: 'c' }], null)).toBe('3 objects');
    expect(titleOf({ selector: '[data-dc-screen="desktop"]', artboardId: 'desktop' }, null)).toBe(
      'desktop'
    );
  });

  test('crumbs: artboard, then the ancestors, then the element (the same instance by occurrence)', () => {
    expect(crumbsOf(TREE, { id: 'book-call', index: 1 })).toEqual([
      'desktop',
      'Nav',
      'Book a call (2)',
    ]);
    expect(crumbsOf(TREE, { id: 'nav', index: 0 })).toEqual(['desktop', 'Nav']);
    // not in the tree (a tree that has not arrived yet): no crumbs, never invented ones
    expect(crumbsOf(TREE, { id: 'zzz', index: 0 })).toEqual([]);
    expect(crumbsOf(null, { id: 'nav', index: 0 })).toEqual([]);
  });

  test('tokens it uses: every var(--name) in authored + custom values, once, in first-seen order', () => {
    const el = {
      authored: {
        gap: 'var(--space-8)',
        padding: '10px var(--space-24)',
        background: 'var(--ink)',
        'box-shadow': 'var(--shadow-resting)',
      },
      customStyles: { '--local': 'var(--space-8)', color: 'var(--page, white)' },
    };
    expect(tokensUsed(el)).toEqual([
      { name: '--space-8', label: 'Space 8' },
      { name: '--space-24', label: 'Space 24' },
      { name: '--ink', label: 'Ink' },
      { name: '--shadow-resting', label: 'Shadow resting' },
      { name: '--page', label: 'Page' },
    ]);
    expect(tokensUsed({})).toEqual([]);
  });

  test('Copy CSS: authored, then custom properties, as declarations; no canvas-only attributes', () => {
    const el = {
      authored: { display: 'inline-flex', gap: 'var(--space-8)' },
      customStyles: { '--tilt': '2deg' },
      attrs: { 'data-cd-id': 'book-call', 'data-cd-locked': '' },
    };
    expect(cssTextOf(el)).toBe('display: inline-flex;\ngap: var(--space-8);\n--tilt: 2deg;');
    expect(cssTextOf({})).toBe('');
    expect(propertyCount(el)).toBe(3);
    expect(propertyCount({})).toBe(0);
  });

  test('the element id rule (V2-1.4): kebab, at most 48, not taken; the same id is no change', () => {
    const taken = new Set(['hero', 'nav']);
    expect(validateElementId('book-call', 'cta', taken)).toEqual({ ok: true, id: 'book-call' });
    expect(validateElementId('  book-call ', 'cta', taken)).toEqual({ ok: true, id: 'book-call' });
    expect(validateElementId('cta', 'cta', taken)).toEqual({ ok: false, code: 'same' });
    expect(validateElementId('Book Call', 'cta', taken)).toMatchObject({
      ok: false,
      code: 'invalid',
    });
    expect(validateElementId('', 'cta', taken)).toMatchObject({ ok: false, code: 'invalid' });
    expect(validateElementId('a'.repeat(49), 'cta', taken)).toMatchObject({
      ok: false,
      code: 'invalid',
    });
    expect(validateElementId('hero', 'cta', taken)).toMatchObject({ ok: false, code: 'taken' });
    // words for the person, in CONTRACT voice (no "!"), one fact each
    for (const bad of ['Book Call', 'hero', '']) {
      const r = validateElementId(bad, 'cta', taken) as { message?: string };
      expect(r.message).toBeTruthy();
      expect(r.message).not.toContain('!');
    }
  });

  test('a computed id (8 hex) is transient: it is shown, but it is not a name yet', () => {
    expect(hasUsableId({ id: 'book-call' })).toBe(true);
    expect(hasUsableId({ id: '0a1b2c3d' })).toBe(false);
    expect(hasUsableId({})).toBe(false);
  });
});

describe('the id rule mirrors the server (the shell cannot import element-ids.ts)', () => {
  test('same pattern, same limit, same computed shape', () => {
    expect(ELEMENT_ID_RE.source).toBe(SERVER_RE.source);
    expect(ELEMENT_ID_MAX).toBe(SERVER_MAX);
    expect(COMPUTED_ID_RE.source).toBe(SERVER_COMPUTED.source);
  });
});

describe('renameElementId asks the dispatch route (S2.1) and says the answer in words', () => {
  const REQ = {
    from: 'cta',
    to: 'book-call',
    index: 0,
    artboardId: 'desktop',
    canvas: '.design/ui/Home.tsx',
  };
  const reply = (status: number, body: unknown) => async () =>
    new Response(JSON.stringify(body), { status });

  test('one POST: the file, the op id, the target by artboard + element, the new id', async () => {
    let seen: { url?: string; body?: Record<string, unknown> } = {};
    const r = await renameElementId(REQ, (async (url: string, init: { body: string }) => {
      seen = { url, body: JSON.parse(init.body) };
      return new Response(JSON.stringify({ ok: true, writeId: 'w1', actionId: null }));
    }) as never);
    // S2.2b: the write id comes back, so the inspector can record the one-step undo
    expect(r).toEqual({ ok: true, writeId: 'w1', actionId: null });
    expect(seen.url).toBe('/_api/edit-op');
    expect(seen.body).toEqual({
      file: '.design/ui/Home.tsx',
      op: 'element.set-id',
      targets: [{ artboard: 'desktop', element: 'cta' }],
      params: { id: 'book-call' },
    });
    // a later occurrence of a reused component is addressed by occurrence (V2-1.4 §7)
    await renameElementId({ ...REQ, index: 2 }, (async (_u: string, init: { body: string }) => {
      seen.body = JSON.parse(init.body);
      return new Response('{"ok":true}');
    }) as never);
    expect(((seen.body?.targets ?? []) as unknown[])[0]).toEqual({
      artboard: 'desktop',
      element: 'cta',
      occurrence: 2,
    });
  });

  test('refusals read as plain sentences; no route yet is "not available"; an outage is retryable', async () => {
    const held = await renameElementId(
      REQ,
      reply(409, { ok: false, code: 'held-by-ai', message: 'x' }) as never
    );
    expect(held).toMatchObject({ ok: false });
    expect((held as { message: string }).message).toContain('belongs to AI');
    const locked = await renameElementId(
      REQ,
      reply(409, { ok: false, code: 'locked', message: 'x' }) as never
    );
    expect((locked as { message: string }).message).toContain('locked');
    const none = await renameElementId(REQ, reply(404, {}) as never);
    expect((none as { message: string }).message).toContain('not available in this version yet');
    const down = await renameElementId(REQ, (async () => {
      throw new Error('offline');
    }) as never);
    expect((down as { message: string }).message).toContain('try again');
    for (const r of [held, locked, none, down])
      expect((r as { message: string }).message).not.toContain('!');
  });

  test('S2.2b: `invalid` says the server’s own reason (taken, grammar, references)', async () => {
    const taken = await renameElementId(
      REQ,
      reply(400, {
        ok: false,
        code: 'invalid',
        message: 'Not renamed: another object on this canvas already has that id.',
      }) as never
    );
    expect((taken as { message: string }).message).toBe(
      'Not renamed: another object on this canvas already has that id.'
    );
    const bare = await renameElementId(REQ, reply(400, { ok: false, code: 'invalid' }) as never);
    expect((bare as { message: string }).message).toContain('does not fit');
  });
});

describe('the registry carries the inspector actions (rule 14: each with its AI path)', () => {
  test('registered as shell commands, greyed without an object, each with an agent path', () => {
    expect([...INSPECTOR_ACTION_IDS]).toEqual([
      'inspector.copy-css',
      'element.copy-id',
      'element.set-id',
      'element.clear-link', // S3.10a
      // S11.8
      'inspector.copy-code',
      'inspector.edit-css-as-text',
      'element.detach',
      'component.go-to-main', // S2.17
      'inspect.copy-code', // S3.11
    ]);
    for (const id of INSPECTOR_ACTION_IDS) {
      const def = ACTIONS_BY_ID.get(id);
      expect(def, id).toBeTruthy();
      expect(def?.exec).toBe('shell');
      expect(def?.enabled?.selection).toEqual(['object']);
      expect(AGENT_PATHS[id], id).toBeTruthy();
    }
    expect(ACTIONS_BY_ID.get('element.set-id')?.enabled?.minRole).toBe('edit');
    // S11.8: the code is a download (Can comment and up); the other two write the file
    expect(ACTIONS_BY_ID.get('inspector.copy-code')?.enabled?.minRole).toBe('comment');
    expect(ACTIONS_BY_ID.get('inspector.edit-css-as-text')?.enabled?.minRole).toBe('edit');
    expect(ACTIONS_BY_ID.get('element.detach')?.enabled?.minRole).toBe('edit');
    // S3.11: the Inspect panel's Copy code is the same download, so the same floor
    expect(ACTIONS_BY_ID.get('inspect.copy-code')?.enabled?.minRole).toBe('comment');
    expect(ACTIONS_BY_ID.get('inspector.copy-css')?.label).toBe('Copy CSS');
    // writing an id is a project write; an agent does not rename ids (A5 lead: the references
    // live in _comments/ + the board, which agents never write) — the copies write nothing
    expect(AGENT_PATHS['element.set-id'].effect).toBe('project');
    expect(AGENT_PATHS['element.set-id'].agent).toMatchObject({ path: 'human', because: 'keys' });
    expect(AGENT_PATHS['inspector.copy-css'].effect).toBe('none');
  });

  test('the menu runner has a handler for each, and shows the line they answer', async () => {
    const toasts: string[] = [];
    const handlers = createMenuHandlers({ toast: (m: string) => toasts.push(m) } as never);
    for (const id of INSPECTOR_ACTION_IDS) expect(typeof handlers[id], id).toBe('function');
    await handlers['inspector.copy-css']();
    await new Promise((r) => setTimeout(r, 0));
    expect(toasts).toEqual(['Select an object first.']);
  });
});

describe('the frame stays on the rails (CONTRACT: tokens only, weights stop at 600)', () => {
  const css = read('client/v2/inspector/inspector.css');
  test('inspector.css has no hex colour and no weight above 600', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/font-weight:\s*(7|8|9)00/);
    expect(css).not.toMatch(/font-weight:\s*bold/);
  });
  test('it is imported by the styles index', () => {
    expect(read('client/styles/_index.css')).toContain('../v2/inspector/inspector.css');
  });
});

describe('the new testids are registered (an API)', () => {
  const ids: string[] = JSON.parse(read('client/testids.json')).map(
    (e: { hook: string }) => e.hook
  );
  const md = read('client/TESTIDS.md');
  for (const hook of [
    'inspector-frame',
    'inspector-kind',
    'inspector-title',
    'inspector-crumbs',
    'inspector-uses',
    'insp-sec-<id>',
    'insp-add-<id>',
    'inspector-element-id',
    'inspector-id-error',
    'inspector-copy-id',
    'inspector-copy-css',
    'inspector-tokens-used',
    'inspector-facts',
  ]) {
    test(`${hook} is in testids.json and TESTIDS.md`, () => {
      expect(ids).toContain(hook);
      expect(md).toContain(`\`${hook}\``);
    });
  }
});
