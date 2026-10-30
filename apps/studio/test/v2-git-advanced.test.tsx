// S11.10 — Version history › Advanced, drawn (06 · ad-history): the git in plain words, one fold down. Every
// button of the retired Changes / History panel and of the project dock's branch half is reached here and does
// what it did: Branch (behind the chat guard), Drafts › Continue, Remote › Copy, Changed in this version (its git
// id, +14 −6, the lines), Not in a version yet › Discard, Save a version with a note…, New branch…, Fetch,
// Publish N versions, Pull a copy to this Mac…, Add to main · opens a pull request, Undo. Can comment / Can view
// get none of it, a browser tab gets the awareness, a cloud tab gets "Cloud versions".
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  if (typeof document === 'undefined') GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { HistoryAdvanced } from '../client/v2/history/git-advanced.jsx';

const CANVAS = '.design/ui/Combine.tsx';
const FILES = [
  { path: CANVAS, status: 'modified' },
  { path: '.design/ui/Combine.meta.json', status: 'modified' },
  { path: 'brief.md', status: 'deleted' },
];
const BRANCHES = [
  { name: 'main', current: true, updatedAt: 100, where: 'both' },
  { name: 'tereza/uniformy-v2', current: false, updatedAt: 300, where: 'local' },
  { name: 'jonas/ads', current: false, updatedAt: 200, where: 'remote' },
];
const LOG = [
  {
    sha: 'bbb2222cafe',
    message: 'Post 1:1 greener',
    author: 'Tereza',
    email: 't@x',
    date: '2026-10-18T14:33:00Z',
  },
  {
    sha: 'aaa1111cafe',
    message: 'Story copy',
    author: 'Jonas',
    email: 'j@x',
    date: '2026-10-18T14:00:00Z',
  },
];
const ROW = { ref: 'r5', from: 'r4', madeAt: Date.parse('2026-10-18T14:32:00Z') };
const SRC: Record<string, string> = {
  r4: '<div>\n  background: var(--ink);\n  gap: 8px;\n</div>',
  r5: '<div>\n  background: var(--green);\n  --badge: var(--lime);\n  gap: 8px;\n</div>',
};

type Call = { url: string; method: string; body?: Record<string, unknown> };
let calls: Call[] = [];
let running = 0;
let answers: Record<string, { status: number; body: unknown }> = {};
const j = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const fetchImpl = (async (url: string, init?: { method?: string; body?: string }) => {
  const method = init?.method ?? 'GET';
  const body = init?.body ? JSON.parse(init.body) : undefined;
  calls.push({ url, method, body });
  if (answers[url]) return j(answers[url].status, answers[url].body);
  if (url === '/_api/git/branches') return j(200, { ok: true, branches: BRANCHES });
  if (url === '/_api/acp/running') return j(200, { running });
  if (url.startsWith('/_api/project/source')) {
    const at = new URL(url, 'http://x').searchParams.get('at') ?? '';
    return SRC[at] ? j(200, { ok: true, source: SRC[at] }) : j(404, { ok: false });
  }
  if (method === 'POST') return j(200, { ok: true });
  return j(404, {});
}) as unknown as typeof fetch;

let host: HTMLElement;
let root: Root;
const flush = async () => {
  for (let i = 0; i < 8; i++) await act(async () => {});
};
const reloads: number[] = [];
const actions = {
  commits: [] as unknown[][],
  discards: [] as unknown[][],
  publishes: 0,
  latest: 0,
  undone: [] as string[],
  restored: [] as number[],
  previews: [] as string[],
  commitResult: { ok: true } as Record<string, unknown>,
  publishResult: { ok: true } as Record<string, unknown>,
};
const git = (over: Record<string, unknown> = {}) => ({
  status: { repo: true, branch: 'main', files: FILES, unpushed: 2 },
  project: 'Alligators brand',
  native: true,
  cellManaged: false,
  cloudManaged: false,
  designRel: '.design',
  remote: 'https://github.com/brno-alligators/brand.git',
  historySource: 'local',
  historyRefresh: 0,
  loadLog: async () => LOG,
  onCommit: async (...a: unknown[]) => {
    actions.commits.push(a);
    return actions.commitResult;
  },
  onDiscard: async (...a: unknown[]) => {
    actions.discards.push(a);
    return { ok: true };
  },
  onPublish: async () => {
    actions.publishes++;
    return actions.publishResult;
  },
  onGetLatest: async () => {
    actions.latest++;
    return { ok: true };
  },
  onUndoAction: async (id: string) => {
    actions.undone.push(id);
    return true;
  },
  onRestoreVersion: async (rev: number) => {
    actions.restored.push(rev);
    return true;
  },
  onPreviewVersion: (sha: string) => actions.previews.push(sha),
  onOpenCanvas: () => {},
  onOpenDiff: () => {},
  reload: () => reloads.push(1),
  ...over,
});

async function mount(over: Record<string, unknown> = {}, props: Record<string, unknown> = {}) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      <HistoryAdvanced
        canvas={CANVAS}
        canView
        fetchImpl={fetchImpl}
        git={git(over)}
        {...{ role: 'edit', ...props }}
      />
    )
  );
  await flush();
}
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  calls = [];
  running = 0;
  answers = {};
  reloads.length = 0;
  actions.commits = [];
  actions.discards = [];
  actions.publishes = 0;
  actions.latest = 0;
  actions.undone = [];
  actions.restored = [];
  actions.previews = [];
  actions.commitResult = { ok: true };
  actions.publishResult = { ok: true };
});

const q = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const qa = (sel: string) => [...document.querySelectorAll(sel)] as HTMLElement[];
const text = (sel: string) => q(sel)?.textContent ?? '';
const click = async (el: Element | null) => {
  expect(el).not.toBeNull();
  await act(async () => {
    (el as HTMLElement).click();
  });
  await flush();
};
// happy-dom does not route a native `input` event into React's onChange: set the value, then call the prop
// (the house way — test/v2-history-panel.test.tsx)
const typeInto = async (el: HTMLElement | null, value: string) => {
  expect(el).not.toBeNull();
  const node = el as HTMLInputElement | HTMLTextAreaElement;
  const propsKey = Object.keys(node).find((k) => k.startsWith('__reactProps$')) as string;
  const props = (node as unknown as Record<string, { onChange: (e: unknown) => void }>)[propsKey];
  await act(async () => {
    const proto = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
    Object.getOwnPropertyDescriptor(proto.prototype, 'value')?.set?.call(node, value);
    props.onChange({ target: node, currentTarget: node });
  });
  await flush();
};
const button = (label: string | RegExp) =>
  qa('button').find((b) =>
    typeof label === 'string' ? b.textContent === label : label.test(b.textContent ?? '')
  ) ?? null;

describe('who sees what', () => {
  test('Can view and Can comment get no git — Compare pictures stays (it is S1.15’s)', async () => {
    for (const role of ['view', 'comment']) {
      await mount({}, { role, onComparePictures: () => {} });
      expect(q('[data-testid="git-panel"]')).toBeNull();
      expect(q('[data-testid="vh-compare-pictures"]')).not.toBeNull();
      // and nothing was asked of the server on its behalf
      expect(calls.filter((c) => c.url.startsWith('/_api/git/'))).toEqual([]);
      await act(async () => root.unmount());
      host.remove();
    }
  });

  test('an editor in the desktop app gets the whole fold, in plain words', async () => {
    await mount();
    expect(q('[data-testid="git-panel"]')?.getAttribute('data-mode')).toBe('full');
    expect(text('[data-testid="git-panel-repo"]')).toContain('Alligators brand');
    expect(text('[data-testid="git-panel-repo"]')).toContain('main');
    const labels = qa('.vh-git-acts button').map((b) => b.textContent);
    expect(labels).toEqual([
      'Save a version with a note…',
      'New branch…',
      'Fetch',
      'Publish 2 versions',
      'Pull a copy to this Mac…',
    ]);
    expect(text('.vh-git')).toContain('Not in a version yet');
    // on the shared line nothing is added to anything
    expect(q('[data-testid="switcher-merge"]')).toBeNull();
  });

  test('a browser tab is awareness only: the files and the versions, no buttons, and it says why', async () => {
    await mount({ native: false });
    expect(q('[data-testid="git-panel"]')?.getAttribute('data-mode')).toBe('read-only');
    expect(text('[data-testid="vh-git-note"]')).toMatch(/read-only/);
    expect(q('.vh-git-acts')).toBeNull();
    expect(q('[data-testid="git-discard"]')).toBeNull();
    expect(q('[data-testid="vh-git-branch"]')).toBeNull(); // the branch is text, not a control
    expect(qa('[data-testid="git-compare"]').length).toBe(1);
  });

  test('a cloud tab is "Cloud versions": the list and its retry, nothing to press', async () => {
    await mount({ cellManaged: true });
    expect(q('[data-testid="git-panel"]')?.getAttribute('data-mode')).toBe('cloud');
    expect(text('.vh-git')).toContain('Cloud versions');
    expect(q('.vh-git-acts')).toBeNull();
    expect(qa('[data-testid^="vh-git-version-"]').length).toBe(2);
  });

  test('a linked desktop repo names who is saving, and keeps the list', async () => {
    await mount({ cloudManaged: true });
    expect(text('[data-testid="git-cloud-managed"]')).toMatch(/Cloud is saving/);
    expect(q('.vh-git-acts')).toBeNull();
    expect(qa('[data-testid^="vh-git-version-"]').length).toBe(2);
  });

  test('a failed cloud read is a Retry, not "no versions"', async () => {
    let n = 0;
    await mount({
      cellManaged: true,
      historySource: 'cloud',
      loadLog: async () => (n++ === 0 ? null : LOG),
    });
    expect(q('[data-testid="git-history-unreachable"]')).not.toBeNull();
    expect(text('.vh-git')).not.toContain('No saved versions');
    await click(q('[data-testid="git-history-retry"]'));
    expect(q('[data-testid="git-history-unreachable"]')).toBeNull();
    expect(qa('[data-testid^="vh-git-version-"]').length).toBe(2);
  });

  test('not in git: the folder says so', async () => {
    await mount({ status: { repo: false, files: [] } });
    expect(text('[data-testid="vh-git-note"]')).toMatch(/Not versioned yet/);
  });
});

describe('Branch · Drafts · Remote', () => {
  test('the select lists the shared line first, a teammate’s branch marked; the remote copies', async () => {
    await mount();
    const opts = qa('[data-testid="vh-git-branch"] option');
    expect(opts.map((o) => o.getAttribute('data-testid'))).toEqual([
      'branch-row-main',
      'branch-row-tereza-uniformy-v2',
      'branch-row-jonas-ads',
    ]);
    expect(opts[2]?.textContent).toContain('not downloaded yet');
    expect(text('[data-testid="vh-git-remote"]')).toContain('github.com/brno-alligators/brand');
    const copied: string[] = [];
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async (t: string) => copied.push(t) },
      configurable: true,
    });
    await click(q('[data-testid="vh-git-remote-copy"]'));
    expect(copied).toEqual(['github.com/brno-alligators/brand']);
  });

  test('Continue goes back to the newest local draft', async () => {
    await mount();
    expect(text('[data-testid="switcher-resume"]')).toContain('tereza/uniformy-v2');
    await click(q('[data-testid="vh-git-continue"]'));
    const post = calls.find((c) => c.url === '/_api/git/checkout');
    expect(post?.body).toEqual({ name: 'tereza/uniformy-v2' });
    expect(reloads.length).toBe(1);
  });

  test('Dismiss hides the Continue row', async () => {
    await mount();
    await click(q('[data-testid="switcher-resume-dismiss"]'));
    expect(q('[data-testid="switcher-resume"]')).toBeNull();
    expect(calls.some((c) => c.url === '/_api/git/checkout')).toBe(false);
  });

  test('switching branches asks the server whether a chat is working first (D10) — and waits for a yes', async () => {
    running = 2;
    await mount();
    const select = q('[data-testid="vh-git-branch"]') as HTMLSelectElement;
    await act(async () => {
      select.value = 'jonas/ads';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush();
    expect(calls.some((c) => c.url === '/_api/acp/running')).toBe(true);
    expect(calls.some((c) => c.url === '/_api/git/checkout')).toBe(false);
    expect(text('[data-testid="switcher-chat-guard"]')).toContain('2 chats are working right now');
    // Wait: nothing moved
    await click(q('[data-testid="switcher-chat-guard-cancel"]'));
    expect(calls.some((c) => c.url === '/_api/git/checkout')).toBe(false);
    expect(reloads.length).toBe(0);
    // Do it anyway: the checkout, then the page reloads
    await act(async () => {
      select.value = 'jonas/ads';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush();
    await click(q('[data-testid="switcher-chat-guard-confirm"]'));
    expect(calls.find((c) => c.url === '/_api/git/checkout')?.body).toEqual({ name: 'jonas/ads' });
    expect(reloads.length).toBe(1);
  });

  test('a checkout that fails says so and does not reload', async () => {
    answers['/_api/git/checkout'] = {
      status: 400,
      body: { ok: false, error: 'Local changes would be lost' },
    };
    await mount();
    await click(q('[data-testid="vh-git-continue"]'));
    expect(reloads.length).toBe(0);
    expect(text('.vh-git-err')).toBe('Local changes would be lost');
  });

  test('on a branch: the add-to-main button, with the pull-request words for a GitHub remote', async () => {
    await mount({ status: { repo: true, branch: 'tereza/uniformy-v2', files: [], unpushed: 0 } });
    expect(text('[data-testid="switcher-merge"]')).toBe('Add to main · opens a pull request');
    expect(q('[data-testid="switcher-resume"]')).toBeNull();
  });
});

describe('Changed in this version', () => {
  test('its git id, M, +2 −1 and the lines', async () => {
    await mount({}, { version: 'r5', versionRow: ROW });
    expect(text('.vh-git-sub-a')).toBe('bbb2222');
    expect(text('[data-testid="vh-git-changed-file"]')).toContain(CANVAS);
    expect(text('[data-testid="vh-git-changed-file"]')).toContain('+2');
    expect(text('[data-testid="vh-git-changed-file"]')).toContain('−1');
    expect(qa('[data-testid="vh-git-diff"] span').map((s) => s.textContent)).toEqual([
      '−    background: var(--ink);',
      '+    background: var(--green);',
      '+    --badge: var(--lime);',
    ]);
    const asked = calls.filter((c) => c.url.startsWith('/_api/project/source'));
    expect(asked.length).toBe(2);
    expect(asked[0]?.url).toContain('lane=html');
  });

  test('a version the host cannot read says so, and nothing is guessed', async () => {
    await mount({}, { version: 'r9', versionRow: { ...ROW, ref: 'r9', from: 'r8' } });
    expect(text('.vh-git')).toContain('The changes in this version are not available here.');
  });

  test('with no version selected there is no such section', async () => {
    await mount();
    expect(text('.vh-git')).not.toContain('Changed in this version');
  });
});

describe('Not in a version yet · Save · Discard', () => {
  test('a canvas and its sidecars are one row; Discard asks, then takes them all', async () => {
    await mount();
    const rows = qa('[data-testid="vh-git-notyet"] .vh-git-unit');
    expect(rows.map((r) => r.querySelector('.vh-git-fname')?.textContent)).toEqual([
      'Combine',
      'brief.md',
    ]);
    expect(rows[0]?.textContent).toContain('+1 supporting');
    const asked: string[] = [];
    const original = window.confirm;
    window.confirm = (m?: string) => {
      asked.push(String(m));
      return true;
    };
    try {
      await click(rows[0]?.querySelector('[data-testid="git-discard"]') ?? null);
    } finally {
      window.confirm = original;
    }
    expect(asked[0]).toContain('Discard your changes to “Combine” and its supporting files?');
    expect(actions.discards).toEqual([[[CANVAS, '.design/ui/Combine.meta.json']]]);
  });

  test('Save a version with a note…: a note and a file, then the canvas and its sidecars go as one', async () => {
    await mount();
    await click(q('[data-testid="vh-git-save"]'));
    const dialog = q('[data-testid="vh-git-save-dialog"]');
    expect(dialog?.querySelector('h2')?.textContent).toBe('Save a version');
    const primary = dialog?.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(primary.textContent).toBe('Save a version'); // the title’s verb is the button’s
    expect(primary.disabled).toBe(true);
    await typeInto(q('[data-testid="git-commit-message"]'), '  Greener badge  ');
    expect(primary.disabled).toBe(false);
    await click(primary);
    expect(actions.commits).toEqual([
      ['Greener badge', [CANVAS, '.design/ui/Combine.meta.json', 'brief.md']],
    ]);
    expect(q('[data-testid="vh-git-save-dialog"]')).toBeNull();
    expect(text('.vh-git-banner')).toContain('Version saved.');
  });

  test('Save all takes everything whatever is ticked', async () => {
    await mount();
    await click(q('[data-testid="vh-git-save"]'));
    await typeInto(q('[data-testid="git-commit-message"]'), 'All of it');
    await click(q('input[aria-label="Select all changed files"]'));
    await click(q('[data-testid="git-save-all"]'));
    expect(actions.commits).toEqual([['All of it', undefined]]);
  });

  test('a save the server refuses keeps the dialog open with the reason', async () => {
    actions.commitResult = { ok: false, error: 'Author identity unknown' };
    await mount();
    await click(q('[data-testid="vh-git-save"]'));
    await typeInto(q('[data-testid="git-commit-message"]'), 'x');
    await click(q('[data-testid="vh-git-save-dialog"] button[type="submit"]'));
    expect(text('[data-testid="vh-git-save-dialog"] [role="alert"]')).toBe(
      'Author identity unknown'
    );
  });
});

describe('Fetch · New branch · Publish · Get latest · Add to main · Pull a copy', () => {
  test('Fetch asks the remote and re-reads the branches', async () => {
    answers['/_api/git/fetch'] = { status: 200, body: { ok: true, fetchedAt: 1_000 } };
    await mount();
    const before = calls.filter((c) => c.url === '/_api/git/branches').length;
    await click(q('[data-testid="switcher-fetch"]'));
    expect(calls.some((c) => c.url === '/_api/git/fetch' && c.method === 'POST')).toBe(true);
    expect(calls.filter((c) => c.url === '/_api/git/branches').length).toBe(before + 1);
  });

  test('a fetch with no sign-in says to sign in; the list stays', async () => {
    answers['/_api/git/fetch'] = { status: 401, body: { ok: false, authRequired: true } };
    await mount();
    await click(q('[data-testid="switcher-fetch"]'));
    expect(text('.vh-git-err')).toBe('Sign in with GitHub to fetch remote branches.');
    expect(qa('[data-testid="vh-git-branch"] option').length).toBe(3);
  });

  test('New branch…: the name becomes a slug, the chat guard runs, then it is created and the page reloads', async () => {
    await mount();
    await click(q('[data-testid="switcher-new-branch"]'));
    const dialog = q('[data-testid="vh-git-branch-dialog"]');
    expect(dialog?.querySelector('h2')?.textContent).toBe('Create a branch');
    await typeInto(q('[data-testid="switcher-new-branch-input"]'), 'Nav Redesign');
    expect(dialog?.textContent).toContain('Creates branch nav-redesign');
    await click(q('[data-testid="switcher-new-branch-create"]'));
    expect(calls.some((c) => c.url === '/_api/acp/running')).toBe(true);
    expect(calls.find((c) => c.url === '/_api/git/branch')?.body).toEqual({ name: 'nav-redesign' });
    expect(reloads.length).toBe(1);
  });

  test('Publish N versions; a conflict asks for Get latest, and Get latest clears it', async () => {
    actions.publishResult = { ok: false, conflict: true };
    await mount();
    await click(q('[data-testid="git-publish"]'));
    expect(actions.publishes).toBe(1);
    expect(text('.vh-git-banner')).toContain("Publish didn't go through");
    await click(q('.vh-git-banner [data-testid="git-get-latest"]'));
    expect(actions.latest).toBe(1);
    expect(text('.vh-git-banner')).toContain('Up to date with everyone.');
  });

  test('a protected branch points at the pull-request way in', async () => {
    actions.publishResult = {
      ok: false,
      error: 'remote: error: GH006: Protected branch update failed',
    };
    await mount();
    await click(q('[data-testid="git-publish"]'));
    expect(text('.vh-git-banner')).toContain('This branch is protected');
    expect(text('.vh-git-banner')).toContain('Add to main');
  });

  test('the team has new versions: the nudge offers Get latest', async () => {
    await mount({
      status: { repo: true, branch: 'main', files: [], unpushed: 0, remoteAhead: true, behind: 3 },
    });
    expect(text('.vh-git-banner')).toContain('3 new changes from your team.');
    await click(q('.vh-git-banner [data-testid="git-get-latest"]'));
    expect(actions.latest).toBe(1);
  });

  test('Add to main: a pull request opens and the link is shown; Got it for a branch with no PR', async () => {
    answers['/_api/git/fold'] = {
      status: 200,
      body: {
        ok: true,
        prUrl: 'https://github.com/brno-alligators/brand/pull/7',
        prNumber: 7,
        repo: 'brno-alligators/brand',
      },
    };
    await mount({ status: { repo: true, branch: 'tereza/uniformy-v2', files: [], unpushed: 0 } });
    await click(q('[data-testid="switcher-merge"]'));
    const dialog = q('[data-testid="vh-git-add-dialog"]');
    expect(dialog?.querySelector('h2')?.textContent).toBe('Add to main');
    await click(q('[data-testid="switcher-merge-confirm"]'));
    expect(calls.find((c) => c.url === '/_api/git/fold')?.body).toEqual({
      name: 'tereza/uniformy-v2',
    });
    expect(text('[data-testid="vh-git-add-dialog"] h2')).toBe('Pull request opened #7');
    expect(q('[data-testid="switcher-pr-link"]')).not.toBeNull();
    expect(reloads.length).toBe(0); // the branch stays: the pull request points at it
  });

  test('Add to main on a project with no remote adds it directly and reloads', async () => {
    answers['/_api/git/fold'] = { status: 200, body: { ok: true } };
    await mount({ status: { repo: true, branch: 'old', files: [], unpushed: 0 } });
    await click(q('[data-testid="switcher-merge"]'));
    await click(q('[data-testid="switcher-merge-confirm"]'));
    expect(reloads.length).toBe(1);
  });

  test('Pull a copy to this Mac… is the registry action project.pull-copy', async () => {
    await mount();
    const heard: unknown[] = [];
    const on = (e: Event) => heard.push((e as CustomEvent).detail);
    window.addEventListener('maude:menu-action', on);
    await click(q('[data-testid="vh-git-pull-copy"]'));
    window.removeEventListener('maude:menu-action', on);
    expect(heard).toEqual([{ id: 'project.pull-copy' }]);
  });
});

describe('Every version, with its id', () => {
  test('a commit reads author · id; Preview opens it', async () => {
    await mount();
    const rows = qa('[data-testid^="vh-git-version-"]');
    expect(rows[0]?.textContent).toContain('Tereza · bbb2222');
    await click(rows[0]?.querySelector('button') ?? null);
    expect(actions.previews).toEqual(['bbb2222cafe']);
  });

  test('a revision of the project: Preview · Restore · Undo (mine) — each does what the v1 row did', async () => {
    const accepted = (revision: number, mine: boolean, undo = false) => ({
      sha: `r${revision}`,
      message: `Edit ${revision}`,
      author: 'Jonas',
      date: '2026-10-18T14:00:00Z',
      accepted: { revision, mine, undo, actionId: `act-${revision}` },
    });
    await mount({
      historySource: 'project',
      loadLog: async () => [accepted(9, true), accepted(8, false), accepted(7, true, true)],
    });
    expect(text('[data-testid="project-history-row-9"]')).toContain('Jonas · version 9');
    // Undo is on MY rows, not a teammate's and not on an undo
    expect(q('[data-testid="project-history-undo-9"]')).not.toBeNull();
    expect(q('[data-testid="project-history-undo-8"]')).toBeNull();
    expect(q('[data-testid="project-history-undo-7"]')).toBeNull();
    await click(q('[data-testid="project-history-undo-9"]'));
    expect(actions.undone).toEqual(['act-9']);
    expect(text('[data-testid="project-history-row-9"]')).toContain('Undone.');
    await click(q('[data-testid="project-history-restore-8"]'));
    expect(actions.restored).toEqual([8]);
    expect(text('[data-testid="project-history-row-8"]')).toContain(
      'Restored — a new version was added.'
    );
    await click(q('[data-testid="project-history-preview-8"]'));
    expect(actions.previews).toEqual(['r8']);
  });

  test('the project’s refusal to undo is said, not swallowed', async () => {
    await mount({
      historySource: 'project',
      loadLog: async () => [
        {
          sha: 'r4',
          message: 'Edit',
          author: 'Me',
          date: '2026-10-18T14:00:00Z',
          accepted: { revision: 4, mine: true, undo: false, actionId: 'act-4' },
        },
      ],
      onUndoAction: async () => false,
    });
    await click(q('[data-testid="project-history-undo-4"]'));
    expect(text('[data-testid="project-history-row-4"]')).toContain(
      'Someone changed this since — nothing was undone.'
    );
  });
});

// p8-sweep-leftovers item 6 — Compare pictures with no version picked reads the git HEAD copy; a project that is
// not in git has none (the crawler saw `?sha=HEAD` 404 + "No saved version of this canvas"). The button rests with
// DiffView's own line; a picked version (the op log's `r<n>`) still compares.
describe('Compare pictures without git', () => {
  test('not in git, no version picked: the button rests and says why', async () => {
    const asked: unknown[] = [];
    await mount(
      { status: { repo: false, files: [] } },
      { onComparePictures: (a: unknown) => asked.push(a) }
    );
    const btn = q('[data-testid="vh-compare-pictures"]') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('aria-description')).toBe(
      'No saved version of this canvas to compare yet.'
    );
    await act(async () => btn.click());
    expect(asked).toEqual([]);
  });

  test('not in git, a version picked: it compares with that version', async () => {
    const asked: unknown[] = [];
    await mount(
      { status: { repo: false, files: [] } },
      { version: 'r12', onComparePictures: (a: unknown) => asked.push(a) }
    );
    const btn = q('[data-testid="vh-compare-pictures"]') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    await act(async () => btn.click());
    expect(asked).toEqual([{ file: CANVAS, beforeSha: 'r12' }]);
  });

  test('in git: the saved copy is HEAD, as before', async () => {
    const asked: unknown[] = [];
    await mount({}, { onComparePictures: (a: unknown) => asked.push(a) });
    const btn = q('[data-testid="vh-compare-pictures"]') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    await act(async () => btn.click());
    expect(asked).toEqual([{ file: CANVAS, beforeSha: 'HEAD' }]);
  });
});
