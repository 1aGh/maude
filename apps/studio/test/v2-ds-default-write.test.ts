// S10.13 — the two gestures behind the pinned rows that are not "open": `ds.set-default` (one POST, the
// server judges) and `ds.make` (the door; the sheet answers an event, and with none listening the row says so).
import { describe, expect, test } from 'bun:test';

import { DS_MAKE_EVENT, requestDsMake, setDefaultSystem } from '../client/v2/ds/default-write.js';
import { createMenuHandlers } from '../client/v2/shell/menu-runner.js';

const reply = (status: number, body: unknown) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('setDefaultSystem', () => {
  test('posts the system and says what changed', async () => {
    const seen: Array<{ url: string; body: string }> = [];
    const f = (async (url: string, init: { body: string }) => {
      seen.push({ url, body: init.body });
      return new Response(JSON.stringify({ default: 'camp', previous: 'club' }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await setDefaultSystem('camp', { label: 'Combine 2026', fetchImpl: f });
    expect(seen).toEqual([{ url: '/_api/ds/default', body: JSON.stringify({ ds: 'camp' }) }]);
    expect(r).toEqual({
      ok: true,
      changed: true,
      message: 'Combine 2026 is now the default for new canvases.',
    });
  });

  test('already the default is said, not written again', async () => {
    const r = await setDefaultSystem('camp', {
      label: 'Combine 2026',
      fetchImpl: reply(200, { default: 'camp', previous: 'camp' }),
    });
    expect(r).toMatchObject({ ok: true, changed: false });
    expect(r.message).toBe('Combine 2026 is already the default.');
  });

  test('a 403 is the quiet "ask to edit" line; an unreachable studio is its own', async () => {
    const no = await setDefaultSystem('camp', { fetchImpl: reply(403, { code: 'forbidden' }) });
    expect(no).toEqual({ ok: false, message: 'You can look here; ask to edit.' });
    const down = await setDefaultSystem('camp', {
      fetchImpl: (async () => {
        throw new Error('down');
      }) as unknown as typeof fetch,
    });
    expect(down.ok).toBe(false);
    expect(down.message).toBe('Not changed. The studio could not be reached; try again.');
  });
});

describe('requestDsMake', () => {
  test('a sheet that takes the event is the door; nothing toasts', () => {
    const target = new EventTarget();
    const heard: unknown[] = [];
    target.addEventListener(DS_MAKE_EVENT, (e) => {
      heard.push((e as CustomEvent).detail);
      e.preventDefault();
    });
    const toasts: string[] = [];
    expect(
      requestDsMake(
        { project: 'p' },
        { toast: (m: string) => toasts.push(m), target: target as never }
      )
    ).toBe(true);
    expect(heard).toEqual([{ project: 'p' }]);
    expect(toasts).toEqual([]);
  });

  test('with no sheet listening the row says so rather than doing nothing', () => {
    const toasts: string[] = [];
    const took = requestDsMake(
      {},
      { toast: (m: string) => toasts.push(m), target: new EventTarget() as never }
    );
    expect(took).toBe(false);
    expect(toasts).toEqual(['Making a design system opens here soon.']);
  });
});

describe('the runner', () => {
  test('ds.set-default, ds.make and ds.open have shell handlers', () => {
    const h = createMenuHandlers({ toast: () => {}, onDsGoTo: () => {} });
    expect(typeof h['ds.set-default']).toBe('function');
    expect(typeof h['ds.make']).toBe('function');
    expect(typeof h['ds.open']).toBe('function');
  });
});

describe('a canvas made by ⌘N starts on its folder’s system', () => {
  test('createBlankCanvas sends what the shell’s provider answers — and nothing when none does', async () => {
    const { createBlankCanvas } = await import('../client/v2/create/new-canvas.js');
    const { setNewCanvasDsProvider } = await import('../client/v2/ds/new-canvas-default.js');
    const bodies: unknown[] = [];
    const f = (async (_u: string, init: { body: string }) => {
      bodies.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ ok: true, file: 'ui/x.tsx' }), { status: 201 });
    }) as unknown as typeof fetch;
    await createBlankCanvas({ fetchImpl: f, open: () => {} });
    const off = setNewCanvasDsProvider(() => 'combine-2026');
    await createBlankCanvas({ fetchImpl: f, open: () => {} });
    await createBlankCanvas({ fetchImpl: f, open: () => {}, designSystem: 'club' });
    off();
    await createBlankCanvas({ fetchImpl: f, open: () => {} });
    expect(bodies).toEqual([
      { kind: 'blank' },
      { kind: 'blank', designSystem: 'combine-2026' },
      { kind: 'blank', designSystem: 'club' },
      { kind: 'blank' },
    ]);
  });
});
