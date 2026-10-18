// client/v2/export/exports-model.js — S8.4: the Exports panel's words and decisions, as pure functions.
//
// 09 Export ex-progress / ex-states / ex-history say every moment of an export in one line: where it
// runs, how far along, how many made it, and the one thing to do next. Nothing here touches React or
// the DOM, so the panel, the done toast and the tests read the same sentences.
//
// A job is what `GET /_api/export-jobs` and the `export:job` socket frame carry (exporters/jobs.ts
// `ExportJob`): `{ id, format, scope, status, progress?, filename?, error?, degraded?, spec?, items?,
// runsOn?, retryable?, createdAt, finishedAt? }`. A group job's `items` are
// `{ id, name, status: 'queued' | 'running' | 'ok' | 'failed' | 'waiting', reason? }`.

export const PANEL_TITLE = 'Exports';
export const PANEL_FOOT =
  'The last 20 exports stay here. Cloud renders keep going if this Mac sleeps or the window closes.';
export const SHOW_IN_FINDER = 'Show in Finder';
export const DOWNLOAD = 'Download';
export const EXPORT_AGAIN = 'Export again';
export const FOLD_LABEL = 'Fold into the Exports icon';

/** The most rows the panel lists (the server keeps this many, exporters/jobs.ts `HISTORY_DEPTH`). */
export const PANEL_ROWS = 20;

const FORMAT_LABELS = {
  png: 'PNG',
  jpg: 'JPG',
  pdf: 'PDF',
  svg: 'SVG',
  html: 'HTML',
  pptx: 'PowerPoint',
  canva: 'Canva',
  zip: 'ZIP',
  mp4: 'MP4',
  webm: 'WebM',
  gif: 'GIF',
  audio: 'Sound',
};
const SCOPE_LABELS = {
  selection: 'Selection',
  artboard: 'Artboard',
  'canvas-as-separate': 'Canvas',
  'canvas-whole': 'Whole canvas',
  'selection-bounds': 'Selection area',
  'project-raw': 'Project',
};

export const formatLabel = (job) =>
  FORMAT_LABELS[job?.format] || String(job?.format || '').toUpperCase();

/** 'cloud' | 'this-mac'. A job that does not say ran here: the cloud lane stamps `runsOn`. */
export const whereOf = (job) => (job?.runsOn === 'cloud' ? 'cloud' : 'this-mac');
export const whereWords = (job) => (whereOf(job) === 'cloud' ? 'In the cloud' : 'On this Mac');

const isActive = (job) => job?.status === 'queued' || job?.status === 'running';

/** `{ ok, total, failed }` for a group job; null for a plain one. */
export function itemTally(job) {
  const items = Array.isArray(job?.items) ? job.items : null;
  if (!items || items.length === 0) return null;
  const failed = items.filter((i) => i.status === 'failed' || i.status === 'waiting');
  return {
    ok: items.filter((i) => i.status === 'ok').length,
    total: items.length,
    failed,
  };
}

/** A finished job some of whose items did not make it ("Exported 114 of 115"). */
export function isPartial(job) {
  if (job?.status !== 'done') return false;
  const t = itemTally(job);
  return !!t && t.failed.length > 0;
}

/**
 * The panel row's state: `busy` · `queued` · `done` · `warn` (ready with a problem, or partial)
 * · `fail`.
 */
export function rowState(job) {
  if (job?.status === 'queued') return 'queued';
  if (job?.status === 'running') return 'busy';
  if (job?.status === 'failed') return 'fail';
  return job?.degraded || isPartial(job) ? 'warn' : 'done';
}

const stemOf = (name) => String(name || '').replace(/\.[^./]+$/, '');

/** What the row is called: the file when there is one, else what is being made. */
export function jobTitle(job) {
  const t = itemTally(job);
  if (job?.status === 'done' && job.filename) {
    if (t && t.failed.length > 0) return `${stemOf(job.filename)} · ${t.ok} of ${t.total}`;
    return job.filename;
  }
  const fmt = formatLabel(job);
  if (t && t.total > 1) return `${fmt} · ${t.total} items`;
  return `${fmt} · ${SCOPE_LABELS[job?.scope] || job?.scope || ''}`.trim();
}

/** "20 min ago" — coarse on purpose; the exact time is the hover. */
export function ago(iso, now = Date.now()) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

/** "Retry Recap" for one item that did not make it, "Retry 3 items" for several; null when none. */
export function retryLabel(job) {
  if (!job?.retryable) return null;
  const t = itemTally(job);
  if (!t || t.failed.length === 0) return null;
  const only = t.failed.length === 1 ? t.failed[0] : null;
  return only ? `Retry ${only.name}` : `Retry ${t.failed.length} items`;
}

/** The item ids a Retry press names (all that did not make it). */
export const retryItems = (job) => (itemTally(job)?.failed ?? []).map((i) => i.id);

/** Why an item did not make it, trimmed to one line (the full text is the hover / the details). */
function reasonLine(item) {
  const text = String(item?.reason || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return item?.status === 'waiting' ? 'is waiting' : "didn't render";
  return text.length > 80 ? `${text.slice(0, 79)}…` : text;
}

/** The progress words of a running job: items first ("3 of 21"), else the render's own steps. */
export function progressWords(job, eta) {
  const t = itemTally(job);
  if (t && t.total > 1) {
    const done = t.ok + t.failed.length;
    const word = `${Math.min(done + 1, t.total)} of ${t.total}`;
    return eta ? `${word} · ${eta}` : word;
  }
  const p = job?.progress;
  if (p?.total) {
    const pct = Math.max(0, Math.min(100, Math.round((p.current / p.total) * 100)));
    return `${pct} %${eta ? ` · ${eta}` : ''}`;
  }
  return 'Rendering…';
}

/** 0–100 for the row's bar, or null when the render cannot say. */
export function progressPct(job) {
  const t = itemTally(job);
  if (t && t.total > 1) {
    const done = t.ok + t.failed.length;
    const running = job.progress?.total ? job.progress.current / job.progress.total : 0;
    return Math.round(Math.min(100, ((done + running) / t.total) * 100));
  }
  const p = job?.progress;
  return p?.total ? Math.max(0, Math.min(100, Math.round((p.current / p.total) * 100))) : null;
}

/** The second line of a row: where it runs and the moment it is in. */
export function jobMeta(job, { now = Date.now(), eta = null } = {}) {
  const where = whereWords(job);
  if (job?.status === 'queued') return `${where} · Queued`;
  if (job?.status === 'running') return `${where} · ${progressWords(job, eta)}`;
  if (job?.status === 'failed') return `${where} · Failed`;
  const t = itemTally(job);
  if (t && t.failed.length > 0) {
    const first = t.failed[0];
    const why = t.failed.length === 1 ? ` — ${first.name} ${reasonLine(first)}` : '';
    return `Exported ${t.ok} of ${t.total}${why}`;
  }
  const bits = [formatLabel(job), where, ago(job?.finishedAt || job?.createdAt, now)];
  return bits.filter(Boolean).join(' · ');
}

/** The pill-ish word a finished row shows when it has no button of its own. */
export function stateWord(job) {
  if (job?.status === 'queued') return 'Queued';
  if (job?.status === 'running') return '';
  if (job?.status === 'failed') return 'Failed';
  if (job?.degraded?.audioDropped) return 'Ready · no audio';
  if (job?.degraded?.fontsNotEmbedded?.length) return 'Ready · font warning';
  if (job?.degraded) return 'Ready · degraded';
  if (isPartial(job)) return '';
  return 'Ready';
}

const dayKey = (iso, now) => {
  const t = new Date(Date.parse(iso || ''));
  if (Number.isNaN(t.getTime())) return 'earlier';
  const start = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((start(new Date(now)) - start(t)) / 86_400_000);
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : 'earlier';
};
const DAY_LABEL = { today: 'Today', yesterday: 'Yesterday', earlier: 'Earlier' };

/**
 * The newest 20, grouped Today · Yesterday · Earlier (a group with nothing in it is not drawn).
 * Running rows are always today: they were just asked for.
 */
export function panelGroups(jobs, now = Date.now()) {
  const rows = [...(jobs || [])]
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    .slice(0, PANEL_ROWS);
  const groups = [];
  for (const job of rows) {
    const key = isActive(job) ? 'today' : dayKey(job.finishedAt || job.createdAt, now);
    let g = groups.find((x) => x.key === key);
    if (!g) {
      g = { key, label: DAY_LABEL[key], jobs: [] };
      groups.push(g);
    }
    g.jobs.push(job);
  }
  return groups;
}

/** The names of what a finished job wrote — "Copy file names" (a group job lists every file). */
export function fileNames(job) {
  const named = (job?.items ?? []).flatMap((i) => i.files ?? []);
  return named.length ? named : job?.filename ? [job.filename] : [];
}

/**
 * The completion toast's one sentence and its ONE action (`rule/one-verb-per-dialog-one-action-per-toast`).
 * `native` = a Mac app, which can show a file in Finder; a browser tab downloads it instead.
 * `folder` = the folder name the file was saved into, when it already was.
 * @returns {{ kind: 'info'|'success'|'warning'|'error', title: string, text: string,
 *            action: 'reveal'|'download'|'retry'|'open', label: string }}
 */
export function toastWords(job, { native = false, folder = null } = {}) {
  const fmt = formatLabel(job);
  if (isActive(job)) {
    return {
      kind: 'info',
      title: 'Exporting…',
      text: `${whereWords(job)}. You can keep working.`,
      action: 'open',
      label: 'Open Exports',
    };
  }
  if (job?.status === 'failed') {
    return {
      kind: 'error',
      title: 'Export failed',
      text: job.error || 'Something went wrong.',
      action: 'open',
      label: 'Show details',
    };
  }
  const t = itemTally(job);
  const door = native
    ? { action: 'reveal', label: SHOW_IN_FINDER }
    : { action: 'download', label: DOWNLOAD };
  if (t && t.failed.length > 0) {
    const retry = retryLabel(job);
    const first = t.failed[0];
    return {
      kind: 'warning',
      title: `Exported ${t.ok} of ${t.total}`,
      text:
        t.failed.length === 1
          ? `${first.name} ${reasonLine(first)}.`
          : `${t.failed.length} items didn't make it.`,
      ...(retry ? { action: 'retry', label: retry } : door),
    };
  }
  if (job?.degraded) {
    // the problem itself is the panel's / toast's DegradedNote; this line says what was made
    return {
      kind: 'warning',
      title: 'Export ready — with a problem',
      text: `Exported ${job.filename ? `“${stemOf(job.filename)}”` : fmt}.`,
      ...door,
    };
  }
  const n = fileNames(job).length;
  const what =
    n > 1 ? `Exported ${n} files` : `Exported ${job?.filename ? `“${stemOf(job.filename)}”` : fmt}`;
  return {
    kind: 'success',
    title: 'Export ready',
    text: folder ? `${what} to ${folder}.` : `${what}.`,
    ...door,
  };
}
