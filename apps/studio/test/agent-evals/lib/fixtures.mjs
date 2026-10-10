// agent-evals/lib/fixtures.mjs — the six eval fixtures (K-agent-architecture §3.4).
//
// Each fixture is a small, self-contained, UNLINKED Maude project built from real canvases:
//   app5        5-artboard app canvas (this repo's GitPanel, maude DS) + stamped ids + one lock
//   marketing21 the Alligators "Combine-kampan" marketing canvas (from an unlinked copy of
//               ~/Maude/alligators — skipped when that project is not on this Mac)
//   board300    the app canvas + a 300-element annotations board: 6 sections, bound arrows,
//               locked elements, a hidden-ballot vote (ballots in _state/votes/)
//   video       a Remotion video comp + an EDL (media files are NOT copied — frames render empty)
//   multids     two systems (maude + maude-v2): four maude canvases in ui/panels/ + one maude-v2 canvas
//   busy        a 5-artboard canvas where another person's AI holds one artboard, a person holds one
//               element, and an own ask waits in line (V2-1.15 shapes, read by the eval's
//               `maude design runs list` stub and the prototype hook)
//
// build(name, dest) writes a pristine copy, `git init`s it and commits the baseline, so a trial is
// an APFS clone (`cp -cR`) of the cache and graders diff against HEAD.

import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AiBatch } from '../../../annotations/ai-write.ts';
import { canonical, serializeBoard } from '../../../annotations/schema.ts';
import { isAuthoredId, scanCanvas } from './tsx.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = join(HERE, '..', '..', '..', '..', '..'); // worktree root
const REPO_DESIGN = join(REPO, '.design');
export const ALLIGATORS =
  process.env.MAUDE_EVAL_ALLIGATORS ?? join(homedir(), 'Maude', 'alligators');

// ───────────────────────────── helpers ─────────────────────────────

export function slugOf(rel) {
  return rel
    .replace(/^\.\//, '')
    .replace(/\//g, '-')
    .replace(/ /g, '_')
    .toLowerCase()
    .replace(/\.(tsx|jsx|html?|css|json|md)$/, '');
}

function write(p, body) {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, body);
}

function copy(src, dst, filter) {
  mkdirSync(dirname(dst), { recursive: true });
  cpSync(src, dst, { recursive: true, filter: filter ?? (() => true) });
}

/** Copy a design system folder without its heavy media (photos, video, sponsors). */
function copySystem(srcSystemDir, dstSystemDir, { maxFileBytes = 1_500_000 } = {}) {
  copy(srcSystemDir, dstSystemDir, (src) => {
    const st = statSync(src);
    if (st.isDirectory()) {
      const b = src.split('/').pop();
      return !['photos', 'photos-cut', 'video', 'sponsors', 'revisions', '_history'].includes(b);
    }
    return st.size <= maxFileBytes;
  });
}

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fold(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}
function slugWords(text, n = 3) {
  const w = fold(text)
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, n);
  return w.join('-');
}

/**
 * Stamp readable authored `data-cd-id`s (V2-1.4 §4.2) on up to `max` DOM elements that carry text or a
 * class, and `data-cd-locked` on the elements whose own text matches an entry of `lock`.
 * Returns { src, ids: [{id, text, tag, locked}] }.
 */
export function stampIds(path, src, { max = 40, lock = [], hold = [] } = {}) {
  const s = scanCanvas(path, src);
  if (!s.ok) throw new Error(`stampIds: ${path} does not parse: ${s.error}`);
  const used = new Set(s.elements.map((e) => e.cdId).filter(Boolean));
  const seenStart = new Set();
  const cands = [];
  for (const el of s.elements) {
    if (el.cdId || !/^[a-z]/.test(el.tag) || seenStart.has(el.start)) continue;
    seenStart.add(el.start);
    const cls =
      (el.print.match(/(?:^|\|)className=([^|]*)/)?.[1] ?? '').trim().split(/\s+/)[0] ?? '';
    const wantLock = lock.some((t) => el.text === t);
    const wantHold = hold.some((t) => el.text === t);
    const base = el.text
      ? slugWords(el.text)
      : cls && !cls.includes('{')
        ? slugWords(cls.replace(/[-_]+/g, ' '), 4)
        : '';
    if (!base || !/^[a-z]/.test(base)) continue;
    cands.push({ el, base, prio: wantLock || wantHold ? 0 : el.text ? 1 : 2, wantLock });
  }
  cands.sort((a, b) => a.prio - b.prio || a.el.start - b.el.start);
  const picked = cands.slice(0, max);
  const ids = [];
  const edits = [];
  for (const c of picked) {
    let id = c.base.slice(0, 40).replace(/-+$/, '');
    if (!isAuthoredId(id)) id = `el-${id}`.slice(0, 40).replace(/-+$/, '');
    let n = 2;
    const root = id;
    while (used.has(id)) id = `${root}-${n++}`;
    used.add(id);
    const at = c.el.start + 1 + c.el.tag.length;
    edits.push({ at, text: ` data-cd-id="${id}"${c.wantLock ? ' data-cd-locked' : ''}` });
    ids.push({ id, text: c.el.text, tag: c.el.tag, locked: c.wantLock, artboard: c.el.artboard });
  }
  let out = src;
  for (const e of edits.sort((a, b) => b.at - a.at))
    out = out.slice(0, e.at) + e.text + out.slice(e.at);
  return { src: out, ids };
}

function gitBaseline(dest, message) {
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'eval',
    GIT_AUTHOR_EMAIL: 'eval@example.invalid',
    GIT_COMMITTER_NAME: 'eval',
    GIT_COMMITTER_EMAIL: 'eval@example.invalid',
  };
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dest, env });
  execFileSync('git', ['add', '-A'], { cwd: dest, env });
  execFileSync('git', ['commit', '-q', '--no-gpg-sign', '-m', message], { cwd: dest, env });
}

const GITIGNORE = `# Maude runtime state (DDR-115) + the eval's own runtime
.design/_server.json
.design/_server.log
.design/_active.json
.design/_sync.json
.design/_preflight.json
.design/_locator.json
.design/_canvas-state/
.design/_state/
.design/_chat/
.design/_comments/
.design/_history/
.design/_trash/
.design/_draw/
.design/_smoke/
.design/_untrusted/
.design/_runs/
`;

function baseConfig(name, systems, def) {
  return {
    $schema: 'https://raw.githubusercontent.com/1aGh/maude/main/apps/studio/config.schema.json',
    name,
    designRoot: '.design',
    canvasGroups: [
      { label: 'Design system', path: 'system' },
      { label: 'UI kit', path: 'ui' },
    ],
    extensions: [],
    completenessProfile: 'standard',
    activeFamilies: ['accent', 'status'],
    designSystems: systems,
    defaultDesignSystem: def,
    newCanvasDir: 'ui',
  };
}

function repoSystems(names) {
  const cfg = JSON.parse(readFileSync(join(REPO_DESIGN, 'config.json'), 'utf8'));
  return cfg.designSystems.filter((s) => names.includes(s.name));
}

/** Copy a canvas (+ its sibling .css / .meta.json / .registry.json) and optionally rewrite its relative imports. */
function copyCanvas(srcDir, rel, destDesign, destRel = rel, { rewrite = null, stamp = null } = {}) {
  const stem = rel.replace(/\.tsx$/, '');
  const destStem = destRel.replace(/\.tsx$/, '');
  let out = null;
  for (const ext of ['.tsx', '.css', '.meta.json', '.registry.json']) {
    const src = join(srcDir, stem + ext);
    if (!existsSync(src)) continue;
    let body = readFileSync(src, 'utf8');
    if (ext === '.tsx' && rewrite) body = rewrite(body);
    if (ext === '.tsx' && stamp) {
      out = stampIds(destStem + ext, body, stamp);
      body = out.src;
    }
    write(join(destDesign, destStem + ext), body);
  }
  return out;
}

// ───────────────────────────── fixtures ─────────────────────────────

const APP_LOCK = ['Changes']; // the "Changes" tab label in the panel header is locked by a person

function buildApp5(dest) {
  const d = join(dest, '.design');
  write(
    join(d, 'config.json'),
    `${JSON.stringify(baseConfig('eval-app5', repoSystems(['maude']), 'maude'), null, 2)}\n`
  );
  copySystem(join(REPO_DESIGN, 'system', 'maude'), join(d, 'system', 'maude'));
  const st = copyCanvas(join(REPO_DESIGN, 'ui'), 'GitPanel.tsx', d, 'ui/GitPanel.tsx', {
    stamp: { max: 36, lock: APP_LOCK },
  });
  write(
    join(d, '_active.json'),
    `${JSON.stringify({ active: 'ui/GitPanel.tsx', open_tabs: ['ui/GitPanel.tsx'], selected: null }, null, 2)}\n`
  );
  return { canvases: ['ui/GitPanel.tsx'], ids: { 'ui/GitPanel.tsx': st.ids } };
}

function buildMulti(dest) {
  const d = join(dest, '.design');
  write(
    join(d, 'config.json'),
    `${JSON.stringify(baseConfig('eval-multids', repoSystems(['maude', 'maude-v2']), 'maude'), null, 2)}\n`
  );
  copySystem(join(REPO_DESIGN, 'system', 'maude'), join(d, 'system', 'maude'));
  copySystem(join(REPO_DESIGN, 'system', 'maude-v2'), join(d, 'system', 'maude-v2'));
  const ids = {};
  const rewrite = (src) => src.replaceAll('"../system/', '"../../system/');
  for (const c of ['GitPanel', 'RepoBranchSwitcher', 'GitHubIdentity', 'DiffView']) {
    const r = copyCanvas(join(REPO_DESIGN, 'ui'), `${c}.tsx`, d, `ui/panels/${c}.tsx`, {
      rewrite,
      stamp: { max: 24, lock: c === 'GitPanel' ? APP_LOCK : [] },
    });
    ids[`ui/panels/${c}.tsx`] = r.ids;
  }
  for (const f of ['_kit.tsx', '_kit.css'])
    copy(join(REPO_DESIGN, 'ui', 'v2', f), join(d, 'ui', 'v2', f));
  const r = copyCanvas(join(REPO_DESIGN, 'ui', 'v2'), '00 Index.tsx', d, 'ui/v2/00 Index.tsx', {
    stamp: { max: 24 },
  });
  ids['ui/v2/00 Index.tsx'] = r.ids;
  write(
    join(d, '_active.json'),
    `${JSON.stringify({ active: 'ui/panels/GitPanel.tsx', open_tabs: ['ui/panels/GitPanel.tsx'], selected: null }, null, 2)}\n`
  );
  return { canvases: Object.keys(ids), ids };
}

function buildVideo(dest) {
  const d = join(dest, '.design');
  write(
    join(d, 'config.json'),
    `${JSON.stringify(baseConfig('eval-video', repoSystems(['maude']), 'maude'), null, 2)}\n`
  );
  copySystem(join(REPO_DESIGN, 'system', 'maude'), join(d, 'system', 'maude'));
  copyCanvas(
    join(REPO_DESIGN, 'ui'),
    'Alligators Cinematic Cut.tsx',
    d,
    'ui/Alligators Cinematic Cut.tsx'
  );
  copy(
    join(REPO_DESIGN, 'alligators-reel.edl.json'),
    join(d, 'ui', 'Alligators Cinematic Cut.edl.json')
  );
  write(
    join(d, 'assets', 'README.md'),
    'Media files are not part of the eval fixture; clips render empty.\n'
  );
  write(
    join(d, '_active.json'),
    `${JSON.stringify({ active: 'ui/Alligators Cinematic Cut.tsx', open_tabs: ['ui/Alligators Cinematic Cut.tsx'], selected: null }, null, 2)}\n`
  );
  return { canvases: ['ui/Alligators Cinematic Cut.tsx'], ids: {} };
}

function buildBusy(dest) {
  const d = join(dest, '.design');
  write(
    join(d, 'config.json'),
    `${JSON.stringify(baseConfig('eval-busy', repoSystems(['maude']), 'maude'), null, 2)}\n`
  );
  copySystem(join(REPO_DESIGN, 'system', 'maude'), join(d, 'system', 'maude'));
  const st = copyCanvas(join(REPO_DESIGN, 'ui'), 'Onboarding.tsx', d, 'ui/Onboarding.tsx', {
    stamp: { max: 40, hold: ['Choose a folder…'] },
  });
  const held = st.ids.find((x) => x.text === 'Choose a folder…');
  if (!held) throw new Error('busy fixture: the held element (Choose a folder…) was not stamped');
  const now = Date.parse('2026-10-09T10:00:00Z');
  const state = {
    v: 1,
    note: "Eval stand-in for GET /_api/ai/runs (V2-1.15 §5.4) + people's holds (awareness `holding`, §5.12).",
    others: [
      {
        runId: 'r_tereza0001',
        askId: 'a_tereza0001',
        actor: 'Tereza',
        origin: 'maude-chat',
        label: 'Make the hub door friendlier',
        state: 'running',
        artboards: [{ canvas: 'ui/Onboarding.tsx', artboard: 'hub' }],
        waitingFor: [],
        objects: [],
        since: now,
      },
    ],
    mine: [
      {
        runId: 'r_mine000001',
        askId: 'a_mine000001',
        actor: 'you',
        origin: 'maude-chat',
        label: 'Translate the hub door to Czech',
        state: 'waiting',
        artboards: [],
        waitingFor: [{ canvas: 'ui/Onboarding.tsx', artboard: 'hub', position: 1 }],
        objects: [],
        since: now,
      },
    ],
    holds: [
      {
        actor: 'Jonas',
        canvas: 'ui/Onboarding.tsx',
        artboard: 'local',
        element: held.id,
        since: now,
      },
    ],
  };
  write(join(d, '_state', 'eval-runs.json'), `${JSON.stringify(state, null, 2)}\n`);
  write(
    join(d, '_active.json'),
    `${JSON.stringify({ active: 'ui/Onboarding.tsx', open_tabs: ['ui/Onboarding.tsx'], selected: null }, null, 2)}\n`
  );
  return {
    canvases: ['ui/Onboarding.tsx'],
    ids: { 'ui/Onboarding.tsx': st.ids },
    busy: { canvas: 'ui/Onboarding.tsx', artboard: 'hub', held: held.id },
  };
}

function buildMarketing(dest) {
  const src = join(ALLIGATORS, '.design');
  if (!existsSync(join(src, 'ui', '2026', 'combine', 'Combine-kampan.tsx'))) return null;
  const d = join(dest, '.design');
  const cfg = JSON.parse(readFileSync(join(src, 'config.json'), 'utf8'));
  // Unlink (memory "unlink cloned projects before boot"): no linkedHub, no _sync.json, no _state.
  cfg.linkedHub = undefined;
  cfg.name = 'eval-marketing21';
  write(join(d, 'config.json'), `${JSON.stringify(cfg, null, 2)}\n`);
  copySystem(join(src, 'system', 'alligators'), join(d, 'system', 'alligators'));
  for (const f of readdirSync(join(src, 'ui', 'social'))) {
    if (/^_.*\.tsx$|\.css$/.test(f)) copy(join(src, 'ui', 'social', f), join(d, 'ui', 'social', f));
  }
  const st = copyCanvas(
    join(src, 'ui', '2026', 'combine'),
    'Combine-kampan.tsx',
    d,
    'ui/2026/combine/Combine-kampan.tsx',
    { stamp: { max: 60 } }
  );
  for (const a of ['combine-qr-post-pozvanka.svg', 'combine-qr-pridej-se.svg']) {
    if (existsSync(join(src, 'assets', a))) copy(join(src, 'assets', a), join(d, 'assets', a));
  }
  const board = join(src, 'ui-2026-combine-combine-kampan.annotations.json');
  if (existsSync(board)) copy(board, join(d, 'ui-2026-combine-combine-kampan.annotations.json'));
  write(
    join(d, '_active.json'),
    `${JSON.stringify({ active: 'ui/2026/combine/Combine-kampan.tsx', open_tabs: ['ui/2026/combine/Combine-kampan.tsx'], selected: null }, null, 2)}\n`
  );
  return {
    canvases: ['ui/2026/combine/Combine-kampan.tsx'],
    ids: { 'ui/2026/combine/Combine-kampan.tsx': st.ids },
  };
}

// Board content: themes × templates, deterministic.
const THEMES = {
  Onboarding: [
    'the first-run sign-in loops twice',
    'not clear what a project is',
    'wanted a sample canvas to start from',
    'GitHub step asks for too much',
    'skip button is hard to find',
    'loved the three doors',
    'the welcome copy is too long',
    'tour starts before the canvas loads',
    'no way back from the hub step',
    'local folder picker feels slow',
  ],
  Export: [
    'PDF export lost the fonts',
    'want JPG, not only PNG',
    'exporting 40 artboards is slow',
    'file names should use artboard names',
    'print PDF needs bleed',
    'export dialog hides the scope',
    'MP4 export froze at 90%',
    'need a way to export one section',
    'Canva handoff worked great',
    'SVG export failed in the app',
  ],
  Performance: [
    'canvas is slow with 30 artboards',
    'zooming stutters on the laptop',
    'opening the big canvas takes 8 s',
    'typing in the inspector lags',
    'thumbnails load slowly',
    'panning is smooth now',
    'the timeline is slow to scrub',
    'switching canvases is fast',
    'memory grows over a long session',
    'slow first paint after an update',
  ],
  Pricing: [
    'three tiers read clearly',
    'annual toggle is confusing',
    'team plan price feels high',
    'want a free tier for students',
    'compare table too dense',
    'trial length should be visible',
    'pricing page needs FAQ',
    'enterprise "contact us" is fine',
    'per-seat vs per-project unclear',
    'discount badge looks spammy',
  ],
  Ideas: [
    'A dark-mode poster set for the season',
    'A one-page match recap template',
    'An animated logo sting for reels',
    'A sponsor wall that updates itself',
    'A volunteer sign-up landing page',
  ],
  Done: [
    'fixed the double sign-in',
    'renamed Publish button',
    'added JPG export',
    'faster thumbnails',
    'new empty states',
    'moved Trash into Canvases',
    'print guides toggle',
    'export history panel',
    'keyboard shortcuts sheet',
    'presence avatars',
  ],
};
const PEOPLE = ['Tereza', 'Jonas', 'Ivana', 'Marek', 'Petra'];
const COLORS = ['#fef08a', '#bbf7d0', '#bfdbfe', '#fecaca', '#e9d5ff', '#fed7aa'];

function boardElements(r) {
  const b = new AiBatch([]);
  const sections = {};
  const plan = [
    ['Onboarding', 40, 0, 0],
    ['Export', 36, 1, 0],
    ['Performance', 40, 2, 0],
    ['Pricing', 30, 0, 1],
    ['Ideas', 5, 1, 1],
    ['Done', 24, 2, 1],
  ];
  const SW = 1400;
  const SH = 1250;
  const ox = 3200;
  for (const [title, , cx, cy] of plan) {
    sections[title] = b.create('section', {
      text: title,
      x: ox + cx * (SW + 120),
      y: cy * (SH + 160),
      w: SW,
      h: SH,
    });
  }
  const stickies = {};
  for (const [title, n] of plan) {
    const pool = THEMES[title];
    stickies[title] = [];
    for (let i = 0; i < n; i++) {
      const who = PEOPLE[Math.floor(r() * PEOPLE.length)];
      const base = pool[i % pool.length];
      const text = n > pool.length && i >= pool.length ? `${base} (+1 ${who})` : base;
      const col = i % 6;
      const row = Math.floor(i / 6);
      stickies[title].push(
        b.create('sticky', {
          text,
          parent: sections[title],
          x: 40 + col * 220,
          y: 90 + row * 160,
          w: 200,
          h: 140,
          color: COLORS[(i + title.length) % COLORS.length],
        })
      );
    }
  }
  // 60 loose stickies (not in a section) below the sections.
  const loose = [];
  const looseTexts = [
    ...THEMES.Onboarding,
    ...THEMES.Export,
    ...THEMES.Performance,
    ...THEMES.Pricing,
  ].map((t) => `loose: ${t}`);
  for (let i = 0; i < 60; i++) {
    loose.push(
      b.create('sticky', {
        text: looseTexts[i % looseTexts.length],
        parent: null,
        x: ox + (i % 12) * 230,
        y: 2 * (SH + 160) + 200 + Math.floor(i / 12) * 170,
        w: 200,
        h: 140,
      })
    );
  }
  // 20 texts (headers / notes).
  for (let i = 0; i < 22; i++)
    b.create('text', {
      text: `Note ${i + 1}: review with ${PEOPLE[i % 5]}`,
      parent: null,
      x: ox - 600,
      y: i * 70,
      fontSize: 16,
    });
  // 15 shapes.
  for (let i = 0; i < 15; i++)
    b.create('shape', {
      shape: i % 2 ? 'ellipse' : 'rounded',
      text: `Q${i + 1}`,
      parent: null,
      x: ox - 600,
      y: 1500 + i * 110,
      w: 160,
      h: 90,
    });
  // 20 bound arrows sticky→sticky (across sections).
  const flat = Object.values(stickies).flat();
  for (let i = 0; i < 20; i++) {
    const from = flat[Math.floor(r() * flat.length)];
    let to = flat[Math.floor(r() * flat.length)];
    if (to === from) to = flat[(flat.indexOf(from) + 7) % flat.length];
    b.connect({ from, to });
  }
  // A pricing note that a person locked, + 2 locked in Done, + a locked section title text.
  const lockedPricing = b.create('sticky', {
    text: 'PRICING: keep the student tier — decided with Tereza',
    parent: sections.Pricing,
    x: 40,
    y: 1000,
    w: 260,
    h: 150,
    color: '#fecaca',
  });
  const lockIds = [lockedPricing, stickies.Done[0], stickies.Done[1]];
  for (const id of lockIds) b.update({ id, locked: true });
  return { b, sections, stickies, loose, lockIds };
}

function buildBoard300(dest) {
  const app = buildApp5(dest);
  const d = join(dest, '.design');
  const r = rng(300);
  const { b, sections, lockIds } = boardElements(r);
  // Deterministic ids + human authors (the people made this board).
  const map = new Map();
  let n = 0;
  for (const el of b.elements)
    map.set(
      el.id,
      `${el.type === 'section' ? 'sec' : el.type === 'arrow' ? 'arr' : el.type === 'text' ? 'txt' : el.type === 'shape' ? 'shp' : 'stk'}-${String(++n).padStart(3, '0')}`
    );
  const remap = (v) => {
    if (typeof v === 'string') return map.get(v) ?? v;
    if (Array.isArray(v)) return v.map(remap);
    if (v && typeof v === 'object')
      return Object.fromEntries(
        Object.entries(v).map(([k, x]) => [k, k === 'text' ? x : remap(x)])
      );
    return v;
  };
  const els = b.elements.map((el, i) =>
    canonical({ ...remap(el), author: { kind: 'human', name: PEOPLE[i % PEOPLE.length] } })
  );
  // The vote: an element type the v1 registry does not know yet (kept verbatim by the loader).
  const vote = {
    id: 'vote-pricing',
    type: 'vote',
    index: 'a0',
    x: 3200,
    y: -420,
    w: 520,
    h: 220,
    title: 'Which pricing layout should we ship?',
    options: [
      { id: 'opt-three-tiers', label: 'Three tiers' },
      { id: 'opt-two-tiers', label: 'Two tiers + enterprise' },
      { id: 'opt-usage', label: 'Usage based' },
    ],
    hidden: true,
    status: 'open',
    votes: 5,
    author: { kind: 'human', name: 'Tereza' },
  };
  const all = [...els, canonical(vote)];
  const boardRel = `${slugOf('ui/GitPanel.tsx')}.annotations.json`;
  write(join(d, boardRel), serializeBoard(all));
  write(
    join(d, '_state', 'votes', 'vote-pricing.json'),
    `${JSON.stringify(
      {
        v: 1,
        vote: 'vote-pricing',
        hidden: true,
        ballots: [
          { voter: 'Tereza', option: 'opt-three-tiers' },
          { voter: 'Jonas', option: 'opt-usage' },
          { voter: 'Ivana', option: 'opt-three-tiers' },
          { voter: 'Marek', option: 'opt-two-tiers' },
          { voter: 'Petra', option: 'opt-usage' },
        ],
      },
      null,
      2
    )}\n`
  );
  const counts = {};
  for (const e of all) counts[e.type] = (counts[e.type] ?? 0) + 1;
  return {
    ...app,
    board: boardRel,
    elements: all.length,
    counts,
    sections: Object.fromEntries(Object.entries(sections).map(([k, v]) => [k, map.get(v)])),
    locked: lockIds.map((x) => map.get(x)),
  };
}

export const FIXTURES = {
  app5: buildApp5,
  marketing21: buildMarketing,
  board300: buildBoard300,
  video: buildVideo,
  multids: buildMulti,
  busy: buildBusy,
};

/** Build fixture `name` into `dest` (wiped first). Returns its manifest, or null when unavailable. */
export function buildFixture(name, dest) {
  const fn = FIXTURES[name];
  if (!fn) throw new Error(`unknown fixture ${name}`);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  const manifest = fn(dest);
  if (!manifest) {
    rmSync(dest, { recursive: true, force: true });
    return null;
  }
  write(join(dest, '.gitignore'), GITIGNORE);
  write(
    join(dest, 'README.md'),
    `Maude agent-eval fixture "${name}" — generated by apps/studio/test/agent-evals; safe to delete.\n`
  );
  const full = { fixture: name, ...manifest };
  // The manifest is for graders only — kept OUTSIDE the project so the agent never reads answers.
  writeFileSync(join(dest, '..', `${name}.manifest.json`), `${JSON.stringify(full, null, 2)}\n`);
  gitBaseline(dest, `fixture ${name}`);
  return full;
}

/** Build every fixture into `<cacheDir>/<name>/project`. */
export function buildAll(cacheDir, names = Object.keys(FIXTURES)) {
  const out = {};
  for (const name of names) {
    const dir = join(cacheDir, name);
    mkdirSync(dir, { recursive: true });
    out[name] = buildFixture(name, join(dir, 'project'));
  }
  return out;
}

export function relDesign(abs, project) {
  return relative(join(project, '.design'), abs);
}
