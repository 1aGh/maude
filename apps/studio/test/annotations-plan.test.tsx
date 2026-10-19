// S4.13 (canvas 15 `an-plan`, artboard 12 "The Combine 2026 plan, next to the work") - the plan reproduces from
// the pieces this slice owns: a kanban in the prompt's language (the template's layout engine, any text), its
// sections saying how many they hold, the quick votes as stamps on the cards, and the done cards pointing at
// the artboards they became. Everything goes through the real expand -> stroke -> element -> scene path.

import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { stampId } from '../annotations/elements/stamp.model.ts';
import { templateBoard } from '../annotations/templates.ts';
import type { AnnotationElement } from '../annotations/types.ts';
import { Containment } from '../annotations/ui/containment.ts';
import { strokeToRenderItem } from '../annotations/ui/render-model.ts';
import { AnnotationScene } from '../annotations/ui/scene.tsx';
import { membersOf } from '../annotations/ui/section-fold.ts';
import { clusterStamps, stampElement, upsertStampStroke } from '../annotations/ui/stamps.ts';
import { expandBoard } from '../annotations/ui/template-place.ts';
import { elementsToStrokes, strokesToElementMap } from '../annotations/v1-adapter.ts';
import { type ArrowStroke, STICKY_PALETTE, type Stroke } from '../annotations-model.ts';

const [YELLOW, , , CORAL, , GREEN, , SKY, LILAC] = STICKY_PALETTE as readonly string[];

/** The kanban template, filled the way AI fills it from "Kanban pro Combine 2026 ...": same layout, new words. */
const PLAN = {
  groups: [
    {
      title: 'Nápady',
      cards: [
        { text: 'Reel: 40 yd sprint ve zpomaleném záběru', color: LILAC },
        { text: 'Story: odpočet 7 dní do Combine', color: SKY },
        { text: 'Plakát do škol v Brně a Blansku', color: CORAL },
        { text: 'Rozhovor s trenérem O-line', color: LILAC },
      ],
    },
    {
      title: 'Rozpracované',
      cards: [
        { text: 'Leták A6 — registrace s QR kódem', color: CORAL },
        { text: 'Web: stránka STAŇ SE GATOREM', color: GREEN },
        { text: 'Post 1:1 — datum tučně', color: SKY },
      ],
    },
    {
      title: 'Hotovo',
      cards: [
        { text: 'Pozvánka pro partnery', color: GREEN },
        { text: 'Combine v číslech 2025', color: SKY },
      ],
    },
  ],
};

const plan = expandBoard(PLAN, { x: 96, y: 104 }, 'Michal');
const byText = (text: string) =>
  plan.strokes.find((s) => s.tool === 'sticky' && s.text === text) as Stroke & { id: string };
const stampOn = (card: Stroke, kind: string, who: string) =>
  stampElement({ kind, who: { name: who }, target: card.id, x: 0, y: 0 });

describe("the kanban is the template, in the prompt's language", () => {
  test('the same layout engine as the Kanban tile: three sections, the cards inside them', () => {
    expect(templateBoard('kanban')).not.toBeNull();
    const secs = plan.strokes.filter((s) => s.tool === 'section');
    expect(secs.map((s) => (s as { label: string }).label)).toEqual([
      'Nápady',
      'Rozpracované',
      'Hotovo',
    ]);
    expect(plan.strokes.filter((s) => s.tool === 'sticky')).toHaveLength(9);
    expect(Math.min(...secs.map((s) => (s as { x: number }).x))).toBe(96);
    expect(byText('Combine v číslech 2025')).toBeDefined();
  });
  test('colour-coded by channel: the colours the plan asked for are kept', () => {
    expect((byText('Plakát do škol v Brně a Blansku') as { color: string }).color).toBe(CORAL);
    expect((byText('Web: stránka STAŇ SE GATOREM') as { color: string }).color).toBe(GREEN);
  });
});

describe('the sections say how many they hold', () => {
  const els = strokesToElementMap(plan.strokes, new Map());
  const c = new Containment(els.values());
  const counts = plan.strokes
    .filter((s) => s.tool === 'section')
    .map((s) => membersOf(plan.strokes, s.id, (id) => c.contentsOf(id)).length);

  test('4 · 3 · 2', () => {
    expect(counts).toEqual([4, 3, 2]);
  });
  test('and the chip draws that number after the name', () => {
    const notes = new Map(
      plan.strokes.filter((s) => s.tool === 'section').map((s, i) => [s.id, String(counts[i])])
    );
    const items = plan.strokes.map((s) => strokeToRenderItem(s)).filter((i) => i !== null);
    const html = renderToStaticMarkup(
      createElement(AnnotationScene, {
        items: items as never,
        interactive: false,
        editingId: null,
        edit: null,
        pending: null,
        resolveAsset: (h: string) => h,
        foldNotes: notes,
      })
    );
    expect([...html.matchAll(/data-section-count="1"[^>]*>(\d)</g)].map((m) => m[1])).toEqual([
      '4',
      '3',
      '2',
    ]);
    expect(html).toContain('Rozpracované');
  });
});

describe('the quick votes are stamps on the cards', () => {
  const reel = byText('Reel: 40 yd sprint ve zpomaleném záběru');
  const poster = byText('Plakát do škol v Brně a Blansku');
  const post = byText('Post 1:1 — datum tučně');
  const numbers = byText('Combine v číslech 2025');
  const stamps = [
    stampOn(reel, 'yes', 'Tereza'),
    stampOn(reel, 'yes', 'Jonas'),
    stampOn(reel, 'star', 'Tereza'),
    stampOn(poster, 'ask', 'Petra'),
    stampOn(post, 'yes', 'Jonas'),
    stampOn(numbers, 'heart', 'Tereza'),
  ];

  test('each lands on its card, one per person per kind', () => {
    let strokes: Stroke[] = [...plan.strokes];
    for (const s of stamps) strokes = upsertStampStroke(strokes, s);
    strokes = upsertStampStroke(strokes, stampOn(reel, 'yes', 'Tereza')); // the same vote again: nothing new
    expect(strokes.filter((s) => s.tool === 'element')).toHaveLength(6);
    const els = [...strokesToElementMap(strokes, new Map()).values()];
    const cl = clusterStamps(els);
    expect(Object.fromEntries(cl.map((x) => [x.spot, x.count]))).toEqual({
      [reel.id]: 3,
      [poster.id]: 1,
      [post.id]: 1,
      [numbers.id]: 1,
    });
    expect(els.find((e) => e.type === 'stamp')?.id).toBe(
      stampId({ spot: reel.id, author: 'Tereza', kind: 'yes' })
    );
  });
});

describe('done cards point at the artboards they became', () => {
  const invite = byText('Pozvánka pro partnery');
  const numbers = byText('Combine v číslech 2025');
  const arrow = (card: Stroke, ab: string, label: string): ArrowStroke => ({
    id: `arr-${ab}`,
    tool: 'arrow',
    color: '#1f1f1f',
    width: 2,
    x1: 400,
    y1: 300,
    x2: 1000,
    y2: 200,
    startBind: { id: card.id } as never,
    endHost: { ref: `ab:${ab}`, label },
  });

  test('the arrow keeps its end on the artboard, by name, through the file and back', () => {
    const arrows = [
      arrow(invite, 'combine-invite', 'Combine-invite · partneři'),
      arrow(numbers, 'combine-cisla', 'Combine-cisla · 2025'),
    ];
    const els = strokesToElementMap([...plan.strokes, ...arrows], new Map());
    const ends = arrows.map((a) => (els.get(a.id) as AnnotationElement).endHost);
    expect(ends).toEqual([
      { ref: 'ab:combine-invite', label: 'Combine-invite · partneři' },
      { ref: 'ab:combine-cisla', label: 'Combine-cisla · 2025' },
    ]);
    const back = elementsToStrokes(els.values()).filter((s) => s.tool === 'arrow') as ArrowStroke[];
    expect(back.map((a) => a.endHost?.ref).sort()).toEqual([
      'ab:combine-cisla',
      'ab:combine-invite',
    ]);
  });
});
