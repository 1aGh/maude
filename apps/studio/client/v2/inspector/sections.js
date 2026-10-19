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
