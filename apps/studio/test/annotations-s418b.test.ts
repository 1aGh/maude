// S4.18b - the S4.V fidelity findings, part 2:
//   1. Preview's Hand (`browse`) PICKS annotations (click, right-click menu, double-click, resize, connector
//      dots, select mode); Edit / Viewing / hidden do not; the Hand's drag on empty canvas stays a pan.
//   2. an-rebind: the "rewritten by AI" ring follows a rewrite that changes the words and keeps the box.
//   3. an-dangling: the card reads "Pointed at “X” — moved to the trash by <who>".
//   4. Contract S4-S5 §6.2: "Make these changes" takes the shell to Edit when the run starts.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AimRects } from '../annotations/ui/arrow-bind.ts';
import { danglingCard } from '../annotations/ui/arrow-cards.tsx';
import { hostSignature } from '../annotations/ui/host-view.ts';
import {
  type AnnotationPosture,
  annotationMarquees,
  annotationPicks,
} from '../annotations/ui/posture.ts';
import { acceptOffer } from '../client/v2/ai/OfferCard.jsx';

const LAYER = readFileSync(join(import.meta.dir, '../annotations-layer.tsx'), 'utf8');

describe('the Hand picks annotations in Preview', () => {
  test('move picks everywhere (Edit unchanged); browse picks only where the layer is editable', () => {
    const postures: AnnotationPosture[] = ['drawn', 'quiet', 'read-only', 'hidden'];
    for (const p of postures) expect(annotationPicks('move', p)).toBe(true);
    expect(annotationPicks('browse', 'drawn')).toBe(true);
    for (const p of ['quiet', 'read-only', 'hidden'] as const)
      expect(annotationPicks('browse', p)).toBe(false);
    for (const t of ['sticky', 'pen', 'arrow', 'text', 'rect', 'eraser'])
      expect(annotationPicks(t, 'drawn')).toBe(false);
  });

  test('only Move rubber-bands empty canvas; the Hand keeps its pan', () => {
    expect(annotationMarquees('move')).toBe(true);
    expect(annotationMarquees('browse')).toBe(false);
  });

  test('the layer asks the one predicate at every picking site (no bare tool test is left)', () => {
    expect(LAYER).not.toMatch(/tool\s*[!=]==\s*'move'/);
    expect((LAYER.match(/annotationPicks\(tool, posture\)/g) ?? []).length).toBeGreaterThanOrEqual(
      7
    );
    // empty-canvas drags are the pan's under the Hand
    expect(LAYER).toMatch(/annotationMarquees\(tool\)/);
  });
});

describe('an-rebind: the ring follows a rewrite that keeps the box', () => {
  const arrow = {
    tool: 'arrow',
    id: 'arw',
    endHost: { ref: 'el:desktop/book-a-call', label: 'Book a call' },
  };
  const rects = (text: string): AimRects => ({
    artboards: [{ id: 'desktop', x: 0, y: 0, w: 1440, h: 900 }],
    elements: [
      {
        cdId: 'book-a-call',
        artboard: 'desktop',
        x: 580,
        y: 690,
        w: 220,
        h: 64,
        tag: 'button',
        text,
      },
    ],
  });
  test('the poll signature changes when the words do', () => {
    const a = hostSignature([arrow as never], rects('Book a call'));
    const b = hostSignature([arrow as never], rects('See our work'));
    expect(a).not.toBe(b);
  });
});

describe('an-dangling: the chip names who moved it to the trash', () => {
  const rects = { artboards: [{ id: 'desktop', x: 0, y: 0, w: 1440, h: 900 }] };
  const end = {
    arrowId: 'arw',
    end: 'end' as const,
    ref: 'el:desktop/book-a-call',
    label: 'Book a call',
    at: [670, 744] as [number, number],
  };
  test('an element that left its artboard is "moved to the trash", with the name when it is known', () => {
    expect(danglingCard(end as never, rects).lead).toBe(
      'Pointed at “Book a call” — moved to the trash'
    );
    expect(danglingCard(end as never, rects, 'Jonas').lead).toBe(
      'Pointed at “Book a call” — moved to the trash by Jonas'
    );
  });
  test('an artboard in the trash keeps its words', () => {
    expect(danglingCard({ ...end, ref: 'el:mobile/x' } as never, rects).lead).toBe(
      'Pointed at “Book a call” — its artboard is in the trash'
    );
  });
});

describe('Make these changes goes straight to Edit (contract S4-S5 §6.2)', () => {
  const offer = { v: 1, says: 'x', answers: ['s_a1'], leaves: [], targets: [] };
  const ask = { file: 'ui/Home.tsx', ids: ['s_a1'], artboards: ['desktop'], kinds: { sticky: 1 } };
  test('a send that went out selects Edit once; a send that did not leaves the mode alone', () => {
    const picked: string[] = [];
    const sent: unknown[] = [];
    const mode = { select: (m: string) => picked.push(m) };
    expect(acceptOffer({ offer, ask, send: (a: unknown) => (sent.push(a), true), mode })).toBe(
      true
    );
    expect(picked).toEqual(['edit']);
    expect((sent[0] as { text: string }).text).toBe('Make these changes');
    expect(acceptOffer({ offer, ask, send: () => false, mode })).toBe(false);
    expect(picked).toEqual(['edit']);
  });
});
