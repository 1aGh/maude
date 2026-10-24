// client/v2/diagnostics/diagnostics-model.js — V2-4.7b: what Menu › Diagnostics says, as pure functions.
//
// CONTRACT §1: the submenu names Sync, Server and AI setup each with ONE status word, and under
// Advanced the values Address · Process · Project folder. Everything here is derived from the data
// the shell already has (the sync status payload, the live socket, the preflight report, the
// diagnostics API) — no DOM, no React, no second data layer.
//
//   word:  { word, tone: 'ok' | 'warn' | 'error' | 'neutral', mono? }

import { syncPresentation } from '../../../sync/presentation.ts';

/** The six action ids whose rows carry a status word, and the three whose rows carry a value. */
export const STATUS_IDS = Object.freeze(['diag.sync', 'diag.server', 'diag.ai']);
export const VALUE_IDS = Object.freeze(['diag.address', 'diag.process', 'diag.project-folder']);

/** Sync: one word. A solo project has nothing to sync (a neutral word, not a problem). */
export function syncWord(syncStatus, { project, aiHeld = false } = {}) {
  if (aiHeld) return { word: 'Needs you', tone: 'warn' };
  const p = syncPresentation(syncStatus, { project });
  if (!p) return { word: 'Local project', tone: 'neutral' };
  switch (p.phase) {
    case 'synced':
      return { word: 'Up to date', tone: 'ok' };
    case 'connecting':
    case 'syncing':
      return { word: 'Syncing…', tone: 'ok' };
    case 'offline':
    case 'stalled':
      return { word: 'Offline', tone: 'warn' };
    case 'refused':
      return { word: 'Failed', tone: 'error' };
    case 'attention':
      return { word: 'Needs you', tone: 'warn' };
    case 'parked':
      return { word: 'Paused', tone: 'neutral' };
    case 'nothing-syncable':
      return { word: 'Nothing to sync', tone: 'neutral' };
    default:
      return { word: 'Unknown', tone: 'neutral' };
  }
}

/**
 * Server: the studio answers (this page is served by it); the socket says whether it is live. In a cloud tab
 * there is no process of yours to name — the server is the cloud's (S11.15, 06 · ad-edge-where).
 */
export function serverWord({ wsConnected = true, unreachable = false, cloud = null } = {}) {
  if (unreachable) return { word: 'Not responding', tone: 'error' };
  if (cloud) return { word: 'Runs in the cloud', tone: 'neutral' };
  return wsConnected ? { word: 'Running', tone: 'ok' } : { word: 'Reconnecting…', tone: 'warn' };
}

/** AI setup: the preflight report's own `ready` (null = not checked yet). */
export function aiWord(report) {
  if (!report || !Array.isArray(report.items)) return { word: 'Checking…', tone: 'neutral' };
  return report.ready ? { word: 'Ready', tone: 'ok' } : { word: 'Needs setup', tone: 'warn' };
}

/**
 * The map the menu draws: action id → { word, tone, mono? }.
 * @param in.syncStatus  the shell's sync payload (null = unlinked / unknown)
 * @param in.info        `diagnosticsInfo()` below (address / pid / folder), or null before the first read
 */
export function menuStatuses({
  syncStatus,
  project,
  wsConnected,
  report,
  info,
  unreachable = false,
  cloud,
} = {}) {
  const out = {
    'diag.sync': syncWord(syncStatus, { project, aiHeld: syncStatus?.aiAction?.state === 'held' }),
    'diag.server': serverWord({ wsConnected, unreachable, cloud }),
    'diag.ai': aiWord(report),
  };
  if (info?.address) out['diag.address'] = { word: info.address, tone: 'neutral', mono: true };
  if (info?.pid != null)
    out['diag.process'] = { word: String(info.pid), tone: 'neutral', mono: true };
  if (info?.folder)
    out['diag.project-folder'] = { word: tilde(info.folder), tone: 'neutral', mono: true };
  return out;
}

/** `/Users/me/Maude/x` → `~/Maude/x` for display (the copied value stays the full path). */
export function tilde(path) {
  return String(path).replace(/^\/(?:Users|home)\/[^/]+(?=\/|$)/, '~');
}

/**
 * Rows the menu leaves out, mirroring where today's Sync panel offers them: Resync and Download all
 * are for a desktop copy that owns its sync runtime — never for a cloud member (the hub refuses the
 * route) — and Download all needs a file plane to download.
 */
export function hiddenMenuIds({ cloud = null, syncStatus = null } = {}) {
  const hidden = [];
  // A cloud tab has no process, folder or local address of its own: the Server row says "Runs in the cloud"
  // instead (S11.15), so the three values it would copy are not offered.
  if (cloud) hidden.push(...VALUE_IDS, 'sync.resync', 'sync.download-all');
  else if (!syncStatus?.files) hidden.push('sync.download-all');
  if (!syncStatus) hidden.push('sync.resync');
  return hidden;
}

/**
 * What `GET /_api/diagnostics` (+ the page's own address) says about this server. The project folder
 * comes from that guarded payload (`projectFolder`, absent in a cloud tab), never from `/_config`.
 */
export function diagnosticsInfo(payload, { host = '', folder = '' } = {}) {
  const st = payload?.sources?.server?.status ?? {};
  return {
    address: host || '',
    pid: Number.isFinite(st.pid) ? st.pid : null,
    version: typeof st.version === 'string' ? st.version : '',
    folder: folder || (typeof payload?.projectFolder === 'string' ? payload.projectFolder : ''),
    uptimeSeconds: Number.isFinite(st.uptimeSeconds) ? st.uptimeSeconds : null,
  };
}

// ── Logs ──────────────────────────────────────────────────────────────────────────────────────

export const LOG_SOURCES = Object.freeze(['sync', 'server', 'ai', 'export']);
export const LOG_FILTERS = Object.freeze(['all', ...LOG_SOURCES]);

const LABELS = { all: 'All', sync: 'Sync', server: 'Server', ai: 'AI', export: 'Export' };
export const filterLabel = (f) => LABELS[f] ?? f;

/** `[warn] [sync] hub replied 429` → { level: 'warn', text: '[sync] hub replied 429' } */
export function parseLine(raw) {
  const m = /^\[(log|info|warn|error|debug)\]\s*(.*)$/s.exec(String(raw));
  return m ? { level: m[1], text: m[2] } : { level: 'log', text: String(raw) };
}

/** `[sync] hub replied 429` shown under the Sync source: the source column already says it. */
function shownText(text, source) {
  return text.replace(new RegExp(`^\\[${source}(?::[a-z0-9-]+)?\\]\\s*`, 'i'), '');
}

/**
 * The visible lines: one source or all (merged by time when the server stamped them — S11.11 — else
 * in source order, each source keeping its own), narrowed by a case-insensitive substring. Newest
 * last, like a tail. `text` keeps the `[prefix]` (a query matches it); `shown` is what the row draws.
 * @param sources `diagnostics().sources`
 */
export function logLines(sources, { filter = 'all', query = '' } = {}) {
  const q = query.trim().toLowerCase();
  const names = filter === 'all' ? LOG_SOURCES : LOG_SOURCES.filter((s) => s === filter);
  const out = [];
  let seq = 0;
  for (const source of names) {
    const recent = sources?.[source]?.recent ?? [];
    const stamps = sources?.[source]?.recentAt ?? [];
    recent.forEach((raw, i) => {
      const { level, text } = parseLine(raw);
      if (q && !text.toLowerCase().includes(q) && !source.includes(q)) return;
      const at = Number.isFinite(stamps[i]) ? stamps[i] : null;
      out.push({ source, level, text, shown: shownText(text, source), at, seq: seq++ });
    });
  }
  out.sort((a, b) => (a.at ?? 0) - (b.at ?? 0) || a.seq - b.seq);
  return out.map(({ seq: _seq, ...line }) => line);
}

const pad2 = (n) => String(n).padStart(2, '0');
/** `14:05:12` in this Mac's clock, or '' for a line the server did not stamp. */
export function clock(at) {
  if (!Number.isFinite(at)) return '';
  const d = new Date(at);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

/** "Copy all": the lines as they read in the sheet — `14:05:12  sync  pushed a.tsx`, one per row. */
export function logsText(lines) {
  return lines
    .map((l) => `${l.at != null ? `${clock(l.at)}  ` : ''}${l.source}  ${l.shown ?? l.text}`)
    .join('\n');
}

// ── AI setup ──────────────────────────────────────────────────────────────────────────────────

/**
 * 06 ad-logs "AI setup answers in four rows" — over `GET /_api/preflight`'s items, not the whole
 * list component: Claude Code installed · Found at · Signed in · Plugins ready. Each is
 * `{ id, label, state: 'ok' | 'missing' | 'unknown', value, hint? }`. Empty until the probe answered.
 * `hint` is the origin of the binary (DDR-166 D3: a PATH-hijacked `claude` must not be invisible).
 */
export function aiRows(report) {
  const items = Array.isArray(report?.items) ? report.items : [];
  if (items.length === 0) return [];
  const claude = items.find((i) => i.id === 'claude');
  const plugins = items.find((i) => i.id === 'plugins');
  const found = !!claude?.resolvedPath;
  const stateOf = (item) =>
    !item
      ? 'unknown'
      : item.status === 'present'
        ? 'ok'
        : item.status === 'unknown'
          ? 'unknown'
          : 'missing';
  return [
    {
      id: 'installed',
      label: 'Claude Code installed',
      state: found ? 'ok' : stateOf(claude),
      value: '',
    },
    {
      id: 'found',
      label: 'Found at',
      state: found ? 'ok' : 'missing',
      value: found ? tilde(claude.resolvedPath) : '',
      hint: found ? (claude.resolvedViaMaude ? 'Installed by Maude' : 'Found on your PATH') : '',
    },
    { id: 'signed-in', label: 'Signed in', state: stateOf(claude), value: '' },
    { id: 'plugins', label: 'Plugins ready', state: stateOf(plugins), value: '' },
  ];
}

/** The probe's items that are not satisfied — they keep their full row (fix, Set up, Sign in). */
export function aiNeedsWork(report) {
  return (Array.isArray(report?.items) ? report.items : []).filter((i) => i.status !== 'present');
}

/** The Server card's mode stamp (was the menu bar's IDLE · CANVAS · SYSTEM). */
export function modeStamp({ activePath, isSystem = false } = {}) {
  if (isSystem) return { stamp: 'System', showing: 'Design system' };
  // 06 ad-logs: "Canvas · Combine-kampan" — the canvas by name, not the path to its file
  if (activePath) {
    const name = String(activePath)
      .split('/')
      .pop()
      .replace(/\.(tsx|jsx|html|svg)$/i, '');
    return { stamp: 'Canvas', showing: `Canvas · ${name}` };
  }
  return { stamp: 'Idle', showing: 'Nothing open' };
}
