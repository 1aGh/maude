// client/v2/inspector/sections.js — S2.2: the ten sections of the inspector, in the order and words the
// canvas draws (.design/ui/v2/14 Editing.tsx, artboard `ed-inspector`, Gate 0 D18).
//
// FIXED: this table is the frame's numbering, not a registry. A section's BODY is a slot entry
// (slots.js) that S2.3 (Position · Size · Layout), S2.4 (Fill · Corners · Border · Effects · Type),
// S2.5 (Interaction) and S8 (Export) register from their own files. Advanced is not a section: it is
// the fold at the foot (advanced.jsx).
//
//   adder   — the section draws a "+" in its header when its body offers `add` (Fill adds another fill,
//             Border adds a border, Effects another effect, Interaction a trigger, Export a size).
//   aside   — a quiet word beside the title ('text inside'), or 'unlink' (Corners: one value, or each).
//   explain — the one-line explainer from the canvas's right-hand column; it is the section header's hover
//             and its accessible description. CONTRACT §3 words.

/** @type {ReadonlyArray<Readonly<{ n: number, id: string, title: string, explain: string, adder?: boolean, aside?: string }>>} */
export const SECTIONS = Object.freeze(
  [
    // S2.15 — a picture's own rows come first (14 Editing, ed-img). Both are drawn for the Image kind only: the frame
    // draws a section only when a body is registered for the selected kind. Numbered after the ten drawn ones and S2.14's Combine (11).
    {
      // P8 c10 (14 ed-pen): the point of a Pen path being edited — Corner Smooth / Sharp and X · Y. Drawn for a path only.
      n: 28,
      id: 'point',
      title: 'Point',
      explain:
        'The point you picked on the path: Smooth bends through it, Sharp turns a corner. X and Y say where it sits; typing moves it.',
    },
    {
      n: 12,
      id: 'image',
      title: 'Image',
      explain:
        'The picture, its size and how it fits the frame: Fill crops it to fit, Fit shows all of it, Crop moves and zooms it inside the frame, Tile repeats it.',
    },
    {
      n: 13,
      id: 'adjust',
      title: 'Adjust',
      explain: 'The look of the picture and its background open Photo.',
    },
    {
      n: 1,
      id: 'position',
      title: 'Position',
      explain:
        'Where it sits inside its frame. Constraints say which edges it keeps when the frame grows.',
    },
    {
      n: 2,
      id: 'size',
      title: 'Size',
      explain: 'Hug wraps the content, Fill takes the room the frame gives, Fixed is a number.',
    },
    {
      n: 3,
      id: 'layout',
      title: 'Layout',
      explain:
        "Auto layout: direction, gap, spacing (Packed or Space between), padding H and V, alignment. Values come from the system's space; a number that isn't in it shows plainly with Bind.",
    },
    {
      n: 4,
      id: 'fill',
      title: 'Fill',
      adder: true,
      explain:
        'Colour from the Design system first; + adds another fill — a colour, a gradient or an image.',
    },
    {
      n: 5,
      id: 'corners',
      title: 'Corners',
      aside: 'unlink',
      explain:
        'One home on every object: one value, or unlink for each corner. Round, XS … XL from the system.',
    },
    {
      n: 6,
      id: 'border',
      title: 'Border',
      adder: true,
      explain:
        'Empty until you add one with +. Inside, centre or outside. Lines and Pen paths call it Stroke.',
    },
    {
      n: 7,
      id: 'effects',
      title: 'Effects',
      adder: true,
      explain:
        "Shadows are the system's elevation — Flat, Resting, Floating, Sheet — the lowered, soft kind.",
    },
    {
      n: 8,
      id: 'type',
      title: 'Type',
      aside: 'text inside',
      explain: 'For the text inside. The style first; size and weight override it, with a dot.',
    },
    {
      // S2.14 (ed-pen): "Two or more" — greyed for one shape, live for several. Drawn only for shapes and paths.
      n: 11,
      id: 'combine',
      title: 'Combine shapes',
      explain:
        'Union, Subtract, Intersect or Exclude two or more shapes into one path. The shapes stay editable points; it exports as plain SVG.',
    },
    {
      n: 9,
      id: 'interaction',
      title: 'Interaction',
      adder: true,
      explain:
        'Where a click goes and what a hover does. Preview plays it; Edit shows the link while selected.',
    },
    {
      // S7.13 (07 ve-formats): a video artboard only — the cut it shares with its other formats.
      n: 27,
      id: 'formats',
      title: 'Formats',
      explain:
        'Videos that play this same cut at another size. Trim or retitle once and all of them follow; each keeps its own framing. Make an unlinked copy when one needs its own cut.',
    },
    {
      // S7.22 (08 ak-safe-zones): a fixed-size or video artboard only — drawn when a body is registered for it.
      n: 22,
      id: 'safe-zones',
      title: 'Safe zones',
      // 08 ak-social: two plain rows ("Safe zones", "Show on canvas") under the size — no heading that repeats the row
      headless: true,
      explain:
        'Where a platform’s own interface covers the artboard. Drawn on the canvas for you; never exported.',
    },
    {
      // S7.10 (07 ve-transition, ve-text): a clip you select on the Timeline, and a title — drawn for those kinds only.
      n: 23,
      id: 'clip',
      title: 'Clip',
      explain:
        'How long it plays, how fast, how loud and how the picture sits. The file, the in and out points, Grade, Crop and the join after it are under Advanced.',
    },
    {
      // S7.12 (07 ve-music): a song you select on the Timeline's Music track — drawn for that kind only.
      n: 26,
      id: 'music',
      title: 'Music',
      explain:
        'How loud it plays, whether it steps aside while someone speaks, and whether edits land on its beat. The tempo and the exact numbers are under Advanced.',
    },
    {
      n: 24,
      id: 'title-motion',
      title: 'Title',
      explain:
        'The words, how they come in — None, Fade, Slide up, Pop, Type on or Per word — and how long the title stays.',
    },
    {
      // S7.11 (07 ve-captions): the captions you select on the Text track — drawn for that kind only.
      n: 25,
      id: 'captions',
      title: 'Captions',
      explain:
        'How the words under the picture look: the font, the colour of the word being said, where they sit and how many show at once. The words themselves are in the Transcript.',
    },
    {
      n: 10,
      id: 'export',
      title: 'Export',
      adder: true,
      explain: 'This object as PNG or SVG — artboards export the same way, plus ⇧⌘E.',
    },
  ].map((s) => Object.freeze(s))
);

export const SECTION_IDS = Object.freeze(SECTIONS.map((s) => s.id));

const BY_ID = new Map(SECTIONS.map((s) => [s.id, s]));
export const sectionById = (id) => BY_ID.get(id);

/**
 * The sections in the order a kind draws them. An artboard puts Fill before Layout (14 Editing, ed-ab-select:
 * Artboard, Fill, Layout, Export); every other kind keeps the table's order.
 */
/**
 * V2-8.5 C2 (14 Editing R5) — what each kind draws, in the order its board draws it. The ten-section list is the
 * Button's (`ed-inspector`); every other kind opens on its own thing: a text on its Type (style first), a picture on
 * Image and Adjust, a shape on Shape · Corners · Fill · Border · Effects, an instance on Component · Content (blocks,
 * no sections), several boards on the one list that fits them all. A kind not named here keeps the table.
 * Position and Size stay last for a text and a picture: the board draws no geometry for them, but a number that sets
 * where it sits must stay one click from the inspector (Advanced holds the CSS, not the numbers).
 */
export const KIND_SECTIONS = Object.freeze({
  text: ['type', 'fill', 'position', 'size', 'interaction', 'export'],
  shape: ['size', 'corners', 'fill', 'border', 'effects', 'position', 'interaction', 'export'],
  // 14 ed-pen: a Pen path opens on its point, then its Stroke; Combine shapes follows; where it sits stays one click away
  path: ['point', 'border', 'fill', 'combine', 'position', 'size', 'effects', 'interaction', 'export'],
  image: ['image', 'adjust', 'position', 'size', 'interaction', 'export'],
  instance: [],
  'multi-artboard': ['size', 'fill', 'safe-zones', 'export'],
});

export function sectionsFor(kindId, opts = {}) {
  // V2-8.5 c6 (14 ed-lay-auto): a frame that runs an auto layout and that no layout places leads with Layout, then
  // Size ("Layout · Auto", Direction, Gap, Padding, Align; Size) — an object IN a layout keeps Position first
  // ("In Services · Set by Services") because who places it is its first fact.
  if (opts.layoutFirst) {
    const lead = ['layout', 'size', 'position'];
    return [...lead.map((id) => BY_ID.get(id)), ...SECTIONS.filter((s) => !lead.includes(s.id))];
  }
  const named = KIND_SECTIONS[kindId];
  if (named) return named.map((id) => BY_ID.get(id));
  // 08 ak-web-hug (owns the Artboard card): Width · Height · Layout · Fill · Other widths — the table's own order
  return SECTIONS;
}
