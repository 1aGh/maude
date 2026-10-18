// The canary sweep's request table (V2-1.16 §7, S9.5). Not a test file.
//
// One entry per hub route-table row, keyed by `rowKey(row)`. Each entry builds
// the concrete requests that row stands for, aimed at a TARGET `tg` — canvas B
// (the canary) or its missing twin — so every row is swept with a real request
// that reaches it. The sweep files assert two things over this table:
//
//   - `checkSweepTable` — every row has an entry, every request it builds
//     classifies (`rowFor`) to THAT row, no path carries an unsubstituted
//     segment (`undefined`, `null`, a regex fragment), and every canvasDoor
//     row names a B target somewhere in its requests. Before this table the
//     sweep derived pattern rows' paths from `RegExp.source`, which escapes
//     `/`, so every accepted-revisions and votes row was requested at
//     `/v1/undefined` and swept nothing (the `/api/projects/*` catch-all
//     answered for all of them).
//   - the sweep itself — B answers byte-identically to the twin, no B byte.
//
// A new row without an entry here is a red `checkSweepTable`: add the row's
// requests the day the row lands.

import { rowFor } from '../src/routes-v2/index.mjs';

export const V1 = '/api/projects/local/v1';

const enc = encodeURIComponent;

/** The key a row is indexed by (mirrors `checkHubRouteTable`). */
export const rowKey = (row) => (row.pattern ? `re:${row.pattern.source}` : row.path);

const json = (v) => JSON.stringify(v);
/** A query naming every target field a door might read. */
const q = (tg) =>
  `?path=${enc(tg.path)}&doc=${enc(tg.doc)}&canvas=${enc(tg.path)}&sha=${tg.sha}&lane=html&rev=1&since=0&after=0`;
const getPost = (p, tg) => [
  ['GET', `${p}${q(tg)}`],
  ['POST', p, json({ path: tg.path, doc: tg.doc, paths: [tg.path] })],
];
const fileRequests = (prefix, tg) => [
  ['GET', `${prefix}${tg.path}`],
  ['HEAD', `${prefix}${tg.path}`],
  ['GET', `${prefix}${tg.css}`],
  ['GET', `${prefix}${tg.asset}`],
  ['PUT', `${prefix}${tg.path}`, 'export default () => 0;\n'],
  ['PUT', `${prefix}${tg.asset}`, 'png'],
  ['DELETE', `${prefix}${tg.path}`],
];

/**
 * `(tg, ctx) => [method, path, body?][]` per row key. `ctx.epoch` is the
 * accepted-revisions epoch the proposals carry.
 */
export const SWEEP_REQUESTS = {
  '/health': (tg) => getPost('/health', tg),
  '/internal/revocation-sweep': (tg) => getPost('/internal/revocation-sweep', tg),
  '/': (tg) => getPost('/', tg),
  '/auth/login': (tg) => getPost('/auth/login', tg),
  '/auth/logout': (tg) => [['POST', '/auth/logout', json({ path: tg.path })]],
  '/auth/session': (tg) => getPost('/auth/session', tg),
  '/auth/browser': (tg) => getPost('/auth/browser', tg),
  '/auth/browser/signout': (tg) => [['POST', '/auth/browser/signout', json({ path: tg.path })]],
  '/studio/signin': (tg) => getPost('/studio/signin', tg),
  '/auth/oidc/start': (tg) => getPost('/auth/oidc/start', tg),
  '/auth/oidc/callback': (tg) => getPost('/auth/oidc/callback', tg),
  '/auth/*': (tg) => [
    ['GET', `/auth/${tg.slug}${q(tg)}`],
    ['POST', `/auth/${tg.slug}`, json({ path: tg.path })],
  ],
  '/join': (tg) => getPost('/join', tg),
  '/join/*': (tg) => [
    ['GET', `/join/${tg.slug}`],
    ['POST', `/join/${tg.slug}`, json({ path: tg.path })],
  ],
  '/admin': (tg) => getPost('/admin', tg),
  '/admin/*': (tg) => [
    ['GET', `/admin/${tg.slug}${q(tg)}`],
    ['POST', `/admin/${tg.slug}`, json({ path: tg.path })],
  ],
  '/invites*': (tg) => [
    ['GET', `/invites${q(tg)}`],
    ['POST', '/invites', json({ canvas: tg.path, grants: [{ c: tg.path, r: 'viewer' }] })],
  ],
  '/.well-known/*': (tg) => [['GET', `/.well-known/${tg.slug}`]],

  // ---- the file plane --------------------------------------------------------
  '/api/journal': (tg) => [
    ['GET', `/api/journal${q(tg)}`],
    ['GET', `/api/journal?since=0&path=${enc(tg.css)}`],
    ['POST', '/api/journal', json({ path: tg.path })],
  ],
  '/api/journal/report': (tg) => [['POST', '/api/journal/report', json({ paths: [tg.path] })]],
  '/api/files': (tg) => [
    ['GET', `/api/files${q(tg)}`],
    ['GET', `/api/files?prefix=${enc(tg.path)}`],
    ['POST', '/api/files', json({ paths: [tg.path, tg.css, tg.asset] })],
  ],
  '/_project-file/*': (tg) => fileRequests('/_project-file/', tg),
  '/api/file/*': (tg) => fileRequests('/api/file/', tg),
  '/api/file-uploads*': (tg) => [
    ['POST', '/api/file-uploads', json({ path: tg.path, size: 3, sha256: tg.hash })],
    ['POST', '/api/file-uploads', json({ path: tg.asset, size: 3, sha256: tg.hash })],
    ['GET', `/api/file-uploads/${tg.slug}`],
    ['POST', `/api/file-uploads/${tg.slug}/complete`, '{}'],
  ],
  '/api/file-limits': (tg) => [['GET', `/api/file-limits${q(tg)}`]],
  '/api/project-config': (tg) => getPost('/api/project-config', tg),
  '/api/project-format': (tg) => getPost('/api/project-format', tg),
  '/_materialize': (tg) => getPost('/_materialize', tg),
  '/assets/*': (tg) => [
    ['GET', `/${tg.asset}`],
    ['HEAD', `/${tg.asset}`],
    ['PUT', `/${tg.asset}`, 'png'],
  ],
  '/_asset-file/*': (tg) => [
    ['GET', `/_asset-file/${tg.asset}`],
    ['HEAD', `/_asset-file/${tg.asset}`],
    ['PUT', `/_asset-file/${tg.asset}`, 'png'],
  ],
  '/_asset-probe': (tg) => [['POST', '/_asset-probe', json({ paths: [tg.asset, tg.css] })]],

  // ---- documents ---------------------------------------------------------------
  '/api/documents': (tg) => getPost('/api/documents', tg),
  '/api/documents/*': (tg) => [
    ['GET', `/api/documents/${enc(tg.doc)}`],
    ['POST', `/api/documents/${enc(tg.doc)}`, '{}'],
    ['DELETE', `/api/documents/${enc(tg.doc)}`],
  ],

  // Any other `/api/projects/…` shape (the runs routes live here, S5).
  '/api/projects/*': (tg) => [
    ['GET', `${V1}/runs${q(tg)}`],
    ['GET', `${V1}/runs/${tg.slug.replace(/[^a-z]/g, '')}`],
    ['POST', `${V1}/runs`, json({ canvas: tg.path, doc: tg.doc })],
  ],

  // ---- the cell's git history ---------------------------------------------------
  '/api/history': (tg) => [
    ['GET', `/api/history${q(tg)}`],
    ['GET', `/api/history?path=${enc(tg.css)}`],
  ],
  '/api/history/file': (tg) => [
    ['GET', `/api/history/file?sha=${tg.sha}&path=${enc(tg.path)}`],
    ['GET', `/api/history/file?sha=${tg.sha}&path=${enc(tg.css)}`],
  ],
  '/api/export': (tg) => [['POST', '/api/export', json({ paths: [tg.path] })]],

  // ---- the access API (S9.6, routes-v2/access.mjs) — me / people / requests are canvas doors
  '/api/access/me': (tg) => [['GET', `/api/access/me${q(tg)}`]],
  '/api/access/people': (tg) => [
    ['GET', `/api/access/people${q(tg)}`],
    ['GET', `/api/access/people?canvas=${enc(tg.path)}`],
    ['POST', '/api/access/people', json({ canvas: tg.path })],
  ],
  '/api/access/people/*': (tg) => [
    ['PATCH', `/api/access/people/${tg.slug}`, json({ canvas: tg.path, role: 'viewer' })],
    ['DELETE', `/api/access/people/${tg.slug}`],
  ],
  '/api/access/invites': (tg) => [
    ['GET', `/api/access/invites${q(tg)}`],
    [
      'POST',
      '/api/access/invites',
      json({ email: `${tg.slug}@example.invalid`, canvas: tg.path, role: 'viewer' }),
    ],
  ],
  '/api/access/invites/*': (tg) => [
    ['POST', `/api/access/invites/${tg.slug}/resend`, '{}'],
    ['DELETE', `/api/access/invites/${tg.slug}`],
  ],
  '/api/access/links': (tg) => [
    ['GET', `/api/access/links${q(tg)}`],
    ['POST', '/api/access/links', json({ canvas: tg.path, role: 'viewer' })],
  ],
  '/api/access/links/*': (tg) => [
    ['PATCH', `/api/access/links/${tg.slug}`, json({ canvas: tg.path })],
    ['DELETE', `/api/access/links/${tg.slug}`],
  ],
  '/api/access/requests': (tg) => [
    ['GET', `/api/access/requests${q(tg)}`],
    ['POST', '/api/access/requests', json({ canvas: tg.path })],
  ],
  '/api/access/requests/*': (tg) => [
    ['POST', `/api/access/requests/${tg.slug}/approve`, json({ canvas: tg.path })],
    ['POST', `/api/access/requests/${tg.slug}/decline`, '{}'],
  ],
  // self-authenticating (the control plane's signed poke): a peer token is not its key
  '/internal/access-changed': (tg) => getPost('/internal/access-changed', tg),

  // ---- comments (S9.7, routes-v2/comments.mjs) — a canvas door judged by `doc`
  '/api/comments': (tg) => [
    ['POST', '/api/comments', json({ op: 'add', doc: tg.doc, text: 'sweep' })],
    ['POST', '/api/comments', json({ op: 'resolve', doc: tg.doc, id: `c_${tg.slug}` })],
  ],

  // ---- the shared Trash (S1.7) — owner-only, project scope
  '/api/trash/clear': (tg) => [
    ['POST', '/api/trash/clear', json({ items: [`canvas:${tg.slug}`] })],
    ['POST', '/api/trash/clear', '{}'],
  ],

  // ---- a presentation link (S3.7b / S9.13) — a canvas door on the canvas path
  '/present/*': (tg) => [
    ['GET', `/present/${tg.path}`],
    ['POST', `/present/${tg.path}`, '{}'],
  ],
};

/** The accepted-revisions + votes rows, keyed by the route name the pattern carries. */
const ACCEPTED = {
  bootstrap: (tg) => [
    ['GET', `${V1}/bootstrap${q(tg)}`],
    ['POST', `${V1}/bootstrap`, json({ doc: tg.doc })],
  ],
  lane: (tg) => [
    ['GET', `${V1}/lane?doc=${enc(tg.doc)}&lane=html&rev=1`],
    ['GET', `${V1}/lane?doc=${enc(tg.doc)}&lane=comments&rev=1`],
    ['GET', `${V1}/lane?doc=${enc(tg.doc)}&lane=html&rev=0`],
  ],
  blobs: (tg) => [
    ['GET', `${V1}/blobs/${tg.hash}`],
    ['GET', `${V1}/blobs/${tg.commentsHash}`],
  ],
  proposals: (tg, ctx) => {
    const tx = (k) => `tx_sweep_${k}_${tg.slug.replace(/[^a-z]/g, '')}`;
    const op = (k, operations) => [
      'POST',
      `${V1}/proposals`,
      json({
        protocol: 1,
        projectId: 'local',
        epoch: ctx.epoch,
        transactionId: tx(k),
        origin: { deviceId: 'acl-sweep', sessionId: 's1' },
        action: { kind: 'edit', label: 'sweep', operations },
      }),
    ];
    const content = 'export default () => <h1>sweep</h1>;\n';
    return [
      op('replace', [{ op: 'lane.replace', doc: tg.doc, lane: 'html', base: tg.hash, content }]),
      op('replace-any', [{ op: 'lane.replace', doc: tg.doc, lane: 'html', content }]),
      op('comments', [
        { op: 'lane.replace', doc: tg.doc, lane: 'comments', base: tg.commentsHash, content: '[]' },
      ]),
      op('move', [{ op: 'doc.move', doc: tg.doc, to: { path: `ui/moved-${tg.slug}.tsx` } }]),
      op('delete', [{ op: 'doc.delete', doc: tg.doc }]),
      op('undo', [{ op: 'history.undo', actionId: tg.action }]),
      op('undo-many', [{ op: 'history.undo', actionIds: [tg.action] }]),
      op('redo', [{ op: 'history.redo', actionId: tg.action }]),
      op('restore', [{ op: 'history.restore', revision: 1, docs: [tg.doc] }]),
      ['GET', `${V1}/proposals${q(tg)}`],
    ];
  },
  transactions: (tg) => [
    ['GET', `${V1}/transactions/${tg.tx}`],
    ['GET', `${V1}/transactions${q(tg)}`],
  ],
  revisions: (tg) => [['GET', `${V1}/revisions${q(tg)}`]],
  history: (tg) => [
    ['GET', `${V1}/history${q(tg)}`],
    ['GET', `${V1}/history?entry=${enc(tg.doc)}`],
  ],
  mode: (tg) => [
    ['GET', `${V1}/mode${q(tg)}`],
    ['POST', `${V1}/mode`, json({ mode: 'transactions', doc: tg.doc })],
  ],
  parity: (tg) => [['GET', `${V1}/parity${q(tg)}`]],
  votes: (tg) => [
    ['GET', `${V1}/votes?canvas=${enc(tg.path)}`],
    ['GET', `${V1}/votes?canvas=${enc(tg.path)}&after=0`],
    [
      'POST',
      `${V1}/votes`,
      json({ canvas: tg.path, targets: [`ab:${tg.slug}`, 'ab:other'], expected: 3 }),
    ],
  ],
  'votes/:id': (tg) => [
    ['GET', `${V1}/votes/${tg.vote}`],
    ['POST', `${V1}/votes/${tg.vote}`, '{}'],
  ],
  'votes/:id/ballot': (tg) => [
    ['POST', `${V1}/votes/${tg.vote}/ballot`, json({ picks: { [`ab:${tg.slug}`]: 1 } })],
    ['POST', `${V1}/votes/${tg.vote}/ballot`, '{}'],
  ],
  'votes/:id/end': (tg) => [['POST', `${V1}/votes/${tg.vote}/end`, '{}']],
  // S1.7 — the shared Trash's records (L18: cut to a canvas-only session's canvases)
  trash: (tg) => [
    ['GET', `${V1}/trash${q(tg)}`],
    ['GET', `${V1}/trash/${tg.slug.replace(/[^A-Za-z0-9_-]/g, '')}${q(tg)}`],
    ['POST', `${V1}/trash`, json({ doc: tg.doc, path: tg.path })],
  ],
};

/** Name a pattern row by a probe path: the accepted route it matches. */
const PATTERN_PROBES = {
  bootstrap: `${V1}/bootstrap`,
  lane: `${V1}/lane`,
  blobs: `${V1}/blobs`,
  proposals: `${V1}/proposals`,
  transactions: `${V1}/transactions`,
  revisions: `${V1}/revisions`,
  history: `${V1}/history`,
  mode: `${V1}/mode`,
  parity: `${V1}/parity`,
  votes: `${V1}/votes`,
  'votes/:id': `${V1}/votes/x1`,
  'votes/:id/ballot': `${V1}/votes/x1/ballot`,
  'votes/:id/end': `${V1}/votes/x1/end`,
  trash: `${V1}/trash`,
};

/** The builder for a row: exact/prefix by key, a pattern by the probe it matches. */
export function requestBuilderFor(row) {
  if (!row.pattern) return SWEEP_REQUESTS[row.path] ?? null;
  for (const [name, probe] of Object.entries(PATTERN_PROBES)) {
    if (row.pattern.test(probe) && rowFor(probe) === row) return ACCEPTED[name];
  }
  return null;
}

/** Every request a row stands for, at one target. */
export function requestsFor(row, tg, ctx) {
  const build = requestBuilderFor(row);
  if (!build) throw new Error(`the sweep has no requests for ${rowKey(row)}`);
  return build(tg, ctx);
}

/** A path no row names is the studio's lane (`DEFAULT_ROW`): swept with these. */
export function studioDefaultRequests(tg) {
  return [
    ['GET', `/_api/canvas-source${q(tg)}`],
    ['POST', '/_api/canvas-source', json({ path: tg.path, doc: tg.doc })],
    ['GET', `/_canvas-shell.html${q(tg)}`],
    ['GET', `/${tg.path}`],
  ];
}

const UNSUBSTITUTED = /undefined|null|NaN|\[object|\\|\(\?|\{\d|\$\{/;
/** A body is JSON: escapes are legal there, a missing value is not. */
const UNSUBSTITUTED_BODY = /undefined|NaN|\[object|\$\{/;

/**
 * The self-check: returns the list of problems (empty = the table is sound).
 * `targets` are the B target and its twin; `build` is the request builder
 * under check (the table's own by default).
 */
export function checkSweepTable(rows, targets, ctx, build = requestsFor) {
  const problems = [];
  for (const row of rows) {
    const key = rowKey(row);
    if (build === requestsFor && !requestBuilderFor(row)) {
      problems.push(`${key}: no requests in the sweep table`);
      continue;
    }
    const lists = targets.map((tg) => build(row, tg, ctx));
    if (lists.some((l) => l.length === 0 || l.length !== lists[0].length)) {
      problems.push(`${key}: B and its twin build different request counts`);
    }
    for (const [i, list] of lists.entries()) {
      for (const [method, url, body] of list) {
        const pathOnly = url.split('?')[0];
        if (UNSUBSTITUTED.test(url)) problems.push(`${key}: unsubstituted segment in ${url}`);
        if (body !== undefined && UNSUBSTITUTED_BODY.test(body)) {
          problems.push(`${key}: unsubstituted value in the body of ${method} ${url}`);
        }
        if (rowFor(pathOnly) !== row) {
          const got = rowFor(pathOnly);
          problems.push(
            `${key}: ${method} ${pathOnly} reaches ${got ? rowKey(got) : 'the studio default'}`
          );
        }
      }
      if (row.canvasDoor === true) {
        const tg = targets[i];
        const named = list.some(([, url, body]) =>
          [tg.path, tg.doc, tg.hash, tg.vote, tg.asset, tg.css, tg.action].some(
            (v) => v && (url.includes(v) || url.includes(enc(v)) || String(body ?? '').includes(v))
          )
        );
        if (!named) problems.push(`${key}: no request names the target`);
      }
    }
  }
  return problems;
}
