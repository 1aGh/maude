import { describe, expect, test } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createApi } from '../api.ts';
import { createPersistence } from '../collab/persistence.ts';
import { createRegistry } from '../collab/registry.ts';
import { type Context, createBus } from '../context.ts';
import { makeSandbox } from './_helpers.ts';

const FILE = '.design/ui/Foo.tsx';
const SLUG = 'ui-foo';
const oldSvg = '<svg><rect x="1"/></svg>';
const newSvg = '<svg><rect x="2"/></svg>';

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
  const disk = () => readFileSync(join(designRoot, `${SLUG}.annotations.svg`), 'utf8');
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
      expect(r.room.doc.getMap('annotations').get('svg')).toBe(newSvg);
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
      expect(r.room.doc.getMap('annotations').get('svg')).toBe(newSvg);
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
      expect(r.room.doc.getMap('annotations').get('writeId')).toBe('remote-ui');
    } finally {
      await r.registry.destroyAll();
    }
  });
});
