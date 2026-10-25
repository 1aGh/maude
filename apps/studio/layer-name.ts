// apps/studio/layer-name.ts — P8 C5 (05 es-filter, 14): the name a Layers row wears when the author named
// nothing. A raw tag ("div", "h1", "p", "div.hero") is the code's word; the row says what the thing is, in the
// words the toolbar and the Inspector use (Heading, Text, Button, Image, Frame …). Leaf module, no DOM.

const TAG_WORD: Readonly<Record<string, string>> = Object.freeze({
  h1: 'Heading',
  h2: 'Heading',
  h3: 'Heading',
  h4: 'Heading',
  h5: 'Heading',
  h6: 'Heading',
  p: 'Text',
  span: 'Text',
  strong: 'Text',
  em: 'Text',
  small: 'Text',
  label: 'Label',
  a: 'Link',
  button: 'Button',
  img: 'Image',
  picture: 'Image',
  svg: 'Icon',
  video: 'Video',
  audio: 'Audio',
  canvas: 'Canvas',
  ul: 'List',
  ol: 'List',
  li: 'List item',
  nav: 'Navigation',
  form: 'Form',
  input: 'Field',
  textarea: 'Field',
  select: 'Field',
  header: 'Header',
  footer: 'Footer',
  section: 'Section',
  article: 'Section',
  main: 'Page',
  aside: 'Sidebar',
  table: 'Table',
  hr: 'Divider',
});

const ROLE_WORD: Readonly<Record<string, string>> = Object.freeze({
  button: 'Button',
  heading: 'Heading',
  link: 'Link',
  img: 'Image',
  list: 'List',
  listitem: 'List item',
  navigation: 'Navigation',
  banner: 'Header',
  contentinfo: 'Footer',
  main: 'Page',
  textbox: 'Field',
});

/** "Heading", "Text", "Frame" …: the plain-words name of an unnamed element. */
export function plainLayerName(tag: string, role?: string | null): string {
  const r = (role ?? '').trim().toLowerCase();
  if (r && ROLE_WORD[r]) return ROLE_WORD[r];
  return TAG_WORD[tag.toLowerCase()] ?? 'Frame';
}

// ── P8 C7 (08 ak-mixed-fit, 01 cf-frames-text): the name an unnamed element wears is what it SAYS ──────────────
// A Layers row for a text reads its words ("Calm software, made in Brno"), a picture reads its alt or its file
// ("Hero photo"), exactly as the 01 board draws them. Only when there are no words does `plainLayerName` speak
// ("Heading", "Image", "Frame"). A Frame is never named after what it holds: that would call a container a thing it
// is not.

const SAYS_ITS_TEXT: ReadonlySet<string> = new Set([
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'span',
  'strong',
  'em',
  'small',
  'label',
  'a',
  'button',
]);

const PICTURE_TAGS: ReadonlySet<string> = new Set(['img', 'picture', 'video']);

/** Callers read an element's text / source only when its name could use it (a big Frame's text is a long walk). */
export const saysItsText = (tag: string): boolean => SAYS_ITS_TEXT.has(tag.toLowerCase());
export const isPictureTag = (tag: string): boolean => PICTURE_TAGS.has(tag.toLowerCase());

/** A row's width is small: a long sentence is cut at a word and ends in an ellipsis. */
export const LAYER_NAME_MAX = 28;

/** "  Calm   software, made in Brno and beyond " → "Calm software, made in…" */
export function snippetOf(text: string, max = LAYER_NAME_MAX): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const at = cut.lastIndexOf(' ');
  return `${(at > max / 2 ? cut.slice(0, at) : cut).replace(/[\s,.;:–—-]+$/, '')}…`;
}

/** "./photos/hero_photo-2.JPG?v=3" → "Hero photo 2". A data: URI or an opaque id says nothing → ''. */
export function fileWords(src: string | null | undefined): string {
  if (!src || /^(data|blob):/i.test(src)) return '';
  const last = (src.split(/[?#]/)[0] ?? '').split('/').filter(Boolean).pop() ?? '';
  let name = last;
  try {
    name = decodeURIComponent(last);
  } catch {
    /* keep the raw segment */
  }
  const stem = name
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/[-_.]+/g, ' ')
    .trim();
  // a bare hash / number is the code's word, not a person's
  if (!stem || /^[0-9a-f]{8,}$/i.test(stem) || /^\d+$/.test(stem)) return '';
  return snippetOf(stem.charAt(0).toUpperCase() + stem.slice(1));
}

/**
 * The name for an element nobody named. `text` is its text content, `alt` / `src` a picture's.
 * Order: a text says its words; a picture says its alt, then its file; anything else (or no words) the plain word.
 */
export function displayLayerName(el: {
  tag: string;
  role?: string | null;
  text?: string | null;
  alt?: string | null;
  src?: string | null;
}): string {
  const tag = el.tag.toLowerCase();
  if (SAYS_ITS_TEXT.has(tag)) {
    const words = snippetOf(el.text ?? '');
    if (words) return words;
  }
  if (PICTURE_TAGS.has(tag)) {
    const alt = snippetOf(el.alt ?? '');
    if (alt) return alt;
    const file = fileWords(el.src);
    if (file) return file;
  }
  return plainLayerName(tag, el.role);
}
