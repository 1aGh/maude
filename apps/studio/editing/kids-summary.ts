/**
 * @file kids-summary.ts
 * @purpose What an auto-layout frame's children are, as one sentence the Layout card says (14 Editing, ed-lay-auto:
 *          "3 cards, each Fills the width."). Pure: the canvas collects plain facts per child (dom-selection.ts), this
 *          reads them into a count, a kind and ONE width sizing word — Hug / Fill / Fixed, or "mixed" — the same
 *          words the Size row speaks.
 */
import { isMainAxis, type ParentLayout } from '../sizing-mode.ts';
import { tagWord } from './crumbs.ts';

export type KidWidth = 'hug' | 'fill' | 'fixed';

/** What the canvas reads off one child: its tag and its authored inline width / flex values ('' = not authored). */
export interface KidFacts {
  tag: string;
  width: string;
  flexGrow: string;
  alignSelf: string;
}

export interface KidsSummary {
  count: number;
  /** the children's shared tag, '' when they differ */
  tag: string;
  width: KidWidth | 'mixed';
}

type FlexParent = ParentLayout & { alignItems?: string };

const HUG = new Set(['fit-content', 'max-content', 'min-content', 'auto']);
const FILL = new Set(['100%', 'fill', '-webkit-fill-available', 'stretch']);
const isFlex = (d?: string) => d === 'flex' || d === 'inline-flex';

/** One child's width in the frame's own terms. */
export function kidWidth(parent: FlexParent, k: KidFacts): KidWidth {
  const w = k.width.trim().toLowerCase();
  if (FILL.has(w)) return 'fill';
  if (HUG.has(w)) return 'hug';
  if (/^-?\d/.test(w)) return 'fixed';
  // nothing authored: the frame's layout decides
  if (isMainAxis('width', parent))
    return Number.parseFloat(k.flexGrow || '0') >= 1 ? 'fill' : 'hug';
  const self = k.alignSelf.trim() || 'auto';
  const items = (parent.alignItems || 'normal').trim();
  return self === 'stretch' || (self === 'auto' && (items === 'normal' || items === 'stretch'))
    ? 'fill'
    : 'hug';
}

/** Two or more children of an auto-layout (flex) frame; nothing for anything else. */
export function summarizeKids(parent: FlexParent, kids: KidFacts[]): KidsSummary | undefined {
  if (!isFlex(parent.display) || kids.length < 2) return undefined;
  const widths = new Set(kids.map((k) => kidWidth(parent, k)));
  const tags = new Set(kids.map((k) => k.tag.toLowerCase()));
  return {
    count: kids.length,
    tag: tags.size === 1 ? [...tags][0] : '',
    width: widths.size === 1 ? [...widths][0] : 'mixed',
  };
}

/** "3 frames, each Fills the width." — the kind word is the Layers' own (Frame, Button, Text …), plural. */
export function kidsLine(s: KidsSummary | null | undefined): string {
  if (!s || !(s.count >= 2)) return '';
  const noun = s.tag ? `${tagWord(s.tag).toLowerCase()}s` : 'items';
  const how =
    s.width === 'fill'
      ? 'each Fills the width'
      : s.width === 'hug'
        ? 'each Hugs its content'
        : s.width === 'fixed'
          ? 'each a fixed width'
          : 'widths differ';
  return `${s.count} ${noun}, ${how}.`;
}
