// F4 — a teammate's text-only edit reaches the open canvas as a text patch,
// ahead of the module re-import + remount that still confirms it.
//
// Three layers: the parser-free source diff (canvas-text-patch.ts), the
// broadcaster that attaches it to the `module` message using the last build's
// locator, and the shell's own applyTextPatches (lifted from the template
// between its markers) in a DOM.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

import { transpileCanvasSource } from '../canvas-pipeline.ts';
import { forgetCanvasBuilds, rememberCanvasBuild } from '../canvas-source-memo.ts';
import { textOnlyPatches } from '../canvas-text-patch.ts';
import { type Context, createBus } from '../context.ts';
import { createHmrBroadcaster, HMR_DEBOUNCE_MS, type HmrMessage } from '../hmr-broadcast.ts';

const FILE = '/p/.design/ui/Page.tsx';
const SOURCE = `export default function Page() {
  const note = "a > b";
  return (
    <main>
      <h1 title="Launch">Launch
        plan</h1>
      <p>{'Kept paragraph'}</p>
      <section>Hi <b>bold</b> there</section>
      <span>a &amp; b</span>
    </main>
  );
}
`;

const built = (source: string) => transpileCanvasSource(FILE, source);
/** The id the build stamps on the first `tag` element. */
function stampedId(source: string, tag: string): string {
  const m = new RegExp(`<${tag} data-cd-id="([0-9a-f]{8})"`).exec(built(source).withIds);
  if (!m?.[1]) throw new Error(`no stamped ${tag}`);
  return m[1];
}
const patch = (after: string, before = SOURCE) =>
  textOnlyPatches(before, after, built(before).locator);

describe('textOnlyPatches', () => {
  test('a JSX text edit yields the rendered string under the stamped id', () => {
    expect(patch(SOURCE.replace('>Launch\n', '>Launch day\n'))).toEqual([
      { id: stampedId(SOURCE, 'h1'), text: 'Launch day plan' },
    ]);
  });

  test('the id comes from the rendered build even after a non-ASCII prefix', () => {
    const before = SOURCE.replace('"a > b"', '"Ahoj světe — ✓"');
    const out = patch(before.replace('>Launch\n', '>Start\n'), before);
    // Either proven (and then exactly right) or declined — never a wrong id.
    if (out) expect(out).toEqual([{ id: stampedId(before, 'h1'), text: 'Start plan' }]);
  });

  test('identical sources need no patch', () => {
    expect(patch(SOURCE)).toEqual([]);
  });

  test.each([
    ['an attribute value', (s: string) => s.replace('title="Launch"', 'title="Kickoff"')],
    ['a string-literal child', (s: string) => s.replace("{'Kept paragraph'}", "{'Other'}")],
    ['an inserted element', (s: string) => s.replace('<main>', '<main>\n      <hr />')],
    ['text beside markup', (s: string) => s.replace(' there<', ' where<')],
    ['a JS string outside JSX', (s: string) => s.replace('"a > b"', '"a > c"')],
    ['text next to an entity', (s: string) => s.replace('a &amp; b', 'a &amp; c')],
    ['a new entity', (s: string) => s.replace('>Launch\n', '>Launch &amp;\n')],
    ['text that becomes markup', (s: string) => s.replace('>Launch\n', '><b>Launch</b>\n')],
    ['text emptied out', (s: string) => s.replace('>Launch\n        plan<', '><')],
    [
      'two separate regions',
      (s: string) => s.replace('>Launch\n', '>One\n').replace('bold', 'loud'),
    ],
  ])('%s is not a proven text-only change', (_, edit) => {
    expect(patch(edit(SOURCE))).toBeNull();
  });

  test('a locator that does not name the element declines', () => {
    expect(textOnlyPatches(SOURCE, SOURCE.replace('>Launch\n', '>X\n'), {})).toBeNull();
  });
});

describe('broadcaster attaches patches', () => {
  let root: string;
  const abs = () => join(root, 'ui', 'Page.tsx');
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'maude-text-patch-'));
    mkdirSync(join(root, 'ui'), { recursive: true });
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  async function broadcast(write: string, renderedBuild: string | null): Promise<HmrMessage[]> {
    forgetCanvasBuilds();
    if (renderedBuild !== null)
      rememberCanvasBuild(abs(), { source: renderedBuild, locator: built(renderedBuild).locator });
    writeFileSync(abs(), write);
    const ctx: Context = {
      cfg: {} as Context['cfg'],
      projectLabel: '',
      paths: { designRoot: root } as Context['paths'],
      bus: createBus(),
    };
    const got: HmrMessage[] = [];
    const h = createHmrBroadcaster(ctx, (m) => got.push(m));
    ctx.bus.emit('fs:any', 'ui/Page.tsx');
    await new Promise((r) => setTimeout(r, HMR_DEBOUNCE_MS + 30));
    h.stop();
    return got;
  }

  test('a text-only change to the rendered build carries its patch', async () => {
    const [msg] = await broadcast(SOURCE.replace('>Launch\n', '>Kickoff\n'), SOURCE);
    expect(msg?.mode).toBe('module');
    expect(msg?.patches).toEqual([{ id: stampedId(SOURCE, 'h1'), text: 'Kickoff plan' }]);
  });

  test('a structural change is a plain module message', async () => {
    const [msg] = await broadcast(SOURCE.replace('<p>', '<p className="x">'), SOURCE);
    expect(msg?.mode).toBe('module');
    expect(msg?.patches).toBeUndefined();
  });

  test('without a build of this canvas there is nothing to diff against', async () => {
    const [msg] = await broadcast(SOURCE.replace('>Launch\n', '>Unseen\n'), null);
    expect(msg?.mode).toBe('module');
    expect(msg?.patches).toBeUndefined();
  });
});

describe('shell applyTextPatches', () => {
  const SHELL = readFileSync(
    join(import.meta.dir, '..', '..', '..', 'plugins', 'design', 'templates', '_shell.html'),
    'utf8'
  );
  let apply: (patches: unknown[]) => void;
  beforeAll(() => {
    GlobalRegistrator.register();
    const begin = SHELL.indexOf('// text-patches:begin');
    const end = SHELL.indexOf('// text-patches:end');
    expect(begin).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(begin);
    apply = new Function(`${SHELL.slice(begin, end)}\nreturn applyTextPatches;`)();
  });
  afterAll(() => GlobalRegistrator.unregister());

  const id = 'a1b2c3d4';
  const mount = (html: string) => {
    document.body.innerHTML = html;
    return document.body.firstElementChild as HTMLElement;
  };

  test('replaces the single text child of every matching leaf', () => {
    document.body.innerHTML = `<h1 data-cd-id="${id}" data-cd-editable="text">Old</h1><h1 data-cd-id="${id}" data-cd-editable="text">Old</h1>`;
    apply([{ id, text: 'New' }]);
    expect([...document.querySelectorAll('h1')].map((h) => h.textContent)).toEqual(['New', 'New']);
  });

  test('leaves markup-bearing, non-editable and focused elements alone', () => {
    const mixed = mount(`<p data-cd-id="${id}" data-cd-editable="text">Old <b>bold</b></p>`);
    apply([{ id, text: 'New' }]);
    expect(mixed.innerHTML).toBe('Old <b>bold</b>');

    const plain = mount(`<p data-cd-id="${id}">Old</p>`);
    apply([{ id, text: 'New' }]);
    expect(plain.textContent).toBe('Old');

    const editing = mount(
      `<p data-cd-id="${id}" data-cd-editable="text" contenteditable="true">Typing</p>`
    );
    editing.focus();
    apply([{ id, text: 'New' }]);
    expect(editing.textContent).toBe('Typing');
  });

  test('never interprets the text as markup, and ignores malformed patches', () => {
    const el = mount(`<h1 data-cd-id="${id}" data-cd-editable="text">Old</h1>`);
    apply([
      null,
      { id: '"],body,[x="', text: 'injected' },
      { id, text: '<img src=x onerror=alert(1)>' },
    ]);
    expect(el.children).toHaveLength(0);
    expect(el.textContent).toBe('<img src=x onerror=alert(1)>');
  });
});
