// S11.1 — the empty kit (client/v2/empty/): Empty · Spot · AskButton · Suggestions · Confetti ·
// SkeletonArtboard / ArrivingRow · the copy table · the landing spring.
//
// Done when: every 05 string is in the copy table verbatim (parsed from the canvas source, both ways) · no
// button where there is nothing to do · Confetti is imported only from client/v2/comments/ · spot art
// and empty.css carry token colours only · reduced motion collapses the spring and the pulse to 1 ms.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { COPY, copyIds, NO_DOOR } from '../client/v2/empty/empty-copy.js';
import {
  ArrivingRow,
  AskButton,
  Confetti,
  copy,
  Empty,
  SkeletonArtboard,
  Spot,
  Suggestions,
} from '../client/v2/empty/index.js';
import { FRAMES, pose, springAt } from '../client/v2/empty/spot.jsx';
import { SPOT_ART, SPOT_NAMES } from '../client/v2/empty/spot-art.jsx';

const STUDIO = join(import.meta.dir, '..');
const REPO = join(STUDIO, '..', '..');
const read = (p: string) => readFileSync(p, 'utf8');
const CANVAS = read(join(REPO, '.design/ui/v2/05 Empty States.tsx'));
const KIT = (f: string) => join(STUDIO, 'client/v2/empty', f);

/** The canvas source with its inline decoration peeled off, so a sentence reads as one run of text. */
const flat = (s: string) =>
  s
    .replace(/<Kbd>([^<]*)<\/Kbd>/g, '[[$1]]')
    .replace(/<span className="es-q">([^<]*)<\/span>/g, '$1')
    .replace(/\s+/g, ' ');
const BLOB = flat(CANVAS);

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A copy template as a regex: `{var}` matches any run, everything else is literal. */
const templateRe = (t: string) =>
  new RegExp(
    t
      .split(/(\{[A-Za-z]+\})/)
      .map((part) => (/^\{[A-Za-z]+\}$/.test(part) ? '.{1,60}?' : escapeRe(part)))
      .join('')
  );

describe('the copy table equals the canvas', () => {
  test('every string in the table appears in 05 Empty States.tsx, verbatim', () => {
    const missing: string[] = [];
    for (const id of copyIds()) {
      for (const [field, value] of Object.entries(COPY[id])) {
        const list = Array.isArray(value) ? value : [value];
        for (const v of list) {
          if (!templateRe(flat(v as string)).test(BLOB)) missing.push(`${id}.${field}: ${v}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  test('every <Empty title="…"> in the canvas is a title in the table', () => {
    const titles = [...CANVAS.matchAll(/<Empty\b[^>]*?\btitle="([^"]+)"/g)].map((m) => m[1]);
    expect(titles.length).toBeGreaterThanOrEqual(15);
    const have = copyIds()
      .map((id) => COPY[id].title)
      .filter(Boolean) as string[];
    const missing = titles.filter((t) => !have.some((h) => templateRe(h).test(t)));
    expect(missing).toEqual([]);
  });

  test('every artboard of the canvas has at least one copy id', () => {
    const header = CANVAS.match(/@artboards\s+([\s\S]*?)\n \* @brief/)?.[1] ?? '';
    const boards = header
      .replace(/\*/g, '')
      .split(/[|\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    expect(boards.length).toBe(20);
    for (const b of boards) {
      expect(copyIds().some((id) => id.startsWith(`${b}.`))).toBe(true);
    }
  });

  test('ids are <artboard>.<part>; copy(id, vars) fills {vars} and refuses a missing one', () => {
    expect(copy('es-panels-canvas.comments-none', { canvas: 'Homepage' }).title).toBe(
      'No comments on Homepage yet.'
    );
    expect(copy('es-search-k.search-none', { q: 'pricng' }).title).toBe('Nothing called “pricng”.');
    expect(() => copy('es-panels-canvas.comments-none')).toThrow(/canvas/);
    expect(() => copy('nope.nothing')).toThrow(/unknown/);
    for (const id of copyIds()) expect(id).toMatch(/^es-[a-z0-9-]+\.[a-z0-9-]+$/);
  });

  test('the two CONTRACT lines are exact (§6 empty canvas, §4 no results)', () => {
    const c = copy('es-canvas-ai.canvas-ready');
    expect(`${c.title} ${c.next}`).toBe(
      'Your canvas is ready. Ask AI for a first draft, or start drawing.'
    );
    const n = copy('es-search-k.search-none', { q: 'pricng' });
    expect(`${n.title} ${n.next}`).toBe(
      'Nothing called “pricng”. Try another word, or ask AI to find it.'
    );
  });

  test('voice (CONTRACT §3–§4): no we / I / Oops / !, none of the banned nouns', () => {
    const bad = /\b(we|I|Oops|board|screen|sidebar|island|dock|Assistant|Pro|Debug|Delete)\b|!/;
    const offenders: string[] = [];
    for (const id of copyIds()) {
      if (/placeholder|starter/.test(id)) continue; // a prompt is the person's own words
      for (const [field, value] of Object.entries(COPY[id])) {
        const text = String(value).replace(/\[\[[^\]]*\]\]/g, '');
        if (bad.test(text)) offenders.push(`${id}.${field}: ${text}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('Empty', () => {
  test('size, align and the three parts: situation, next step, one action', () => {
    const html = renderToStaticMarkup(
      createElement(Empty, {
        size: 'canvas',
        align: 'left',
        title: 'Your canvas is ready.',
        next: 'Ask AI for a first draft, or start drawing.',
        actions: createElement(AskButton, { keys: '⌘/' }, 'Ask AI'),
      })
    );
    expect(html).toContain('es-e es-e--canvas es-e--left');
    expect(html).toContain('<p class="es-sit">Your canvas is ready.</p>');
    expect(html).toContain('class="es-next"');
    expect(html).toContain('class="es-acts"');
  });

  test('no door: a copy id in NO_DOOR renders no actions even when a caller passes one', () => {
    expect([...NO_DOOR].sort()).toEqual([
      'es-home-shared.shared-none',
      'es-panels-canvas.vh-before-first',
      'es-panels-make.trash-empty',
    ]);
    for (const id of NO_DOOR) {
      const html = renderToStaticMarkup(
        createElement(Empty, {
          copyId: id,
          actions: createElement('button', { type: 'button' }, 'Do it'),
        })
      );
      expect(html).not.toContain('es-acts');
      expect(html).not.toContain('<button');
      expect(html).toContain('es-sit');
    }
    const withDoor = renderToStaticMarkup(
      createElement(Empty, {
        copyId: 'es-panels-canvas.comments-none',
        vars: { canvas: 'Homepage' },
        actions: createElement('button', { type: 'button' }, 'Share for feedback'),
      })
    );
    expect(withDoor).toContain('es-acts');
  });

  test('copyId fills title, next, chips and foot from the table; the id is on the root', () => {
    const html = renderToStaticMarkup(
      createElement(Empty, { copyId: 'es-panels-make.ai-none', vars: { canvas: 'Pricing' } })
    );
    expect(html).toContain('Ask about Pricing.');
    expect(html).toContain('Add a yearly toggle');
    expect(html).toContain('data-copy="es-panels-make.ai-none"');
    expect(html).toContain('data-testid="empty-es-panels-make.ai-none"');
  });

  test('[[C]] becomes a key cap and a quoted word keeps together (es-q)', () => {
    const html = renderToStaticMarkup(
      createElement(Empty, {
        copyId: 'es-panels-canvas.comments-none',
        vars: { canvas: 'Homepage' },
      })
    );
    expect(html).toContain('<span class="kbd">C</span>');
    expect(html).not.toContain('[[');
    const q = renderToStaticMarkup(
      createElement(Empty, { copyId: 'es-search-k.search-none', vars: { q: 'pricng' } })
    );
    expect(q).toContain('<span class="es-q">“pricng”</span>');
  });

  test('quiet halves the spot; a glyph stands in only when there is no spot', () => {
    const quiet = renderToStaticMarkup(
      createElement(Empty, { spot: 'canvas', quiet: true, title: 'x' })
    );
    expect(quiet).toContain('es-spot--quiet');
    expect(quiet).not.toContain('es-glyph');
    const glyph = renderToStaticMarkup(createElement(Empty, { glyph: 'history', title: 'x' }));
    expect(glyph).toContain('es-glyph');
    expect(glyph).not.toContain('es-spot');
  });
});

describe('Spot and the landing spring', () => {
  test('all eight spots exist; the notes that land are their own layers', () => {
    expect([...SPOT_NAMES].sort()).toEqual([
      'ai',
      'canvas',
      'comment',
      'done',
      'image',
      'none',
      'offline',
      'trash',
    ]);
    expect(SPOT_ART.canvas.stickies.length).toBe(3);
    expect(SPOT_ART.ai.stickies.length).toBe(1);
    expect(SPOT_ART.done.stickies.length).toBe(1);
    for (const n of SPOT_NAMES) {
      const html = renderToStaticMarkup(createElement(Spot, { name: n, w: 176 }));
      expect(html).toContain('viewBox="0 0 240 160"');
      expect(html).toContain('aria-hidden="true"');
      expect(html).toContain('height="117.33');
    }
  });

  test('land plays the spring: each note carries its stagger index; no land means no animation class', () => {
    const land = renderToStaticMarkup(createElement(Spot, { name: 'canvas', land: true }));
    expect(land).toContain('es-spot--land');
    expect(land).toContain('--i:0');
    expect(land).toContain('--i:2');
    const still = renderToStaticMarkup(createElement(Spot, { name: 'canvas' }));
    expect(still).not.toContain('es-spot--land');
  });

  test('the 05 filmstrip: frames at 0 / 90 / 200 / 520 ms are what a rendered land would show', () => {
    expect(FRAMES.map((f) => f.ms)).toEqual([0, 90, 200, 520]);
    // 0 ms: the first note is not there yet
    expect(pose(0, 0).opacity).toBe(0);
    // 90 ms: the first note is on its way, the second (48 ms later) is behind it
    const a = pose(90, 0);
    const b = pose(90, 1);
    expect(Number(a.opacity)).toBeGreaterThan(Number(b.opacity));
    expect(Number(b.opacity)).toBeGreaterThan(0);
    // 200 ms: the first overshoots to ~104.5 % and settles
    expect(springAt(200 / 420)).toBeGreaterThan(1.03);
    expect(springAt(200 / 420)).toBeLessThan(1.06);
    expect(String(pose(200, 0).transform)).toMatch(/scale\(1\.00\d\)/);
    // 520 ms: settled, nothing moves again
    expect(pose(520, 0)).toEqual({
      opacity: 1,
      transform: 'translateY(0.0px) scale(1.000) rotate(0.0deg)',
    });
    expect(pose(520, 2)).toEqual({
      opacity: 1,
      transform: 'translateY(0.0px) scale(1.000) rotate(0.0deg)',
    });
  });

  test('a frozen frame replaces the animation (the filmstrip cannot also animate)', () => {
    const f = renderToStaticMarkup(createElement(Spot, { name: 'canvas', land: true, frame: 90 }));
    expect(f).not.toContain('es-spot--land');
    expect(f).toMatch(/style="opacity:[0-9.]+;transform:translateY/);
  });
});

describe('AskButton and Suggestions', () => {
  let dom = false;
  beforeAll(() => {
    GlobalRegistrator.register();
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    dom = true;
  });
  afterAll(() => {
    if (dom) GlobalRegistrator.unregister();
  });

  test('AskButton: a real button, spark glyph in the button colour, the keys, onClick', async () => {
    let clicks = 0;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(createElement(AskButton, { keys: '⌘/', onClick: () => clicks++ }, 'Ask AI'));
    });
    const btn = host.querySelector('button') as HTMLButtonElement;
    expect(btn.type).toBe('button');
    expect(btn.className).toContain('es-ask');
    expect(btn.textContent).toContain('Ask AI');
    expect(btn.querySelector('.es-keys')?.textContent).toBe('⌘/');
    expect(btn.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(btn.getAttribute('data-testid')).toBe('empty-ask');
    await act(async () => {
      btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    expect(clicks).toBe(1);
    await act(async () => root.unmount());
  });

  test('Suggestions: one chip per phrase, picking one hands back the words', async () => {
    const picked: string[] = [];
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        createElement(Suggestions, {
          items: ['Add a yearly toggle', 'Make a dark version'],
          onPick: (t: string) => picked.push(t),
        })
      );
    });
    const chips = [...host.querySelectorAll('button')];
    expect(chips.map((c) => c.textContent)).toEqual(['Add a yearly toggle', 'Make a dark version']);
    await act(async () => {
      chips[1].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    expect(picked).toEqual(['Make a dark version']);
    await act(async () => root.unmount());
  });

  test('Suggestions without onPick are plain words, not buttons', () => {
    const html = renderToStaticMarkup(createElement(Suggestions, { items: ['A', 'B'] }));
    expect(html).not.toContain('<button');
    expect(html).toContain('es-sugg');
  });
});

describe('Skeleton and ArrivingRow: arriving is not empty', () => {
  test('an arriving row always has its name (never nameless bars), dimmed and pulsing', () => {
    const row = renderToStaticMarkup(
      createElement(ArrivingRow, { name: 'Combine-cisla', depth: 1 })
    );
    expect(row).toContain('Combine-cisla');
    expect(row).toContain('es-arr');
    expect(row).toContain('es-pulse');
    expect(row).toContain('data-testid="arriving-row"');
    const folder = renderToStaticMarkup(
      createElement(ArrivingRow, { name: '2027', folder: true, count: 12 })
    );
    expect(folder).toContain('2027');
    expect(folder).toContain('>12<');
  });

  test('a skeleton artboard shows its name, kind and the page-shaped placeholder at its size', () => {
    const html = renderToStaticMarkup(
      createElement(SkeletonArtboard, {
        label: 'Post 1:1 · Combine 2026',
        kind: 'digital',
        x: 830,
        y: 110,
        w: 230,
        h: 230,
      })
    );
    expect(html).toContain('Post 1:1 · Combine 2026');
    expect(html).toContain('left:830px');
    expect(html).toContain('width:230px');
    expect(html).toContain('es-pulse');
    expect(html).toContain('data-testid="skeleton-artboard"');
  });
});

describe('Confetti: one celebration', () => {
  test('a token-filled tile pattern behind the empty state, decorative', () => {
    const html = renderToStaticMarkup(createElement(Confetti, { id: 'es-confetti-done' }));
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('<pattern id="es-confetti-done"');
    expect(html).toContain('var(--object-coral)');
    expect(html).toContain('data-testid="empty-confetti"');
  });

  test('the Confetti import is allowed only from client/v2/comments/ (and the kit barrel)', () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(jsx?|tsx?)$/.test(n)) files.push(p);
      }
    };
    walk(join(STUDIO, 'client'));
    const offenders: string[] = [];
    for (const f of files) {
      const rel = relative(STUDIO, f);
      if (rel === 'client/v2/empty/index.js' || rel === 'client/v2/empty/confetti.jsx') continue;
      if (rel.startsWith('client/v2/comments/')) continue;
      const src = read(f);
      if (
        /from\s+['"][^'"]*empty\/confetti(\.jsx)?['"]/.test(src) ||
        /from\s+['"]\.\/confetti(\.jsx)?['"]/.test(src) ||
        /\bConfetti\b[^;]*from\s+['"][^'"]*\/empty(\/index\.js)?['"]/.test(src)
      ) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('tokens only, and reduced motion', () => {
  const css = read(KIT('empty.css'));
  const art = read(KIT('spot-art.jsx'));
  const HEX = /#[0-9a-fA-F]{3,8}\b/;
  const RAW_COLOUR = /\b(rgb|rgba|hsl|hsla|oklch|oklab|color-mix)\(/;

  test('no hex or colour function in empty.css, spot-art.jsx or the kit components', () => {
    expect(css).not.toMatch(HEX);
    expect(css).not.toMatch(RAW_COLOUR);
    expect(art).not.toMatch(HEX);
    for (const f of [
      'empty.jsx',
      'spot.jsx',
      'ask-button.jsx',
      'suggestions.jsx',
      'confetti.jsx',
      'skeleton.jsx',
    ]) {
      const src = read(KIT(f));
      expect(src.replace(/\/\/.*$/gm, '')).not.toMatch(HEX);
    }
    // every paint in the spot art is a token
    const paints = [...art.matchAll(/\b(?:fill|stroke)="([^"]+)"/g)].map((m) => m[1]);
    expect(paints.length).toBeGreaterThan(50);
    for (const p of paints) expect(p === 'none' || /^var\(--[a-z0-9-]+\)$/.test(p)).toBe(true);
  });

  test('every animation and transition runs on a --dur-* token', () => {
    const decls = [...css.matchAll(/\b(animation|transition)\s*:[^;]+;/g)].map((m) => m[0]);
    expect(decls.length).toBeGreaterThanOrEqual(2);
    for (const d of decls) {
      if (/:\s*none\s*;/.test(d)) continue;
      expect(d).toMatch(/var\(--dur-[a-z0-9-]+\)/);
      expect(d).not.toMatch(/\b\d+(\.\d+)?m?s\b/);
    }
    // delays are token-derived too
    for (const m of css.matchAll(/animation-delay\s*:[^;]+;/g)) expect(m[0]).toMatch(/var\(--dur-/);
  });

  test('reduced motion: the tokens collapse to 1 ms and the landing + the pulse stop outright', () => {
    const tokens = read(join(REPO, '.design/system/maude-v2/colors_and_type.css'));
    const rm = tokens.slice(tokens.indexOf('@media (prefers-reduced-motion: reduce)'));
    for (const t of ['--dur-flip', '--dur-soft', '--dur-panel', '--dur-spring'])
      expect(rm).toContain(t);
    expect(rm).toMatch(/--dur-flip:\s*1ms/);
    expect(css).toMatch(
      /\[data-reduced-motion="true"\][^{]*\.es-spot--land[^{]*\{[^}]*animation:\s*none/
    );
    expect(css).toMatch(
      /\[data-reduced-motion="true"\][^{]*\.es-pulse[^{]*\{[^}]*animation:\s*none/
    );
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.es-spot--land[\s\S]*animation:\s*none/
    );
  });
});

describe('the interface is stated once, at the top of index.js', () => {
  const head = read(KIT('index.js'))
    .split('\n')
    .filter((l) => l.startsWith('//'))
    .map((l) => l.replace(/^\/\/\s?/, ''))
    .join(' ');
  test('the header names every export other packages import', () => {
    for (const n of [
      'Empty',
      'Spot',
      'AskButton',
      'Suggestions',
      'Confetti',
      'SkeletonArtboard',
      'ArrivingRow',
      'copy',
    ]) {
      expect(head).toContain(n);
    }
    expect(head).toMatch(/never copy (the )?markup/i);
  });

  test('every testid the kit emits is in testids.json and TESTIDS.md', () => {
    const ids = JSON.parse(read(join(STUDIO, 'client/testids.json'))).map(
      (e: { hook: string }) => e.hook
    );
    const md = read(join(STUDIO, 'client/TESTIDS.md'));
    for (const h of [
      'empty-<copy-id>',
      'empty-spot-<name>',
      'empty-ask',
      'empty-confetti',
      'arriving-row',
      'skeleton-artboard',
    ]) {
      expect(ids).toContain(h);
      expect(md).toContain(`\`${h}\``);
    }
  });
});
