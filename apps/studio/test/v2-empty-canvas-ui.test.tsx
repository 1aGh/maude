// S11.2 — the DOM half: the empty-canvas block (three variants), the artboard hint, the Layers empty line,
// the connect sheet that opens once, and the mount rules (read-only role gets no create affordance).
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

const load = async () => {
  const React = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { act } = await import('react');
  return {
    React,
    createRoot,
    act,
    model: await import('../client/v2/empty/use-empty-canvas.js'),
    canvas: await import('../client/v2/empty/empty-canvas.jsx'),
    hint: await import('../client/v2/empty/artboard-hint.jsx'),
    layers: await import('../client/v2/empty/layers-empty.jsx'),
  };
};

const mounted: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const un of mounted.splice(0)) await un();
  document.body.innerHTML = '';
});

async function mount(make: (m: Awaited<ReturnType<typeof load>>) => JSX.Element) {
  const m = await load();
  const host = document.createElement('div');
  document.body.append(host);
  const root = m.createRoot(host);
  await m.act(async () => root.render(make(m)));
  mounted.push(() => m.act(async () => root.unmount()));
  return { ...m, host };
}

const ready = {
  count: 0,
  mode: 'edit',
  canEdit: true,
  online: true,
  claude: 'present',
  canAsk: true,
};
const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('EmptyCanvas', () => {
  test('ready: the CONTRACT line, Ask AI ⌘/ and the other way in', async () => {
    const calls: string[] = [];
    const { host, act } = await mount(({ React, model, canvas }) =>
      React.createElement(canvas.EmptyCanvas, {
        model: model.emptyCanvasModel(ready),
        onAsk: () => calls.push('ask'),
        onNewArtboard: () => calls.push('door'),
      })
    );
    const block = host.querySelector('[data-testid="empty-canvas"]');
    expect(block?.getAttribute('data-variant')).toBe('ready');
    expect(
      `${text(block?.querySelector('.es-sit') ?? null)} ${text(block?.querySelector('.es-next') ?? null)}`
    ).toBe('Your canvas is ready. Ask AI for a first draft, or start drawing.');
    const ask = host.querySelector('[data-testid="empty-canvas-ask"]') as HTMLButtonElement;
    expect(text(ask)).toContain('Ask AI');
    expect(text(ask)).toContain('⌘/');
    const door = host.querySelector('[data-testid="empty-canvas-door"]') as HTMLButtonElement;
    expect(text(door)).toBe('New artboard');
    await act(async () => ask.click());
    await act(async () => door.click());
    expect(calls).toEqual(['ask', 'door']);
    expect(host.querySelector('[data-testid="empty-canvas-offline"]')).toBeNull();
  });

  test('offline: adds the S5.13 line, the spot is quiet, Ask AI stays', async () => {
    const { host } = await mount(({ React, model, canvas }) =>
      React.createElement(canvas.EmptyCanvas, {
        model: model.emptyCanvasModel({ ...ready, online: false }),
        onAsk: () => {},
        onNewArtboard: () => {},
      })
    );
    expect(host.querySelector('[data-testid="empty-canvas"]')?.getAttribute('data-variant')).toBe(
      'offline'
    );
    expect(text(host.querySelector('[data-testid="empty-canvas-offline"]'))).toBe(
      'AI is back when this Mac is online.'
    );
    expect(host.querySelector('.es-e--quiet')).not.toBeNull();
    expect(host.querySelector('[data-testid="empty-canvas-ask"]')).not.toBeNull();
  });

  test('not connected: the line is the same words as ready', async () => {
    const lines: string[] = [];
    for (const claude of ['present', 'absent']) {
      const { host } = await mount(({ React, model, canvas }) =>
        React.createElement(canvas.EmptyCanvas, {
          model: model.emptyCanvasModel({ ...ready, claude }),
          onAsk: () => {},
          onNewArtboard: () => {},
        })
      );
      lines.push(text(host.querySelector('[data-testid="empty-canvas"]')));
    }
    expect(lines[1]).toBe(lines[0]);
  });

  test('no AI here: no Ask AI, but the door is there (W7)', async () => {
    const { host } = await mount(({ React, model, canvas }) =>
      React.createElement(canvas.EmptyCanvas, {
        model: model.emptyCanvasModel({ ...ready, canAsk: false }),
        onAsk: () => {},
        onNewArtboard: () => {},
      })
    );
    expect(host.querySelector('[data-testid="empty-canvas-ask"]')).toBeNull();
    expect(host.querySelector('[data-testid="empty-canvas-door"]')).not.toBeNull();
  });

  test('Can view / Can comment: nothing rendered', async () => {
    const { host } = await mount(({ React, model, canvas }) =>
      React.createElement(canvas.EmptyCanvas, {
        model: model.emptyCanvasModel({ ...ready, canEdit: false }),
        onAsk: () => {},
        onNewArtboard: () => {},
      })
    );
    expect(host.querySelector('[data-testid="empty-canvas"]')).toBeNull();
    expect(host.textContent).toBe('');
  });
});

describe('the connect sheet', () => {
  test("S5 ConnectSheet: Connect runs the flow, Cancel closes; both are the sheet's own words", async () => {
    const calls: string[] = [];
    const { host, act } = await mount(({ React, canvas }) =>
      React.createElement(canvas.EmptyConnect, {
        onConnect: () => calls.push('connect'),
        onCancel: () => calls.push('cancel'),
        phase: 'idle',
      })
    );
    expect(text(host)).toContain('Connect your Claude account to let AI draft this.');
    await act(async () =>
      (host.querySelector('[data-testid="ai-connect-go"]') as HTMLElement).click()
    );
    await act(async () =>
      (host.querySelector('[data-testid="ai-connect-cancel"]') as HTMLElement).click()
    );
    expect(calls).toEqual(['connect', 'cancel']);
  });
});

describe('ArtboardHint', () => {
  const hint = {
    artboardId: 'tab',
    label: 'Tablet',
    from: 'Desktop',
    rect: { x: 0, y: 0, w: 200, h: 300 },
  };

  test("says it in the canvas's words and offers Ask AI to fill the board", async () => {
    const asked: string[] = [];
    const { host, act } = await mount(({ React, hint: h, model }) =>
      React.createElement(h.ArtboardHint, {
        hint,
        placement: model.hintPlacement(
          { left: 0, top: 0 },
          hint.rect,
          { w: 1200, h: 800 },
          { w: 320, h: 150 }
        ),
        canAsk: true,
        onAsk: (hh: { label: string }) => asked.push(hh.label),
      })
    );
    const el = host.querySelector('[data-testid="empty-artboard-hint"]');
    expect(text(el)).toContain('Empty artboard.');
    expect(text(el)).toContain(
      'Draw a frame with F, place an image I or a component ⇧I, or let AI start it from Desktop.'
    );
    const ask = host.querySelector('[data-testid="empty-artboard-ask"]') as HTMLButtonElement;
    expect(text(ask)).toContain('Ask AI to fill Tablet');
    await act(async () => ask.click());
    expect(asked).toEqual(['Tablet']);
  });

  test('no AI here: the hint still says how to start, without the button', async () => {
    const { host } = await mount(({ React, hint: h }) =>
      React.createElement(h.ArtboardHint, { hint, placement: { left: 10, top: 10 }, canAsk: false })
    );
    expect(host.querySelector('[data-testid="empty-artboard-hint"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="empty-artboard-ask"]')).toBeNull();
  });
});

describe('LayersEmpty', () => {
  test('"No layers on Tablet yet." with what will appear there', async () => {
    const { host } = await mount(({ React, layers }) =>
      React.createElement(layers.LayersEmpty, { artboard: 'Tablet' })
    );
    const el = host.querySelector('[data-testid="layers-empty"]');
    expect(text(el)).toContain('No layers on Tablet yet.');
    expect(text(el)).toContain('Anything you draw or drop on it shows up here, in order.');
  });
});
