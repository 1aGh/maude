// V2-8.13 — pins for the 00 Index rules that had behaviour but no test of their own (the ledger sweep):
//  · `keys-for-the-modes`        ⌥⌘P Preview · ⌥⌘↵ Present from the selection · ⇧⌥⌘↵ from the start · L pointer while presenting
//  · `save-status-shown-not-operated`  one word by the faces; no dot on the project pill
//  · `print-colour-in-one-line`  "RGB — the print shop converts to CMYK"; no CMYK option in v2
//  · `designer-vocabulary`       the Share / export surfaces never say "publish" (CONTRACT §3: Share replaces publish)
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { ACTIONS_BY_ID } from '../actions/index.ts';
import { readableStrings } from './_v2-words-scan.ts';

const V2 = join(dirname(fileURLToPath(import.meta.url)), '..', 'client', 'v2');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(?:jsx?|tsx?)$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

/** Every string a person can read under client/v2/<dirs…> that matches `re`, as "file:line text". */
function readable(re: RegExp, only?: (rel: string) => boolean): string[] {
  const hits: string[] = [];
  for (const f of walk(V2)) {
    const rel = relative(V2, f);
    if (only && !only(rel)) continue;
    for (const s of readableStrings(readFileSync(f, 'utf8'), f)) {
      if (re.test(s.text)) hits.push(`${rel}:${s.line} ${s.text}`);
    }
  }
  return hits;
}

describe('rule: Keys for the modes', () => {
  const chords = (id: string) => (ACTIONS_BY_ID.get(id)?.keys ?? []).map((k) => k.chord);

  test('⌥⌘P Preview · ⌥⌘↵ Present from the selection · ⇧⌥⌘↵ from the start', () => {
    expect(chords('mode.preview')).toEqual(['⌥⌘P']);
    expect(chords('present.from-selection')).toEqual(['⌥⌘↵']);
    // the registry spells the chord ⌥⇧⌘↵ — the same three modifiers as the board's ⇧⌥⌘↵
    expect(chords('present.from-start').map((c) => [...c].sort().join(''))).toEqual([
      [...'⌥⇧⌘↵'].sort().join(''),
    ]);
  });

  test('the pointer is L, and only while presenting', () => {
    const keys = ACTIONS_BY_ID.get('tool.pointer')?.keys ?? [];
    expect(keys.map((k) => k.chord)).toEqual(['L']);
    expect(keys[0].when?.mode).toEqual(['present']);
  });
});

describe('rule: Save status, shown not operated — no dot on the project pill', () => {
  let root: import('react-dom/client').Root | null = null;
  let host: HTMLElement | null = null;
  beforeAll(() => {
    GlobalRegistrator.register();
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
  });
  afterEach(async () => {
    const { act } = await import('react');
    act(() => root?.unmount());
    host?.remove();
  });
  afterAll(() => {
    GlobalRegistrator.unregister();
  });

  test('the pill is the name, the canvas and a caret: no dot, no status word, no save state', async () => {
    const { act } = await import('react');
    const { createRoot } = await import('react-dom/client');
    const { menuCtx } = await import('../client/v2/shell/project-menu-model.js');
    const { ProjectPill } = await import('../client/v2/shell/project-pill.jsx');
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(
        <ProjectPill
          project="Alligators brand"
          canvas="Combine-kampan"
          ctx={menuCtx({ native: true, canvasOpen: true })}
          state={{}}
          run={() => {}}
        />
      );
    });
    const pill = host.querySelector('.sh-pill') as HTMLElement;
    expect(pill).toBeTruthy();
    expect(pill.querySelector('[class*="dot" i], [data-status], [role="status"]')).toBeNull();
    // only the mark, the name, the canvas and the caret are drawn
    const parts = [...pill.querySelectorAll('[class^="sh-pill-"]')].map((e) => e.className);
    expect(parts.sort()).toEqual(
      [
        'sh-pill-btn',
        'sh-pill-canvas',
        'sh-pill-caret',
        'sh-pill-mark',
        'sh-pill-name',
        'sh-pill-sep',
      ].sort()
    );
  });

  test('the save word lives in the Share cluster, not in the pill module', () => {
    const pill = readFileSync(join(V2, 'shell', 'project-pill.jsx'), 'utf8');
    expect(pill).not.toMatch(/save-status|saveStatus|share-cluster/);
    const cluster = readFileSync(join(V2, 'shell', 'share-cluster.jsx'), 'utf8');
    expect(cluster).toMatch(/share-cluster-status/);
  });
});

describe('rule: Print colour, in one line — no CMYK option in v2', () => {
  test('CMYK is only ever said in the one sentence', () => {
    const hits = readable(/CMYK/i);
    expect(hits.length).toBeGreaterThan(0);
    // …:<line> <the whole string>: nothing but the one sentence (optionally after "Designed in sRGB.") may name it
    const sentence =
      /^\S+:\d+ (Designed in sRGB\. )?RGB — the print shop converts to CMYK(\.|; if they ask for a profile, use theirs\.)( If they ask for a profile, use theirs\.)?$/;
    for (const h of hits) expect(h).toMatch(sentence);
  });
});

describe('rule: Designer vocabulary — Share, never "publish"', () => {
  test('no readable string in the Share sheet, the Share cluster, the access layer or the export sheet says publish', () => {
    const surfaces = (rel: string) =>
      /^(share|access|export)\//.test(rel) || /^shell\/share-cluster/.test(rel);
    expect(readable(/\bpublish/i, surfaces)).toEqual([]);
  });
});
