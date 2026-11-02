// client/v2/ds/convert-model.js — S10.12: the words of "Convert system folders" (13 · 25 ds-multi-migrate, 29
// ds-edge-migrate) and the two writes behind it. Pure apart from the fetches: the dialog (convert-dialog.jsx) only
// draws what `dialogModel` returns, and the server's dry run (`POST /_api/ds/convert {dryRun}`,
// `maude.ds-convert/1`) is the only source of what each folder becomes — nothing is counted on the page.
//
// One question (S10 §3): which folders become Design system canvases, which become drafts (no canvas uses them),
// and which stays the default. Convert is one all-or-nothing run; Restore lives in the system's version history.

/** The event the convert host answers; it calls `preventDefault()` to say "I took it". */
export const DS_CONVERT_EVENT = 'maude:ds-convert';

const SECTION_LABEL = Object.freeze({
  brand: 'Brand',
  colour: 'Colour',
  type: 'Type',
  space: 'Space & shape',
  motion: 'Motion',
  components: 'Components',
  patterns: 'Patterns',
});

export const CONVERT_WORDS = Object.freeze({
  banner: 'Turn this folder into a Design system canvas',
  bannerAction: 'Convert…',
  convert: 'Convert',
  cancel: 'Cancel',
  canvasChip: 'Design system canvas',
  draftChip: 'Draft',
  files: 'The files stay exactly where they are.',
  ownRow: 'Own artboards',
  nothing: 'Every design system here is already a Design system canvas.',
  loading: 'Reading the system folders…',
  failed: 'The folders could not be converted. Nothing was changed.',
  unreachable: 'Maude can’t reach this project right now. Nothing was changed.',
  forbidden: 'You can’t change this design system.',
  autoDone: 'Design systems moved onto canvases.',
});

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const list = (names) =>
  names.length <= 1
    ? names.join('')
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

/** "87 canvases · default" · "6 canvases in 2026/combine" · "no canvas uses it" (25) */
export function useWords(row) {
  if (!row?.canvases) return 'no canvas uses it';
  const n = plural(row.canvases, 'canvas', 'canvases');
  if (row.default) return `${n} · default`;
  return row.folder ? `${n} in ${row.folder}` : n;
}

/** A specimen stem as the map row names it: `colors-accent` → "accent", `type-scale` → "type scale". */
const pageWord = (stem) =>
  String(stem)
    .replace(/^(colors|components)-/, '')
    .replace(/[-_]+/g, ' ')
    .trim();

/** The section rows of one folder (29): label · the pages it folds · how many. */
export function mapRows(row) {
  const out = [];
  for (const [kind, label] of Object.entries(SECTION_LABEL)) {
    const pages = row?.sections?.[kind] ?? [];
    if (!pages.length) continue;
    const words = pages.map(pageWord);
    const from =
      words.length > 6
        ? `${words.slice(0, 5).join(' · ')} and ${words.length - 5} more`
        : words.join(' · ');
    out.push({ key: kind, label, from, count: pages.length });
  }
  // rc.1 finding 9 option A (decision `v2-michal-ds-specimens-own-artboards`): every page also stays
  // on the canvas as its own artboard, so the row counts them all and names the showcases no section shows
  const own = row?.own ?? [];
  const pages = Math.max(row?.specimens ?? 0, own.length);
  const names = [
    ...(pages > own.length ? ['every page'] : []),
    ...own.map((o) => o.label.toLowerCase()),
  ];
  if (pages)
    out.push({
      key: 'own',
      label: CONVERT_WORDS.ownRow,
      from: `${names.join(' · ')} — kept as they are`,
      count: pages,
    });
  return out;
}

/**
 * The dialog from the dry run. One folder → 29's close-up (sections), several → 25's list (what each becomes).
 * @param {{ systems: any[] }} plan  `maude.ds-convert/1`
 */
export function dialogModel(plan) {
  const rows = Array.isArray(plan?.systems) ? plan.systems : [];
  const refused = rows.filter((r) => r.refused);
  const base = {
    rows,
    refused: refused.map((r) => ({ name: r.name, label: r.label, why: String(r.refused.message) })),
    canConvert: rows.length > 0 && refused.length === 0,
  };
  if (rows.length === 1) {
    const r = rows[0];
    const n = r.specimens ?? 0;
    return {
      ...base,
      kind: 'one',
      title: `Convert ${r.path} into its Design system canvas?`,
      lead: n
        ? `${plural(n, 'specimen page')} fill${n === 1 ? 's' : ''} 7 sections and stay${n === 1 ? 's' : ''} as ${n === 1 ? 'its own artboard' : 'their own artboards'}. ${CONVERT_WORDS.files}`
        : `Its tokens fill 7 sections. ${CONVERT_WORDS.files}`,
      map: mapRows(r),
      fine: 'Version history keeps the folder view — Restore undoes the conversion.',
    };
  }
  const canvases = rows.filter((r) => r.to !== 'draft');
  const drafts = rows.filter((r) => r.to === 'draft');
  const lead = [];
  if (canvases.length)
    lead.push(
      `${canvases.length === 1 ? `${canvases[0].label} becomes a Design system canvas` : `${canvases.length} become Design system canvases`}.`
    );
  if (drafts.length)
    lead.push(
      `${list(drafts.map((d) => d.label))} ${drafts.length === 1 ? 'becomes a draft' : 'become drafts'} — listed with the systems, used by no canvas.`
    );
  lead.push(CONVERT_WORDS.files);
  const def = rows.find((r) => r.default);
  const fine = [
    def ? `${def.label} stays the default for new canvases.` : null,
    'A converted system made before the schema shows an amber dot — Bring it up lines it up.',
    'Version history keeps the folder view; Restore undoes the conversion.',
  ]
    .filter(Boolean)
    .join(' ');
  return {
    ...base,
    kind: 'many',
    title: `Convert ${rows.length} system folders?`,
    lead: lead.join(' '),
    list: rows.map((r) => ({
      name: r.name,
      label: r.label,
      path: r.path,
      use: useWords(r),
      to: r.to === 'draft' ? CONVERT_WORDS.draftChip : CONVERT_WORDS.canvasChip,
    })),
    fine,
  };
}

/** What a finished run says. */
export function doneWords(result) {
  const n = result?.systems?.length ?? 0;
  return n === 1 ? 'It’s a Design system canvas now.' : `${n} Design system canvases now.`;
}

/** A refusal code in the person's words. */
export function convertRefusal(status, json) {
  if (status === 403) return CONVERT_WORDS.forbidden;
  if (json?.code === 'ds-convert-nothing') return CONVERT_WORDS.nothing;
  if (json?.code === 'ds-convert-refused' && typeof json.error === 'string') return json.error;
  if (json?.code === 'ds-convert-failed') return CONVERT_WORDS.failed;
  return CONVERT_WORDS.failed;
}

const JSON_HEADERS = { 'content-type': 'application/json' };

async function post(body, fetchImpl) {
  let res;
  try {
    res = await fetchImpl('/_api/ds/convert', {
      method: 'POST',
      cache: 'no-store',
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, message: CONVERT_WORDS.unreachable };
  }
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* judged by status */
  }
  if (!res.ok)
    return { ok: false, message: convertRefusal(res.status, json), code: json?.code ?? null };
  return { ok: true, body: json };
}

/** The dry run for `systems` (default: every folder not yet on a canvas). */
export function fetchConvertPlan(systems, { fetchImpl = globalThis.fetch } = {}) {
  return post({ ...(systems?.length ? { systems } : {}), dryRun: true }, fetchImpl);
}

/** Convert: one all-or-nothing run, on exactly the systems the dialog showed. */
export async function convertSystems(systems, { fetchImpl = globalThis.fetch } = {}) {
  const r = await post({ systems }, fetchImpl);
  return r.ok ? { ok: true, message: doneWords(r.body?.result), result: r.body?.result } : r;
}

/** Restore one system to its folder (the system's version history, S10.19, mounts the button). */
export async function restoreSystemFolder(ds, { fetchImpl = globalThis.fetch } = {}) {
  const r = await post({ restore: ds }, fetchImpl);
  return r.ok ? { ok: true, message: 'The system is a folder again. Its revisions are kept.' } : r;
}

/**
 * Ask the convert host to open. `ds` names the folder the banner sits on; the dialog lists every folder not yet
 * on a canvas, because converting is one run for all of them (V2-1.6 §5.11 g).
 * @returns {boolean} whether something took the request
 */
export function requestDsConvert(params = {}, { toast, target = globalThis.window } = {}) {
  if (!target?.dispatchEvent) return false;
  const ev = new CustomEvent(DS_CONVERT_EVENT, { detail: params, cancelable: true });
  target.dispatchEvent(ev);
  if (!ev.defaultPrevented) toast?.(CONVERT_WORDS.unreachable);
  return ev.defaultPrevented;
}
