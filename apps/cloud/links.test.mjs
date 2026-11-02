// Share links — V2-1.7 §5.6 (S9.8).
//
// Redeem needs sign-in, never lowers a role, ends with the link (off or
// expired), and the page that holds the secret sends no Referer.

import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { deriveCellSecret } from './cell-token.mjs';
import { d1FromSqlite } from './db.mjs';
import { createLink, LINK_INVALID, LINK_OFF, sweepExpiredLinks } from './links.mjs';
import { applySchema } from './migrate.mjs';
import { SCHEMA_SQL } from './schema.mjs';
import worker from './worker.mjs';

const MASTER = 'master';
const P = 'alligators';
const A = 'ui/a.tsx';
const PASSWORD = 'a-long-enough-password';

let ip = 0;
async function signUp(env, email) {
  const res = await worker.fetch(
    new Request('https://cloud.test/auth/signup', {
      method: 'POST',
      // One client per sign-up: the plane budgets five a minute per client.
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'cf-connecting-ip': `10.0.0.${++ip % 250}`,
      },
      body: new URLSearchParams({ email, password: PASSWORD, disclosure: 'yes' }).toString(),
    }),
    env
  );
  return /maude_session=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')?.[1];
}

async function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  const DB = d1FromSqlite(sqlite);
  await applySchema(DB, SCHEMA_SQL);
  const env = { DB, CELL_SECRET_MASTER: MASTER, CELL_ZONE: 'cloud.test' };
  const session = {};
  for (const who of ['owner', 'member', 'viewer', 'observer', 'canvas', 'stranger']) {
    session[who] = await signUp(env, `${who}@example.com`);
  }
  const id = (who) =>
    sqlite.prepare('SELECT id FROM accounts WHERE email = ?').get(`${who}@example.com`).id;
  sqlite
    .prepare(
      "INSERT INTO projects (id, account_id, name, state, state_since, created_at) VALUES (?, ?, 'A', 'active', 1, 1)"
    )
    .run(P, id('owner'));
  const mem = sqlite.prepare(
    'INSERT INTO project_members (project_id, account_id, role, added_at) VALUES (?, ?, ?, 1)'
  );
  mem.run(P, id('member'), 'member');
  mem.run(P, id('viewer'), 'viewer');
  mem.run(P, id('observer'), 'observer');
  sqlite
    .prepare(
      "INSERT INTO canvas_grants (project_id, account_id, canvas_path, role, source, granted_at) VALUES (?, ?, ?, 'member', 'invite', 1)"
    )
    .run(P, id('canvas'), A);
  return { env, sqlite, session, id };
}

const get = (env, path, session) =>
  worker.fetch(
    new Request(`https://cloud.test${path}`, {
      headers: { ...(session ? { cookie: `maude_session=${session}` } : {}), accept: 'text/html' },
    }),
    env
  );

const redeem = (env, token, session) =>
  worker.fetch(
    new Request('https://cloud.test/l/redeem', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'sec-fetch-site': 'same-origin',
        ...(session ? { cookie: `maude_session=${session}` } : {}),
      },
      body: new URLSearchParams({ link: token }).toString(),
    }),
    env
  );

/** A link made through the owner's forwarded call, as a cell would make it. */
async function makeLink(env, body) {
  const res = await worker.fetch(
    new Request(`https://cloud.test/internal/projects/${P}/access/links`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${await deriveCellSecret(MASTER, P)}`,
        'x-maude-actor': 'owner@example.com',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    }),
    env
  );
  assert.equal(res.status, 201);
  const { id, url } = await res.json();
  return { id, token: url.split('/l/')[1] };
}

async function patchLink(env, id, body) {
  return worker.fetch(
    new Request(`https://cloud.test/internal/projects/${P}/access/links/${id}`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${await deriveCellSecret(MASTER, P)}`,
        'x-maude-actor': 'owner@example.com',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    }),
    env
  );
}

let calls;
let realFetch;
beforeEach(() => {
  calls = [];
  realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), body: init.body ? JSON.parse(init.body) : null });
    return new Response(null, { status: 204 });
  };
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('redeem needs sign-in', () => {
  it('signed out, the page and the POST both go to sign-in and come back', async () => {
    const { env } = await fixture();
    const { token } = await makeLink(env, { role: 'observer', who: 'anyone', canvas: A });
    for (const res of [await get(env, `/l/${token}`), await redeem(env, token)]) {
      assert.equal(res.status, 303);
      assert.equal(res.headers.get('location'), `/login?next=${encodeURIComponent(`/l/${token}`)}`);
    }
  });

  it('signed in, the page carries no script, no Referer, and a POST form', async () => {
    const { env, session } = await fixture();
    const { token } = await makeLink(env, { role: 'observer', who: 'anyone', canvas: A });
    const res = await get(env, `/l/${token}`, session.stranger);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
    assert.match(res.headers.get('content-security-policy'), /default-src 'none'/);
    const body = await res.text();
    assert.match(body, /<form method="post" action="\/l\/redeem">/);
    assert.ok(!/<script/i.test(body));
  });
});

describe('an anyone link redeems into a grant', () => {
  it('a stranger gets a link:<id> grant and lands in the browser lane on the canvas', async () => {
    const { env, sqlite, session, id } = await fixture();
    const link = await makeLink(env, { role: 'observer', who: 'anyone', canvas: A });
    const res = await redeem(env, link.token, session.stranger);
    assert.equal(res.status, 303);
    assert.equal(
      res.headers.get('location'),
      `/projects/${P}/browser?canvas=${encodeURIComponent(A)}`
    );
    assert.deepEqual(
      {
        ...sqlite
          .prepare('SELECT role, source FROM canvas_grants WHERE account_id = ?')
          .get(id('stranger')),
      },
      { role: 'observer', source: `link:${link.id}` }
    );
    assert.equal(
      sqlite.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'link.redeem'").get().n,
      1
    );
  });

  it('never lowers: owner, member, viewer, observer and the canvas member keep their reach', async () => {
    const { env, sqlite, session, id } = await fixture();
    const canvasLink = await makeLink(env, { role: 'viewer', who: 'anyone', canvas: A });
    const projectLink = await makeLink(env, { role: 'observer', who: 'anyone' });
    for (const who of ['owner', 'member', 'viewer', 'observer', 'canvas']) {
      assert.equal((await redeem(env, canvasLink.token, session[who])).status, 303, who);
      assert.equal((await redeem(env, projectLink.token, session[who])).status, 303, who);
    }
    const role = (who) =>
      sqlite.prepare('SELECT role FROM project_members WHERE account_id = ?').get(id(who))?.role;
    assert.equal(role('member'), 'member');
    assert.equal(role('viewer'), 'viewer');
    assert.equal(role('observer'), 'observer');
    assert.equal(role('owner'), undefined, 'the owner is a column, never a member row');
    assert.equal(
      sqlite
        .prepare('SELECT role FROM canvas_grants WHERE account_id = ? AND canvas_path = ?')
        .get(id('canvas'), A).role,
      'member',
      'a member grant is not lowered to the link’s viewer'
    );
    // The canvas-only person gained a project-level Can view from the project link.
    assert.equal(role('canvas'), 'observer');
  });

  it('a wrong secret, a missing one, or garbage reads as an unknown link', async () => {
    const { env, session } = await fixture();
    const { token } = await makeLink(env, { role: 'observer', who: 'anyone', canvas: A });
    const [id] = token.split('.');
    for (const t of [`${id}.${'0'.repeat(64)}`, id, 'lnk_zz', `${token}x`]) {
      const res = await redeem(env, t, session.stranger);
      assert.equal(res.status, 404, t);
      assert.match(await res.text(), new RegExp(LINK_INVALID.slice(0, 20)));
    }
  });
});

describe('a team link is a location', () => {
  it('grants nothing; a stranger is turned away, a member is let through', async () => {
    const { env, sqlite, session } = await fixture();
    const { token } = await makeLink(env, { role: 'viewer', who: 'team', canvas: A });
    assert.ok(!token.includes('.'), 'a team link carries no secret');
    assert.equal((await redeem(env, token, session.stranger)).status, 403);
    assert.equal((await redeem(env, token, session.member)).status, 303);
    assert.equal((await redeem(env, token, session.canvas)).status, 303);
    assert.equal(
      sqlite.prepare("SELECT COUNT(*) AS n FROM canvas_grants WHERE source LIKE 'link:%'").get().n,
      0
    );
  });
});

describe('the link ends its grants', () => {
  it('turning it off deletes them, revokes, tells the cell, and the page says so', async () => {
    const { env, sqlite, session } = await fixture();
    const canvasLink = await makeLink(env, { role: 'observer', who: 'anyone', canvas: A });
    const projectLink = await makeLink(env, { role: 'viewer', who: 'anyone' });
    await redeem(env, canvasLink.token, session.stranger);
    await redeem(env, projectLink.token, session.stranger);
    calls.length = 0;
    assert.equal((await patchLink(env, canvasLink.id, { off: true })).status, 200);
    assert.equal((await patchLink(env, projectLink.id, { off: true })).status, 200);
    assert.equal(
      sqlite.prepare("SELECT COUNT(*) AS n FROM canvas_grants WHERE source LIKE 'link:%'").get().n,
      0
    );
    assert.equal(
      sqlite.prepare("SELECT COUNT(*) AS n FROM project_members WHERE source LIKE 'link:%'").get()
        .n,
      0
    );
    assert.equal(
      sqlite
        .prepare(
          "SELECT COUNT(*) AS n FROM member_revocations WHERE email = 'stranger@example.com'"
        )
        .get().n,
      2
    );
    const notices = calls.filter((c) => c.url.endsWith('/internal/access-changed'));
    assert.equal(notices.at(-1).body.change, 'ended');
    assert.equal(notices.at(-1).body.reason, 'link-off');
    const page = await redeem(env, canvasLink.token, session.stranger);
    assert.equal(page.status, 404);
    assert.match(await page.text(), new RegExp(LINK_OFF));
    assert.equal((await patchLink(env, canvasLink.id, { off: true })).status, 404, 'off is final');
  });

  it('narrowing a link narrows what it gave', async () => {
    const { env, sqlite, session, id } = await fixture();
    const link = await makeLink(env, { role: 'viewer', who: 'anyone', canvas: A });
    await redeem(env, link.token, session.stranger);
    await patchLink(env, link.id, { role: 'observer' });
    assert.equal(
      sqlite.prepare('SELECT role FROM canvas_grants WHERE account_id = ?').get(id('stranger'))
        .role,
      'observer'
    );
    assert.equal(
      sqlite
        .prepare(
          "SELECT COUNT(*) AS n FROM member_revocations WHERE email = 'stranger@example.com'"
        )
        .get().n,
      1
    );
  });

  it('the expiry sweep ends an expired link’s grants, once', async () => {
    const { env, sqlite, session, id } = await fixture();
    const now = Date.now();
    const link = await createLink(env.DB, {
      projectId: P,
      canvas: A,
      role: 'observer',
      who: 'anyone',
      expiresAt: now + 60_000,
      createdBy: id('owner'),
      now,
    });
    const token = link.url('https://cloud.test').split('/l/')[1];
    assert.equal((await redeem(env, token, session.stranger)).status, 303);
    assert.equal((await sweepExpiredLinks(env, { now })).swept, 0, 'not yet expired');
    const later = now + 120_000;
    assert.deepEqual(await sweepExpiredLinks(env, { now: later }), { swept: 1, ended: 1 });
    assert.equal(
      sqlite
        .prepare('SELECT COUNT(*) AS n FROM canvas_grants WHERE account_id = ?')
        .get(id('stranger')).n,
      0
    );
    assert.deepEqual(await sweepExpiredLinks(env, { now: later + 1 }), { swept: 0, ended: 0 });
    assert.equal(
      sqlite
        .prepare(
          "SELECT COUNT(*) AS n FROM member_revocations WHERE email = 'stranger@example.com'"
        )
        .get().n,
      1
    );
  });
});
