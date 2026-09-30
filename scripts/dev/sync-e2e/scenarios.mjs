// The sync regression catalogue — every scenario written ONCE, run BOTH WAYS.
//
// That constraint is the whole design. A scenario names `from` and `to` and
// never says which is which, so the runner executes it cloud→desktop and then
// desktop→cloud, and a fix that only works in the direction somebody tested by
// hand shows up as a red row instead of as a user's screenshot three weeks
// later. Every asymmetry this suite has found so far was invisible in the
// direction its author happened to try first.
//
// ── The shape of one scenario ───────────────────────────────────────────────
//
//   id       stable, kebab-case; the screenshot filenames are built from it
//   title    what a person would say happened
//   plane    'file' | 'doc' — which lane carries it. Reported, not enforced;
//            knowing WHICH lane broke is most of a sync diagnosis.
//   act      do the thing on `from`. Returns a small record the checks read.
//   settle   wait for it on `to`. Returns waitFor's `{ ok, ms }`.
//   verify   assert on `to` — disk facts, and where it matters, the live DOM.
//   view     optional: what to point the receiving browser at, so the
//            screenshot shows the thing rather than whatever was open.
//
// `settle` and `verify` are separate on purpose. Settle answers "did it
// arrive"; verify answers "did the right thing arrive, and can you see it".
// Collapsing them loses the timing, and the timing is how a slow regression is
// caught while it is still only slow.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { annotationBoard, makePng, sameBytes, sleep, waitFor } from './harness.mjs';

/** A per-run tag so repeat runs against a kept cell never collide. */
export function tag(run, extra = '') {
  return `e2e-${run}${extra ? `-${extra}` : ''}`;
}

/** designRoot-relative path of a canvas in the `ui` group. */
const uiRel = (name) => `ui/${name}.tsx`;
/** The slug the file tree builds its testid from (`ui/x.tsx` → `ui-x`). */
const uiSlug = (name) => `ui-${name}`;

/* --------------------------------------------------- structure scenarios --- */

const canvasCreate = {
  id: 'canvas-create',
  title: 'a new canvas',
  plane: 'doc+file',
  async act({ from, run, dir }) {
    const name = tag(run, `new-${dir}`);
    await from.api('/_api/canvas', { method: 'POST', body: { name, group: 'ui' } });
    return { name, rel: uiRel(name), metaRel: `ui/${name}.meta.json`, slug: uiSlug(name) };
  },
  settle: ({ to }, m) => waitFor(() => to.has(m.rel), { label: m.rel }),
  async verify({ to, browser }, m) {
    // The BODY arriving is not the canvas arriving. A canvas whose `.meta.json`
    // stayed behind has no title, no kind and no design-system binding on the
    // far side — it renders as an untitled default, and it shipped that way in
    // one direction only, because the cloud won a race the desktop lost. So the
    // sidecar gets its own row rather than being folded into "it crossed".
    const metaLanded = await waitFor(() => to.has(m.metaRel), { timeoutMs: 20_000 });
    const meta = metaLanded.ok ? JSON.parse(to.text(m.metaRel)) : null;
    const checks = [
      [`${m.rel} on disk`, to.has(m.rel)],
      ['its .meta.json came too', metaLanded.ok],
      ['…carrying the title, not an empty shell', meta?.title === m.name],
    ];
    if (browser) {
      const seen = await browser.waitPresent(`[data-testid="canvas-row-${m.slug}"]`, {
        timeoutMs: 20_000,
      });
      checks.push(['the row is in the receiving file tree', seen.ok]);
    }
    return checks;
  },
};

const folderCreate = {
  id: 'folder-create',
  title: 'a new folder',
  plane: 'file',
  async act({ from, run, dir }) {
    const name = tag(run, `dir-${dir}`);
    await from.api('/_api/fs-mkdir', { method: 'POST', body: { parent: 'ui', name } });
    // A folder is not a file, and the file plane moves FILES. An empty
    // directory has nothing to journal, so it cannot cross on its own — the
    // canvas inside it is what carries it. Saying so here, rather than
    // asserting on the bare directory and watching it fail, is the difference
    // between a test that documents the design and one that argues with it.
    //
    // And the canvas is created in the GROUP and then moved, because `group`
    // means a declared canvas group (`ui`, `system`) — not an arbitrary
    // subdirectory. Passing `ui/<folder>` is refused, correctly.
    const canvasName = tag(run, `dir-${dir}-inside`);
    await from.api('/_api/canvas', { method: 'POST', body: { name: canvasName, group: 'ui' } });
    await from.api('/_api/fs-move', {
      method: 'POST',
      body: { file: `.design/${uiRel(canvasName)}`, toDir: `.design/ui/${name}` },
    });
    return { dir: `ui/${name}`, rel: `ui/${name}/${canvasName}.tsx`, name };
  },
  settle: ({ to }, m) => waitFor(() => to.has(m.rel), { label: m.rel }),
  async verify({ to }, m) {
    return [
      ['the folder exists on the far side', to.has(m.dir)],
      ['the canvas inside it came too', to.has(m.rel)],
    ];
  },
};

const canvasMove = {
  id: 'canvas-move',
  title: 'a canvas moved into another folder',
  plane: 'doc+file',
  async act({ from, run, dir }) {
    const name = tag(run, `mv-${dir}`);
    const folder = tag(run, `mvdest-${dir}`);
    await from.api('/_api/canvas', { method: 'POST', body: { name, group: 'ui' } });
    await from.api('/_api/fs-mkdir', { method: 'POST', body: { parent: 'ui', name: folder } });
    const moved = await from.api('/_api/fs-move', {
      method: 'POST',
      body: { file: `.design/${uiRel(name)}`, toDir: `.design/ui/${folder}` },
    });
    return {
      fromRel: uiRel(name),
      toRel: `ui/${folder}/${name}.tsx`,
      toSlug: `ui-${folder}-${name}`.replace(/[^a-z0-9]+/gi, '-').toLowerCase(),
      api: moved,
    };
  },
  settle: ({ to }, m) => waitFor(() => to.has(m.toRel), { label: m.toRel }),
  async verify({ from, to }, m) {
    // The move protocol (codec stampMovedTo): the old document is retired,
    // the hub quarantines its checkout copy, peers park theirs in _trash/.
    // So the old path DISAPPEARING is a real assertion now — this row used to
    // be expected-pending, and the lingering ghost it tolerated is exactly
    // the duplicate the user screenshotted ("je tam navíc tralal-Threads").
    const oldGone = await waitFor(() => !to.has(m.fromRel) && !from.has(m.fromRel), {
      timeoutMs: 30_000,
      label: `old path ${m.fromRel} retired`,
    });
    return [
      ['the canvas is at its new path', to.has(m.toRel)],
      ['the old path is gone on the mover', !from.has(m.fromRel)],
      ['…and on the far side (the retired document cleaned up)', oldGone.ok],
    ];
  },
};

const canvasRenameByHand = {
  id: 'canvas-rename-by-hand',
  title: 'a canvas re-created under a new name (the product has no rename)',
  plane: 'doc+file',
  async act({ from, run, dir }) {
    // THERE IS NO RENAME. Not on `/_api/fs-move` (it takes `toDir` and no
    // `toName`), not in the tree's row menu (Move to… and Delete only), not
    // anywhere in the studio — `renameCanvas` does not exist as a verb.
    //
    // This scenario used to pretend otherwise: it POSTed a `toName` the route
    // ignores, quietly fell through to create-new + delete-old, and reported
    // itself as `canvas-rename` passing. A green row for a feature that is not
    // there is worse than a missing row, so it now says what it does.
    //
    // What it still tests is real and worth testing: the create and the delete
    // both have to cross, which is the sequence a person is forced into today.
    const before = tag(run, `rn-${dir}`);
    const after = `${before}-renamed`;
    await from.api('/_api/canvas', { method: 'POST', body: { name: before, group: 'ui' } });
    await from.api('/_api/canvas', { method: 'POST', body: { name: after, group: 'ui' } });
    await from.api(`/_api/canvas?file=${encodeURIComponent(`.design/${uiRel(before)}`)}`, {
      method: 'DELETE',
    });
    return { before: uiRel(before), after: uiRel(after), slug: uiSlug(after) };
  },
  settle: ({ to }, m) => waitFor(() => to.has(m.after), { label: m.after }),
  async verify({ to, browser }, m) {
    const checks = [['the new name is on the far side', to.has(m.after)]];
    if (browser) {
      const seen = await browser.waitPresent(`[data-testid="canvas-row-${m.slug}"]`, {
        timeoutMs: 20_000,
      });
      checks.push(['the new row shows in the tree', seen.ok]);
    }
    checks.push([
      'the old name is gone on the far side (deletion propagation — Increment 6)',
      !to.has(m.before),
      'expected-pending',
    ]);
    return checks;
  },
};

const canvasDelete = {
  id: 'canvas-delete',
  title: 'a canvas deleted',
  plane: 'file',
  async act({ from, to, run, dir }) {
    // Delete something that has already CROSSED, or the scenario proves
    // nothing: removing a file the far side never had is indistinguishable
    // from a no-op.
    const name = tag(run, `del-${dir}`);
    await from.api('/_api/canvas', { method: 'POST', body: { name, group: 'ui' } });
    const rel = uiRel(name);
    const arrived = await waitFor(() => to.has(rel), { timeoutMs: 30_000 });
    await from.api(`/_api/canvas?file=${encodeURIComponent(`.design/${rel}`)}`, {
      method: 'DELETE',
    });
    return { rel, arrived: arrived.ok };
  },
  settle: async ({ to }, m) => {
    // Increment 6 owns deletion EMISSION. Until it lands, the honest settle is
    // a bounded look rather than a wait that will always time out.
    const gone = await waitFor(() => !to.has(m.rel), { timeoutMs: 8_000, label: m.rel });
    return { ...gone, ok: true, pending: !gone.ok };
  },
  async verify({ from, to }, m) {
    return [
      ['it had crossed before the delete (so the test means something)', m.arrived],
      ['gone locally', !from.has(m.rel)],
      [
        'gone on the far side (deletion propagation — Increment 6)',
        !to.has(m.rel),
        'expected-pending',
      ],
    ];
  },
};

const folderDelete = {
  id: 'folder-delete',
  title: 'a folder deleted, with a canvas in it',
  plane: 'file',
  async act({ from, to, run, dir }) {
    // Delete a folder that has already CROSSED, or the scenario proves nothing:
    // removing something the far side never had is indistinguishable from a
    // no-op. Same route as a canvas delete, pointed at a directory.
    const folder = tag(run, `deldir-${dir}`);
    const inner = tag(run, `deldir-${dir}-inner`);
    await from.api('/_api/fs-mkdir', { method: 'POST', body: { parent: 'ui', name: folder } });
    await from.api('/_api/canvas', { method: 'POST', body: { name: inner, group: 'ui' } });
    await from.api('/_api/fs-move', {
      method: 'POST',
      body: { file: `.design/${uiRel(inner)}`, toDir: `.design/ui/${folder}` },
    });
    const rel = `ui/${folder}/${inner}.tsx`;
    const arrived = await waitFor(() => to.has(rel), { timeoutMs: 40_000 });
    const res = await from.api(`/_api/canvas?file=${encodeURIComponent(`.design/ui/${folder}`)}`, {
      method: 'DELETE',
    });
    return { folder: `ui/${folder}`, rel, arrived: arrived.ok, trashed: res?.trashed ?? [] };
  },
  settle: async ({ to }, m) => {
    const gone = await waitFor(() => !to.has(m.rel), { timeoutMs: 8_000, label: m.rel });
    return { ...gone, ok: true, pending: !gone.ok };
  },
  async verify({ from, to }, m) {
    return [
      ['the folder had crossed before the delete (so the test means something)', m.arrived],
      ['the folder is gone locally', !from.has(m.folder)],
      // Recoverability, not just removal — the whole point of the trash.
      ['its canvas went to _trash/, not to nothing', m.trashed.some((t) => t.endsWith('.tsx'))],
      [
        'gone on the far side too (deletion propagation — Increment 6)',
        !to.has(m.rel),
        'expected-pending',
      ],
    ];
  },
};

/* ------------------------------------------------------ content scenarios --- */

const canvasEdit = {
  id: 'canvas-edit',
  title: 'an edit inside a canvas',
  plane: 'doc',
  async act({ from, run, dir }) {
    const name = tag(run, `edit-${dir}`);
    await from.api('/_api/canvas', { method: 'POST', body: { name, group: 'ui' } });
    const rel = uiRel(name);
    const marker = `MARKER-${dir}-${run}`;
    // The canvas BODY is written to disk, not through an API — `/_api/canvas-
    // source` is read-only by design, and the inline ops (`edit-text`,
    // `edit-css`) address an element by inspector id, which a freshly created
    // brief board does not usefully have. Writing the file is what Claude and
    // `/design:edit` do, and it is the change the doc lane has to notice.
    await editProjectFile(from, rel, (body) =>
      body.includes('</main>')
        ? body.replace('</main>', `  <p data-e2e="${marker}">${marker}</p>\n    </main>`)
        : `${body}\n// ${marker}\n`
    );
    return { rel, marker };
  },
  settle: ({ to }, m) =>
    waitFor(() => to.has(m.rel) && to.text(m.rel).includes(m.marker), { label: m.rel }),
  async verify({ from, to }, m) {
    return [
      ['the edit is in the far side’s file', to.has(m.rel) && to.text(m.rel).includes(m.marker)],
      ['byte-identical on both sides', sameBytes(from, to, m.rel)],
    ];
  },
};

const artboardMove = {
  id: 'artboard-move',
  title: 'an artboard dragged to a new position',
  plane: 'file',
  async act({ from, run, dir }) {
    const name = tag(run, `board-${dir}`);
    await from.api('/_api/canvas', { method: 'POST', body: { name, group: 'ui' } });
    const rel = uiRel(name);
    const metaRel = `ui/${name}.meta.json`;
    const x = 640 + (dir === 'cloud-to-desktop' ? 0 : 90);
    const y = 480;
    await from.api('/_api/canvas-meta', {
      method: 'PATCH',
      body: {
        file: `.design/${rel}`,
        patch: { layout: { artboards: [{ id: 'root', x, y }] } },
      },
    });
    return { rel, metaRel, x, y };
  },
  settle: ({ to }, m) =>
    waitFor(
      () => {
        if (!to.has(m.metaRel)) return false;
        const meta = JSON.parse(to.text(m.metaRel));
        return meta?.layout?.artboards?.some((a) => a.x === m.x && a.y === m.y);
      },
      { label: m.metaRel }
    ),
  async verify({ to }, m) {
    const meta = to.has(m.metaRel) ? JSON.parse(to.text(m.metaRel)) : null;
    const board = meta?.layout?.artboards?.find((a) => a.x === m.x);
    return [
      ['the layout crossed', !!board && board.y === m.y],
      [
        'the camera did NOT cross — viewport is per-machine (DDR-115)',
        meta ? meta.viewport === undefined : false,
      ],
    ];
  },
};

/* --------------------------------------------- design-system + assets --- */

const dsSpecimenCreate = {
  id: 'ds-specimen-create',
  title: 'a new design-system specimen',
  plane: 'file',
  async act({ from, run, dir }) {
    const rel = `system/smoke/preview/${tag(run, `spec-${dir}`)}.css`;
    const css = `/* ${tag(run, dir)} */\n:root { --e2e-${run}: 1; }\n`;
    await writeProjectFile(from, rel, css);
    return { rel, css };
  },
  settle: ({ to }, m) => waitFor(() => to.has(m.rel), { label: m.rel }),
  async verify({ from, to }, m) {
    return [
      ['the specimen crossed', to.has(m.rel)],
      ['byte-identical', sameBytes(from, to, m.rel)],
    ];
  },
};

const dsSpecimenEdit = {
  id: 'ds-specimen-edit',
  title: 'an edit to an existing design-system file',
  plane: 'file',
  async act({ from, to, run, dir }) {
    const rel = `system/smoke/brand.css`;
    const next = `/* edited from ${dir} in run ${run} */\n${from.has(rel) ? from.text(rel) : ''}`;
    await writeProjectFile(from, rel, next);
    return { rel, marker: `edited from ${dir} in run ${run}` };
  },
  settle: ({ to }, m) =>
    waitFor(() => to.has(m.rel) && to.text(m.rel).includes(m.marker), { label: m.rel }),
  async verify({ from, to }, m) {
    return [
      ['the edit crossed', to.has(m.rel) && to.text(m.rel).includes(m.marker)],
      ['byte-identical', sameBytes(from, to, m.rel)],
    ];
  },
};

const assetUpload = {
  id: 'asset-upload',
  title: 'an image uploaded to the project',
  plane: 'file',
  async act({ from, run, dir }) {
    const png = makePng(run + (dir === 'cloud-to-desktop' ? 1 : 2));
    const res = await from.api('/_api/asset', {
      method: 'POST',
      raw: png,
      contentType: 'application/octet-stream',
    });
    return { rel: res.path, size: png.length };
  },
  settle: ({ to }, m) => waitFor(() => to.size(m.rel) === m.size, { label: m.rel }),
  async verify({ from, to }, m) {
    return [
      ['the bytes arrived intact', sameBytes(from, to, m.rel)],
      ['the far side serves it', await servesAsset(to, m.rel)],
    ];
  },
};

const artboardPhoto = {
  id: 'artboard-photo',
  title: 'a photo placed into a canvas artboard',
  plane: 'doc+file',
  async act({ from, run, dir }) {
    const png = makePng(run + (dir === 'cloud-to-desktop' ? 11 : 12));
    const asset = await from.api('/_api/asset', {
      method: 'POST',
      raw: png,
      contentType: 'application/octet-stream',
    });
    const name = tag(run, `photo-${dir}`);
    await from.api('/_api/canvas', { method: 'POST', body: { name, group: 'ui' } });
    const rel = uiRel(name);
    const img = `<img src="/.design/${asset.path}" alt="e2e" width={120} height={120} />`;
    await editProjectFile(from, rel, (body) =>
      body.includes('</main>')
        ? body.replace('</main>', `  ${img}\n    </main>`)
        : `${body}\n// ${asset.path}\n`
    );
    return { rel, asset: asset.path, size: png.length };
  },
  settle: ({ to }, m) =>
    waitFor(
      () => to.size(m.asset) === m.size && to.has(m.rel) && to.text(m.rel).includes(m.asset),
      { label: `${m.rel} + ${m.asset}` }
    ),
  async verify({ from, to }, m) {
    // BOTH halves, deliberately. The canvas referencing an image the far side
    // does not have is exactly the failure that reads as "sync is broken":
    // the file tree looks right and the picture is a broken box.
    return [
      ['the canvas references the image', to.has(m.rel) && to.text(m.rel).includes(m.asset)],
      ['the image itself crossed', sameBytes(from, to, m.asset)],
      ['the far side serves it', await servesAsset(to, m.asset)],
    ];
  },
};

/* ---------------------------------------------------------- annotations --- */

/** The elements of a v2 board file on `side` ([] when absent or not a board). */
function boardElements(side, rel) {
  if (!side.has(rel)) return [];
  try {
    const els = JSON.parse(side.text(rel)).elements;
    return Array.isArray(els) ? els : [];
  } catch {
    return [];
  }
}

const annotationShapes = {
  id: 'annotation-shapes',
  title: 'sticky note, rectangle, arrow and section on the draw layer',
  plane: 'file',
  async act({ from, run, dir }) {
    const name = tag(run, `ann-${dir}`);
    await from.api('/_api/canvas', { method: 'POST', body: { name, group: 'ui' } });
    const rel = uiRel(name);
    const marker = `note-${dir}-${run}`;
    // DDR-242 — a v2 element board, written whole (the import/restore path);
    // the canvas itself sends op batches to /_api/annotations/ops.
    const board = annotationBoard([
      { kind: 'sticky', x: 40, y: 40, text: marker },
      { kind: 'rect', x: 260, y: 40 },
      { kind: 'arrow', x: 40, y: 220 },
      { kind: 'section', x: 260, y: 220, text: `section-${run}` },
    ]);
    await from.api('/_api/annotations', {
      method: 'PUT',
      body: { file: `.design/${rel}`, board },
    });
    return { rel, annRel: `${uiSlug(name)}.annotations.json`, marker };
  },
  settle: ({ to }, m) =>
    waitFor(() => to.has(m.annRel) && to.text(m.annRel).includes(m.marker), { label: m.annRel }),
  async verify({ from, to }, m) {
    const els = boardElements(to, m.annRel);
    const has = (pred) => els.some(pred);
    return [
      ['the sticky note text crossed', has((e) => e.type === 'sticky' && e.text === m.marker)],
      ['the rectangle crossed', has((e) => e.type === 'shape' && (e.kind ?? 'rect') === 'rect')],
      ['the arrow crossed', has((e) => e.type === 'arrow')],
      ['the section crossed', has((e) => e.type === 'section')],
      ['byte-identical', sameBytes(from, to, m.annRel)],
    ];
  },
};

const annotationSticker = {
  id: 'annotation-sticker',
  title: 'a photo/sticker dropped onto the draw layer',
  plane: 'file',
  async act({ from, run, dir }) {
    const png = makePng(run + (dir === 'cloud-to-desktop' ? 21 : 22));
    const asset = await from.api('/_api/asset', {
      method: 'POST',
      raw: png,
      contentType: 'application/octet-stream',
    });
    const name = tag(run, `sticker-${dir}`);
    await from.api('/_api/canvas', { method: 'POST', body: { name, group: 'ui' } });
    const rel = uiRel(name);
    const board = annotationBoard([{ kind: 'image', x: 100, y: 100, href: asset.path }]);
    await from.api('/_api/annotations', { method: 'PUT', body: { file: `.design/${rel}`, board } });
    return { annRel: `${uiSlug(name)}.annotations.json`, asset: asset.path, size: png.length };
  },
  settle: ({ to }, m) =>
    waitFor(
      () => to.has(m.annRel) && to.text(m.annRel).includes(m.asset) && to.size(m.asset) === m.size,
      { label: `${m.annRel} + ${m.asset}` }
    ),
  async verify({ from, to }, m) {
    // This is the user's original bug, as a test: the annotation crossed and
    // the picture did not, so the far side rendered an empty box. Asserting
    // the reference without the bytes would have passed straight through it.
    return [
      ['the annotation references the sticker', to.text(m.annRel).includes(m.asset)],
      ['the sticker bytes crossed', sameBytes(from, to, m.asset)],
      ['the far side serves it', await servesAsset(to, m.asset)],
    ];
  },
};

/* -------------------------------------------------- history + presence --- */

const autocommitHistory = {
  id: 'autocommit-history',
  title: 'the cloud commits what arrives, and the history shows it',
  plane: 'git',
  async act({ from, run, dir }) {
    const name = tag(run, `commit-${dir}`);
    await from.api('/_api/canvas', { method: 'POST', body: { name, group: 'ui' } });
    // A design-system file and an asset alongside it, because "the cloud
    // commits" turns out to mean different things for different kinds of file
    // and the difference is the interesting part.
    const cssRel = `system/smoke/preview/${tag(run, `commit-${dir}`)}.css`;
    await writeProjectFile(from, cssRel, `/* ${tag(run, dir)} */\n`);
    const asset = await from.api('/_api/asset', {
      method: 'POST',
      raw: makePng(run + (dir === 'cloud-to-desktop' ? 31 : 32)),
      contentType: 'application/octet-stream',
    });
    return { rel: uiRel(name), name, cssRel, asset: asset.path };
  },
  settle: ({ cloud }, m) =>
    // The cell is the only side with a checkout the hub commits to, so this
    // watches the CLOUD's git log in both directions — including the one where
    // the cloud is the actor, because "it committed its own work" is a claim
    // worth holding too. Waits for a commit naming THIS canvas: "some commits
    // exist" would pass on the seed commit alone.
    waitFor(
      async () => {
        const scoped = await cloud.api(
          `/_api/git/log?limit=10&path=${encodeURIComponent(`.design/${m.rel}`)}`
        );
        return (scoped?.entries ?? []).length > 0;
      },
      { timeoutMs: 90_000, label: `a commit touching ${m.rel}` }
    ),
  async verify({ cloud }, m) {
    const log = await cloud.api('/_api/git/log?limit=25');
    const entries = log?.entries ?? [];
    const scoped = await cloud.api(
      `/_api/git/log?limit=10&path=${encodeURIComponent(`.design/${m.rel}`)}`
    );
    const status = await cloud.api('/_api/git/status');
    const dirty = (status?.files ?? status?.changes ?? []).map((f) => f.path ?? f);
    const untracked = (p) => dirty.some((d) => String(d).endsWith(p));
    return [
      ['the checkout has commits', entries.length > 0],
      ['they are attributed, not anonymous', entries.every((e) => !!e.author && !!e.date)],
      ['history is queryable for THIS canvas', (scoped?.entries ?? []).length > 0, scoped?.entries],
      [
        'no per-machine runtime state leaked into the working tree',
        !dirty.some((d) => /\/_(state|history|server|sync|locator|active|trash)/.test(String(d))),
        dirty,
      ],
      // THE GAP, stated rather than hidden. The hub commits on
      // `onDocumentStored` — one commit per CANVAS DOCUMENT. Files that arrive
      // over the file plane (assets, design-system css/md/ts) go through the
      // write door, which journals them and never commits them. So the cloud's
      // git history covers the canvases and not the project: restore that
      // checkout from git alone and the pictures are gone.
      [
        'a peer-landed design-system file is committed too',
        !untracked(m.cssRel),
        'expected-pending',
      ],
      ['a peer-landed asset is committed too', !untracked(m.asset), 'expected-pending'],
    ];
  },
};

const presence = {
  id: 'presence',
  title: 'a second person shows up on the same canvas',
  plane: 'presence',
  needsBrowser: true,
  async act({ from, to, run, dir }) {
    const name = tag(run, `presence-${dir}`);
    await from.api('/_api/canvas', { method: 'POST', body: { name, group: 'ui' } });
    return { rel: uiRel(name), slug: uiSlug(name), name };
  },
  settle: ({ to }, m) => waitFor(() => to.has(m.rel), { label: m.rel }),
  async verify({ from, to }, m) {
    if (!from.browserHandle || !to.browserHandle) {
      return [['presence needs both browsers', false, 'run without --no-browser']];
    }
    // Open the SAME canvas on both machines, by clicking its row — the only
    // reliable way in, and incidentally a check that the row is clickable.
    // OPEN IT THE WAY A PERSON WOULD: type into the search box, then click the
    // one row left. Clicking the row directly looked simpler and failed for two
    // reasons a screenshot made obvious — with twenty-odd canvases the target
    // sits below the fold so the click misses, and a popover left open by an
    // earlier scenario silently swallows it. Filtering fixes both, because it
    // is what the box is for.
    const row = `[data-testid="canvas-row-${m.slug}"]`;
    const openIt = async (side) => {
      const b = side.browserHandle;
      await b.open(side.uiUrl);
      await sleep(1_500);
      // A lapsed session shows the sign-in form, which is an auth problem
      // wearing a sync problem's clothes. Rule it out before reporting.
      if (
        !(await b.present('[data-testid="canvas-search"]')) &&
        typeof side.reSignIn === 'function'
      ) {
        await side.reSignIn();
        await b.open(side.uiUrl);
        await sleep(1_500);
      }
      await b.run(['fill', '[data-testid="canvas-search"]', m.name]);
      await sleep(800);
      const found = await b.waitPresent(row, { timeoutMs: 25_000 });
      if (found.ok) await b.click(row);
      // THE ACTIVE PATH, not an iframe. A brief board has no artboards and
      // therefore mounts no iframe at all, so "an iframe exists" was asking the
      // wrong question — it happened to pass one direction and not the other.
      return waitFor(
        async () => {
          const bar = await b.eval(
            'document.querySelector(\'[data-testid="statusbar"]\')?.textContent ?? ""'
          );
          return typeof bar === 'string' && bar.includes(`${m.name}.tsx`);
        },
        { timeoutMs: 25_000, label: 'the status bar naming this canvas' }
      );
    };
    const here = await openIt(from);
    const there = await openIt(to);
    // WHAT THIS CAN AND CANNOT ASSERT, stated rather than fudged.
    //
    // Participant chips and live cursors render inside the CANVAS IFRAME, which
    // is a separate origin by design (DDR-054). A parent-document query cannot
    // reach them, and `.st-presence` in the shell is the LOCAL user's own
    // avatar — it never shows anybody else, so counting it would be a check
    // that fails whether presence works or not. So: the precondition here, and
    // the screenshots for the collaborative half, honest about being a human
    // check rather than pretending to be a machine one.
    await from.browserHandle.shot(`presence--${m.slug}--from`);
    await to.browserHandle.shot(`presence--${m.slug}--to`);
    return [
      ['both machines have the same canvas open', here.ok && there.ok],
      ['(participant chips + cursors are cross-origin — see the two screenshots)', true],
    ];
  },
};

/* ----------------------------------------------------------------- parity --- */

/**
 * Per-project by design, so parity must not ask about them.
 *
 * `config.json` holds THIS machine's name and THIS machine's `linkedHub` — two
 * peers agreeing on it would mean one of them had been overwritten with the
 * other's identity, which is the opposite of working.
 */
const NEVER_IDENTICAL = new Set(['config.json']);

/**
 * Paths parity must not ask about at all.
 *
 * `.gitkeep` is the marker `createFolder` drops so git tracks an empty
 * directory. The classifier refuses leading-dot files, so it never crosses —
 * which is consistent with folders not crossing until they hold something, and
 * is the design rather than a gap.
 */
const NOT_SYNCED = (rel) => rel.split('/').some((seg) => seg.startsWith('.'));

const fullParity = {
  id: 'full-parity',
  title: 'every shared file agrees on both sides',
  plane: 'file+doc',
  async act() {
    return {};
  },
  settle: ({ from, to }) =>
    waitFor(() => shared(from).every((r) => to.has(r)), { timeoutMs: 60_000, label: 'parity' }),
  async verify({ from, to }) {
    const mine = shared(from);
    const missing = mine.filter((r) => !to.has(r));
    const differing = mine.filter((r) => to.has(r) && !agrees(from, to, r));
    return [
      [`nothing missing on the far side (${mine.length} files)`, missing.length === 0, missing],
      ['no shared file disagrees', differing.length === 0, differing],
    ];
  },
};

const shared = (side) => side.tracked().filter((r) => !NEVER_IDENTICAL.has(r) && !NOT_SYNCED(r));

/* ------------------------------------------------------------- helpers --- */

/**
 * Does the side actually SERVE the asset, not merely hold the bytes?
 *
 * Through the design-root mount (`/.design/assets/…`), which is the URL a
 * canvas resolves. NOT `/assets/…` — on a cell that is the hub's own
 * bearer-gated object-storage route, and probing it would report 401 for a file
 * that is sitting right there and serving fine.
 */
async function servesAsset(side, rel) {
  try {
    const res = await fetch(`${side.base}/${side.designDirName}/${rel}`, {
      headers: side.headers,
    });
    return res.ok && Number(res.headers.get('content-length') ?? 1) !== 0;
  } catch {
    return false;
  }
}

/**
 * Write a plain project file (design-system css, markdown, a module).
 *
 * There is no studio route for "write an arbitrary project file" and there
 * should not be — the routes are per-kind on purpose. On the DESKTOP side that
 * is a plain disk write, which is exactly what an agent or an editor does. On
 * the CLOUD side the same disk is the hub's checkout, so writing it directly is
 * what `/design:setup-ds` running inside the cell does too. Both are the real
 * out-of-band path, and the walk-import reconciler is what has to notice them.
 */
async function writeProjectFile(side, rel, contents) {
  const abs = side.abs(rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, contents);
}

/** Read-modify-write a project file. Same out-of-band path as above. */
async function editProjectFile(side, rel, transform) {
  const abs = side.abs(rel);
  const before = existsSync(abs) ? readFileSync(abs, 'utf8') : '';
  writeFileSync(abs, transform(before));
}

/**
 * `.meta.json` is only PARTLY shared, so a byte comparison is the wrong test.
 *
 * The doc lane carries the shared subset; `last_modified` is stamped locally on
 * a layout change and the camera never leaves `_canvas-state/` at all
 * (DDR-115). Comparing whole files would report a difference that is the design
 * working, which is worse than not checking — it trains you to ignore the row.
 */
const LOCAL_META_KEYS = new Set(['last_modified', 'viewport']);

function sharedMeta(side, rel) {
  try {
    const parsed = JSON.parse(side.text(rel));
    const out = {};
    for (const k of Object.keys(parsed).sort()) {
      if (!LOCAL_META_KEYS.has(k)) out[k] = parsed[k];
    }
    return JSON.stringify(out);
  } catch {
    return null;
  }
}

/** Do both sides agree about `rel`, judged the way that path deserves? */
function agrees(a, b, rel) {
  if (rel.endsWith('.meta.json')) {
    const x = sharedMeta(a, rel);
    return x !== null && x === sharedMeta(b, rel);
  }
  return sameBytes(a, b, rel);
}

/* ---------------------------------------------------------- the catalogue --- */

export const SCENARIOS = [
  canvasCreate,
  folderCreate,
  canvasMove,
  canvasRenameByHand,
  canvasDelete,
  folderDelete,
  canvasEdit,
  artboardMove,
  dsSpecimenCreate,
  dsSpecimenEdit,
  assetUpload,
  artboardPhoto,
  annotationShapes,
  annotationSticker,
  autocommitHistory,
  presence,
  fullParity,
];
