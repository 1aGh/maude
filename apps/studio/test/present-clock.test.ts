// S3.6b — the presenter view's clock words (client/v2/present/presenter-model.js): elapsed since Present
// started ("12:48") and the wall time ("14:05"). Pure.
import { describe, expect, test } from 'bun:test';
import { elapsedText, wallText } from '../client/v2/present/presenter-model.js';

describe('elapsedText', () => {
  test('minutes and seconds, seconds always two digits', () => {
    expect(elapsedText(0)).toBe('0:00');
    expect(elapsedText(7_000)).toBe('0:07');
    expect(elapsedText(768_000)).toBe('12:48');
    expect(elapsedText(59_999)).toBe('0:59');
  });
  test('past an hour it grows an hour', () => {
    expect(elapsedText(3_600_000)).toBe('1:00:00');
    expect(elapsedText(3_723_000)).toBe('1:02:03');
  });
  test('bad numbers never print NaN', () => {
    expect(elapsedText(-5)).toBe('0:00');
    expect(elapsedText(Number.NaN)).toBe('0:00');
    expect(elapsedText(Number.POSITIVE_INFINITY)).toBe('0:00');
    expect(elapsedText(undefined)).toBe('0:00');
  });
});

describe('wallText', () => {
  test('24-hour HH:MM from the date it is given', () => {
    expect(wallText(new Date(2026, 9, 18, 14, 5))).toBe('14:05');
    expect(wallText(new Date(2026, 9, 18, 9, 3))).toBe('09:03');
    expect(wallText(new Date(2026, 9, 18, 0, 0))).toBe('00:00');
  });
  test('an invalid date prints nothing', () => {
    expect(wallText(new Date('nope'))).toBe('');
    expect(wallText(null)).toBe('');
  });
});
