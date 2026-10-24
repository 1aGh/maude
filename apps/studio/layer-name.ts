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
