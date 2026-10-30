// P8 stage C round 8 (14 ed-lay-free): the free-placement card says what a free frame is and what the pins keep.
import { describe, expect, test } from 'bun:test';

import { freeLine } from '../client/v2/inspector/sections/position.jsx';

const pins = (o: Partial<Record<'left' | 'right' | 'top' | 'bottom', boolean>>) => ({
  left: false,
  right: false,
  top: false,
  bottom: false,
  ...o,
});

describe('14 ed-lay-free: the free-placement line', () => {
  test('Right + Top at the same distance reads as a corner', () => {
    expect(
      freeLine('Post', 'Datum', pins({ right: true, top: true }), { right: '64px', top: '64px' })
    ).toBe(
      'Post places things freely — no auto layout. Constraints keep Datum 64 from the top-right corner.'
    );
  });
  test('two different distances are both said', () => {
    expect(
      freeLine('Post', 'Datum', pins({ left: true, bottom: true }), {
        left: '40px',
        bottom: '24px',
      })
    ).toBe(
      'Post places things freely — no auto layout. Constraints keep Datum 40 from the left and 24 from the bottom.'
    );
  });
  test('no distance to say (a centred or two-sided pin) leaves the first sentence alone; no frame, no line', () => {
    expect(
      freeLine('Post', 'Datum', pins({ left: true, right: true, top: true }), { top: '8px' })
    ).toBe('Post places things freely — no auto layout.');
    expect(
      freeLine(null, 'Datum', pins({ right: true, top: true }), { right: '64px', top: '64px' })
    ).toBe('');
  });
});
