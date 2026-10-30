// S5.18 G11 — choosing "Whole canvas" in the chip's menu while an artboard is selected must SEND the whole
// canvas (`artboards: '*'`). The explicit chip choice wins over the selection, also when the selection is
// re-announced (a new array with the same artboard) after the pick.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

type Hook = { current: ReturnType<typeof import('../client/v2/ai/use-ai-scope.js').useAiScope> };

const SEL = (artboardId: string) => ({
  file: 'ui/Site.tsx',
  artboardId,
  selector: 'div',
  index: 0,
});

describe('G11 — the chip choice wins over the selection', () => {
  beforeAll(() => {
    GlobalRegistrator.register();
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    (globalThis as unknown as { fetch: unknown }).fetch = async () => ({
      json: async () => ({ artboards: [] }),
    });
  });
  afterAll(() => {
    GlobalRegistrator.unregister();
  });

  async function mount(initial: unknown) {
    const React = await import('react');
    const { createRoot } = await import('react-dom/client');
    const { act } = await import('react');
    const { useAiScope } = await import('../client/v2/ai/use-ai-scope.js');
    const out: Hook = { current: null as never };
    let setSelected: (s: unknown) => void = () => {};
    function Probe() {
      const [selected, set] = React.useState(initial);
      setSelected = set;
      out.current = useAiScope({ activeCanvas: 'ui/Site.tsx', selected, panelHidden: false });
      return null;
    }
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(React.createElement(Probe));
    });
    return { out, act, setSelected: (s: unknown) => setSelected(s), root };
  }

  test('Whole canvas picked with an artboard selected → the ask carries "*", not the artboard', async () => {
    const { out, act, root } = await mount([SEL('landing')]);
    expect(out.current.contextRef.current?.runScope).toEqual({
      canvas: 'ui/Site.tsx',
      artboards: ['landing'],
    });
    await act(async () => {
      out.current.choose({ kind: 'whole' });
    });
    expect(out.current.scope.kind).toBe('whole');
    expect(out.current.contextRef.current?.runScope).toEqual({
      canvas: 'ui/Site.tsx',
      artboards: '*',
    });
    await act(async () => root.unmount());
  });

  test('the selection announced again (same artboard, new array) does not undo the pick', async () => {
    const { out, act, setSelected, root } = await mount([SEL('landing')]);
    await act(async () => {
      out.current.choose({ kind: 'whole' });
    });
    await act(async () => {
      setSelected([SEL('landing')]);
    });
    expect(out.current.scope.kind).toBe('whole');
    expect(out.current.contextRef.current?.runScope?.artboards).toBe('*');
    // a DIFFERENT selection is a new look: the chip follows it again
    await act(async () => {
      setSelected([SEL('pricing')]);
    });
    expect(out.current.scope).toEqual({ kind: 'artboards', ids: ['pricing'] });
    await act(async () => root.unmount());
  });
});
