// P8 stage C round 10 (14 ed-lay-auto): the Layout card of an auto-layout frame says what it lays out —
// "3 cards, each Fills the width." The canvas reads the children's sizing into the selection payload (`kids`).
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

import { kidsLine, summarizeKids } from '../editing/kids-summary.ts';

const row = { display: 'flex', flexDirection: 'row' };
const kid = (o: Record<string, string> = {}) => ({
  tag: 'div',
  width: '',
  flexGrow: '',
  alignSelf: '',
  ...o,
});

describe('summarizeKids / kidsLine', () => {
  test('three cards that grow in a row each Fill the width', () => {
    const s = summarizeKids(row, [
      kid({ flexGrow: '1' }),
      kid({ flexGrow: '1' }),
      kid({ flexGrow: '1' }),
    ]);
    expect(s).toEqual({ count: 3, tag: 'div', width: 'fill' });
    expect(kidsLine(s)).toBe('3 frames, each Fills the width.');
  });
  test('Hug, Fixed and mixed read in the Size row’s words', () => {
    expect(kidsLine(summarizeKids(row, [kid(), kid()]))).toBe('2 frames, each Hugs its content.');
    expect(kidsLine(summarizeKids(row, [kid({ width: '120px' }), kid({ width: '80px' })]))).toBe(
      '2 frames, each a fixed width.'
    );
    expect(kidsLine(summarizeKids(row, [kid({ flexGrow: '1' }), kid({ width: '80px' })]))).toBe(
      '2 frames, widths differ.'
    );
  });
  test('mixed kinds are "items"; a button row is buttons', () => {
    expect(
      kidsLine(summarizeKids(row, [kid({ flexGrow: '1' }), kid({ tag: 'p', flexGrow: '1' })]))
    ).toBe('2 items, each Fills the width.');
    expect(kidsLine(summarizeKids(row, [kid({ tag: 'button' }), kid({ tag: 'button' })]))).toBe(
      '2 buttons, each Hugs its content.'
    );
  });
  test('a column fills the width by default (stretch), unless the frame centres', () => {
    const col = { display: 'flex', flexDirection: 'column' };
    expect(kidsLine(summarizeKids(col, [kid(), kid()]))).toBe('2 frames, each Fills the width.');
    expect(kidsLine(summarizeKids({ ...col, alignItems: 'center' }, [kid(), kid()]))).toBe(
      '2 frames, each Hugs its content.'
    );
  });
  test('not a flex frame, or one child: no sentence', () => {
    expect(summarizeKids({ display: 'block' }, [kid(), kid()])).toBeUndefined();
    expect(summarizeKids(row, [kid()])).toBeUndefined();
    expect(kidsLine(undefined)).toBe('');
  });
});

describe('the canvas reads the children into the selection', () => {
  beforeAll(() => GlobalRegistrator.register());
  afterAll(() => GlobalRegistrator.unregister());

  test('a flex frame of three growing children: kids = 3 frames that Fill', async () => {
    const { hoverTargetToSelection } = await import('../dom-selection.ts');
    document.body.innerHTML = `
      <article data-dc-screen="desktop"><div class="dc-artboard-body">
        <div data-cd-id="services" style="display:flex;gap:24px">
          <div data-cd-id="c1" style="flex:1">A</div><div data-cd-id="c2" style="flex:1">B</div><div data-cd-id="c3" style="flex:1">C</div>
        </div></div></article>`;
    const el = document.querySelector('[data-cd-id="services"]') as Element;
    const s = hoverTargetToSelection({
      el,
      cdId: 'services',
      artboardId: 'desktop',
    } as never) as unknown as { kids?: unknown };
    expect(s.kids).toEqual({ count: 3, tag: 'div', width: 'fill' });
  });
  test('an element that is not a flex frame carries no kids', async () => {
    const { hoverTargetToSelection } = await import('../dom-selection.ts');
    document.body.innerHTML = `<article data-dc-screen="d"><div class="dc-artboard-body"><div data-cd-id="b"><p>x</p><p>y</p></div></div></article>`;
    const el = document.querySelector('[data-cd-id="b"]') as Element;
    const s = hoverTargetToSelection({ el, cdId: 'b', artboardId: 'd' } as never) as unknown as {
      kids?: unknown;
    };
    expect(s.kids).toBeUndefined();
  });
});
