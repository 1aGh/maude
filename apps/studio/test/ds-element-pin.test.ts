// S10.4 (V2-1.6 §5.8 "Element pins") — a `data-ds-rev` subtree keeps its revision's look while its sibling
// renders head. Three layers:
//   1. ds/pin-scope.ts rewrites SELECTORS only (token rules onto the scope element, one attribute of
//      specificity on class rules, before any pseudo-element) — and the shell's mirror of it agrees with it
//      on a corpus (the template imports nothing, so it carries a copy);
//   2. the shell frame, in a real Chromium (headless lane), asks only for well-formed values, loads only what
//      the parent answers, ignores a canvas's own posts, and scopes what it loads;
//   3. the cascade: the old corners and the old accent in the pinned subtree, head's in its sibling, and the
//      pinned `.btn.btn--primary:hover` beats the unpinned twin even when it comes EARLIER in the document.

import { afterEach, describe, expect, test } from 'bun:test';

import { isPinValue, scopeCss, scopeSelector } from '../ds/pin-scope.ts';
import { type Frame, openShellFrame, shellRegion } from './ds-shell-harness.ts';

const OLD = 'a'.repeat(64);
const NEW = 'b'.repeat(64);
const pin = (v: string) => `[data-ds-rev="${v}"]`;

describe('ds/pin-scope — selectors only', () => {
  test('a class rule gets one attribute of specificity on its LAST compound', () => {
    expect(scopeSelector('.btn.btn--primary:hover', OLD)).toEqual([
      `.btn.btn--primary:hover:is(${pin(OLD)}, ${pin(OLD)} *)`,
    ]);
    expect(scopeSelector('.card .title', 'head')).toEqual([
      `.card .title:is(${pin('head')}, ${pin('head')} *)`,
    ]);
    expect(scopeSelector('ul > li + li', OLD)).toEqual([
      `ul > li + li:is(${pin(OLD)}, ${pin(OLD)} *)`,
    ]);
  });

  test('…before any pseudo-element, legacy single-colon forms included', () => {
    expect(scopeSelector('.btn::before', OLD)).toEqual([
      `.btn:is(${pin(OLD)}, ${pin(OLD)} *)::before`,
    ]);
    expect(scopeSelector('.btn:after', OLD)).toEqual([`.btn:is(${pin(OLD)}, ${pin(OLD)} *):after`]);
    expect(scopeSelector('.in::placeholder', OLD)).toEqual([
      `.in:is(${pin(OLD)}, ${pin(OLD)} *)::placeholder`,
    ]);
    expect(scopeSelector('a:hover::after', OLD)).toEqual([
      `a:hover:is(${pin(OLD)}, ${pin(OLD)} *)::after`,
    ]);
  });

  test('token rules are declared on the scope element', () => {
    expect(scopeSelector(':root', OLD)).toEqual([pin(OLD)]);
    expect(scopeSelector('.ds', OLD)).toEqual([pin(OLD)]);
    expect(scopeSelector('.ds[data-theme="dark"]', OLD)).toEqual([
      `:where([data-theme="dark"]) ${pin(OLD)}`,
      `[data-theme="dark"]${pin(OLD)}`,
    ]);
    expect(scopeSelector(".ds[data-theme='light']", 'head')).toEqual([
      `:where([data-theme="light"]) ${pin('head')}`,
      `[data-theme="light"]${pin('head')}`,
    ]);
    expect(scopeSelector('.maude[data-theme=dark]', OLD, { rootClass: 'maude' })).toEqual([
      `:where([data-theme="dark"]) ${pin(OLD)}`,
      `[data-theme="dark"]${pin(OLD)}`,
    ]);
  });

  test('a themed COMPONENT is a class rule, not a token rule (the rootClass is what tells them apart)', () => {
    expect(scopeSelector('.card[data-theme="dark"]', OLD, { rootClass: 'maude' })).toEqual([
      `.card[data-theme="dark"]:is(${pin(OLD)}, ${pin(OLD)} *)`,
    ]);
    expect(scopeSelector('*', OLD)).toEqual([`*:is(${pin(OLD)}, ${pin(OLD)} *)`]);
    expect(scopeSelector('.ds[data-theme="dark"] .btn', OLD)).toEqual([
      `.ds[data-theme="dark"] .btn:is(${pin(OLD)}, ${pin(OLD)} *)`,
    ]);
  });

  test('a value that is not a pin value is refused, never put in a selector', () => {
    expect(() => scopeSelector('.btn', '"] , body {')).toThrow();
    expect(() => scopeCss('.btn{}', 'zz')).toThrow();
    expect(isPinValue('head')).toBe(true);
    expect(isPinValue(OLD)).toBe(true);
    expect(isPinValue('HEAD')).toBe(false);
    expect(isPinValue(`${OLD}0`)).toBe(false);
  });

  test('scopeCss keeps declaration bodies byte for byte and walks grouping rules', () => {
    const css = `/* } tricky */
@import url("x.css");
.ds[data-theme="light"], :root { --r: 4px; --font: "a, b"; background: url(data:image/svg+xml;utf8,<svg a="}"/>); }
.btn, .btn--ghost:hover { border-radius: var(--r); }
@media (min-width: 600px) { .btn { padding: 2px; } :root { --r: 8px; } }
@keyframes spin { from { opacity: 0 } to { opacity: 1 } }
@font-face { font-family: X; src: url(x.woff2); }
`;
    const out = scopeCss(css, OLD);
    expect(out).toContain(`${pin(OLD)}`);
    expect(out).toContain(
      `{ --r: 4px; --font: "a, b"; background: url(data:image/svg+xml;utf8,<svg a="}"/>); }`
    );
    expect(out).toContain(`.btn:is(${pin(OLD)}, ${pin(OLD)} *),`);
    expect(out).toContain(
      `.btn--ghost:hover:is(${pin(OLD)}, ${pin(OLD)} *) { border-radius: var(--r); }`
    );
    expect(out).toContain('@media (min-width: 600px) {');
    expect(out).toContain(`${pin(OLD)} { --r: 8px; }`);
    expect(out).not.toContain('@keyframes');
    expect(out).not.toContain('@font-face');
    expect(out).not.toContain('@import');
    expect(out).not.toContain('tricky');
  });

  test('over the size cap → nothing', () => {
    expect(scopeCss(`.a{x:${'y'.repeat(2 * 1024 * 1024)}}`, OLD)).toBe('');
  });
});

describe('the shell mirror agrees with ds/pin-scope.ts', () => {
  const CORPUS = [
    '.btn.btn--primary:hover { background: var(--accent-hover); }',
    ':root, .ds[data-theme="light"] { --a: 1; }',
    '.ds[data-theme="dark"] { --a: 2; }\n.card[data-theme="dark"] .t::after { content: "}"; }',
    '@media (prefers-color-scheme: dark) { :root { --a: 3 } .x > .y:not(.z) { color: red } }',
    '@supports (display: grid) { @layer base { * , *::before { box-sizing: border-box } } }',
    '.a:is(.b, .c) .d:nth-child(2n+1)::marker { color: red }',
    '@keyframes k { to { opacity: 1 } } @font-face { font-family: F } .z { x: 1 }',
    '/* c */ .q /* in */ , .r { m: "a;b" }',
  ];

  test('scopeCss gives the same text for every corpus entry, both values, both rootClass settings', () => {
    const region = `${shellRegion('ds-css')}\n${shellRegion('ds-pins')}\nreturn dsPinScope;`;
    const mirror = new Function(
      'window',
      'document',
      'withCap',
      'designRel',
      'fetch',
      'setTimeout',
      'MutationObserver',
      region
    )(
      { addEventListener() {}, parent: {} },
      {},
      (u: string) => u,
      '.design',
      () => Promise.reject(new Error('no')),
      () => 0,
      undefined
    ) as { scopeCss: typeof scopeCss; isPinValue: typeof isPinValue };
    for (const css of CORPUS)
      for (const v of ['head', OLD])
        for (const rootClass of [null, 'maude'])
          expect(mirror.scopeCss(css, v, { rootClass })).toBe(scopeCss(css, v, { rootClass }));
    expect(mirror.isPinValue('head')).toBe(true);
    expect(mirror.isPinValue('x')).toBe(false);
  });
});

// ─── the real thing: a Chromium frame, the shell's own code ─────────────────────────────────────────

const HEAD_TOKENS = `.ds[data-theme="light"] { --r: 4px; --accent: rgb(0, 0, 255); --accent-hover: rgb(0, 0, 200); }`;
const OLD_TOKENS = `.ds[data-theme="light"] { --r: 16px; --accent: rgb(255, 0, 0); --accent-hover: rgb(200, 0, 0); }`;
// The hover colour is a LITERAL per revision, so inheriting the old tokens cannot fake a pass.
const components = (hover: string) => `
.btn { display: block; width: 80px; height: 30px; border: 0; border-radius: var(--r); }
.btn.btn--primary { background: var(--accent); }
.btn.btn--primary:hover { background: ${hover}; }`;
const HEAD_COMPONENTS = components('rgb(0, 0, 200)');
const OLD_COMPONENTS = components('rgb(200, 0, 0)');

let frame: Frame | null = null;
afterEach(async () => {
  await frame?.close();
  frame = null;
});

const BODY = `<div class="ds" data-theme="light" style="padding:8px">
  <button class="btn btn--primary" id="head">head</button>
  <div id="pinned" data-ds-rev="${OLD}"><button class="btn btn--primary" id="old">old</button></div>
</div>`;

const style = (sel: string, prop: string) =>
  `getComputedStyle(document.querySelector('${sel}')).${prop}`;

describe('headless lane — the shell frame', () => {
  test('a data-ds-rev subtree keeps the old look, its sibling renders head, and the pin wins the cascade', async () => {
    const files = {
      'system/s/revisions/head.tokens.css': HEAD_TOKENS,
      'system/s/revisions/head.components.css': HEAD_COMPONENTS,
      [`system/s/revisions/${OLD}.tokens.css`]: OLD_TOKENS,
      [`system/s/revisions/${OLD}.components.css`]: OLD_COMPONENTS,
    };
    frame = await openShellFrame({ css: files, body: BODY });
    // The canvas's own two links, as the shell sets them for the revision it follows.
    await frame.post({
      dgn: 'ds-css',
      tokens: 'system/s/revisions/head.tokens.css',
      components: 'system/s/revisions/head.components.css',
    });
    await frame.page.waitForFunction(() => {
      const f = (document.getElementById('f') as HTMLIFrameElement).contentDocument;
      return getComputedStyle(f?.querySelector('#head') as Element).borderRadius === '4px';
    });
    // Without the pin the subtree follows the canvas.
    expect(await frame.evalInFrame(style('#old', 'borderRadius'))).toBe('4px');

    // It asked for exactly the well-formed value it carries.
    await frame.page.waitForFunction(() =>
      (window as unknown as { __got: Array<{ dgn: string }> }).__got.some(
        (m) => m.dgn === 'ds-pins-want'
      )
    );
    const want = (await frame.got()).find((m) => (m as { dgn: string }).dgn === 'ds-pins-want') as {
      revs: string[];
    };
    expect(want.revs).toEqual([OLD]);

    await frame.post({
      dgn: 'ds-pins',
      rootClass: 'ds',
      revs: {
        [OLD]: {
          tokens: `system/s/revisions/${OLD}.tokens.css`,
          components: `system/s/revisions/${OLD}.components.css`,
        },
      },
    });
    await frame.page.waitForFunction(() => {
      const f = (document.getElementById('f') as HTMLIFrameElement).contentDocument;
      return getComputedStyle(f?.querySelector('#old') as Element).borderRadius === '16px';
    });
    expect(await frame.evalInFrame(style('#old', 'borderRadius'))).toBe('16px');
    expect(await frame.evalInFrame(style('#old', 'backgroundColor'))).toBe('rgb(255, 0, 0)');
    // …while its sibling still renders head.
    expect(await frame.evalInFrame(style('#head', 'borderRadius'))).toBe('4px');
    expect(await frame.evalInFrame(style('#head', 'backgroundColor'))).toBe('rgb(0, 0, 255)');
  });

  test('specificity: the pinned :hover beats the unpinned twin even when the twin comes LATER', async () => {
    const files = {
      [`system/s/revisions/${OLD}.tokens.css`]: OLD_TOKENS,
      [`system/s/revisions/${OLD}.components.css`]: OLD_COMPONENTS,
    };
    // The unpinned sheet is a <style> at the END of the body: it comes after the pin's <style> (appended
    // to <head>), so order alone hands a hover on the old button to the unpinned rule unless the pin
    // out-weighs it.
    frame = await openShellFrame({
      css: files,
      body: `${BODY}<style>${HEAD_TOKENS}${HEAD_COMPONENTS}</style>`,
    });
    await frame.post({
      dgn: 'ds-pins',
      rootClass: 'ds',
      revs: {
        [OLD]: {
          tokens: `system/s/revisions/${OLD}.tokens.css`,
          components: `system/s/revisions/${OLD}.components.css`,
        },
      },
    });
    await frame.page.waitForFunction(() => {
      const f = (document.getElementById('f') as HTMLIFrameElement).contentDocument;
      return !!f?.querySelector('style[data-ds-pin]')?.textContent;
    });
    const frameEl = await frame.page.$('#f');
    const box = await frameEl.boundingBox();
    const old = await frame.evalInFrame<{ x: number; y: number }>(
      `(() => { const r = document.querySelector('#old').getBoundingClientRect(); return { x: r.x + 10, y: r.y + 10 }; })()`
    );
    await frame.page.mouse.move(box.x + old.x, box.y + old.y);
    expect(await frame.evalInFrame(style('#old', 'backgroundColor'))).toBe('rgb(200, 0, 0)');
    const head = await frame.evalInFrame<{ x: number; y: number }>(
      `(() => { const r = document.querySelector('#head').getBoundingClientRect(); return { x: r.x + 10, y: r.y + 10 }; })()`
    );
    await frame.page.mouse.move(box.x + head.x, box.y + head.y);
    expect(await frame.evalInFrame(style('#head', 'backgroundColor'))).toBe('rgb(0, 0, 200)');
  });

  test('only a well-formed value is asked for; the canvas cannot name a path', async () => {
    frame = await openShellFrame({
      body: `<div data-ds-rev="head"></div><div data-ds-rev="../../etc/passwd"></div>
             <div data-ds-rev="https://evil.test/x.css"></div><div data-ds-rev="${NEW}"></div>`,
    });
    await frame.page.waitForFunction(() =>
      (window as unknown as { __got: Array<{ dgn: string }> }).__got.some(
        (m) => m.dgn === 'ds-pins-want'
      )
    );
    const want = (await frame.got()).find((m) => (m as { dgn: string }).dgn === 'ds-pins-want') as {
      revs: string[];
    };
    expect(want.revs).toEqual(['head', NEW].sort());
  });

  test('a pin the canvas posts to itself, or with a hostile path, loads nothing', async () => {
    frame = await openShellFrame({
      css: { 'system/s/revisions/x.tokens.css': '.ds{--r:1px}' },
      body: `<div data-ds-rev="head"></div>`,
    });
    const hostile = {
      dgn: 'ds-pins',
      revs: {
        head: { tokens: '../secret.css', components: 'https://evil.test/c.css' },
        [OLD]: { tokens: '/abs.css', components: null },
        'not-a-pin': { tokens: 'system/s/revisions/x.tokens.css', components: null },
      },
    };
    await frame.post(hostile); // from the parent, but every entry is malformed
    await frame.selfPost({
      dgn: 'ds-pins',
      revs: { head: { tokens: 'system/s/revisions/x.tokens.css', components: null } },
    }); // well-formed, but from the canvas itself
    await frame.page.waitForTimeout(400);
    expect(
      await frame.evalInFrame<number>(`document.querySelectorAll('style[data-ds-pin]').length`)
    ).toBe(0);
  });

  test('a value the parent stops listing is dropped', async () => {
    frame = await openShellFrame({
      css: { 'system/s/revisions/p.tokens.css': '.ds[data-theme="light"]{--r:9px}' },
      body: `<div class="ds" data-theme="light"><i data-ds-rev="head" id="i"></i></div>`,
    });
    await frame.post({
      dgn: 'ds-pins',
      rootClass: 'ds',
      revs: { head: { tokens: 'system/s/revisions/p.tokens.css', components: null } },
    });
    await frame.page.waitForFunction(
      () =>
        !!(document.getElementById('f') as HTMLIFrameElement).contentDocument?.querySelector(
          'style[data-ds-pin]'
        )
    );
    await frame.post({ dgn: 'ds-pins', revs: {} });
    await frame.page.waitForFunction(
      () =>
        !(document.getElementById('f') as HTMLIFrameElement).contentDocument?.querySelector(
          'style[data-ds-pin]'
        )
    );
  });
});
