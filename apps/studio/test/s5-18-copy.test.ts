// S5.18 G2 (03 `ai-copy`) — Run on a copy: the divider words, the copy's sidecar entry (so the scope chip shows a
// name) and its place (clear of other artboards, also when the canvas has explicit layout.artboards[]).
// Red first: no divider words existed, the copy had no sidecar entry, and with explicit positions it fell on the
// default-grid cell of its JSX index — on top of the next artboard.
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { artboardRects, copyLabelOf, metaWithCopy, placeCopy } from '../ai/copy-meta.ts';
import { createLocalLeaseHome } from '../ai/lease-home.ts';
import { createRunRegistry } from '../ai/runs.ts';
import { copyDividerText } from '../client/v2/ai/run-model.js';
import { createAiRoutes } from '../routes/ai.ts';
import { matchRoute } from '../routes/table.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

// A canvas AFTER the copy landed: P, its copy, then S and T. Explicit positions for P, S, T only.
const SOURCE = `<DesignCanvas>
  <DCArtboard id="P" label="Post 1:1" width={260} height={260}><b>p</b></DCArtboard>
  <DCArtboard id="P-copy-abc123" label="Post 1:1 · copy" width={260} height={260}><b>p</b></DCArtboard>
  <DCArtboard id="S" label="Story" width={260} height={460}><b>s</b></DCArtboard>
  <DCArtboard id="T" label="Teaser" width={260} height={260}><b>t</b></DCArtboard>
</DesignCanvas>`;
const LAYOUT = [
  { id: 'P', x: 0, y: 0 },
  { id: 'S', x: 340, y: 0 }, // directly to the right of P: the copy's default-grid cell would be here or nearby
  { id: 'T', x: 680, y: 0 },
];

describe('the divider words (03: "Ran on a copy — Post 1:1 was busy")', () => {
  test('a copy run names the artboard that was busy; any other run has no divider', () => {
    expect(copyDividerText({ copyOf: { canvas: 'c', artboard: 'P' } }, { name: 'Post 1:1' })).toBe(
      'Ran on a copy — Post 1:1 was busy'
    );
    expect(copyDividerText({ copyOf: { canvas: 'c', artboard: 'post-1-1' } })).toBe(
      'Ran on a copy — Post 1 1 was busy'
    );
    expect(copyDividerText({})).toBeNull();
    expect(copyDividerText(null)).toBeNull();
  });
});

describe('metaWithCopy — the name', () => {
  test('a sections[].artboards list gets the copy right after the original (no note); idempotent', () => {
    const meta = {
      sections: [
        {
          id: 's',
          artboards: [
            { id: 'P', label: 'Post 1:1', width: 260, note: 'the hero' },
            { id: 'S', label: 'Story' },
          ],
        },
      ],
    };
    const next = metaWithCopy(meta, {
      source: SOURCE,
      artboardId: 'P',
      copyId: 'P-copy-abc123',
      label: 'Post 1:1 · copy',
    });
    expect(next?.sections).toEqual([
      {
        id: 's',
        artboards: [
          { id: 'P', label: 'Post 1:1', width: 260, note: 'the hero' },
          { id: 'P-copy-abc123', label: 'Post 1:1 · copy', width: 260 },
          { id: 'S', label: 'Story' },
        ],
      },
    ]);
    expect(
      metaWithCopy(next as Record<string, unknown>, {
        source: SOURCE,
        artboardId: 'P',
        copyId: 'P-copy-abc123',
        label: 'Post 1:1 · copy',
      })
    ).toBeNull();
  });

  test('a top-level artboards[] list works the same; a sidecar that lists nothing for the original adds nothing', () => {
    const top = metaWithCopy(
      { artboards: [{ id: 'P', label: 'Post 1:1' }] },
      { source: SOURCE, artboardId: 'P', copyId: 'P-copy-abc123', label: 'Post 1:1 · copy' }
    );
    expect(top?.artboards).toEqual([
      { id: 'P', label: 'Post 1:1' },
      { id: 'P-copy-abc123', label: 'Post 1:1 · copy' },
    ]);
    expect(
      metaWithCopy(
        { title: 'x' },
        { source: SOURCE, artboardId: 'P', copyId: 'P-copy-abc123', label: 'l' }
      )
    ).toBeNull();
  });

  test('the copy’s label is read from its own <DCArtboard>', () => {
    expect(copyLabelOf(SOURCE, 'P-copy-abc123')).toBe('Post 1:1 · copy');
    expect(copyLabelOf(SOURCE, 'nope')).toBeNull();
  });
});

describe('metaWithCopy — the place', () => {
  test('with explicit layout.artboards[] the copy gets a position clear of every other artboard', () => {
    const next = metaWithCopy(
      { layout: { artboards: LAYOUT } },
      { source: SOURCE, artboardId: 'P', copyId: 'P-copy-abc123', label: 'l' }
    );
    const layout = next?.layout as { artboards: Array<{ id: string; x: number; y: number }> };
    const placed = layout.artboards;
    const me = placed.find((e) => e.id === 'P-copy-abc123');
    expect(me).toBeDefined();
    const rects = artboardRects(SOURCE, placed);
    const copy = rects.find((r) => r.id === 'P-copy-abc123');
    if (!copy) throw new Error('no copy rect');
    for (const o of rects.filter((r) => r.id !== copy.id)) {
      const apart =
        copy.x + copy.w <= o.x ||
        o.x + o.w <= copy.x ||
        copy.y + copy.h <= o.y ||
        o.y + o.h <= copy.y;
      expect(apart).toBe(true);
    }
    // 03: "lands right beside the original" (S5.19: the neighbour on the right moves over, the copy does not go below)
    expect(me?.x).toBe(340);
    expect(me?.y).toBe(0);
  });

  test('no explicit positions: nothing is written for the place (the default grid already seats it beside)', () => {
    const next = metaWithCopy(
      { artboards: [{ id: 'P', label: 'Post 1:1' }] },
      { source: SOURCE, artboardId: 'P', copyId: 'P-copy-abc123', label: 'l' }
    );
    expect(next?.layout).toBeUndefined();
  });

  test('placeCopy prefers right of the original when that is clear', () => {
    const rects = [
      { id: 'P', x: 0, y: 0, w: 260, h: 260 },
      { id: 'c', x: 9999, y: 9999, w: 260, h: 260 },
      { id: 'T', x: 1000, y: 0, w: 260, h: 260 },
    ];
    expect(placeCopy(rects, 'c', 'P')).toEqual({ x: 340, y: 0 });
  });
});

describe('the route writes the sidecar entries through the layout-write door', () => {
  test('POST …/copy → meta.write(file, text with the copy’s entry + place, the replaced text)', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 's518-copy-'));
    dirs.push(root);
    mkdirSync(path.join(root, '.design', 'ui'), { recursive: true });
    const accepted = `<DesignCanvas>
  <DCArtboard id="P" label="Post 1:1" width={260} height={260}><b>p</b></DCArtboard>
  <DCArtboard id="S" label="Story" width={260} height={460}><b>s</b></DCArtboard>
</DesignCanvas>
`;
    writeFileSync(path.join(root, '.design', 'ui', 'C.tsx'), accepted);
    const metaText = `${JSON.stringify({
      sections: [
        {
          id: 's',
          artboards: [
            { id: 'P', label: 'Post 1:1' },
            { id: 'S', label: 'Story' },
          ],
        },
      ],
      layout: {
        artboards: [
          { id: 'P', x: 0, y: 0 },
          { id: 'S', x: 340, y: 0 },
        ],
      },
    })}\n`;
    writeFileSync(path.join(root, '.design', 'ui', 'C.meta.json'), metaText);

    const reg = createRunRegistry({
      designRoot: null,
      home: createLocalLeaseHome({ actor: 'you' }),
      autoRenew: false,
      turns: { send: () => undefined },
    });
    const writes: Array<{ file: string; text: string; base: string | null }> = [];
    const specs = createAiRoutes({
      registry: reg,
      repoRoot: root,
      designRel: '.design',
      meta: {
        write: async (file, text, base) => {
          writes.push({ file, text, base });
          return true;
        },
      },
    });
    const ask = (chatId: string) =>
      reg.ask({
        chatId,
        origin: 'maude-chat',
        label: chatId,
        prompt: chatId,
        scope: { canvas: 'ui/C.tsx', artboards: ['P'] },
      });
    const busy = await ask('c1');
    await reg.started(busy.runId);
    const w = await ask('c2');
    const url = `/_api/ai/runs/${w.runId}/copy`;
    const m = matchRoute(specs, 'POST', url);
    if (!m) throw new Error('no route');
    const res = await m.spec.handle(
      new Request(`http://localhost${url}`, { method: 'POST' }),
      m.params
    );
    expect(res.status).toBe(200);
    const copyId = ((await res.json()) as { copy: { artboard: string } }).copy.artboard;

    expect(writes).toHaveLength(1);
    expect(writes[0].file).toBe('.design/ui/C.tsx');
    expect(writes[0].base).toBe(metaText);
    const next = JSON.parse(writes[0].text) as {
      sections: Array<{ artboards: Array<{ id: string; label: string }> }>;
      layout: { artboards: Array<{ id: string; x: number; y: number }> };
    };
    expect(next.sections[0].artboards.map((a) => a.id)).toEqual(['P', copyId, 'S']);
    expect(next.sections[0].artboards[1].label).toBe('Post 1:1 · copy');
    const at = next.layout.artboards.find((a) => a.id === copyId);
    expect(at).toBeDefined();
    // S5.19: beside P at (340, 0); S moved over to make room
    expect(at?.x).toBe(340);
    expect(at?.y).toBe(0);
  });
});
