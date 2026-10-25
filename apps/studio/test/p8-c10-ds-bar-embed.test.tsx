// P8-C10 misc — the reach view frames the Design system canvas with `?embed=1`; the canvas's own island
// (name · Light | Dark · "1 change waiting" · Review…) must not be drawn inside that frame (the board's
// Patterns frame is the canvas content alone — a second Review… next to the review sheet is a duplicate).
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  if (typeof document === 'undefined') GlobalRegistrator.register();
});
afterAll(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

import { renderToStaticMarkup } from 'react-dom/server';
import { DsBar } from '../ds/board/index.tsx';
import { __registerBoardModel, __resetBoardState } from '../ds/board/state.ts';
import type { BoardModel } from '../ds/board/types.ts';
import { _resetReadOnlyCache } from '../read-only-mode.ts';

const model = {
  label: 'Studio site system',
  library: null,
  pendingCount: 1,
  tokens: [{ section: 'colour' }],
  themes: { all: ['light', 'dark'], default: 'light', light: 'light', dark: 'dark' },
} as unknown as BoardModel;

function setPageUrl(url: string): void {
  (window as unknown as { happyDOM?: { setURL?: (u: string) => void } }).happyDOM?.setURL?.(url);
  _resetReadOnlyCache();
}

afterEach(() => {
  setPageUrl('http://localhost/');
  __resetBoardState();
});

describe('the Design system bar inside the reach view embed', () => {
  test('the canvas on its own draws the bar', () => {
    setPageUrl('http://localhost/?x=1');
    __registerBoardModel(model);
    const out = renderToStaticMarkup(<DsBar portal={false} />);
    expect(out).toContain('data-testid="ds-bar"');
    expect(out).toContain('Review…');
  });

  test('an embed (?embed=1) draws no bar', () => {
    setPageUrl('http://localhost/?embed=1&dsPreview=studio@pending');
    __registerBoardModel(model);
    expect(renderToStaticMarkup(<DsBar portal={false} />)).toBe('');
  });
});
