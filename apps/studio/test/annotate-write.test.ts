// annotate-write — FigJam v3 AI write verb (`maude design annotate`).
// Drives bin/annotate.mjs as a subprocess against a temp design root and
// asserts the output through the CANONICAL parser: everything the verb writes
// must be sanitize-stable, byte-identical under parse → re-serialize, and
// readable back as a graph by read-annotations --graph.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { readBoardFile } from '../annotations/v1-bridge-io.ts';

import {
  type ArrowStroke,
  type EllipseStroke,
  type SectionStroke,
  type StickyStroke,
  type Stroke,
  sanitizeAnnotationSvg,
  strokesToSvg,
  svgToStrokes,
  type TextStroke,
} from '../annotations-model.ts';

const BIN = new URL('../bin/annotate.mjs', import.meta.url).pathname;
const READER = new URL('../bin/read-annotations.mjs', import.meta.url).pathname;

let root: string;

beforeAll(() => {
  GlobalRegistrator.register();
  root = mkdtempSync(join(tmpdir(), 'annotate-test-'));
  // A design root with no config — resolveDesignRoot defaults to .design.
  writeFileSync(
    join(root, 'flow.json'),
    JSON.stringify({
      nodes: [
        { id: 'a', label: 'Start' },
        { id: 'b', label: 'Middle' },
        { id: 'c', label: 'End', shape: 'ellipse' },
      ],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c', label: 'ships' },
      ],
    })
  );
  Bun.spawnSync(['mkdir', '-p', join(root, '.design')]);
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
  rmSync(root, { recursive: true, force: true });
});

function runAnnotate(args: string[], stdin?: string): { code: number; out: string; err: string } {
  const proc = Bun.spawnSync(['bun', BIN, ...args], {
    stdin: stdin ? new TextEncoder().encode(stdin) : undefined,
  });
  return {
    code: proc.exitCode,
    out: new TextDecoder().decode(proc.stdout),
    err: new TextDecoder().decode(proc.stderr),
  };
}

/**
 * DDR-242 — the verb writes the v2 board (`<slug>.annotations.json`), never a
 * `.annotations.svg`. Render it back to the v1 SVG these assertions parse (the
 * same bridge the verb itself reads through until Task 27).
 */
function boardSvg(slug: string): string {
  const json = join(root, '.design', `${slug}.annotations.json`);
  if (!existsSync(json)) return `<!-- no board written at ${json} -->`;
  return readBoardFile(join(root, '.design'), slug).svg;
}

function readSvg(): string {
  return boardSvg('ui-flow');
}

describe('annotate --flow', () => {
  test('writes an auto-laid-out diagram of bound connectors', () => {
    const res = runAnnotate(['ui/Flow.tsx', '--flow', join(root, 'flow.json'), '--root', root]);
    expect(res.code).toBe(0);
    const result = JSON.parse(res.out) as { ok: boolean; refs: Record<string, string> };
    expect(result.ok).toBe(true);
    expect(Object.keys(result.refs)).toEqual(['@a', '@b', '@c']);

    const svg = readSvg();
    // Canonical-parser compatible, sanitize-stable, byte-identical round-trip.
    expect(sanitizeAnnotationSvg(svg)).toBe(svg);
    const strokes = svgToStrokes(svg);
    expect(strokesToSvg(strokes)).toBe(svg);
    // 3 shapes + 3 labels (2 anchored + 1 ellipse-anchored) + 2 arrows + 1 edge label.
    const arrows = strokes.filter((s): s is ArrowStroke => s.tool === 'arrow');
    expect(arrows).toHaveLength(2);
    for (const a of arrows) {
      expect(a.startBind?.hostId).toBeDefined();
      expect(a.endBind?.hostId).toBeDefined();
      expect(a.author).toBe('ai');
    }
    // Layered layout: 'b' sits one column right of 'a'.
    const aShape = strokes.find((s) => s.id === result.refs['@a']) as Stroke & { x: number };
    const bShape = strokes.find((s) => s.id === result.refs['@b']) as Stroke & { x: number };
    expect(bShape.x).toBeGreaterThan(aShape.x);
  });

  test('read-annotations --graph reads the diagram back as the same graph', () => {
    const proc = Bun.spawnSync(['node', READER, 'ui/Flow.tsx', '--root', root, '--graph']);
    const parsed = JSON.parse(new TextDecoder().decode(proc.stdout)) as {
      graph: { nodes: Array<{ label: string | null }>; edges: unknown[] };
    };
    expect(parsed.graph.edges).toHaveLength(2);
    expect(parsed.graph.nodes.map((n) => n.label).sort()).toEqual(['End', 'Middle', 'Start']);
  });
});

describe('annotate --ops', () => {
  test('create sticky + group + connect-to-existing + delete, via stdin', () => {
    // Connect to a node minted by the previous --flow run.
    const flowSvg = readSvg();
    const existingId = (svgToStrokes(flowSvg).find((s) => s.tool === 'rect') as Stroke).id;
    const ops = {
      ops: [
        { op: 'create', type: 'sticky', ref: '@n1', text: 'pain point', x: 100, y: 600 },
        { op: 'create', type: 'sticky', ref: '@n2', text: 'idea', x: 340, y: 600 },
        { op: 'group', ids: ['@n1', '@n2'] },
        { op: 'connect', from: '@n1', to: existingId },
      ],
    };
    const res = runAnnotate(['ui/Flow.tsx', '--root', root], JSON.stringify(ops));
    expect(res.code).toBe(0);
    const svg = readSvg();
    expect(sanitizeAnnotationSvg(svg)).toBe(svg);
    const strokes = svgToStrokes(svg);
    expect(strokesToSvg(svg && strokes ? strokes : [])).toBe(svg);
    const stickies = strokes.filter((s): s is StickyStroke => s.tool === 'sticky');
    expect(stickies).toHaveLength(2);
    expect(stickies[0]?.groupIds).toEqual(stickies[1]?.groupIds);
    expect(stickies[0]?.groupIds?.length).toBe(1);
    const bound = strokes.filter(
      (s): s is ArrowStroke => s.tool === 'arrow' && s.endBind?.hostId === existingId
    );
    expect(bound).toHaveLength(1);

    // Delete one sticky — the element disappears and the file stays canonical.
    const del = runAnnotate(
      ['ui/Flow.tsx', '--root', root],
      JSON.stringify({ ops: [{ op: 'delete', id: stickies[1]?.id }] })
    );
    expect(del.code).toBe(0);
    const after = svgToStrokes(readSvg());
    expect(after.filter((s) => s.tool === 'sticky')).toHaveLength(1);
    expect(strokesToSvg(after)).toBe(readSvg());
  });

  test('unknown connect target fails loud, writes nothing', () => {
    const before = readSvg();
    const res = runAnnotate(
      ['ui/Flow.tsx', '--root', root],
      JSON.stringify({ ops: [{ op: 'connect', from: '@ghost', to: 'nope' }] })
    );
    expect(res.code).toBe(2);
    expect(readSvg()).toBe(before);
  });

  test('--dry-run prints the merged SVG without writing', () => {
    const before = readSvg();
    const res = runAnnotate(
      ['ui/Flow.tsx', '--root', root, '--dry-run'],
      JSON.stringify({ ops: [{ op: 'create', type: 'text', text: 'ghost', x: 0, y: 0 }] })
    );
    expect(res.code).toBe(0);
    expect(res.out).toContain('ghost');
    expect(readSvg()).toBe(before);
  });

  test('--in places inside the artboard bounds (top-left + inset)', () => {
    const manifest = JSON.stringify({
      artboards: [{ id: 'hero', x: 1000, y: 2000, w: 400, h: 300 }],
      elements: [],
      elementsTruncated: false,
    });
    writeFileSync(join(root, 'rects.json'), manifest);
    const res = runAnnotate(
      ['ui/Pin.tsx', '--root', root, '--rects', join(root, 'rects.json'), '--in', 'hero'],
      JSON.stringify({ ops: [{ op: 'create', type: 'sticky', text: 'inside hero' }] })
    );
    expect(res.code).toBe(0);
    const svg = boardSvg('ui-pin');
    const [sticky] = svgToStrokes(svg).filter((s): s is StickyStroke => s.tool === 'sticky');
    expect(sticky?.x).toBe(1040); // hero.x + 40 inset
    expect(sticky?.y).toBe(2040); // hero.y + 40 inset
  });

  test('--in with an unknown artboard fails loud, writes nothing', () => {
    const manifest = JSON.stringify({
      artboards: [{ id: 'hero', x: 0, y: 0, w: 400, h: 300 }],
      elements: [],
      elementsTruncated: false,
    });
    writeFileSync(join(root, 'rects2.json'), manifest);
    const res = runAnnotate(
      ['ui/PinMissing.tsx', '--root', root, '--rects', join(root, 'rects2.json'), '--in', 'ghost'],
      JSON.stringify({ ops: [{ op: 'create', type: 'sticky', text: 'x' }] })
    );
    expect(res.code).toBe(2);
    expect(res.err).toMatch(/unknown artboard "ghost"/);
  });

  test('--pin places beside the element and draws a pointer arrow to it', () => {
    const manifest = JSON.stringify({
      artboards: [{ id: 'hero', x: 0, y: 0, w: 1000, h: 800 }],
      elements: [
        {
          cdId: 'cta1',
          selector: '[data-dc-screen="hero"] [data-cd-id="cta1"]',
          index: 0,
          artboard: 'hero',
          x: 500,
          y: 500,
          w: 120,
          h: 40,
          tag: 'button',
          text: 'Continue',
        },
      ],
      elementsTruncated: false,
    });
    writeFileSync(join(root, 'rects3.json'), manifest);
    const res = runAnnotate(
      ['ui/Callout.tsx', '--root', root, '--rects', join(root, 'rects3.json'), '--pin', 'cta1'],
      JSON.stringify({ ops: [{ op: 'create', type: 'sticky', text: 'make this bigger' }] })
    );
    expect(res.code).toBe(0);
    const svg = boardSvg('ui-callout');
    expect(sanitizeAnnotationSvg(svg)).toBe(svg);
    const strokes = svgToStrokes(svg);
    expect(strokesToSvg(strokes)).toBe(svg);
    const [sticky] = strokes.filter((s): s is StickyStroke => s.tool === 'sticky');
    expect(sticky?.x).toBe(660); // element.x (500) + element.w (120) + 40 gap
    expect(sticky?.y).toBe(500); // element.y
    const arrows = strokes.filter((s): s is ArrowStroke => s.tool === 'arrow');
    expect(arrows).toHaveLength(1);
    expect(arrows[0]?.author).toBe('ai');
    // The pointer arrow is a snapshot, NOT a magnetic bind (no DOM host in this SVG).
    expect(arrows[0]?.startBind).toBeUndefined();
    expect(arrows[0]?.endBind).toBeUndefined();
  });

  test('--pin to an unknown element fails loud, writes nothing', () => {
    const manifest = JSON.stringify({ artboards: [], elements: [], elementsTruncated: false });
    writeFileSync(join(root, 'rects4.json'), manifest);
    const res = runAnnotate(
      ['ui/PinGhost.tsx', '--root', root, '--rects', join(root, 'rects4.json'), '--pin', 'ghost'],
      JSON.stringify({ ops: [{ op: 'create', type: 'sticky', text: 'x' }] })
    );
    expect(res.code).toBe(2);
    expect(res.err).toMatch(/element "ghost" not found/);
  });

  test('--no-pointer suppresses the arrow but keeps the placement', () => {
    const manifest = JSON.stringify({
      artboards: [],
      elements: [
        {
          cdId: 'cta2',
          selector: '[data-cd-id="cta2"]',
          index: 0,
          artboard: null,
          x: 0,
          y: 0,
          w: 100,
          h: 40,
          tag: 'button',
          text: 'Go',
        },
      ],
      elementsTruncated: false,
    });
    writeFileSync(join(root, 'rects5.json'), manifest);
    const res = runAnnotate(
      [
        'ui/NoPointer.tsx',
        '--root',
        root,
        '--rects',
        join(root, 'rects5.json'),
        '--pin',
        'cta2',
        '--no-pointer',
      ],
      JSON.stringify({ ops: [{ op: 'create', type: 'sticky', text: 'quiet note' }] })
    );
    expect(res.code).toBe(0);
    const strokes = svgToStrokes(boardSvg('ui-nopointer'));
    expect(strokes.filter((s) => s.tool === 'sticky')).toHaveLength(1);
    expect(strokes.filter((s) => s.tool === 'arrow')).toHaveLength(0);
  });

  test('per-op "pin" overrides the batch default for just that op', () => {
    const manifest = JSON.stringify({
      artboards: [],
      elements: [
        {
          cdId: 'target',
          selector: '[data-cd-id="target"]',
          index: 0,
          artboard: null,
          x: 900,
          y: 900,
          w: 50,
          h: 50,
          tag: 'span',
          text: 'here',
        },
      ],
      elementsTruncated: false,
    });
    writeFileSync(join(root, 'rects6.json'), manifest);
    const res = runAnnotate(
      ['ui/OpPin.tsx', '--root', root, '--rects', join(root, 'rects6.json')],
      JSON.stringify({
        ops: [
          { op: 'create', type: 'sticky', ref: '@a', text: 'default placement', x: 5, y: 5 },
          { op: 'create', type: 'sticky', ref: '@b', text: 'pinned', pin: 'target' },
        ],
      })
    );
    expect(res.code).toBe(0);
    const strokes = svgToStrokes(boardSvg('ui-oppin'));
    const pinned = strokes.find(
      (s) => s.tool === 'sticky' && (s as StickyStroke).text === 'pinned'
    );
    expect((pinned as StickyStroke)?.x).toBe(990); // target.x (900) + target.w (50) + 40 gap
    expect((pinned as StickyStroke)?.y).toBe(900);
  });

  test('non-loopback _server.json.url is refused — writes to file, never PUTs off-box (F2)', () => {
    // A poisoned/foreign _server.json points the egress at an external host.
    // The verb must NOT PUT there (SSRF/exfil); it falls back to the file write.
    const serverJson = join(root, '.design', '_server.json');
    writeFileSync(serverJson, JSON.stringify({ url: 'http://attacker.example.com:4399' }));
    try {
      const res = runAnnotate(
        ['ui/F2.tsx', '--root', root],
        JSON.stringify({ ops: [{ op: 'create', type: 'text', text: 'secret', x: 0, y: 0 }] })
      );
      expect(res.code).toBe(0);
      // via:"file" proves the off-box PUT was skipped (a successful PUT → "server").
      expect(JSON.parse(res.out).via).toBe('file');
      const svg = boardSvg('ui-f2');
      expect(svg).toContain('secret');
    } finally {
      rmSync(serverJson, { force: true });
    }
  });
});

// feature-whiteboard-ai-toolkit — the generic --board template engine. Named
// presets (retro / kanban / social-calendar / roadmap / brainstorm /
// checklist / user-flow) aren't hardcoded in annotate.mjs — these specs are
// exactly the shape the `whiteboard` skill documents as fixtures.
describe('annotate --board', () => {
  function sections(strokes: Stroke[]) {
    return strokes
      .filter((s): s is Stroke & { x: number; w: number; label: string } => s.tool === 'section')
      .sort((a, b) => a.x - b.x);
  }

  function noOverlap(rects: Array<{ x: number; w: number }>) {
    for (let i = 1; i < rects.length; i += 1) {
      const prev = rects[i - 1] as { x: number; w: number };
      const cur = rects[i] as { x: number; w: number };
      expect(cur.x).toBeGreaterThanOrEqual(prev.x + prev.w);
    }
  }

  test('retro (columns, empty) — 3 evenly-spaced, non-overlapping blank sections', () => {
    const spec = {
      title: 'Sprint 42 retro',
      groups: [
        { title: 'What went well', cards: [] },
        { title: 'What to improve', cards: [] },
        { title: 'Action items', cards: [] },
      ],
    };
    writeFileSync(join(root, 'retro-empty.json'), JSON.stringify(spec));
    const res = runAnnotate([
      'ui/RetroEmpty.tsx',
      '--root',
      root,
      '--board',
      join(root, 'retro-empty.json'),
    ]);
    expect(res.code).toBe(0);
    const svg = boardSvg('ui-retroempty');
    expect(sanitizeAnnotationSvg(svg)).toBe(svg);
    const strokes = svgToStrokes(svg);
    expect(strokesToSvg(strokes)).toBe(svg);
    const secs = sections(strokes);
    expect(secs).toHaveLength(3);
    expect(secs.map((s) => s.label)).toEqual(['What went well', 'What to improve', 'Action items']);
    // Every empty section gets the SAME clean default height.
    expect(new Set(secs.map((s) => s.h)).size).toBe(1);
    noOverlap(secs);
    expect(strokes.filter((s) => s.tool === 'sticky')).toHaveLength(0);
  });

  test('retro (columns, seeded) — cards stack inside their section without overlap', () => {
    const spec = {
      groups: [
        { title: 'Went well', cards: ['shipped on time', 'good pairing'] },
        { title: 'To improve', cards: ['too many meetings'] },
      ],
    };
    writeFileSync(join(root, 'retro-seeded.json'), JSON.stringify(spec));
    const res = runAnnotate([
      'ui/RetroSeeded.tsx',
      '--root',
      root,
      '--board',
      join(root, 'retro-seeded.json'),
    ]);
    expect(res.code).toBe(0);
    const strokes = svgToStrokes(boardSvg('ui-retroseeded'));
    const secs = sections(strokes);
    expect(secs).toHaveLength(2);
    noOverlap(secs);
    const stickies = strokes.filter((s): s is StickyStroke => s.tool === 'sticky');
    expect(stickies.map((s) => s.text).sort()).toEqual(
      ['good pairing', 'shipped on time', 'too many meetings'].sort()
    );
    // The 2 cards in the first section stack vertically, not overlapping.
    const wellCards = stickies.filter((s) => s.x === stickies[0]?.x);
    const byY = [...wellCards].sort((a, b) => a.y - b.y);
    for (let i = 1; i < byY.length; i += 1) {
      const prev = byY[i - 1] as StickyStroke;
      const cur = byY[i] as StickyStroke;
      expect(cur.y).toBeGreaterThanOrEqual(prev.y + prev.h);
    }
  });

  test('social-calendar shape (7 columns) — 7 sections + 7 stickies, no overlap', () => {
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const spec = { groups: days.map((d) => ({ title: d, cards: [`${d} post idea`] })) };
    writeFileSync(join(root, 'calendar.json'), JSON.stringify(spec));
    const res = runAnnotate([
      'ui/Calendar.tsx',
      '--root',
      root,
      '--board',
      join(root, 'calendar.json'),
    ]);
    expect(res.code).toBe(0);
    const strokes = svgToStrokes(boardSvg('ui-calendar'));
    const secs = sections(strokes);
    expect(secs).toHaveLength(7);
    expect(secs.map((s) => s.label)).toEqual(days);
    noOverlap(secs);
    expect(strokes.filter((s) => s.tool === 'sticky')).toHaveLength(7);
  });

  test('user-flow (layout: "flow") delegates to the SAME auto-layout as --flow, reads back as a graph', () => {
    const spec = {
      layout: 'flow',
      nodes: [
        { id: 'start', label: 'Landing' },
        { id: 'signup', label: 'Sign up' },
        { id: 'done', label: 'Onboarded', shape: 'ellipse' },
      ],
      edges: [
        { from: 'start', to: 'signup' },
        { from: 'signup', to: 'done', label: 'verified' },
      ],
    };
    writeFileSync(join(root, 'userflow.json'), JSON.stringify(spec));
    const res = runAnnotate([
      'ui/UserFlow.tsx',
      '--root',
      root,
      '--board',
      join(root, 'userflow.json'),
    ]);
    expect(res.code).toBe(0);
    const svg = boardSvg('ui-userflow');
    expect(sanitizeAnnotationSvg(svg)).toBe(svg);
    const strokes = svgToStrokes(svg);
    expect(strokesToSvg(strokes)).toBe(svg);
    const arrows = strokes.filter((s): s is ArrowStroke => s.tool === 'arrow');
    expect(arrows).toHaveLength(2);
    for (const a of arrows) {
      expect(a.startBind?.hostId).toBeDefined();
      expect(a.endBind?.hostId).toBeDefined();
    }
    const proc = Bun.spawnSync(['node', READER, 'ui/UserFlow.tsx', '--root', root, '--graph']);
    const parsed = JSON.parse(new TextDecoder().decode(proc.stdout)) as {
      graph: { nodes: Array<{ label: string | null }>; edges: unknown[] };
    };
    expect(parsed.graph.edges).toHaveLength(2);
    expect(parsed.graph.nodes.map((n) => n.label).sort()).toEqual([
      'Landing',
      'Onboarded',
      'Sign up',
    ]);
  });

  test('brainstorm (layout: "radial") — a center topic + cards ringed around it', () => {
    const spec = {
      title: 'How do we grow retention?',
      layout: 'radial',
      groups: [{ title: 'ideas', cards: ['onboarding email', 'in-app tips', 'referral bonus'] }],
    };
    writeFileSync(join(root, 'brainstorm.json'), JSON.stringify(spec));
    const res = runAnnotate([
      'ui/Brainstorm.tsx',
      '--root',
      root,
      '--board',
      join(root, 'brainstorm.json'),
    ]);
    expect(res.code).toBe(0);
    const strokes = svgToStrokes(boardSvg('ui-brainstorm'));
    const center = strokes.find((s) => s.tool === 'ellipse');
    expect(center).toBeDefined();
    const centerLabel = strokes.find(
      (s) => s.tool === 'text' && (s as Stroke & { anchorId?: string }).anchorId === center?.id
    );
    expect((centerLabel as Stroke & { text: string })?.text).toBe('How do we grow retention?');
    const ideas = strokes.filter((s): s is StickyStroke => s.tool === 'sticky');
    expect(ideas).toHaveLength(3);
    expect(ideas.map((s) => s.text).sort()).toEqual(
      ['in-app tips', 'onboarding email', 'referral bonus'].sort()
    );
  });

  test('connections[] draws bound arrows between minted section refs', () => {
    const spec = {
      groups: [
        { title: 'Backlog', cards: ['idea A'] },
        { title: 'Done', cards: ['shipped B'] },
      ],
      connections: [{ from: '@sec0', to: '@sec1', label: 'promoted' }],
    };
    writeFileSync(join(root, 'connected.json'), JSON.stringify(spec));
    const res = runAnnotate([
      'ui/Connected.tsx',
      '--root',
      root,
      '--board',
      join(root, 'connected.json'),
    ]);
    expect(res.code).toBe(0);
    const strokes = svgToStrokes(boardSvg('ui-connected'));
    const arrows = strokes.filter((s): s is ArrowStroke => s.tool === 'arrow');
    expect(arrows).toHaveLength(1);
    expect(arrows[0]?.startBind?.hostId).toBeDefined();
    expect(arrows[0]?.endBind?.hostId).toBeDefined();
  });

  test('--board and --ops together are rejected as mutually exclusive', () => {
    writeFileSync(join(root, 'excl.json'), JSON.stringify({ groups: [{ cards: [] }] }));
    const res = runAnnotate([
      'ui/Excl.tsx',
      '--root',
      root,
      '--board',
      join(root, 'excl.json'),
      '--ops',
      join(root, 'excl.json'),
    ]);
    expect(res.code).toBe(2);
    expect(res.err).toMatch(/mutually exclusive/);
  });

  test('--near places the whole board beside an artboard', () => {
    const manifest = JSON.stringify({
      artboards: [{ id: 'hero', x: 2000, y: 3000, w: 400, h: 300 }],
      elements: [],
      elementsTruncated: false,
    });
    writeFileSync(join(root, 'rects-board.json'), manifest);
    const spec = { groups: [{ title: 'Notes', cards: ['x'] }] };
    writeFileSync(join(root, 'near-board.json'), JSON.stringify(spec));
    const res = runAnnotate([
      'ui/NearBoard.tsx',
      '--root',
      root,
      '--rects',
      join(root, 'rects-board.json'),
      '--near',
      'hero',
      '--board',
      join(root, 'near-board.json'),
    ]);
    expect(res.code).toBe(0);
    const strokes = svgToStrokes(boardSvg('ui-nearboard'));
    const [sec] = sections(strokes);
    expect(sec?.x).toBe(2000 + 400 + 80); // hero.x + hero.w + 80 gap (existing --near math)
    expect(sec?.y).toBe(3000);
  });

  // Security regression (feature-whiteboard-ai-toolkit review, F-board-dos):
  // groups[]/cards[] had no size cap before expansion — MAX_ANNOTATIONS_BYTES
  // only rejected AFTER full expansion + serialization, so a pathological
  // spec could burn CPU/memory before hitting it. These fail loud up front.
  test('--board rejects a groups[] array over the cap', () => {
    const spec = { groups: Array.from({ length: 25 }, (_, i) => ({ title: `g${i}`, cards: [] })) };
    writeFileSync(join(root, 'board-toomanygroups.json'), JSON.stringify(spec));
    const res = runAnnotate([
      'ui/BoardTooManyGroups.tsx',
      '--root',
      root,
      '--board',
      join(root, 'board-toomanygroups.json'),
    ]);
    expect(res.code).toBe(2);
    expect(res.err).toMatch(/groups\[\] has 25, max 20/);
  });

  test('--board rejects a single group with too many cards', () => {
    const spec = { groups: [{ title: 'g', cards: Array.from({ length: 60 }, (_, i) => `c${i}`) }] };
    writeFileSync(join(root, 'board-toomanycards.json'), JSON.stringify(spec));
    const res = runAnnotate([
      'ui/BoardTooManyCards.tsx',
      '--root',
      root,
      '--board',
      join(root, 'board-toomanycards.json'),
    ]);
    expect(res.code).toBe(2);
    expect(res.err).toMatch(/has 60 cards, max 50/);
  });

  test('--board rejects total cards over the cap even when spread across groups', () => {
    const spec = {
      groups: Array.from({ length: 20 }, (_, i) => ({
        title: `g${i}`,
        cards: Array.from({ length: 16 }, (_, j) => `c${i}-${j}`), // 20*16 = 320 > 300
      })),
    };
    writeFileSync(join(root, 'board-toomanytotal.json'), JSON.stringify(spec));
    const res = runAnnotate([
      'ui/BoardTooManyTotal.tsx',
      '--root',
      root,
      '--board',
      join(root, 'board-toomanytotal.json'),
    ]);
    expect(res.code).toBe(2);
    expect(res.err).toMatch(/320 total cards across groups, max 300/);
  });

  test('--board layout "flow" rejects a nodes[] array over the cap', () => {
    const spec = {
      layout: 'flow',
      nodes: Array.from({ length: 201 }, (_, i) => ({ id: `n${i}`, label: `n${i}` })),
    };
    writeFileSync(join(root, 'board-toomanynodes.json'), JSON.stringify(spec));
    const res = runAnnotate([
      'ui/BoardTooManyNodes.tsx',
      '--root',
      root,
      '--board',
      join(root, 'board-toomanynodes.json'),
    ]);
    expect(res.code).toBe(2);
    expect(res.err).toMatch(/nodes\[\] has 201, max 200/);
  });

  // Security regression (feature-whiteboard-ai-toolkit review, F-connections-dos):
  // groups[]/cards[]/nodes[] were capped but connections[]/edges[] were not —
  // createConnect mints a fresh arrow (+ optional label) stroke per entry
  // regardless of how few distinct nodes are involved, so a tiny board spec
  // with a huge connections[]/edges[] array bypassed every existing cap.
  test('--board rejects a connections[] array over the cap (columns layout)', () => {
    const spec = {
      groups: [{ title: 'g', cards: ['a', 'b'] }],
      connections: Array.from({ length: 401 }, () => ({ from: '@sec0', to: '@sec0card0' })),
    };
    writeFileSync(join(root, 'board-toomanyconns.json'), JSON.stringify(spec));
    const res = runAnnotate([
      'ui/BoardTooManyConns.tsx',
      '--root',
      root,
      '--board',
      join(root, 'board-toomanyconns.json'),
    ]);
    expect(res.code).toBe(2);
    expect(res.err).toMatch(/connections\[\] has 401, max 400/);
  });

  test('--flow (top-level) rejects an edges[] array over the cap', () => {
    const spec = {
      nodes: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
      edges: Array.from({ length: 401 }, () => ({ from: 'a', to: 'b' })),
    };
    writeFileSync(join(root, 'flow-toomanyedges.json'), JSON.stringify(spec));
    const res = runAnnotate([
      'ui/FlowTooManyEdges.tsx',
      '--root',
      root,
      '--flow',
      join(root, 'flow-toomanyedges.json'),
    ]);
    expect(res.code).toBe(2);
    expect(res.err).toMatch(/edges\[\] has 401, max 400/);
  });

  test('--flow (top-level) rejects a nodes[] array over the cap', () => {
    const spec = {
      nodes: Array.from({ length: 201 }, (_, i) => ({ id: `n${i}`, label: `n${i}` })),
    };
    writeFileSync(join(root, 'flow-toomanynodes.json'), JSON.stringify(spec));
    const res = runAnnotate([
      'ui/FlowTooManyNodes.tsx',
      '--root',
      root,
      '--flow',
      join(root, 'flow-toomanynodes.json'),
    ]);
    expect(res.code).toBe(2);
    expect(res.err).toMatch(/nodes\[\] has 201, max 200/);
  });
});

// feature-whiteboard-ai-toolkit — id-preserving move/set-text/set-color.
// DDR-100 omitted "update"; these stay LWW-honest (whole-file write) but
// preserve the target's id AND every other attribute via the CANONICAL
// parser (svgToStrokes) + CANONICAL serializer round-trip.
describe('annotate move / set-text / set-color', () => {
  // Mirrors api.ts fileSlug: "ui/Foo.tsx" -> "ui-foo" (the "/" replacement
  // ALREADY produces the "ui-" prefix — no extra prefix on the filename).
  function annotationsPath(canvasRel: string): string {
    const slug = canvasRel
      .replace(/\//g, '-')
      .replace(/\.tsx$/, '')
      .toLowerCase();
    return join(root, '.design', `${slug}.annotations.svg`);
  }

  function seedCanvas(canvasRel: string, strokes: Stroke[]): void {
    writeFileSync(annotationsPath(canvasRel), strokesToSvg(strokes));
  }

  function readStrokes(canvasRel: string): Stroke[] {
    const slug = canvasRel
      .replace(/\//g, '-')
      .replace(/\.tsx$/, '')
      .toLowerCase();
    return svgToStrokes(boardSvg(slug));
  }

  test('move preserves id + every other attribute (custom fontSize, bold, groupIds)', () => {
    const sticky: StickyStroke = {
      id: 'mv1',
      tool: 'sticky',
      color: '#fce8a6',
      x: 10,
      y: 10,
      w: 200,
      h: 100,
      text: 'don’t drop my formatting',
      fontSize: 22, // NON-default — the point of the DOM-parser approach
      cornerRadius: 8,
      bold: true,
      groupIds: ['g1'],
    };
    seedCanvas('ui/Move.tsx', [sticky]);
    const res = runAnnotate(
      ['ui/Move.tsx', '--root', root],
      JSON.stringify({ ops: [{ op: 'move', id: 'mv1', x: 900, y: 900 }] })
    );
    expect(res.code).toBe(0);
    const svg = boardSvg('ui-move');
    expect(sanitizeAnnotationSvg(svg)).toBe(svg);
    const [after] = readStrokes('ui/Move.tsx') as [StickyStroke];
    expect(after.id).toBe('mv1');
    expect(after.x).toBe(900);
    expect(after.y).toBe(900);
    // Everything else survived byte-for-byte — the whole point of parsing
    // through the canonical model instead of reconstructing from defaults.
    expect(after.fontSize).toBe(22);
    expect(after.bold).toBe(true);
    expect(after.cornerRadius).toBe(8);
    expect(after.groupIds).toEqual(['g1']);
    expect(after.text).toBe('don’t drop my formatting');
    expect(after.color).toBe('#fce8a6');
  });

  test('move on an ellipse converts x/y (top-left) to cx/cy, keeping rx/ry', () => {
    const ell: EllipseStroke = {
      id: 'mv2',
      tool: 'ellipse',
      color: '#30a46c',
      width: 3,
      cx: 100,
      cy: 100,
      rx: 40,
      ry: 20,
      fill: null,
    };
    seedCanvas('ui/MoveEllipse.tsx', [ell]);
    // Target x/y is top-left (cx-rx, cy-ry) — the convention read-annotations uses.
    const res = runAnnotate(
      ['ui/MoveEllipse.tsx', '--root', root],
      JSON.stringify({ ops: [{ op: 'move', id: 'mv2', x: 500, y: 500 }] })
    );
    expect(res.code).toBe(0);
    const [after] = readStrokes('ui/MoveEllipse.tsx') as [EllipseStroke];
    expect(after.cx).toBe(540); // 500 + rx(40)
    expect(after.cy).toBe(520); // 500 + ry(20)
    expect(after.rx).toBe(40);
    expect(after.ry).toBe(20);
  });

  test('set-text on a sticky patches "text", set-text on a section patches "label"', () => {
    const sticky: StickyStroke = {
      id: 'st-text',
      tool: 'sticky',
      color: '#fce8a6',
      x: 0,
      y: 0,
      w: 200,
      h: 100,
      text: 'old text',
      fontSize: 14,
      cornerRadius: 8,
    };
    const section: SectionStroke = {
      id: 'sec-text',
      tool: 'section',
      x: 300,
      y: 0,
      w: 280,
      h: 200,
      label: 'Old label',
      color: '#8b8b94',
    };
    seedCanvas('ui/SetText.tsx', [sticky, section]);
    const res = runAnnotate(
      ['ui/SetText.tsx', '--root', root],
      JSON.stringify({
        ops: [
          { op: 'set-text', id: 'st-text', text: 'new text' },
          { op: 'set-text', id: 'sec-text', text: 'New label' },
        ],
      })
    );
    expect(res.code).toBe(0);
    const strokes = readStrokes('ui/SetText.tsx');
    const after = strokes.find((s) => s.id === 'st-text') as StickyStroke;
    const afterSec = strokes.find((s) => s.id === 'sec-text') as SectionStroke;
    expect(after.text).toBe('new text');
    expect(after.x).toBe(0); // unchanged
    expect(afterSec.label).toBe('New label');
    expect(afterSec.color).toBe('#8b8b94'); // unchanged
  });

  test('set-color patches only the color, keeping text/position', () => {
    const t: TextStroke = {
      id: 'col1',
      tool: 'text',
      color: '#1a1a1a',
      fontSize: 14,
      text: 'recolor me',
      x: 50,
      y: 50,
    };
    seedCanvas('ui/SetColor.tsx', [t]);
    const res = runAnnotate(
      ['ui/SetColor.tsx', '--root', root],
      JSON.stringify({ ops: [{ op: 'set-color', id: 'col1', color: '#e5484d' }] })
    );
    expect(res.code).toBe(0);
    const [after] = readStrokes('ui/SetColor.tsx') as [TextStroke];
    expect(after.color).toBe('#e5484d');
    expect(after.text).toBe('recolor me');
    expect(after.x).toBe(50);
    expect(after.y).toBe(50);
  });

  test('move/set-text/set-color work on a stroke created earlier in the SAME batch (@ref)', () => {
    const res = runAnnotate(
      ['ui/SameBatch.tsx', '--root', root],
      JSON.stringify({
        ops: [
          { op: 'create', type: 'sticky', ref: '@a', text: 'v1', x: 5, y: 5 },
          { op: 'move', id: '@a', x: 700, y: 700 },
          { op: 'set-text', id: '@a', text: 'v2' },
          { op: 'set-color', id: '@a', color: '#111111' },
        ],
      })
    );
    expect(res.code).toBe(0);
    const [after] = readStrokes('ui/SameBatch.tsx') as [StickyStroke];
    expect(after.x).toBe(700);
    expect(after.y).toBe(700);
    expect(after.text).toBe('v2');
    expect(after.color).toBe('#111111');
  });

  test('chained move + set-text on a PRE-EXISTING (seeded, not @ref) id accumulate — not clobber', () => {
    // Regression: resolveMutable must check ctx.replaces before the cached
    // "original" — otherwise a second op on the same existing id reads the
    // stale pre-batch stroke and its patch overwrites the first op's change.
    const sticky: StickyStroke = {
      id: 'chain1',
      tool: 'sticky',
      color: '#fce8a6',
      x: 10,
      y: 10,
      w: 200,
      h: 100,
      text: 'v1',
      fontSize: 14,
      cornerRadius: 8,
    };
    seedCanvas('ui/Chain.tsx', [sticky]);
    const res = runAnnotate(
      ['ui/Chain.tsx', '--root', root],
      JSON.stringify({
        ops: [
          { op: 'move', id: 'chain1', x: 500, y: 500 },
          { op: 'set-text', id: 'chain1', text: 'v2' },
          { op: 'set-color', id: 'chain1', color: '#111111' },
        ],
      })
    );
    expect(res.code).toBe(0);
    const [after] = readStrokes('ui/Chain.tsx') as [StickyStroke];
    expect(after.id).toBe('chain1');
    expect(after.x).toBe(500);
    expect(after.y).toBe(500);
    expect(after.text).toBe('v2');
    expect(after.color).toBe('#111111');
  });

  test('move on an unknown id fails loud, writes nothing', () => {
    seedCanvas('ui/MoveGhost.tsx', []);
    const before = boardSvg('ui-moveghost');
    const res = runAnnotate(
      ['ui/MoveGhost.tsx', '--root', root],
      JSON.stringify({ ops: [{ op: 'move', id: 'ghost', x: 1, y: 1 }] })
    );
    expect(res.code).toBe(2);
    expect(res.err).toMatch(/unknown id "ghost"/);
    expect(boardSvg('ui-moveghost')).toBe(before);
  });

  test('move on an arrow fails loud (no single position)', () => {
    const arrow: ArrowStroke = {
      id: 'arr1',
      tool: 'arrow',
      color: '#000',
      width: 2,
      x1: 0,
      y1: 0,
      x2: 10,
      y2: 10,
    };
    seedCanvas('ui/MoveArrow.tsx', [arrow]);
    const res = runAnnotate(
      ['ui/MoveArrow.tsx', '--root', root],
      JSON.stringify({ ops: [{ op: 'move', id: 'arr1', x: 5, y: 5 }] })
    );
    expect(res.code).toBe(2);
    expect(res.err).toMatch(/no single position/);
  });

  test('move on anchored text fails loud (position derives from its host)', () => {
    const anchored: TextStroke = {
      id: 'anc1',
      tool: 'text',
      color: '#000',
      fontSize: 14,
      text: 'label',
      anchorId: 'some-host',
    };
    seedCanvas('ui/MoveAnchored.tsx', [anchored]);
    const res = runAnnotate(
      ['ui/MoveAnchored.tsx', '--root', root],
      JSON.stringify({ ops: [{ op: 'move', id: 'anc1', x: 5, y: 5 }] })
    );
    expect(res.code).toBe(2);
    // DDR-242: a shape label is a field of its shape, not an element — the verb
    // can't address it at all; the guarantee (fail loud, write nothing) holds.
    expect(res.err).toMatch(/anchored text derives its position from its host|unknown id "anc1"/);
  });

  test('set-color / set-text on an image (no color/text field) fail loud', () => {
    const img = {
      id: 'img1',
      tool: 'image',
      x: 0,
      y: 0,
      w: 100,
      h: 100,
      href: 'assets/deadbeef.png',
    } as unknown as Stroke;
    seedCanvas('ui/SetColorImage.tsx', [img]);
    const colorRes = runAnnotate(
      ['ui/SetColorImage.tsx', '--root', root],
      JSON.stringify({ ops: [{ op: 'set-color', id: 'img1', color: '#fff' }] })
    );
    expect(colorRes.code).toBe(2);
    expect(colorRes.err).toMatch(/has no single color field/);

    const textRes = runAnnotate(
      ['ui/SetColorImage.tsx', '--root', root],
      JSON.stringify({ ops: [{ op: 'set-text', id: 'img1', text: 'x' }] })
    );
    expect(textRes.code).toBe(2);
    expect(textRes.err).toMatch(/has no text\/label field/);
  });

  // Security regression (feature-whiteboard-ai-toolkit review, F-happydom-fetch):
  // ensureFullStrokes() in bin/annotate.mjs uses GlobalRegistrator.register()
  // (happy-dom's internals need the full scaffolding — a bare DOMParser patch
  // leaves querySelector's own error path broken, since it reaches through
  // `this.window`) then calls the documented `unregister()` inverse right
  // after the parse, so the later loopback-gated PUT never runs over
  // happy-dom's own fetch/URL polyfill. Run in a FRESH subprocess (not this
  // file's own process, which already has GlobalRegistrator registered for
  // the whole suite via beforeAll) to pin the contract cleanly: unregister()
  // restores the exact pre-register fetch reference, not just "a" fetch.
  test('GlobalRegistrator.register/unregister contract: fetch is restored to the exact pre-register reference', () => {
    const proc = Bun.spawnSync([
      'bun',
      '-e',
      `
      const { GlobalRegistrator } = await import('@happy-dom/global-registrator');
      const nativeFetch = globalThis.fetch;
      GlobalRegistrator.register();
      if (globalThis.fetch === nativeFetch) { console.log('FAIL: fetch unchanged after register'); process.exit(1); }
      await GlobalRegistrator.unregister();
      if (globalThis.fetch !== nativeFetch) { console.log('FAIL: fetch not restored after unregister'); process.exit(1); }
      console.log('OK');
      `,
    ]);
    expect(new TextDecoder().decode(proc.stdout).trim()).toBe('OK');
    expect(proc.exitCode).toBe(0);
  });

  // Security regression (feature-whiteboard-ai-toolkit review, F-readtime-cap):
  // MAX_ANNOTATIONS_BYTES (1 MB) was only ever checked on the MERGED OUTPUT —
  // a file already at/near the cap on disk (peer-written per DDR-054, or
  // git-committed by anyone) would still be read in full and DOM-parsed on
  // every move/set-text/set-color. Now rejected at read time, before parse.
  test('a pre-existing annotations file over the byte cap is rejected before it reaches the DOM parser', () => {
    // One oversized sticky's text is enough to push the file over 1 MB without
    // needing thousands of strokes.
    const big: StickyStroke = {
      id: 'huge1',
      tool: 'sticky',
      color: '#fce8a6',
      x: 10,
      y: 10,
      w: 200,
      h: 100,
      text: 'x'.repeat(4 * 1024 * 1024 + 1),
    };
    seedCanvas('ui/HugeFile.tsx', [big]);
    const res = runAnnotate(
      ['ui/HugeFile.tsx', '--root', root],
      JSON.stringify({ ops: [{ op: 'move', id: 'huge1', x: 20, y: 20 }] })
    );
    expect(res.code).toBe(2);
    expect(res.err).toMatch(/exceeds 4194304 bytes on disk/);
  });
});
