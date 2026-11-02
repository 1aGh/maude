// V2-8.14 — a version picture shows ONE artboard, so the renderer asks the canvas to mount only that
// one (`?thumb-only=<id>`): a 21-board canvas no longer renders (and loads the images of) 20 boards
// nobody will see. The parameter is a rendering hint the thumbnail renderer adds on the read-only
// capture origin; without it nothing changes.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

describe('DCArtboard with ?thumb-only=<id>', () => {
  let canvasLib: typeof import('../canvas-lib.tsx');

  beforeAll(async () => {
    GlobalRegistrator.register();
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    canvasLib = await import('../canvas-lib.tsx');
  });
  afterAll(() => {
    GlobalRegistrator.unregister();
  });

  async function mount(search: string) {
    window.happyDOM.setURL(`http://localhost/${search}`);
    const { DesignCanvas, DCSection, DCArtboard } = canvasLib;
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <DesignCanvas>
          <DCSection id="s" title="S">
            {['a0', 'a1', 'a2'].map((id) => (
              <DCArtboard key={id} id={id} label={id} width={200} height={150}>
                <div data-body={id}>body {id}</div>
              </DCArtboard>
            ))}
          </DCSection>
        </DesignCanvas>
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    const ids = [...host.querySelectorAll('[data-dc-screen]')].map((e) =>
      e.getAttribute('data-dc-screen')
    );
    const bodies = [...host.querySelectorAll('[data-body]')].map((e) =>
      e.getAttribute('data-body')
    );
    await act(async () => {
      root.unmount();
    });
    host.remove();
    return { ids, bodies };
  }

  test('only the named artboard mounts', async () => {
    const r = await mount('?thumb-only=a1');
    expect(r.ids).toEqual(['a1']);
    expect(r.bodies).toEqual(['a1']);
  });

  test('without the parameter every artboard mounts', async () => {
    const r = await mount('');
    expect(r.ids).toEqual(['a0', 'a1', 'a2']);
    expect(r.bodies).toEqual(['a0', 'a1', 'a2']);
  });
});
