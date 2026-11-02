// P8 bug sweep B1 — rows that sat live in the File menu of an empty window and did nothing useful:
// "Close canvas" had no canvas to close; "Handoff to production" opened a sheet about “this canvas” and asked
// the server for the targets of no design system (a 400).
import { describe, expect, test } from 'bun:test';

import { buildProjectMenu, menuCtx } from '../client/v2/shell/project-menu-model.js';

type Node = {
  type: string;
  id?: string;
  enabled?: boolean;
  disabled?: boolean;
  children?: Node[];
};

function find(nodes: Node[], id: string): Node | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const inner = n.children ? find(n.children, id) : null;
    if (inner) return inner;
  }
  return null;
}
const on = (n: Node | null) => !!n && n.enabled !== false && n.disabled !== true;

describe('P8 B1 — canvas rows follow the open canvas', () => {
  test('no canvas open: Close canvas and Handoff to production are off', () => {
    const model = buildProjectMenu(menuCtx({ native: true, canvasOpen: false })) as Node[];
    expect(on(find(model, 'canvas.close'))).toBe(false);
    expect(on(find(model, 'handoff.open'))).toBe(false);
    // not a regression: Export… keeps working with nothing open (Whole project)
    expect(on(find(model, 'export.open'))).toBe(true);
  });

  test('a canvas open: both are live for an owner', () => {
    const model = buildProjectMenu(menuCtx({ native: true, canvasOpen: true })) as Node[];
    expect(on(find(model, 'canvas.close'))).toBe(true);
    expect(on(find(model, 'handoff.open'))).toBe(true);
  });
});
