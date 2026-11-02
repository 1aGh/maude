// S5.5b — a run's `objects` feed the 409 held-by-ai backstop: the elements an AI edit changed
// (edit/touched → `changedElements`) are AI's until the run ends; the rest stay the person's.

import { describe, expect, test } from 'bun:test';

import { changedElements, createAgentRuns } from '../agent-runs.ts';
import { createLocalLeaseHome } from '../ai/lease-home.ts';
import { createRunRegistry } from '../ai/runs.ts';
import { heldByAiRefusal } from '../routes/agent.ts';

const canvas = (
  title: string,
  lead = 'Sub'
) => `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
export default function C() {
  return (
    <DesignCanvas>
      <DCArtboard id="hero" width={800} height={600}>
        <section data-cd-id="intro">
          <h1 data-cd-id="title">${title}</h1>
          <p data-cd-id="lead">${lead}</p>
        </section>
      </DCArtboard>
    </DesignCanvas>
  );
}
`;

describe('changedElements', () => {
  test('names the innermost changed element, never its ancestors or untouched siblings', () => {
    expect(changedElements(canvas('Hi'), canvas('Hello'))).toEqual([
      { artboard: 'hero', element: 'title' },
    ]);
    expect(changedElements(canvas('Hi'), canvas('Hi'))).toEqual([]);
    expect(changedElements(null, canvas('Hi'))).toEqual([]);
    expect(changedElements('export default () => <p', canvas('Hi'))).toEqual([]);
  });
});

describe('a hook run holds the elements it changed', () => {
  test('touch with elements → 409 held-by-ai on them until the run ends', async () => {
    const reg = createRunRegistry({
      designRoot: null,
      designRel: '.design',
      home: createLocalLeaseHome({ actor: 'you' }),
      autoRenew: false,
    });
    const runs = createAgentRuns({}, undefined, reg);
    runs.begin({ session: 's1', actor: 'claude-code', label: 'x' });
    await new Promise((r) => setTimeout(r, 10));
    runs.touch('s1', 'ui/C.tsx', ['hero'], null, changedElements(canvas('Hi'), canvas('Hello')));
    expect(heldByAiRefusal(reg, '.design', 'ui/C.tsx', 'title')?.status).toBe(409);
    expect(heldByAiRefusal(reg, '.design', 'ui/C.tsx', 'lead')).toBeNull();
    // the same element touched again is held once
    runs.touch('s1', 'ui/C.tsx', ['hero'], null, [{ artboard: 'hero', element: 'title' }]);
    expect(reg.live()[0]?.objects).toHaveLength(1);
    runs.end('s1', 'done');
    expect(heldByAiRefusal(reg, '.design', 'ui/C.tsx', 'title')).toBeNull();
  });
});
