// V2-1.14 §5.3 "Never" / §5.10 — `GET /_api/outbox` never carries prompt
// text, e-mail, an invite message or an ask note; the full record is only
// served by id. Plus the route table's shape: main origin only, no enqueue
// route, the content lane cannot be cancelled.

import { afterEach, describe, expect, test } from 'bun:test';

import { createOutboxRoutes, matchRoute, type RouteSpec } from '../routes/outbox.ts';
import { ask, type Harness, harness, invite, prompt, put } from './_outbox-harness.ts';

let h: Harness;
afterEach(() => h?.dispose());

async function call(routes: RouteSpec[], method: string, pathname: string) {
  const m = matchRoute(routes, method, pathname);
  if (!m) return { status: 404, body: null as unknown };
  const res = await m.spec.handle(new Request(`http://localhost${pathname}`, { method }), m.params);
  return { status: res.status, body: (await res.json()) as unknown };
}

const SECRET_TEXT = 'Draft the Q3 layoffs memo in the brand voice';
const EMAIL = 'Tereza.Novak@studio.cz';
const MESSAGE = 'Here is the private brief link';

describe('outbox redaction + routes', () => {
  test('the list never contains prompt text, e-mail, message or note — even inside a label', async () => {
    h = harness();
    put(h, prompt('c1', SECRET_TEXT, { label: SECRET_TEXT }));
    const inv = invite(EMAIL, 'edit', { label: `Invite ${EMAIL} · Can edit` });
    (inv.payload as { message: string }).message = MESSAGE;
    put(h, inv);
    put(h, ask());
    const routes = createOutboxRoutes({ outbox: h.outbox });
    const { status, body } = await call(routes, 'GET', '/_api/outbox');
    expect(status).toBe(200);
    const text = JSON.stringify(body);
    expect(text).not.toContain(SECRET_TEXT);
    expect(text.toLowerCase()).not.toContain(EMAIL.toLowerCase());
    expect(text).not.toContain(MESSAGE);
    expect(text).not.toContain('please'); // the ask note
    expect(text).toContain('Tereza.Novak@…'); // the drawn masked form survives
    expect(body).toMatchObject({
      seq: expect.any(Number),
      content: { pending: 0 },
      intents: expect.any(Array),
    });
  });

  test('the owning surface gets the full record by id', async () => {
    h = harness();
    const r = put(h, prompt('c1', SECRET_TEXT));
    const routes = createOutboxRoutes({ outbox: h.outbox });
    const { status, body } = await call(routes, 'GET', `/_api/outbox/${r.id}`);
    expect(status).toBe(200);
    expect((body as { payload: { text: string } }).payload.text).toBe(SECRET_TEXT);
    expect((await call(routes, 'GET', '/_api/outbox/i_zzzzzzzzzzzzzzzzzzzz')).status).toBe(404);
    expect((await call(routes, 'GET', '/_api/outbox/..%2f..%2fetc')).status).toBe(404);
  });

  test('cancel withdraws a waiting record; the content lane cannot be cancelled; retry is not for queued', async () => {
    h = harness();
    const r = put(h, invite('a@b.cz'));
    const routes = createOutboxRoutes({ outbox: h.outbox });
    expect(await call(routes, 'POST', '/_api/outbox/tx_0123abcd/cancel')).toEqual({
      status: 403,
      body: { error: 'content-lane' },
    });
    expect((await call(routes, 'POST', `/_api/outbox/${r.id}/retry`)).status).toBe(409);
    const c = await call(routes, 'POST', `/_api/outbox/${r.id}/cancel`);
    expect(c.status).toBe(200);
    expect(c.body).toMatchObject({ state: 'dropped', outcome: 'cancelled' });
    expect(JSON.stringify(c.body)).not.toContain('a@b.cz');
    expect((await call(routes, 'POST', `/_api/outbox/${r.id}/cancel`)).status).toBe(409); // final
  });

  test('the table: main origin only, reads + cancel allowed read-only, retry refused, NO enqueue route', () => {
    h = harness();
    const routes = createOutboxRoutes({ outbox: h.outbox });
    expect(routes.map((r) => `${r.method} ${r.path} ${r.origin} ${r.readOnly}`)).toEqual([
      'GET /_api/outbox main allowed',
      'GET /_api/outbox/:id main allowed',
      'POST /_api/outbox/:id/cancel main allowed',
      'POST /_api/outbox/:id/retry main refused',
    ]);
    expect(matchRoute(routes, 'POST', '/_api/outbox')).toBe(null);
    expect(matchRoute(routes, 'PUT', '/_api/outbox/i_aaaaaaaaaaaaaaaaaaaa')).toBe(null);
  });
});
