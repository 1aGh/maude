// S2.21 (ed-edge-keys) — the inspector has no accessibility blockers a keyboard or a screen-reader user would hit.
// axe-core is not a dependency of this repo, so this is the structural half of its critical/serious rules, run
// over the rendered inspector for a frame, a text and a drawn shape: button-name, input-field-label, link-name,
// image-alt, aria-valid-attr, aria-valid-attr-value (id references resolve), aria-roles, duplicate-id,
// tabindex (no positive values), aria-hidden-focus. The contrast and landmark rules need a real browser;
// `/flow:validate-a11y` carries that evidence.

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const realFetch = globalThis.fetch;
beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.fetch = (async (url: string) =>
    String(url).endsWith('.css')
      ? new Response(':root{--radius-md:8px;--shadow-resting:0 1px 2px #000;}', { status: 200 })
      : new Response(JSON.stringify({ ok: true }), { status: 200 })) as unknown as typeof fetch;
});
afterAll(async () => {
  const { unregisterSections } = await import('../client/v2/inspector/sections/index.js');
  unregisterSections();
  for (const off of reregistered.splice(0)) off();
  globalThis.fetch = realFetch;
  GlobalRegistrator.unregister();
});

const roots: Root[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
});
const settle = () => act(async () => new Promise((r) => setTimeout(r, 20)));

const FILE = '.design/ui/Post.tsx';
const BASE = {
  id: 'frame',
  index: 0,
  file: FILE,
  tag: 'div',
  classes: '',
  selector: '[data-cd-id="frame"]',
  text: '',
  bounds: { x: 24, y: 24, w: 216, h: 216 },
  worldW: 216,
  worldH: 216,
  dom_path: ['div'],
  authored: { 'border-radius': '8px', background: 'var(--accent)' } as Record<string, string>,
  computed: { display: 'flex', position: 'relative' } as Record<string, string>,
  customStyles: {},
  attrs: {} as Record<string, string>,
  parentDisplay: 'block',
  parentFlexDirection: 'row',
  artboardId: 'post',
};
const CFG = {
  designRel: '.design',
  designSystems: [{ name: 'Studio', tokensCssRel: 'system/studio/colors_and_type.css' }],
  defaultDesignSystem: 'Studio',
};

const reregistered: Array<() => void> = [];
let generation = 0;
async function ensureSections() {
  await import('../client/v2/inspector/sections/index.js');
  const { slotsFor } = await import('../client/v2/inspector/slots.js');
  if (slotsFor('corners', 'shape').length) return;
  generation += 1;
  for (const f of ['sections/fill', 'sections/corners', 'sections/border', 'sections/effects']) {
    const mod = (await import(`../client/v2/inspector/${f}.jsx?s221=${generation}`)) as Record<
      string,
      unknown
    >;
    for (const [k, v] of Object.entries(mod))
      if (/^off[A-Z]/.test(k) && typeof v === 'function') reregistered.push(v as () => void);
  }
}

async function inspector(el: Record<string, unknown> = {}) {
  await ensureSections();
  (await import('../client/v2/inspector/kinds/shape.jsx')).registerShapeKind();
  const { InspectorFrame } = await import('../client/v2/inspector/frame.jsx');
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () =>
    root.render(
      <InspectorFrame
        {...({
          selected: { ...BASE, ...el },
          layersTree: { artboardId: 'post', nodes: [] },
          cfg: CFG,
          canvasFile: FILE,
          onOptimistic: () => {},
          onRecordEdit: () => {},
          onReplaceMedia: () => {},
          onUndoRedo: () => {},
        } as never)}
      />
    )
  );
  await settle();
  return host;
}

// ── the rules ───────────────────────────────────────────────────────────────────────────────────

const ROLES = new Set(
  'alert alertdialog application article banner button cell checkbox columnheader combobox complementary contentinfo definition dialog directory document feed figure form generic grid gridcell group heading img link list listbox listitem log main marquee math menu menubar menuitem menuitemcheckbox menuitemradio navigation none note option presentation progressbar radio radiogroup region row rowgroup rowheader scrollbar search searchbox separator slider spinbutton status switch tab table tablist tabpanel term textbox timer toolbar tooltip tree treegrid treeitem'.split(
    ' '
  )
);
const ARIA_ATTRS = new Set(
  'activedescendant atomic autocomplete busy checked colcount colindex colspan controls current describedby description details disabled errormessage expanded flowto haspopup hidden invalid keyshortcuts label labelledby level live modal multiline multiselectable orientation owns placeholder posinset pressed readonly relevant required roledescription rowcount rowindex rowspan selected setsize sort valuemax valuemin valuenow valuetext'.split(
    ' '
  )
);
const REFS = [
  'aria-labelledby',
  'aria-describedby',
  'aria-controls',
  'aria-owns',
  'aria-activedescendant',
];

const text = (e: Element) => (e.textContent ?? '').replace(/\s+/g, ' ').trim();
function name(e: Element, root: Element): string {
  const direct = e.getAttribute('aria-label')?.trim();
  if (direct) return direct;
  const by = e.getAttribute('aria-labelledby');
  if (by) {
    const t = by
      .split(/\s+/)
      .map((id) => document.getElementById(id))
      .filter(Boolean)
      .map((n) => text(n as Element))
      .join(' ');
    if (t) return t;
  }
  const own = text(e);
  if (own) return own;
  if (e.getAttribute('title')?.trim()) return e.getAttribute('title') as string;
  const img = e.querySelector('img[alt], svg[aria-label], [aria-label]');
  if (img) return (img.getAttribute('alt') || img.getAttribute('aria-label') || '').trim();
  const id = e.getAttribute('id');
  if (id) {
    const lab = root.querySelector(`label[for="${CSS.escape(id)}"]`);
    if (lab && text(lab)) return text(lab);
  }
  const wrap = e.closest('label');
  if (wrap && text(wrap)) return text(wrap);
  return '';
}

function violations(root: Element): string[] {
  const out: string[] = [];
  const at = (e: Element) =>
    `${e.tagName.toLowerCase()}${e.id ? `#${e.id}` : ''}[${e.getAttribute('data-testid') ?? ''}]`;
  for (const e of Array.from(root.querySelectorAll('button, [role="button"]')))
    if (!name(e, root)) out.push(`button-name ${at(e)}`);
  for (const e of Array.from(root.querySelectorAll('a[href]')))
    if (!name(e, root)) out.push(`link-name ${at(e)}`);
  for (const e of Array.from(root.querySelectorAll('input, select, textarea'))) {
    const type = (e.getAttribute('type') ?? 'text').toLowerCase();
    if (type === 'hidden' || type === 'submit' || type === 'button') continue;
    if (!name(e, root) && !e.getAttribute('placeholder')) out.push(`input-field-label ${at(e)}`);
  }
  for (const e of Array.from(root.querySelectorAll('img')))
    if (!e.hasAttribute('alt') && e.getAttribute('role') !== 'presentation')
      out.push(`image-alt ${at(e)}`);
  for (const e of Array.from(root.querySelectorAll('[role]'))) {
    const r = (e.getAttribute('role') ?? '').split(/\s+/)[0] ?? '';
    if (!ROLES.has(r)) out.push(`aria-roles ${at(e)} role=${r}`);
  }
  for (const e of Array.from(root.querySelectorAll('*')))
    for (const a of Array.from(e.attributes))
      if (a.name.startsWith('aria-') && !ARIA_ATTRS.has(a.name.slice(5)))
        out.push(`aria-valid-attr ${at(e)} ${a.name}`);
  for (const e of Array.from(root.querySelectorAll('*')))
    for (const ref of REFS) {
      const v = e.getAttribute(ref);
      if (!v) continue;
      // aria-controls may name a popup that is not mounted while closed; the others must resolve
      if (ref === 'aria-controls' || ref === 'aria-owns') continue;
      if (!v.split(/\s+/).some((id) => document.getElementById(id)))
        out.push(`aria-valid-attr-value ${at(e)} ${ref}=${v}`);
    }
  const ids = new Map<string, number>();
  for (const e of Array.from(root.querySelectorAll('[id]')))
    ids.set(e.id, (ids.get(e.id) ?? 0) + 1);
  for (const [id, n] of ids) if (n > 1) out.push(`duplicate-id ${id} ×${n}`);
  for (const e of Array.from(root.querySelectorAll('[tabindex]')))
    if (Number(e.getAttribute('tabindex')) > 0) out.push(`tabindex ${at(e)}`);
  for (const e of Array.from(root.querySelectorAll('[aria-hidden="true"]')))
    if (e.matches('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'))
      out.push(`aria-hidden-focus ${at(e)}`);
  return out;
}

describe('the inspector, keyboard and screen-reader blockers', () => {
  test('the checker sees what it should: a nameless button, a label-less field, a bad role', () => {
    document.body.innerHTML =
      '<div><button></button><input /><span role="bogus"></span><i aria-flub="1"></i><a id="x"></a><a id="x"></a></div>';
    const v = violations(document.body).join('\n');
    for (const r of [
      'button-name',
      'input-field-label',
      'aria-roles',
      'aria-valid-attr ',
      'duplicate-id',
    ])
      expect(v).toContain(r);
  });

  test('a frame: 0 blockers', async () => {
    const host = await inspector();
    expect(host.querySelectorAll('button, input, select, [role]').length).toBeGreaterThan(10);
    expect(violations(host)).toEqual([]);
  });

  test('a text: 0 blockers', async () => {
    const host = await inspector({
      id: 'title',
      tag: 'h1',
      text: 'Calm software',
      dom_path: ['h1'],
    });
    expect(violations(host)).toEqual([]);
  });

  test('a drawn shape: 0 blockers', async () => {
    const host = await inspector({ id: 'rectangle', attrs: { 'data-shape': 'rectangle' } });
    expect(violations(host)).toEqual([]);
  });
});
