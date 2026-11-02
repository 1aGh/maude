// Offline FigJam fixture -> board ops (the engine's own mapping, no network, never calls Figma).
import { writeFileSync } from 'node:fs';

const W = '/Users/iagh/git/personal/maude/.claude/worktrees/agent-ada3048713dd57bcb/apps/studio';
const { strokesIntoOps } = await import(`${W}/figma/into-board.ts`);
const { toStrokes } = await import(`${W}/figma/to-strokes.ts`);
const { normalizeDocument } = await import(`${W}/figma/types.ts`);
const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
const st = (id: string, x: number, y: number, t: string) => ({
  id,
  name: 'S',
  type: 'STICKY',
  absoluteBoundingBox: box(x, y, 240, 240),
  characters: t,
});
const DOC = {
  id: '0:0',
  name: 'Document',
  type: 'CANVAS',
  children: [
    st('1:1', 0, 0, 'Hráči z U19 jako tváře kampaně'),
    st('1:2', 300, 0, 'Reels z loňského Combine'),
    st('1:3', 600, 0, 'Pozvat Kraví horu jako partnera'),
    st('1:4', 900, 0, 'Leták do škol'),
    {
      id: '2:1',
      name: 'B',
      type: 'SHAPE_WITH_TEXT',
      shapeType: 'ELLIPSE',
      absoluteBoundingBox: box(0, 400, 200, 100),
      characters: 'Combine 2026',
    },
    {
      id: '2:2',
      name: 'B',
      type: 'SHAPE_WITH_TEXT',
      shapeType: 'DIAMOND',
      absoluteBoundingBox: box(300, 400, 200, 100),
      characters: 'Partneři?',
    },
    {
      id: '2:3',
      name: 'B',
      type: 'SHAPE_WITH_TEXT',
      shapeType: 'SQUARE',
      absoluteBoundingBox: box(600, 400, 200, 100),
      characters: 'Rozpočet 40 000 Kč',
    },
    {
      id: '3:1',
      name: 'A',
      type: 'CONNECTOR',
      absoluteBoundingBox: box(200, 440, 100, 20),
      connectorStart: '2:1',
      connectorEnd: '2:2',
      connectorEndCap: 'ARROW_LINES',
    },
    {
      id: '3:2',
      name: 'A',
      type: 'CONNECTOR',
      absoluteBoundingBox: box(500, 440, 100, 20),
      connectorStart: '2:2',
      connectorEnd: '2:3',
      connectorEndCap: 'ARROW_LINES',
    },
    { id: '4:1', name: 'Voting', type: 'WIDGET', absoluteBoundingBox: box(600, 700, 300, 200) },
  ],
};
const { strokes } = toStrokes(
  normalizeDocument(DOC, { fileKey: 'Em6NOwaOFTYV7NlQT4NK8l', surface: 'board' }),
  { resetIds: true, widgetsAsPictures: true }
);
const usable = strokes.filter(
  (s: { tool: string; href?: string }) => s.tool !== 'image' || Boolean(s.href)
);
const r = strokesIntoOps(usable, { existing: [], at: { x: 4100, y: 100 }, tag: 'abcde' });
writeFileSync(process.argv[2], JSON.stringify({ ops: r.ops }));
console.log(
  'ops',
  r.ops.length,
  'items',
  r.count,
  'section',
  JSON.stringify(r.section).slice(0, 120)
);
