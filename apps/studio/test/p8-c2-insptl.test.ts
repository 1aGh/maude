// P8 stage C round 2 (inspector + timeline + export rest) — pins for the pieces that are CSS rules or a one-line wiring
// in a shared file; the behaviour changes carry their own render tests next to the component they changed.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const client = (rel: string) => readFileSync(join(import.meta.dir, '..', 'client', rel), 'utf8');
const rule = (src: string, sel: string): string => {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(?:^|[\\n,}])\\s*${esc}\\s*\\{([^}]*)\\}`).exec(src);
  if (!m) throw new Error(`no rule for ${sel}`);
  return m[1] ?? '';
};

describe('07 · Advanced stays inside the island (ve-advanced)', () => {
  const adv = client('v2/timeline/advanced/advanced.css');
  const tl = client('v2/timeline/timeline.css');

  test('"Copy timecode" and the other .tla-btn buttons are kit-quiet, not the browser button', () => {
    const r = rule(adv, '.tla-btn');
    expect(r).toMatch(/appearance:\s*none/);
    expect(r).toMatch(/border:\s*0/);
    expect(r).toMatch(/font:\s*inherit/);
  });

  // P8 C10 (07 ve-advanced) supersedes c4-video's "cards above the island" (decision v2-p8-c10-advanced-cards-in-body):
  // Easing at the centre top, Render settings + The cut as code stacked in the inspector's column, both islands of the
  // shell body (a portal into `.sh-body`); the timeline keeps its own height and the tracks keep a floor
  test('the cards are islands of the shell body: Easing centre-top, the stack in the right column, each with chrome', () => {
    const layer = rule(adv, '.tla-layer');
    expect(layer).toMatch(/position:\s*absolute/);
    expect(layer).toMatch(/inset:\s*0/);
    expect(rule(adv, '.tla-card')).toMatch(/box-shadow:/);
    expect(rule(adv, '.tla-card')).toMatch(/top:\s*var\(--tla-top\)/);
    expect(rule(adv, '.tla-card--easing')).toMatch(/left:\s*50%/);
    expect(rule(adv, '.tla-card--stack')).toMatch(/right:\s*var\(--float-gap/);
    expect(rule(adv, '.tla-card--stack')).toMatch(/width:\s*340px/);
    expect(tl).toMatch(
      /\.tl-island \.tl-panel\[data-size="full"\]\s*\{[^}]*max-height:\s*calc\(100vh/
    );
  });

  test('the full panel keeps its floor: the tracks stay readable under an open Advanced', () => {
    expect(tl).toMatch(/\.tl-panel\[data-size="full"\] \.tl-scroll\s*\{[^}]*min-height:\s*168px/);
  });

  test('an open Advanced no longer grows the island; its stack tells the canvas what it covers; the inspector steps aside', () => {
    const src = client('v2/timeline/Timeline.jsx');
    expect(src).not.toMatch(/minHeight: height/);
    expect(client('v2/timeline/advanced/foot.jsx')).toMatch(/data-occludes="right"/);
    expect(adv).toMatch(
      /\.sh-body:has\(\.tla-layer\) \.sh-dockslot-inner:has\(> \.sh-rpanel--insp\)[^{]*\{[^}]*display:\s*none/
    );
  });

  test('the ruler opens in frames (the board: Advanced turns the ruler to frame numbers)', () => {
    expect(client('v2/timeline/advanced/advanced-store.js')).toMatch(
      /const out = \{ mode: 'frames'/
    );
  });
});

describe('07 · "+ Title" selects the clip it inserted (ve-text)', () => {
  test('app.jsx hands the insert-sequence stableId to the timeline selection', () => {
    const app = client('app.jsx');
    const at = app.indexOf("shellToast('Title added.', true)");
    expect(at).toBeGreaterThan(0);
    const near = app.slice(at, at + 600);
    expect(near).toMatch(/setTimelineSelectedClip\(j\.stableId\)/);
  });
});

describe('09 · a batch row draws a stack of the artboard stills the preview route returned', () => {
  test('stillsOf: only ready stills of that kind, at most three, in order', async () => {
    const { stillsOf } = await import('../client/v2/export/sections/batch.jsx');
    const ready = (kind: string, n: number) => ({
      kind,
      label: `L${n}`,
      picture: { status: 'ready', url: `/_api/thumb/${n}` },
    });
    const items = [
      ready('print', 1),
      { kind: 'print', label: 'wait', picture: { status: 'pending', key: 'k' } },
      ready('digital', 2),
      ready('print', 3),
      ready('print', 4),
      ready('print', 5),
    ];
    expect(stillsOf(items, 'print').map((s) => s.url)).toEqual([
      '/_api/thumb/1',
      '/_api/thumb/3',
      '/_api/thumb/4',
    ]);
    expect(stillsOf(items, 'video')).toEqual([]);
    expect(stillsOf(undefined, 'print')).toEqual([]);
  });

  test('the sheet asks the route only for a batch, and re-asks while a picture is pending', () => {
    const hook = client('v2/export/use-export-spec.js');
    expect(hook).toMatch(/usePictures\(draft, \{ enabled: ctx\.estimate !== false && batch \}\)/);
    expect(hook).toMatch(/'pending'\) && \+\+tries < PICTURE_TRIES/);
    expect(client('v2/export/export-sheet.jsx')).toMatch(/est,\n\s+pictures,\n\s+video,/);
  });
});

describe('07 · the transition picker has no preview slab and a tip on the join', () => {
  const css = client('v2/timeline/joins/joins.css');
  test('the .tj-preview slab rules are gone; the tip rule is there', () => {
    expect(css).not.toMatch(/\.tj-preview/);
    expect(rule(css, '.tj-pop::after')).toMatch(/rotate:\s*45deg/);
  });
});
