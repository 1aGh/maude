// An annotation edit names the text it was made on (annotation-edit-base.ts).
//
// Oracle: the hub's own lane merge. A stored arrow that is not in this
// client's canonical form (an older serializer, another writer, a hand edit)
// used to make every edit to it a "conflict" — the client named its canonical
// re-serialization as the base, so the element looked changed on both sides
// and the edit was silently reverted (surface run L09.arrow-head.*).

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

import { mergeLane } from '../../hub/src/project-transactions/lanes.mjs';
import { annotationEditBase, receivedAnnotations } from '../annotation-edit-base.ts';
import { strokesToSvg, svgToStrokes } from '../annotations-model.ts';

beforeAll(() => GlobalRegistrator.register());
afterAll(() => GlobalRegistrator.unregister());

// Rounded arrowhead points: valid, renders, not what this client would write.
const stored =
  '<svg xmlns="http://www.w3.org/2000/svg" data-mdcc-annotations="1">' +
  '<rect data-id="s_keep" data-tool="rect" stroke="#1f1f1f" stroke-width="3" fill="#e7e7e7" x="40" y="120" width="100" height="70"/>' +
  '<g data-id="s_arrow" data-tool="arrow" stroke="#1f1f1f" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" fill="none"><line x1="200" y1="130" x2="320" y2="190"/><polyline points="302.3,186.8 320,190 311.5,174.1" fill="#1f1f1f"/></g>' +
  '</svg>';

describe('the base an annotation edit names', () => {
  test('an edit on exactly what the project delivered names that text, and the project accepts it', () => {
    const loaded = svgToStrokes(stored);
    expect(loaded.map((s) => s.id)).toEqual(['s_keep', 's_arrow']);
    const received = receivedAnnotations(stored, loaded);
    const next = loaded.map((s) => (s.id === 's_arrow' ? { ...s, endHead: 'circle' as const } : s));
    const ours = strokesToSvg(next);

    const base = annotationEditBase(loaded, received);
    expect(base).toBe(stored);
    const merged = mergeLane('annotations', base, ours, stored);
    expect(merged.ok).toBe(true);
    expect(svgToStrokes(merged.content).find((s) => s.id === 's_arrow')?.endHead).toBe('circle');

    // What the client used to send: its own canonical form of the same state.
    // The project could not tell that from a teammate's change — refused.
    expect(mergeLane('annotations', strokesToSvg(loaded), ours, stored).ok).toBe(false);
  });

  test("an edit stacked on this client's own unanswered edit names its canonical output", () => {
    const loaded = svgToStrokes(stored);
    const received = receivedAnnotations(stored, loaded);
    const first = loaded.map((s) =>
      s.id === 's_arrow' ? { ...s, endHead: 'circle' as const } : s
    );
    expect(annotationEditBase(first, received)).toBe(strokesToSvg(first));
    expect(annotationEditBase(first, null)).toBe(strokesToSvg(first));
  });
});
