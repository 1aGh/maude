// #155 §6 — component instances render their component.
//
// A `.fig` INSTANCE has no children of its own: it points at a SYMBOL
// (`symbolData.symbolID`) and the symbol's children are what it draws. Every
// instance used to import as an empty box.

import { describe, expect, test } from 'bun:test';
import { decodeFigArchive, rebuildTree } from './fig-decode.ts';
import { MAX_NODE_COUNT, type FigmaNode, walkNodes } from './types.ts';

const FIXTURES = new URL('../../../.ai/fixtures/figma/2026-08-03/', import.meta.url).pathname;

const g = (s: number, l: number) => ({ sessionID: s, localID: l });
const at = (x: number, y: number) => ({ m00: 1, m01: 0, m02: x, m10: 0, m11: 1, m12: y });

type Change = Record<string, unknown>;
function node(
  id: [number, number],
  type: string,
  parent: [number, number] | null,
  position: string,
  extra: Change = {}
): Change {
  return {
    guid: g(...id),
    type,
    name: `${type} ${id[0]}:${id[1]}`,
    size: { x: 100, y: 20 },
    transform: at(0, 0),
    ...(parent ? { parentIndex: { guid: g(...parent), position } } : {}),
    ...extra,
  };
}
const root = (): Change[] => [
  node([0, 0], 'DOCUMENT', null, ''),
  node([0, 1], 'CANVAS', [0, 0], 'a'),
];
const find = (tree: Record<string, unknown>, id: string): FigmaNode | undefined => {
  let hit: FigmaNode | undefined;
  walkNodes(tree as unknown as FigmaNode, (n) => {
    if (n.id === id) hit = n;
  });
  return hit;
};
const countNodes = (tree: Record<string, unknown>) => {
  let n = 0;
  walkNodes(tree as unknown as FigmaNode, () => {
    n++;
  });
  return n;
};
const instanceOf = (symbol: [number, number], extra: Change = {}) => ({
  symbolData: { symbolID: g(...symbol), symbolOverrides: [] },
  ...extra,
});

describe('#155 §6 — an instance carries its component’s children', () => {
  test('the fixture’s Button/Primary instances are no longer empty', async () => {
    const bytes = new Uint8Array(await Bun.file(`${FIXTURES}design.fig`).arrayBuffer());
    const { document, report } = decodeFigArchive(bytes, { fileKey: 'figTESTKEY0123456789' });
    const found: FigmaNode[] = [];
    walkNodes(document.root, (n) => {
      if (n.type === 'INSTANCE') found.push(n);
    });
    expect(found.length).toBeGreaterThanOrEqual(2);
    for (const inst of found) {
      expect(inst.children?.length).toBeGreaterThan(0);
      const label = inst.children?.find((c) => c.type === 'TEXT');
      expect(label?.characters).toBe('Odeslat');
      // positioned inside the instance, not at the page origin
      const box = label?.absoluteBoundingBox;
      const outer = inst.absoluteBoundingBox;
      expect(box && outer && box.x >= outer.x && box.y >= outer.y).toBe(true);
    }
    expect(report.instances.expanded).toBeGreaterThanOrEqual(2);
    expect(report.instances.cycle + report.instances.budget + report.instances.missing).toBe(0);
  });

  test('expanded ids are distinct and carry the instance path', () => {
    const changes = [
      ...root(),
      node([1, 1], 'SYMBOL', [0, 1], 'a'),
      node([1, 2], 'TEXT', [1, 1], 'a', { textData: { characters: 'Label' } }),
      node([2, 1], 'INSTANCE', [0, 1], 'b', instanceOf([1, 1], { transform: at(40, 50) })),
      node([2, 2], 'INSTANCE', [0, 1], 'c', instanceOf([1, 1], { transform: at(40, 90) })),
    ];
    const { root: tree, instances } = rebuildTree(changes, []);
    expect(find(tree, 'I2:1;1:2')?.characters).toBe('Label');
    expect(find(tree, 'I2:2;1:2')?.characters).toBe('Label');
    expect(find(tree, 'I2:1;1:2')?.absoluteBoundingBox).toMatchObject({ x: 40, y: 50 });
    expect(instances.expanded).toBe(2);
  });

  test('a text override on the instance replaces the component’s text', () => {
    const changes = [
      ...root(),
      node([1, 1], 'SYMBOL', [0, 1], 'a'),
      node([1, 2], 'TEXT', [1, 1], 'a', { textData: { characters: 'Label' } }),
      node([2, 1], 'INSTANCE', [0, 1], 'b', {
        symbolData: {
          symbolID: g(1, 1),
          symbolOverrides: [{ guidPath: { guids: [g(1, 2)] }, textData: { characters: 'Zrušit' } }],
        },
      }),
    ];
    const { root: tree } = rebuildTree(changes, []);
    expect(find(tree, 'I2:1;1:2')?.characters).toBe('Zrušit');
  });

  test('an override may hide a child, but cannot choose which fields it touches', () => {
    const changes = [
      ...root(),
      node([1, 1], 'SYMBOL', [0, 1], 'a'),
      node([1, 2], 'RECTANGLE', [1, 1], 'a'),
      node([2, 1], 'INSTANCE', [0, 1], 'b', {
        symbolData: {
          symbolID: g(1, 1),
          symbolOverrides: [
            { guidPath: { guids: [g(1, 2)] }, visible: false, type: 'TEXT', guid: g(9, 9) },
          ],
        },
      }),
    ];
    const { root: tree } = rebuildTree(changes, []);
    const child = find(tree, 'I2:1;1:2');
    expect(child?.visible).toBe(false);
    expect(child?.type).toBe('RECTANGLE');
  });

  test('an instance that already has children keeps them', () => {
    const changes = [
      ...root(),
      node([1, 1], 'SYMBOL', [0, 1], 'a'),
      node([1, 2], 'TEXT', [1, 1], 'a', { textData: { characters: 'FromSymbol' } }),
      node([2, 1], 'INSTANCE', [0, 1], 'b', instanceOf([1, 1])),
      node([2, 2], 'TEXT', [2, 1], 'a', { textData: { characters: 'Own' } }),
    ];
    const { root: tree, instances } = rebuildTree(changes, []);
    expect(find(tree, '2:2')?.characters).toBe('Own');
    expect(find(tree, 'I2:1;1:2')).toBeUndefined();
    expect(instances.expanded).toBe(0);
  });

  test('an instance resized away from its component is counted', () => {
    const changes = [
      ...root(),
      node([1, 1], 'SYMBOL', [0, 1], 'a', { size: { x: 100, y: 20 } }),
      node([1, 2], 'RECTANGLE', [1, 1], 'a'),
      node([2, 1], 'INSTANCE', [0, 1], 'b', instanceOf([1, 1], { size: { x: 240, y: 20 } })),
      node([2, 2], 'INSTANCE', [0, 1], 'c', instanceOf([1, 1])),
    ];
    const { instances } = rebuildTree(changes, []);
    expect(instances.expanded).toBe(2);
    expect(instances.resized).toBe(1);
  });

  test('an instance of a missing component is counted, not fatal', () => {
    const changes = [...root(), node([2, 1], 'INSTANCE', [0, 1], 'b', instanceOf([7, 7]))];
    const { instances } = rebuildTree(changes, []);
    expect(instances.missing).toBe(1);
  });
});

describe('#155 §6 — cycle guard', () => {
  test('a component that contains an instance of itself terminates', () => {
    const changes = [
      ...root(),
      node([1, 1], 'SYMBOL', [0, 1], 'a'),
      node([1, 2], 'TEXT', [1, 1], 'a', { textData: { characters: 'Loop' } }),
      node([1, 3], 'INSTANCE', [1, 1], 'b', instanceOf([1, 1])),
      node([2, 1], 'INSTANCE', [0, 1], 'b', instanceOf([1, 1])),
    ];
    const { root: tree, instances } = rebuildTree(changes, []);
    expect(instances.cycle).toBeGreaterThan(0);
    expect(find(tree, 'I2:1;1:2')?.characters).toBe('Loop');
    expect(countNodes(tree)).toBeLessThan(20);
  });

  test('A contains B and B contains A terminates', () => {
    const changes = [
      ...root(),
      node([1, 1], 'SYMBOL', [0, 1], 'a'),
      node([1, 2], 'INSTANCE', [1, 1], 'a', instanceOf([3, 1])),
      node([3, 1], 'SYMBOL', [0, 1], 'b'),
      node([3, 2], 'INSTANCE', [3, 1], 'a', instanceOf([1, 1])),
      node([4, 1], 'INSTANCE', [0, 1], 'c', instanceOf([1, 1])),
    ];
    const { instances, nodeCount } = rebuildTree(changes, []);
    expect(instances.cycle).toBeGreaterThan(0);
    expect(nodeCount).toBeLessThan(40);
  });

  test('the same component twice side by side is not a cycle', () => {
    const changes = [
      ...root(),
      node([1, 1], 'SYMBOL', [0, 1], 'a'),
      node([1, 2], 'RECTANGLE', [1, 1], 'a'),
      node([2, 1], 'SYMBOL', [0, 1], 'b'),
      node([2, 2], 'INSTANCE', [2, 1], 'a', instanceOf([1, 1])),
      node([2, 3], 'INSTANCE', [2, 1], 'b', instanceOf([1, 1])),
      node([3, 1], 'INSTANCE', [0, 1], 'c', instanceOf([2, 1])),
    ];
    const { instances } = rebuildTree(changes, []);
    expect(instances.cycle).toBe(0);
  });
});

describe('#155 §6 — node budget', () => {
  test('many instances of a big component stop at the node cap instead of failing the file', () => {
    // 60 children per component x 600 instances = 36 000 expanded nodes.
    const changes: Change[] = [...root(), node([1, 1], 'SYMBOL', [0, 1], 'a')];
    for (let i = 0; i < 60; i++) {
      changes.push(node([1, 10 + i], 'RECTANGLE', [1, 1], String.fromCharCode(97 + (i % 26)) + i));
    }
    for (let i = 0; i < 600; i++) {
      changes.push(
        node([2, 1 + i], 'INSTANCE', [0, 1], `i${String(i).padStart(4, '0')}`, instanceOf([1, 1]))
      );
    }
    const { root: tree, instances, nodeCount } = rebuildTree(changes, []);
    expect(nodeCount).toBeLessThanOrEqual(MAX_NODE_COUNT);
    expect(countNodes(tree)).toBeLessThanOrEqual(MAX_NODE_COUNT);
    expect(instances.expanded).toBeGreaterThan(0);
    expect(instances.budget).toBeGreaterThan(0);
    expect(instances.expanded + instances.budget).toBe(600);
  });
});
