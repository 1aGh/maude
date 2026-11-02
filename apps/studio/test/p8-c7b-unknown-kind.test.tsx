// p8 c7b (06 ad-pinned / ad-inspector) — a canvas that carries a kind the four kinds do not know (an old
// `kind="social"`) must resolve like one with no kind: digital (or video when it holds a VideoComp). The
// inspector's per-kind rows match on the four kinds; an unknown value drew an artboard inspector with a "Size"
// heading and nothing under it.

import { describe, expect, test } from 'bun:test';

import { renderToStaticMarkup } from 'react-dom/server';

import { DCArtboard } from '../canvas-lib.tsx';

function FakeVideoComp() {
  return null;
}
FakeVideoComp.displayName = 'VideoComp';

describe('DCArtboard — a kind outside digital · web · print · video', () => {
  test('kind="social" resolves to digital', () => {
    const html = renderToStaticMarkup(
      <DCArtboard id="a" label="A" width={100} height={100} kind={'social' as never}>
        hi
      </DCArtboard>
    );
    expect(html).toContain('data-dc-kind="digital"');
    expect(html).not.toContain('data-dc-kind="social"');
  });

  test('an unknown kind over a VideoComp subtree still falls back to video', () => {
    const html = renderToStaticMarkup(
      <DCArtboard id="a" label="A" width={100} height={100} kind={'social' as never}>
        <FakeVideoComp />
      </DCArtboard>
    );
    expect(html).toContain('data-dc-kind="video"');
  });
});
