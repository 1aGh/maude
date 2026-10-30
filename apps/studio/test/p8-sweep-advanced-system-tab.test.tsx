// p8-sweep-advanced — the dead-control crawl opened the Design system tab through the inspector's "Uses <system>" door
// and then watched the shell ask the server about elements of a canvas called `__system__` (SYSTEM_TAB): a 400 from
// GET /_api/edit-instance and a 500 from GET /_api/edit-scope on every visit. The Design system tab is not a canvas
// file, so neither question is asked of it (the same rule p8-sweep-leftovers item 5 gave comp-media).
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SYSTEM_TAB } from '../client/shell/constants.js';

const realFetch = globalThis.fetch;
const asked: string[] = [];
beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.fetch = (async (url: string) => {
    asked.push(String(url));
    return new Response(JSON.stringify({ ok: false }), { status: 400 });
  }) as unknown as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
  GlobalRegistrator.unregister();
});
const roots: Root[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
  asked.length = 0;
});

describe('the Design system tab is not a canvas file', () => {
  test('the instance question is not asked of it, and still is of a real canvas', async () => {
    const { useInstanceSelection } = await import('../client/v2/inspector/kinds/instance.jsx');
    const el = { id: 'card-1', index: 0, text: 'Card', authored: {} };
    function Probe({ file }: { file: string }) {
      useInstanceSelection(el, file);
      return null;
    }
    const mountFile = async (file: string) => {
      const host = document.createElement('div');
      document.body.append(host);
      const root = createRoot(host);
      roots.push(root);
      await act(async () => root.render(<Probe file={file} />));
    };
    await mountFile(SYSTEM_TAB);
    expect(asked.filter((u) => u.includes('/_api/edit-instance'))).toEqual([]);
    await mountFile('.design/ui/Landing.tsx');
    expect(asked.filter((u) => u.includes('/_api/edit-instance'))).toHaveLength(1);
  });

  test('the edit-scope question is not asked of it, and still is of a real canvas', async () => {
    const { editScopeQuery } = await import('../client/hooks/edit-scope-query.js');
    const el = { id: 'card-1' };
    expect(editScopeQuery(SYSTEM_TAB, el)).toBeNull();
    expect(editScopeQuery(null, el)).toBeNull();
    expect(editScopeQuery('.design/ui/Landing.tsx', null)).toBeNull();
    expect(editScopeQuery('.design/ui/Landing.tsx', [el, el])).toBeNull();
    expect(editScopeQuery('.design/ui/Landing.tsx', [el])).toBe(
      'canvas=.design%2Fui%2FLanding.tsx&id=card-1'
    );
    expect(editScopeQuery('.design/ui/Landing.tsx', el)).toBe(
      'canvas=.design%2Fui%2FLanding.tsx&id=card-1'
    );
  });
});
