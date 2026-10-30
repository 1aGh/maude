// S10.18c (13 · ds-many-linked): a linked team library is view only on the Design system canvas — the board model
// says where it is linked from, the bar says "Linked library — view only" and offers no Review…. A system of
// this project's own keeps its bar. Fake hub only.
import { afterAll, describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildBoardModel } from '../ds/board/build-model.ts';
import { DsBarView } from '../ds/board/ds-bar.tsx';
import { cleanup } from './_ds-engine-fixture.ts';
import { LIB, linked } from './_ds-library-hub.ts';

afterAll(cleanup);

describe('the board of a linked library', () => {
  test('the model carries the library (home = the hub host); an own system carries none', async () => {
    const L = await linked();
    const sys = L.p.engine.systems().find((s) => s.name === LIB);
    expect(sys).toBeTruthy();
    const m = buildBoardModel(L.p.designRoot, sys as NonNullable<typeof sys>);
    expect(m.library).toEqual({ home: 'alligators.cloud.test' });
    const own = L.p.engine.systems().find((s) => s.name !== LIB);
    expect(own).toBeTruthy();
    expect(buildBoardModel(L.p.designRoot, own as NonNullable<typeof own>).library).toBeNull();
  });

  test('the bar says view only and hides Review… even with a review door and waiting edits', async () => {
    const L = await linked();
    const sys = L.p.engine.systems().find((s) => s.name === LIB) as NonNullable<
      ReturnType<typeof L.p.engine.systems>[number]
    >;
    const m = { ...buildBoardModel(L.p.designRoot, sys), pendingCount: 2 };
    const out = renderToStaticMarkup(
      <DsBarView model={m} mode="light" onMode={() => {}} onReview={() => {}} />
    );
    expect(out).toContain('data-testid="ds-bar-library"');
    expect(out).toContain('Linked library — view only');
    expect(out).not.toContain('ds-bar-review');
    expect(out).not.toContain('Review…');
    expect(out).not.toContain('ds-bar-pending');
    // the same bar for a system of this project's own keeps Review…
    const own = renderToStaticMarkup(
      <DsBarView
        model={{ ...m, library: null }}
        mode="light"
        onMode={() => {}}
        onReview={() => {}}
      />
    );
    expect(own).toContain('ds-bar-review');
    expect(own).not.toContain('Linked library');
  });
});
