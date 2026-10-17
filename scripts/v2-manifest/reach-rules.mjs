// The pure half of the nothing-deleted reachability probe (Phase 4 gate; contract
// apps/studio/client/v2/contracts/V2-4-gate-nothing-deleted.md). probe-reach.mjs boots the studio and
// collects what is on screen; this file says where each row / kept target MUST be reachable and turns
// the collected evidence into reachability.json. No DOM, no browser — scripts/test covers it.

/** One headless boot per shell and per role that exists today (owner · member · viewer). */
export const PROBES = Object.freeze([
  { id: 'desktop', shell: 'desktop', role: 'owner', tauri: true },
  { id: 'browser', shell: 'browser', role: 'owner' },
  {
    id: 'cloud-owner',
    shell: 'cloud',
    role: 'owner',
    config: {
      cloud: {
        dashboardUrl: 'https://cloud.example/dashboard',
        projectName: 'Studio site',
        user: 'tereza@example.com',
        role: 'owner',
      },
    },
  },
  {
    id: 'cloud-member',
    shell: 'cloud',
    role: 'member',
    config: {
      cloud: {
        dashboardUrl: 'https://cloud.example/dashboard',
        projectName: 'Studio site',
        user: 'ola@example.com',
        role: 'member',
      },
    },
  },
  {
    id: 'cloud-viewer',
    shell: 'cloud',
    role: 'viewer',
    config: {
      readOnly: true,
      cloud: {
        dashboardUrl: 'https://cloud.example/dashboard',
        projectName: 'Studio site',
        user: 'jonas@example.com',
        role: 'viewer',
      },
    },
  },
  { id: 'viewer', shell: 'viewer', role: 'viewer', config: { readOnly: true } },
  { id: 'embed', shell: 'embed', role: 'viewer', query: '?embed=1' },
]);
export const PROBE_IDS = PROBES.map((p) => p.id);
/** The shells a local project runs in. */
export const LOCAL_PROBES = ['desktop', 'browser'];
/** Hub role → registry role (actions/types.ts Role; the hub's viewer is Can comment, V2-1.7). */
export const REGISTRY_ROLE = Object.freeze({ owner: 'owner', member: 'edit', viewer: 'comment' });

/** §A home codes (06 Advanced ITEMS col 3) only an editor reaches — a viewer probe is exempt. */
export const EDIT_HOMES = new Set(['insp', 'lay', 'assets', 'ds', 'tl', 'ai', 'vh', 'exp']);
/** v1 characterization golden prefix → the probes that shell became (a kept hook seen there in v1
 *  must stay reachable there). */
export const GOLDEN_SHELLS = Object.freeze({
  browser: ['browser'],
  tauri: ['desktop'],
  viewer: ['viewer'],
  cloud: ['cloud-owner', 'cloud-member'],
  'cloud-viewer': ['cloud-viewer'],
  'sync-offline': ['browser'],
});
/** §B rows whose home names its shells (the rest default to the local probes as owner). */
export const B_REACH = Object.freeze({ D19: ['desktop'] });

/** The v2 element that runs an action when the action has no menu row and no ⌘K row of its own
 *  (tools live on the in-canvas toolbars, V2-1.2; a few panels are opened by their own tab). */
export const ACTION_SURFACE = Object.freeze({
  'tool.select': 'toolbar-slot-move',
  'tool.hand': 'toolbar-slot-hand',
  'tool.pen': 'toolbar-slot-pen',
  'tool.highlighter': 'toolbar-slot-pen', // Marker's second tip
  'tool.eraser': 'toolbar-slot-pen', // a Marker option
  'tool.shape': 'toolbar-slot-shape',
  'tool.rect': 'toolbar-slot-shape',
  'tool.ellipse': 'toolbar-slot-shape', // Shape › kinds
  'tool.text': 'toolbar-slot-text',
  'tool.sticky': 'toolbar-slot-sticky',
  'tool.comment': 'toolbar-slot-comment',
  'tool.arrow': 'toolbar-slot-arrow',
  'tool.browse': 'toolbar-slot-browse',
  'tool.section': 'toolbar-slot-section',
  'search.open': '[aria-label="Command palette"]',
  'canvases.search': 'canvas-search',
  'view.layers': 'panel-tab-layers',
  'view.assets': 'panel-tab-assets',
  'view.design-system': 'canvases-ds-row',
  'view.trash': 'canvases-trash-row',
  'canvases.refresh': 'canvases-refresh',
  'ai.chat': 'ai-chat-header',
  'view.comments': 'share-cluster-comments',
  'view.panels': 'share-cluster-panels',
  'share.open': 'share-cluster-share',
});

/** The registry context a probe's shell computes (actions/ctx.ts) with a canvas open. */
export function ctxFor(probe) {
  const facts = new Set(['canvasOpen', 'online']);
  if (probe.shell === 'desktop') facts.add('native');
  if (probe.shell === 'cloud') facts.add('linkedHub');
  return {
    role: REGISTRY_ROLE[probe.role],
    shell: probe.shell,
    mode: probe.role === 'viewer' ? 'viewing' : 'edit',
    focus: 'chrome',
    selection: 'none',
    facts,
  };
}

/**
 * Probes where a ROW must be reachable. Order: an explicit `v2.reach` (probe ids) → §B default →
 * the owning model's local flag (settings-model `local: true` = absent in a cloud tab, DDR-209 D1) →
 * the registry's `visible` predicate when the row names an action → editor-only homes → never embed.
 */
export function rowProbes(row, { settingsLocal, actions, isVisible }) {
  if (Array.isArray(row.v2?.reach)) return row.v2.reach.filter((p) => PROBE_IDS.includes(p));
  if (row.id.startsWith('D')) return B_REACH[row.id] ?? LOCAL_PROBES;
  let out = PROBES.filter((p) => p.shell !== 'embed');
  if (settingsLocal.has(row.id)) out = out.filter((p) => LOCAL_PROBES.includes(p.id));
  const a = row.v2?.action && actions.get(row.v2.action);
  if (a) out = out.filter((p) => isVisible(a, ctxFor(p)));
  if (EDIT_HOMES.has(row.home)) out = out.filter((p) => p.role !== 'viewer');
  return out.map((p) => p.id);
}

/** Probes where a kept registry action must be reachable: wherever the registry shows it. */
export function actionProbes(action, isVisible) {
  return PROBES.filter((p) => p.shell !== 'embed' && isVisible(action, ctxFor(p))).map((p) => p.id);
}

/** Probes where a kept hook must be reachable: every shell v1 showed it in, else the local probes. */
export function hookProbes(hook, v1Seen) {
  const seen = v1Seen.get(hook);
  return seen?.size ? PROBE_IDS.filter((p) => seen.has(p)) : LOCAL_PROBES;
}

/**
 * How the probe recognises a testids.json hook on screen.
 *   testid   [data-testid] value, `<x>` placeholders (and `[-<x>]` optional parts) as wildcards
 *   tour     [data-tour] value
 *   css      the selector alternatives (" / " separated, explanatory "(…)" suffixes dropped)
 * Returns null for prose hooks ("Inspector field labels") — nothing to look for.
 */
export function hookMatcher(def) {
  const hook = typeof def === 'string' ? def : def.hook;
  const kind = typeof def === 'string' ? 'testid' : def.kind;
  if (kind === 'data-tour') return { tour: hook.replace(/^\[data-tour="(.*)"\]$/, '$1') };
  if (kind === 'testid' && /^[A-Za-z0-9._<>[\]${}-]+$/.test(hook)) {
    if (!/[<[$]/.test(hook)) return { testid: hook };
    const src = hook
      .replace(/\[-?<[^>]+>\]/g, '~OPT~')
      .replace(/\$\{[^}]+\}|<[^>]+>/g, '~ANY~')
      .replace(/[.*+?^()|\\]/g, '\\$&')
      .replace(/~OPT~/g, '(?:-.+)?')
      .replace(/~ANY~/g, '.+');
    return { testidRe: `^${src}$` };
  }
  const alts = hook
    .split(' / ')
    .map((a) => a.replace(/\s*\((?:\+|--)[^)]*\)\s*$/, '').trim())
    .map((a) => a.replace(/\(--[a-z-]+\)$/, ''))
    // a CSS alternative starts with . [ # or is one compound tag selector; prose has bare spaces
    .filter((a) => /^[.[#]/.test(a) || /^[a-z][\w-]*[.[#:]\S*$/i.test(a));
  return alts.length ? { css: alts } : null;
}

/** Does one opener's evidence contain the hook? */
export function seenIn(evidence, def) {
  const m = hookMatcher(def);
  if (!m) return false;
  if (m.testid) return evidence.testids.includes(m.testid);
  if (m.testidRe) {
    const re = new RegExp(m.testidRe);
    return evidence.testids.some((t) => re.test(t));
  }
  if (m.tour) return evidence.tours.includes(m.tour);
  return evidence.css.includes(typeof def === 'string' ? def : def.hook);
}

/**
 * Evidence → reachability.json.
 * @param evidence  { [probeId]: { [openerId]: { ok, err?, testids, tours, css, palette: {id: bool} } } }
 * @param subjects  { rows: [{ id, need: probeIds, testid, action }], targets: [{ id, need, hook|action }] }
 */
export function summarize({ evidence, subjects, hooksByName, taken, bundle }) {
  const findHook = (probe, hook) => {
    const def = hooksByName.get(hook) ?? hook;
    for (const [opener, ev] of Object.entries(evidence[probe] ?? {}))
      if (seenIn(ev, def)) return opener;
    return null;
  };
  const findAction = (probe, id) => {
    const viaMenu = findHook(probe, `project-menu-row-${id}`);
    if (viaMenu) return `${viaMenu} (menu row)`;
    const surface = ACTION_SURFACE[id] && findHook(probe, ACTION_SURFACE[id]);
    if (surface) return `${surface} (${ACTION_SURFACE[id]})`;
    for (const [opener, ev] of Object.entries(evidence[probe] ?? {}))
      if (ev.palette?.[id]) return `${opener} (⌘K)`;
    return null;
  };
  const perShell = Object.fromEntries(PROBE_IDS.map((p) => [p, { rows: {}, targets: {} }]));
  const judge = (subj, bucket) => {
    if (!subj.need.length) return 'applies in no probe — give the row a v2.reach or check the rule';
    if (!subj.hook && !subj.action) return 'no v2 home yet (v2.action / v2.testid empty)';
    const missing = [];
    for (const p of subj.need) {
      const at =
        (subj.hook && findHook(p, subj.hook)) || (subj.action && findAction(p, subj.action));
      perShell[p][bucket][subj.id] = at ? `ok: ${at}` : 'missing';
      if (!at) missing.push(p);
    }
    for (const p of PROBE_IDS) if (!subj.need.includes(p)) perShell[p][bucket][subj.id] = 'n/a';
    if (!missing.length) return true;
    const what = [subj.hook && `testid ${subj.hook}`, subj.action && `action ${subj.action}`]
      .filter(Boolean)
      .join(' / ');
    return `${what} not reached in ${missing.join(', ')}`;
  };
  const rows = {};
  for (const r of subjects.rows) rows[r.id] = judge(r, 'rows');
  const targets = {};
  for (const t of subjects.targets) targets[t.id] = judge(t, 'targets');
  const openers = {};
  for (const [p, byOpener] of Object.entries(evidence))
    openers[p] = Object.fromEntries(
      Object.entries(byOpener).map(([o, ev]) => [o, ev.ok === false ? `failed: ${ev.err}` : 'ok'])
    );
  return {
    schema: 'maude.reachability/1',
    about:
      'Written by scripts/v2-manifest/probe-reach.mjs (headless boot per shell and role). rows / targets: true = reachable in every probe it applies to, else why not. perShell = evidence per probe (opener that reached it, missing, n/a).',
    taken,
    bundle,
    probes: PROBES.map(({ id, shell, role }) => ({ id, shell, role })),
    openers,
    rows,
    targets,
    perShell,
  };
}
