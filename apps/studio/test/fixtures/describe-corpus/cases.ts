// Hand-written edits of `canvas.tsx` with the exact lines `describeChanges` must produce (V2-1.9 §7 H2: the
// frozen edge cases — comment-only, mapped family, JSX in `note=`, frame-rendered `<WebStyles/>`,
// `sb-role--` prefix classes, a section removed). A line is `[kind, grade, artboards, words]`.

import type { ChangeKind, Grade } from '../../../history/describe';

export type Line = [ChangeKind, Grade, string[], string];

export interface Case {
  name: string;
  /** [from, to] replacements applied once each, in order. */
  edit: Array<[string, string]>;
  expect: Line[];
}

export const CASES: Case[] = [
  {
    name: 'comment-only change is no change',
    edit: [['{/* the hero */}', '{/* the hero block */}']],
    expect: [],
  },
  {
    name: 'a data-cd-id stamped on an element is no change',
    edit: [['<ul className="fx-list">', '<ul data-cd-id="steps" className="fx-list">']],
    expect: [],
  },
  {
    name: 'formatting only is no change',
    edit: [['<li>One</li>', '<li>\n              One\n            </li>']],
    expect: [],
  },
  {
    name: 'style colour',
    edit: [["color: '#ffffff'", "color: '#000000'"]],
    expect: [['style', 'W1', ['home'], '“Welcome back”: Text colour white → black']],
  },
  {
    name: 'same colour word shows the exact values',
    edit: [["background: '#000000', padding: 24", "background: '#050505', padding: 24"]],
    expect: [['style', 'W1', ['home'], 'Frame: Fill #000000 → #050505']],
  },
  {
    name: 'style number gets its unit',
    edit: [['padding: 24', 'padding: 32']],
    expect: [['style', 'W1', ['home'], 'Frame: Padding 24 → 32 px']],
  },
  {
    name: 'style property added',
    edit: [['padding: 24 }}', 'padding: 24, borderRadius: 8 }}']],
    expect: [['style', 'W1', ['home'], 'Frame: Corner set to 8 px']],
  },
  {
    name: 'style property removed',
    edit: [['background: tone, width: 120 }}', 'background: tone }}']],
    expect: [['style', 'W1', ['home', 'pricing'], 'Jersey › Frame: Width removed (was 120 px)']],
  },
  {
    name: 'computed value reads as a formula',
    edit: [['gap: 16', 'gap: 8 * 2 + 1']],
    expect: [['style', 'W2', ['pricing'], 'Frame: Gap 16 px → a formula']],
  },
  {
    name: 'text of a button names the role, not the text it changes',
    edit: [['Buy now', 'Buy it now']],
    expect: [['text', 'W1', ['home'], 'Button: Text “Buy now” → “Buy it now”']],
  },
  {
    name: 'long text keeps two words of context',
    edit: [['from 10 pieces in one basket', 'from 9 pieces in one basket']],
    expect: [
      [
        'text',
        'W1',
        ['home'],
        'Note: Text “…orders from 10 pieces in…” → “…orders from 9 pieces in…”',
      ],
    ],
  },
  {
    name: 'attribute',
    edit: [['alt="Team on the pitch"', 'alt="Squad on the pitch"']],
    expect: [
      ['attr', 'W1', ['home'], 'Image: Alt text “Team on the pitch” → “Squad on the pitch”'],
    ],
  },
  {
    name: 'numeric attribute',
    edit: [['width={120} />', 'width={150} />']],
    expect: [['attr', 'W1', ['home'], '“Team on the pitch”: Width 120 → 150 px']],
  },
  {
    name: 'class swapped',
    edit: [['fx-btn fx-btn--primary', 'fx-btn fx-btn--ghost']],
    expect: [['class', 'W1', ['home'], '“Buy now”: Style “fx-btn--primary” → “fx-btn--ghost”']],
  },
  {
    name: 'element added',
    edit: [['<li>Three</li>', '<li>Three</li>\n            <li>Four</li>']],
    expect: [['added', 'W1', ['home'], '“Four” added']],
  },
  {
    name: 'element removed',
    edit: [['            <li>Two</li>\n', '']],
    expect: [['removed', 'W1', ['home'], '“Two” removed']],
  },
  {
    name: 'wrapped in a frame',
    edit: [
      [
        '<button type="button" className="fx-btn fx-btn--primary">\n              Buy now\n            </button>',
        '<div><button type="button" className="fx-btn fx-btn--primary">\n              Buy now\n            </button></div>',
      ],
    ],
    expect: [['wrapped', 'W1', ['home'], 'Frame added around “Buy now”']],
  },
  {
    name: 'unwrapped',
    edit: [
      ['<div className="fx-hero" style={{ background: \'#000000\', padding: 24 }}>\n', ''],
      ['<Jersey number={9} tone={GOLD} />\n          </div>', '<Jersey number={9} tone={GOLD} />'],
    ],
    expect: [['unwrapped', 'W1', ['home'], 'Frame removed from around 5 elements']],
  },
  {
    name: 'siblings reordered',
    edit: [
      ['<li>Two</li>\n            <li>Three</li>', '<li>Three</li>\n            <li>Two</li>'],
    ],
    expect: [['reordered', 'W1', ['home'], '“Three” moved up']],
  },
  {
    name: 'artboard resized',
    edit: [['id="home" label="Homepage" width={390}', 'id="home" label="Homepage" width={1080}']],
    expect: [['artboard-resized', 'W1', ['home'], '“Homepage”: size 390 × 800 → 1080 × 800']],
  },
  {
    name: 'artboard renamed',
    edit: [['label="Pricing"', 'label="Plans"']],
    expect: [['artboard-renamed', 'W1', ['pricing'], 'Artboard “Pricing” renamed to “Plans”']],
  },
  {
    name: 'artboard added',
    edit: [
      [
        '</DCSection>\n      <DCSection id="discs-s"',
        '<DCArtboard id="extra" label="Extra" width={300} height={300}>\n          <p>New</p>\n        </DCArtboard>\n      </DCSection>\n      <DCSection id="discs-s"',
      ],
    ],
    expect: [['artboard-added', 'W1', ['extra'], 'Artboard “Extra” added']],
  },
  {
    name: 'mapped family is one entry, every instance',
    edit: [['<div className="fx-disc">', '<div className="fx-disc fx-disc--big">']],
    expect: [['class', 'W1', ['disc-*'], 'Frame: Style “fx-disc--big” added']],
  },
  {
    name: 'family resized',
    edit: [['width={200} height={200}', 'width={240} height={200}']],
    expect: [['artboard-resized', 'W1', ['disc-*'], '“Disc”: size 200 × 200 → 240 × 200']],
  },
  {
    name: 'literal in a shared component reaches every artboard that renders it',
    edit: [
      [
        'width: 120 }}>\n      <span className="fx-jersey-no">',
        'width: 140 }}>\n      <span className="fx-jersey-no">',
      ],
    ],
    expect: [['style', 'W1', ['home', 'pricing'], 'Jersey › Frame: Width 120 → 140 px']],
  },
  {
    name: 'data array item by item',
    edit: [["label: 'Picture'", "label: 'Image'"]],
    expect: [['data', 'W1', ['pricing'], 'Tools › “image”: Label “Picture” → “Image”']],
  },
  {
    name: 'scalar array literal reaches through a component',
    edit: [["const MINI = ['sticky', 'image'];", "const MINI = ['sticky', 'frame'];"]],
    expect: [['data', 'W1', ['home', 'pricing'], 'Mini: “image” → “frame”']],
  },
  {
    name: 'shared constant',
    edit: [["const GOLD = '#c9a227';", "const GOLD = '#123456';"]],
    expect: [['data', 'W1', ['home'], 'Gold: yellow → dark blue']],
  },
  {
    name: 'JSX in an attribute slot',
    edit: [['Syncs while you work', 'Syncs in the background']],
    expect: [
      ['text', 'W1', ['home'], 'Note: Text “Syncs while you work” → “Syncs in the background”'],
    ],
  },
  {
    name: 'a frame-rendered declaration reaches every artboard',
    edit: [['.fx-hero{display:flex}', '.fx-hero{display:grid}']],
    expect: [
      [
        'text',
        'W1',
        ['home', 'pricing', 'disc-*'],
        'Web styles › Style: Text “.fx-hero{display:flex}” → “.fx-hero{display:grid}”',
      ],
    ],
  },
  {
    name: 'section renamed',
    edit: [['title="Discs"', 'title="Round ones"']],
    expect: [['section', 'W1', [], 'Section “Discs” renamed to “Round ones”']],
  },
  {
    name: 'section removed takes its artboards with it',
    edit: [
      [
        // biome-ignore lint/suspicious/noTemplateCurlyInString: JSX source text, not a template
        '      <DCSection id="discs-s" title="Discs">\n        {DISCS.map((d) => (\n          <DCArtboard key={d.id} id={`disc-${d.id}`} label={d.name} width={200} height={200}>\n            <div className="fx-disc">{d.name}</div>\n          </DCArtboard>\n        ))}\n      </DCSection>\n',
        '',
      ],
    ],
    expect: [
      ['artboard-removed', 'W1', ['disc-*'], 'Artboard “Disc” removed'],
      ['section', 'W1', [], 'Section “Discs” removed'],
    ],
  },
  {
    name: 'element moved to another artboard',
    edit: [
      ['<Note>Free shipping on orders from 10 pieces in one basket</Note>\n', ''],
      [
        '<div className="fx-pricing" style={{ gap: 16 }}>',
        '<Note>Free shipping on orders from 10 pieces in one basket</Note>\n          <div className="fx-pricing" style={{ gap: 16 }}>',
      ],
    ],
    expect: [
      ['moved', 'W1', ['home', 'pricing'], '“Free shipping on orders from…” moved into “Pricing”'],
    ],
  },
  {
    name: 'imports alone are the one path to "Changed this canvas"',
    edit: [
      [
        "import type { ReactNode } from 'react';",
        "import type { ReactNode } from 'react';\nimport { thing } from './thing';",
      ],
    ],
    expect: [['imports', 'F', [], 'Changed this canvas']],
  },
  {
    name: 'a hook the describer cannot read is "Changed this canvas"',
    edit: [
      [
        'export default function Fixture() {\n',
        'export default function Fixture() {\n  useThing();\n',
      ],
    ],
    expect: [['canvas', 'F', [], 'Changed this canvas']],
  },
];
