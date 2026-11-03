// rc3-i (rc soak checklist 1aGh/maude#162) — a cloud tab never says "on this Mac".
//
// A cloud tab is a browser on a cell: `exportLane` is 'remote' | 'none' (never 'local'), `shell` is 'cloud',
// `cfg.cloud` is set, and it is not the native app. Nothing it holds is on a Mac, so every sentence that
// says where something is kept or rendered must either say the cloud or say nothing about where (the
// callouts' rule, p8-cell-copy: "same words, minus the part that is false there").
//
// The desktop's words are pinned unchanged beside each case, so a fix cannot flatten them.

import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderChoice } from '../client/export-lane.js';
import { estimateWords, summaryWords } from '../client/v2/export/export-copy.js';
import { PANEL_FOOT, RUNNING_FOOT } from '../client/v2/export/exports-model.js';
import { ExportsPanel } from '../client/v2/export/exports-panel.jsx';
import { bigWords } from '../client/v2/export/sections/batch-model.js';
import { queuedInviteWords } from '../client/v2/share/share-model.js';
import { ShareSheet } from '../client/v2/share/share-sheet.jsx';
import { menuCtx } from '../client/v2/shell/project-menu-model.js';
import { facesOf, saveStatus } from '../client/v2/shell/save-status.js';
import { ShareCluster } from '../client/v2/shell/share-cluster.jsx';

/** The strings the checklist names, in any case: "On this Mac", "kept on this Mac", "this Mac". */
const MAC = /this mac|on a mac|your mac/i;

const tick = (ms = 300) => new Promise((r) => setTimeout(r, ms));

let root: Root | null = null;
let host: HTMLElement | null = null;
const realFetch = globalThis.fetch;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  globalThis.fetch = realFetch;
  try {
    localStorage.clear();
  } catch {}
});
const $ = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const everything = () => host?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

// ── the export sheet, mounted as a cloud tab ──────────────────────────────────────────────────────
let estimate: Record<string, unknown> = {};

function stubFetch() {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    const json = (v: unknown, status = 200) =>
      new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
    if (url.endsWith('/_api/export-history')) return json({ history: [] });
    if (url.endsWith('/_api/export-estimate')) return json(estimate);
    return json({}, 404);
  }) as typeof fetch;
}

async function mountExport(props: Record<string, unknown>) {
  stubFetch();
  const { ExportDialog } = await import('../client/dialogs/export-dialog.jsx');
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <ExportDialog
        mode="export"
        activePath=".design/ui/reel.tsx"
        designRel=".design"
        onClose={() => {}}
        {...props}
      />
    );
    await tick();
  });
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      await tick(250);
    });
  }
}

/** Open Advanced so the "Where it renders" part is on the page. */
async function openAdvanced() {
  await act(async () => {
    $('[data-testid="export-advanced-toggle"]')?.click();
    await tick(50);
  });
}

// A workspace with no render service: the server's estimate says this-mac (nothing can render in the
// cloud), and — worst case — a stale `render.cloud: true`. Neither may put a Mac in the words.
const VIDEO_ROW = {
  canvas: 'ui/reel.tsx',
  artboard: 'reels',
  label: 'Recap Reels',
  w: 1080,
  h: 1920,
  frames: 900,
  fps: 30,
  cap: 3600,
  over: false,
  clips: [
    { track: 'video', from: 0, frames: 300, name: 'Tunel', src: 'assets/a.mp4' },
    { track: 'video', from: 300, frames: 600, name: 'Tackle', src: 'assets/b.mp4' },
  ],
};
const EST_NONE = {
  counts: { selection: 1, canvas: 2, folder: 2, project: 2 },
  files: 1,
  bytes: 6_000_000,
  seconds: 40,
  lane: 'this-mac',
  byKind: { video: { artboards: 1, files: 1, format: 'mp4' } },
  skipped: [],
  video: [VIDEO_ROW],
  render: { cloud: true, suggest: 'cloud', why: '4k' },
};
const EST_BATCH_CLOUD = {
  counts: { selection: null, canvas: 21, folder: 38, project: 524 },
  files: 524,
  bytes: 5_900_000_000,
  seconds: 720,
  lane: 'cloud',
  byKind: {
    digital: { artboards: 424, files: 424, format: 'png' },
    print: { artboards: 46, files: 46, format: 'pdf' },
    video: { artboards: 24, files: 24, format: 'mp4' },
  },
  skipped: [],
};

describe('the export sheet in a cloud tab', () => {
  test('a video on a workspace with no render service: no Render row, no this-Mac footer, no Mac in Advanced', async () => {
    estimate = EST_NONE;
    await mountExport({
      exportLane: 'none',
      hasSelection: true,
      selectedArtboards: ['reels'],
      selectionLabel: 'Recap Reels',
    });
    await openAdvanced();
    expect($('[data-testid="export-render"]')).toBeNull();
    expect($('[data-testid="export-adv-render"]')).not.toBeNull();
    expect(everything()).not.toMatch(MAC);
  });

  test('a big whole-project export on the render service: the cloud finishes it, and no Mac is named', async () => {
    estimate = EST_BATCH_CLOUD;
    await mountExport({ exportLane: 'remote', hasSelection: false, selectedArtboards: [] });
    await act(async () => {
      $('[data-testid="export-scope-project"]')?.click();
      await tick(300);
    });
    expect($('[data-testid="export-big"]')?.textContent).toContain('big export');
    await openAdvanced();
    expect(everything()).not.toMatch(MAC);
  });

  test('the same sheet on the desktop keeps its words (a Mac renders, and says so)', async () => {
    estimate = { ...EST_NONE, render: { cloud: true, suggest: 'cloud', why: '4k' } };
    await mountExport({
      exportLane: 'local',
      hasSelection: true,
      selectedArtboards: ['reels'],
      selectionLabel: 'Recap Reels',
    });
    expect($('[data-testid="export-render-this-mac"]')?.textContent).toContain('On this Mac');
  });
});

describe('the export words, as functions', () => {
  const est = { files: 21, bytes: 140_000_000, seconds: 20, lane: 'this-mac' };

  test('the estimate sentence names the cloud, or no place at all, in a workspace', () => {
    expect(estimateWords(est)).toBe('21 files · about 140 MB · about 20 seconds on this Mac');
    expect(estimateWords(est, { workspace: true })).toBe(
      '21 files · about 140 MB · about 20 seconds'
    );
    expect(estimateWords({ ...est, lane: 'cloud' }, { workspace: true })).toMatch(/ in the cloud$/);
    expect(summaryWords(est, { workspace: true })).not.toMatch(MAC);
  });

  test('a big video export says "this Mac’s part" only where a Mac has a part', () => {
    const big = { files: 524, bytes: 5_900_000_000, seconds: 720, lane: 'cloud' };
    expect(bigWords(big, { summary: 'x', hasVideo: true })).toContain('this Mac’s part');
    expect(bigWords(big, { summary: 'x', hasVideo: true, workspace: true })).not.toMatch(MAC);
  });

  test('the Render row (cloud or this Mac) is the desktop’s question only', () => {
    const render = { cloud: true, suggest: 'cloud', why: '4k' };
    expect(renderChoice({ render }).show).toBe(true);
    expect(renderChoice({ render, workspace: true }).show).toBe(false);
  });
});

// ── the Exports panel's foot ──────────────────────────────────────────────────────────────────────
function exportsCenter(jobs: unknown[]) {
  return {
    jobs,
    panelOpen: true,
    selectedJobId: null,
    savingIds: new Set<string>(),
    closePanel: mock(() => {}),
    reveal: mock(async () => {}),
    download: mock(async () => {}),
    again: mock(async () => {}),
    retry: mock(async () => {}),
  };
}

describe('the Exports panel in a cloud tab', () => {
  const running = (over: Record<string, unknown>) => ({
    id: 'j1',
    format: 'mp4',
    scope: 'canvas',
    status: 'running',
    createdAt: '2026-11-03T10:00:00',
    progress: { current: 3, total: 10 },
    ...over,
  });
  const foot = (native: boolean, jobs: unknown[]) => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    act(() =>
      root?.render(
        createElement(ExportsPanel, {
          center: exportsCenter(jobs),
          native,
          coverOf: () => null,
        })
      )
    );
    return host.querySelector('.ex-panel-foot')?.textContent ?? '';
  };

  test('a running cloud render in a browser tab: the foot does not mention a Mac', () => {
    expect(foot(false, [running({ runsOn: 'cloud' })])).not.toMatch(MAC);
  });

  test('a render running on a Mac keeps the desktop foot', () => {
    expect(foot(true, [running({ runsOn: 'this-mac' })])).toBe(RUNNING_FOOT);
  });

  test('idle: the same foot as ever', () => {
    expect(foot(false, [running({ status: 'done', filename: 'A.mp4', runsOn: 'cloud' })])).toBe(
      PANEL_FOOT
    );
  });
});

// ── the Share cluster's save word ─────────────────────────────────────────────────────────────────
describe('the Share cluster in a cloud tab', () => {
  const linked = { linked: true, online: false, phase: 'offline', pending: 0, writeFailed: null };

  test('offline, the word is "Offline" — nothing is kept on a Mac', () => {
    expect(saveStatus(linked).word).toBe('Offline — kept on this Mac');
    const cloud = saveStatus({ ...linked, cloud: true });
    expect(cloud.word).toBe('Offline');
    expect(cloud.kind).toBe('offline');
  });

  test('the other words are the same in a cloud tab', () => {
    for (const [input, word] of [
      [{ linked: true, online: true, phase: 'synced' }, 'Saved'],
      [{ linked: true, online: true, phase: 'syncing' }, 'Syncing…'],
    ] as const)
      expect(saveStatus({ ...input, cloud: true }).word).toBe(word);
  });

  test('the offline tooltip under Share does not name a Mac', async () => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(
        <ShareCluster
          faces={facesOf({ you: 'Michal' })}
          status={saveStatus({ ...linked, cloud: true })}
          cloud
          ctx={menuCtx({ native: false, canvasOpen: true })}
          run={() => {}}
          onStatusAction={() => {}}
        />
      );
    });
    expect(host.querySelector('[data-testid="share-offline-tip"]')?.textContent ?? '').not.toMatch(
      MAC
    );
    expect(host.querySelector('[data-testid="share-cluster-status"]')?.textContent).toBe('Offline');
  });
});

// ── the Share sheet, mounted as a cloud tab ───────────────────────────────────────────────────────
const TARGET = { path: '.design/ui/a.tsx', rel: 'ui/a.tsx', label: 'a' };
const OWNER_ME = { role: 'owner', grants: [], caps: { invite: true, read: true } };

async function mountShare(over: Record<string, unknown>, shell: 'cloud' | 'native' = 'cloud') {
  const ok = (body: unknown, status = 200) => Promise.resolve({ ok: status < 300, status, body });
  const api = {
    posture: () => ok(over.posture),
    me: () => ok(OWNER_ME),
    people: () => ok({ people: [] }),
    invite: () => over.invite ?? ok({ id: 'i1' }, 201),
    resend: () => ok({}),
    revoke: () => ok(null, 204),
    setRole: () => ok({}),
    remove: () => ok(null, 204),
  };
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <ShareSheet
        target={TARGET}
        links={{ web: 'https://a.cloud.maude.sh/?open=ui/a.tsx', app: null, local: null }}
        shell={shell}
        project="Alligators"
        youEmail="m@x.cz"
        api={api}
        onClose={() => {}}
      />
    );
  });
  await act(async () => {
    await tick(10);
  });
}

const CLOUD_POSTURE = {
  linked: true,
  reachable: true,
  capabilities: [],
  access: {
    authority: 'control-plane',
    roles: ['viewer', 'member', 'owner'],
    scopes: ['project'],
    links: false,
    requests: true,
  },
};

describe('the Share sheet in a cloud tab', () => {
  test('the cell cannot be reached: the line does not say which Mac the invites wait on', async () => {
    await mountShare({ posture: { linked: true, reachable: false } });
    const line = $('[data-testid="share-unreachable"]');
    expect(line).not.toBeNull();
    expect(line?.textContent).not.toMatch(MAC);
    expect(everything()).not.toMatch(MAC);
  });

  test('"Local project — kept on this Mac" is never drawn in a cloud tab, whatever the posture says', async () => {
    await mountShare({ posture: { linked: false } });
    expect($('[data-testid="share-local-note"]')).toBeNull();
    expect(everything()).not.toMatch(MAC);
  });

  test('the ordinary cloud sheet — linked, reachable — says nothing about a Mac', async () => {
    await mountShare({ posture: CLOUD_POSTURE });
    expect($('[data-testid="share-invite"]')).not.toBeNull();
    expect(everything()).not.toMatch(MAC);
  });

  test('a queued invite (the fallback sentence) does not name a Mac', () => {
    expect(queuedInviteWords('native')).toBe('Invites send when this Mac is online.');
    expect(queuedInviteWords('cloud')).not.toMatch(MAC);
  });

  test('the desktop sheet keeps its words: an unlinked project stays on the Mac', async () => {
    await mountShare({ posture: { linked: false } }, 'native');
    // the unlinked desktop project is offered the move to Maude Cloud, and says it stays on the Mac too
    expect($('[data-testid="share-local-note"]')?.textContent).toContain('It stays on this Mac');
  });

  test('the desktop sheet keeps its words: the hub cannot be reached', async () => {
    await mountShare({ posture: { linked: true, reachable: false } }, 'native');
    expect($('[data-testid="share-unreachable"]')?.textContent).toContain('this Mac');
  });
});
