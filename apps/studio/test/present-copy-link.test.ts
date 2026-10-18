// S3.7b — Copy presentation link (S3-present-session §5): `<hub>/present/<rel without .tsx>`, each
// segment encoded; only for a cloud-linked project (the base is the share link's public web origin —
// the linked hub on a desktop, the tab's own origin in a cloud tab; never a loopback address).
// Offline it waits (S3.8: 04's note 25 — "Copy presentation link waits for a connection").

import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  presentationLinkFor as cliPresentationLinkFor,
  runOpen,
} from '../../../cli/lib/design-open.mjs';
import { buildShareLinks } from '../client/share-link.js';
import { copyPresentationLink, presentationLinkFor } from '../client/v2/present/copy-link.js';

describe('presentationLinkFor', () => {
  test('the drawn link and a nested, unicode canvas', () => {
    expect(
      presentationLinkFor('combine-kampan.tsx', 'https://alligators.cloud.maude.sh/?open=x')
    ).toBe('https://alligators.cloud.maude.sh/present/combine-kampan');
    expect(presentationLinkFor('ui/Žába 2.tsx', 'https://a.cloud.maude.sh/')).toBe(
      'https://a.cloud.maude.sh/present/ui/%C5%BD%C3%A1ba%202'
    );
  });

  test('no cloud link → null; not a .tsx canvas → null', () => {
    expect(presentationLinkFor('ui/A.tsx', null)).toBeNull();
    expect(presentationLinkFor('ui/A.html', 'https://a.cloud.maude.sh/')).toBeNull();
    expect(presentationLinkFor('', 'https://a.cloud.maude.sh/')).toBeNull();
    expect(presentationLinkFor('ui/A.tsx', 'not a url')).toBeNull();
  });

  test('it rides the share link: a desktop linked project and a cloud tab; a local-only one has none', () => {
    const desktop = buildShareLinks({
      rel: 'ui/A.tsx',
      shell: 'desktop',
      location: { origin: 'http://localhost:4399', pathname: '/' },
      linkedHubUrl: 'https://alligators.cloud.maude.sh',
      project: 'alligators',
      localUrl: 'http://localhost:4399',
    });
    expect(presentationLinkFor('ui/A.tsx', desktop.web)).toBe(
      'https://alligators.cloud.maude.sh/present/ui/A'
    );
    const cloud = buildShareLinks({
      rel: 'ui/A.tsx',
      shell: 'cloud',
      location: { origin: 'https://alligators.cloud.maude.sh', pathname: '/' },
      project: 'alligators',
    });
    expect(presentationLinkFor('ui/A.tsx', cloud.web)).toBe(
      'https://alligators.cloud.maude.sh/present/ui/A'
    );
    const local = buildShareLinks({
      rel: 'ui/A.tsx',
      shell: 'desktop',
      location: { origin: 'http://localhost:4399', pathname: '/' },
      linkedHubUrl: 'http://localhost:7000',
      project: 'x',
      localUrl: 'http://localhost:4399',
    });
    expect(presentationLinkFor('ui/A.tsx', local.web)).toBeNull();
  });

  test('the CLI builds the same link (maude design open <canvas> --mode present)', () => {
    for (const rel of ['combine-kampan.tsx', 'ui/Žába 2.tsx', 'a/b/c.tsx']) {
      expect(cliPresentationLinkFor(rel, 'https://a.cloud.maude.sh')).toBe(
        presentationLinkFor(rel, 'https://a.cloud.maude.sh/?open=z')
      );
    }
  });
});

describe('copyPresentationLink', () => {
  const run = async (online: boolean, write: (s: string) => Promise<void>) => {
    const toasts: { title: string; kind: string }[] = [];
    const ok = await copyPresentationLink({
      rel: 'ui/A.tsx',
      webLink: 'https://a.cloud.maude.sh/?open=ui/A.tsx',
      online,
      writeText: write,
      notify: (t: { title: string; kind: string }) => toasts.push(t),
    });
    return { ok, toasts };
  };

  test('online: copies the link and says so', async () => {
    const copied: string[] = [];
    const { ok, toasts } = await run(true, async (s) => {
      copied.push(s);
    });
    expect(ok).toBe(true);
    expect(copied).toEqual(['https://a.cloud.maude.sh/present/ui/A']);
    expect(toasts).toEqual([{ title: 'Presentation link copied', kind: 'success' }]);
  });

  test('offline: waits — nothing is copied and the toast says why (S3.8, md-edge-offline)', async () => {
    const copied: string[] = [];
    const { ok, toasts } = await run(false, async (s) => {
      copied.push(s);
    });
    expect(ok).toBe(false);
    expect(copied).toEqual([]);
    expect(toasts).toEqual([
      { title: 'Copy presentation link — waits for a connection', kind: 'error' },
    ]);
  });

  test('no cloud link copies nothing and names where it works; a failed clipboard says so', async () => {
    const toasts: { title: string; kind: string }[] = [];
    const none = await copyPresentationLink({
      rel: 'ui/A.tsx',
      webLink: null,
      online: true,
      writeText: async () => {
        throw new Error('never');
      },
      notify: (t: { title: string; kind: string }) => toasts.push(t),
    });
    expect(none).toBe(false);
    expect(toasts[0].title).toBe('Copy presentation link — in a cloud project');
    const failed = await run(true, async () => {
      throw new Error('denied');
    });
    expect(failed.ok).toBe(false);
    expect(failed.toasts[0].kind).toBe('error');
  });
});

describe('maude design open <canvas> --mode present', () => {
  const project = (linkedHub: unknown) => {
    const root = mkdtempSync(join(tmpdir(), 'maude-open-present-'));
    mkdirSync(join(root, '.design/ui'), { recursive: true });
    writeFileSync(join(root, '.design/config.json'), JSON.stringify({ linkedHub }));
    writeFileSync(join(root, '.design/ui/A.tsx'), 'export default () => null;\n');
    return root;
  };
  const sink = () => {
    const chunks: string[] = [];
    return { chunks, write: (s: string) => chunks.push(s) };
  };

  test('a linked project prints the presentation link (before the window check)', async () => {
    const root = project({ url: 'https://alligators.cloud.maude.sh' });
    try {
      const out = sink();
      const code = await runOpen({
        words: ['ui/A.tsx', '--mode', 'present', '--root', root],
        env: {},
        out,
        err: sink(),
      });
      expect(code).toBe(3); // no Maude window in a test — the link prints regardless
      expect(out.chunks.join('')).toContain(
        'presentation link: https://alligators.cloud.maude.sh/present/ui/A'
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('an unlinked or loopback-linked project, or another mode, prints no link', async () => {
    const cases: [unknown, string][] = [
      [undefined, 'present'],
      [{ url: 'http://localhost:7000' }, 'present'],
      [{ url: 'https://a.cloud.maude.sh' }, 'preview'],
    ];
    for (const [hub, mode] of cases) {
      const root = project(hub);
      try {
        const out = sink();
        await runOpen({
          words: ['ui/A.tsx', '--mode', mode, '--root', root],
          env: {},
          out,
          err: sink(),
        });
        expect(out.chunks.join('')).not.toContain('presentation link');
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });
});
