import { describe, expect, test } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type * as Y from 'yjs';

import { replicaActionId, replicaBoardText } from '../annotations/replica.ts';
import { createApi } from '../api.ts';
import { createPersistence } from '../collab/persistence.ts';
import { createRegistry } from '../collab/registry.ts';
import { type Context, createBus } from '../context.ts';
import { makeSandbox } from './_helpers.ts';
import { board, sticky } from './fixtures/annotations-v2/boards.ts';

const FILE = '.design/ui/Foo.tsx';
const SLUG = 'ui-foo';
// DDR-242 — canonical boards. The projection writes exactly these bytes, so
// `holdOldWrite` can recognise the old board's write by content.
const oldSvg = board(sticky('s1', 'old', { x: 1 }));
const newSvg = board(sticky('s1', 'new', { x: 2 }));
const annotationsOf = (doc: Y.Doc) => replicaBoardText(doc);

function rig() {
  const { root, designRoot } = makeSandbox();
  mkdirSync(join(designRoot, 'ui'), { recursive: true });
  writeFileSync(join(designRoot, 'ui/Foo.tsx'), 'export default function P(){return <main/>}');
  const ctx: Context = {
    cfg: {} as Context['cfg'],
    projectLabel: 'race',
    bus: createBus(),
    paths: {
      repoRoot: root,
      designRel: '.design',
      designRoot,
      serverInfoFile: join(designRoot, '_server.json'),
      activeFile: join(designRoot, '_active.json'),
      commentsDir: join(designRoot, '_comments'),
      canvasStateDir: join(designRoot, '_canvas-state'),
      historyDir: join(designRoot, '_history'),
      tokensUrlRel: '',
      systemDirRel: 'system',
    },
  };
  const registry = createRegistry({
    async seed() {},
    async persistJson() {},
    async persistBinary() {},
  });
  const room = registry.get(SLUG);
  const published: string[] = [];
  const api = createApi(ctx, {
    onCommentsChanged() {},
    onAnnotationsChanged(_file, svg, id) {
      published.push(svg);
      registry.syncRoomFromAnnotations(SLUG, svg, id);
    },
  });
  const persistence = createPersistence({ ctx, api, fileForSlug: async () => FILE });
  const disk = () => readFileSync(join(designRoot, `${SLUG}.annotations.json`), 'utf8');
  return { api, registry, room, persistence, published, disk };
}

/** Hold real async filesystem IO; no timer/order luck or fake document store. */
async function holdOldWrite(run: (started: Promise<void>, release: () => void) => Promise<void>) {
  const original = Bun.write;
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held = false;
  Bun.write = (async (...args: Parameters<typeof Bun.write>) => {
    if (!held && args[1] === oldSvg) {
      held = true;
      entered();
      await pending;
    }
    return original(...args);
  }) as typeof Bun.write;
  try {
    await run(started, release);
  } finally {
    release();
    Bun.write = original;
  }
}

describe('annotation projection cannot become a new edit', () => {
  test('a slow old projection cannot overwrite or republish a newer completed UI edit', async () => {
    const r = rig();
    try {
      await r.api.saveAnnotations(FILE, oldSvg, 'old-ui');
      await holdOldWrite(async (started, release) => {
        const flush = r.persistence.persistJson(SLUG, r.room.doc);
        await started;
        await r.api.saveAnnotations(FILE, newSvg, 'new-ui');
        release();
        await flush;
      });
      expect(annotationsOf(r.room.doc)).toBe(newSvg);
      expect(r.disk()).toBe(newSvg);
      expect(r.published).toEqual([oldSvg, newSvg]);
    } finally {
      await r.registry.destroyAll();
    }
  });

  test('a remote edit arriving during IO retires the older projection', async () => {
    const r = rig();
    try {
      await r.api.saveAnnotations(FILE, oldSvg, 'old-ui');
      await holdOldWrite(async (started, release) => {
        const flush = r.persistence.persistJson(SLUG, r.room.doc);
        await started;
        r.registry.syncRoomFromAnnotations(SLUG, newSvg, 'remote-ui');
        release();
        await flush;
      });
      expect(annotationsOf(r.room.doc)).toBe(newSvg);
      await r.persistence.persistJson(SLUG, r.room.doc);
      expect(r.disk()).toBe(newSvg);
      expect(r.published).toEqual([oldSvg]);
    } finally {
      await r.registry.destroyAll();
    }
  });

  test('ordinary projection preserves authorship without invoking the mutation hook', async () => {
    const r = rig();
    try {
      r.registry.syncRoomFromAnnotations(SLUG, newSvg, 'remote-ui');
      await r.persistence.persistJson(SLUG, r.room.doc);
      expect(r.disk()).toBe(newSvg);
      expect(r.published).toEqual([]);
      // The authoring action survives projection (the replica's '~action').
      expect(replicaActionId(r.room.doc)).toBe('remote-ui');
    } finally {
      await r.registry.destroyAll();
    }
  });
});
