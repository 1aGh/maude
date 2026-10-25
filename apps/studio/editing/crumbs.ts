// editing/crumbs.ts — the selection's breadcrumb, name tag and kind (S2.1, artboard ed-obj-enter;
// S2-edit-ops.md §7). Pure over a small node shape so the rules are testable without a DOM;
// `editing/selection.tsx` reads the DOM into it.
//
//   crumbs: "Desktop › Services › Brand systems" — the artboard, then every stamped ancestor
//           inside its body, then the selected object; outermost first. `ref: null` = the artboard.
//   tag:    "Brand systems · 400 × 232" — the selected object's name and its size in world px.
//   kind:   the inspector's kind chip (S2.2, C16): frame · text · image · path · shape · instance ·
//           artboard · multi.

import type { SelectionCrumb, SelectionKind } from '../bridge/dgn-protocol.ts';
import type { ElementRef } from '../edit-ops/types.ts';

/** One rung, as the DOM shows it. */
export interface CrumbNode {
  /** `data-cd-id` (authored or computed); null for the artboard */
  id: string | null;
  occurrence?: number;
  /** `data-dc-element` (the layer name) */
  name?: string | null;
  aria?: string | null;
  /** own text, whitespace collapsed */
  text?: string;
  tag: string;
  /** a DCArtboard: its label */
  artboardLabel?: string;
}

const MAX_LABEL = 40;
/** the readable ids `object.insert-shape` / `object.frame` / `object.insert-path` mint */
const DRAWN_ID = /^(frame|rectangle|ellipse|line|polygon|path)(?:-\d+)?$/;

function sentence(s: string): string {
  const t = s.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

function clip(s: string): string {
  return s.length > MAX_LABEL ? `${s.slice(0, MAX_LABEL - 1)}…` : s;
}

const TEXT_TAGS = new Set([
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'span',
  'label',
  'li',
  'blockquote',
  'figcaption',
  'em',
  'strong',
  'small',
]);

/**
 * What a rung is called when the designer named nothing and it carries no words: the KIND word the inspector's chip
 * speaks (CONTRACT: Frame · Text · Button · Photo …), never the code's own word — "div", "h1.dc-text-editing".
 */
export function tagWord(tag: string): string {
  const t = tag.toLowerCase();
  if (t === 'img' || t === 'picture' || t === 'image') return 'Photo';
  if (t === 'video') return 'Video';
  if (t === 'button') return 'Button';
  if (t === 'a') return 'Link';
  if (t === 'svg' || t === 'path') return 'Shape';
  if (TEXT_TAGS.has(t)) return 'Text';
  return 'Frame';
}

/** A rung's words: layer name → aria-label → the first words of its own text → the kind word (never the tag). */
export function crumbLabel(n: CrumbNode): string {
  if (n.artboardLabel !== undefined) return clip(n.artboardLabel.trim() || 'Artboard');
  if (n.name) return clip(sentence(n.name));
  if (n.aria) return clip(n.aria.trim());
  const words = (n.text ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 3).join(' ');
  if (words) return clip(words);
  // S2.23 G8: a shape the drawing tools made is named by the id they gave it ("rectangle", "ellipse-2"): the
  // tag reads "Rectangle · 120 × 27", not "div · 120 × 27". The id is the name the Layers panel would show.
  const drawn = n.id ? DRAWN_ID.exec(n.id) : null;
  if (drawn) return sentence(drawn[1]);
  return tagWord(n.tag);
}

/** `chain` is the artboard first, the selected object last. */
export function buildCrumbs(artboardId: string, chain: CrumbNode[]): SelectionCrumb[] {
  return chain.map((n) => ({
    label: crumbLabel(n),
    ref:
      n.id === null
        ? null
        : ({
            artboard: artboardId,
            element: n.id,
            ...(n.occurrence ? { occurrence: n.occurrence } : {}),
          } satisfies ElementRef),
  }));
}

/** The crumbs as one line (tests, VoiceOver): "Desktop › Services › Brand systems". */
export function crumbsText(crumbs: readonly SelectionCrumb[]): string {
  return crumbs.map((c) => c.label).join(' › ');
}

/** "Brand systems · 400 × 232" — sizes are world px, rounded. */
export function nameTag(label: string, w: number, h: number): string {
  return `${label} · ${Math.round(w)} × ${Math.round(h)}`;
}

/** 14 ed-lay-auto: while a gap is dragged the tag names what is being laid out — "Services → Auto layout". */
export function layoutTag(label: string): string {
  return `${label} → Auto layout`;
}

/** A name tag as [name, regular-weight tail]: "Brand systems · 400 × 232" → ["Brand systems", " · 400 × 232"]. */
export function tagParts(text: string): [string, string] {
  const dot = text.lastIndexOf(' · ');
  const arrow = text.indexOf(' → ');
  const at = dot >= 0 ? dot : arrow;
  return at < 0 ? [text, ''] : [text.slice(0, at), text.slice(at)];
}

/** The node facts the kind rule reads. */
export interface KindFacts {
  tag: string;
  /** child element count */
  elements: number;
  /** non-empty own text */
  hasText: boolean;
  /** rendered by a design-system / local component (`data-dc-component`) */
  component?: boolean;
  /** drawn by the Shape tools (S2.13): carries `data-shape` */
  shape?: boolean;
  /** drawn by the Pen (S2.14): `data-shape="path"` — a Path, not a Shape */
  path?: boolean;
}

const SHAPE_TAGS = new Set(['rect', 'circle', 'ellipse', 'polygon', 'line', 'polyline']);
const IMAGE_TAGS = new Set(['img', 'picture', 'video', 'image']);

export function selectionKind(count: number, facts: KindFacts | null): SelectionKind {
  if (count > 1) return 'multi';
  if (!facts) return 'artboard';
  if (facts.component) return 'instance';
  if (facts.path) return 'path';
  if (facts.shape) return 'shape';
  const tag = facts.tag.toLowerCase();
  if (IMAGE_TAGS.has(tag)) return 'image';
  if (tag === 'path') return 'path';
  if (SHAPE_TAGS.has(tag)) return 'shape';
  if (tag === 'svg') return facts.elements === 1 ? 'path' : 'frame';
  if (facts.elements === 0 && facts.hasText) return 'text';
  return 'frame';
}
