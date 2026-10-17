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

/** Server: the studio answers (this page is served by it); the socket says whether it is live. */
export function serverWord({ wsConnected = true, unreachable = false } = {}) {
  if (unreachable) return { word: 'Not responding', tone: 'error' };
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
} = {}) {
  const out = {
    'diag.sync': syncWord(syncStatus, { project, aiHeld: syncStatus?.aiAction?.state === 'held' }),
    'diag.server': serverWord({ wsConnected, unreachable }),
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
  if (cloud) hidden.push('sync.resync', 'sync.download-all');
  else if (!syncStatus?.files) hidden.push('sync.download-all');
  if (!syncStatus) hidden.push('sync.resync');
  return hidden;
}

/** What `GET /_api/diagnostics` (+ the page's own address) says about this server. */
export function diagnosticsInfo(payload, { host = '', folder = '' } = {}) {
  const st = payload?.sources?.server?.status ?? {};
  return {
    address: host || '',
    pid: Number.isFinite(st.pid) ? st.pid : null,
    version: typeof st.version === 'string' ? st.version : '',
    folder: folder || '',
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

/**
 * The visible lines: one source or all (merged in source order, each source keeps its own order),
 * narrowed by a case-insensitive substring. Newest last, like a tail.
 * @param sources `diagnostics().sources`
 */
export function logLines(sources, { filter = 'all', query = '' } = {}) {
  const q = query.trim().toLowerCase();
  const names = filter === 'all' ? LOG_SOURCES : LOG_SOURCES.filter((s) => s === filter);
  const out = [];
  for (const source of names) {
    for (const raw of sources?.[source]?.recent ?? []) {
      const { level, text } = parseLine(raw);
      if (q && !text.toLowerCase().includes(q) && !source.includes(q)) continue;
      out.push({ source, level, text });
    }
  }
  return out;
}

/** The Server card's mode stamp (was the menu bar's IDLE · CANVAS · SYSTEM). */
export function modeStamp({ activePath, isSystem = false } = {}) {
  if (isSystem) return { stamp: 'System', showing: 'Design system' };
  if (activePath) return { stamp: 'Canvas', showing: `Canvas · ${activePath}` };
  return { stamp: 'Idle', showing: 'Nothing open' };
}
