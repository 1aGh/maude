// ds/post-build.ts — 2.0.5 (#205): what ds-check --canvas knows about canvases refused AFTER their build.
//
// The import walk (access/closure.ts) is static: it names a canvas that imports another canvas. A built module
// can still be refused at serve time (the inputs gate inlined a file another canvas owns); only the running
// studio knows, and it reports it on the main origin's `/_index-data` as `canvasRefusedInputs`
// (access/refused-inputs.ts). `bin/_ds-check-live.mjs` asks that studio — loopback only — and hands the answer
// here; with no studio ds-check says so and prints the static reasons only.

export interface PostBuild {
  /** A studio for this project answered. False = only the import walk was checked. */
  live: boolean;
  /** canvas (design-root-relative, `ui/a.tsx`) → the design-root files its built module was refused for. */
  refused: Map<string, string[]>;
}

export const NO_STUDIO: PostBuild = { live: false, refused: new Map() };

/** What to print when no studio answered, so a quiet report is not read as "nothing is refused". */
export const NO_STUDIO_NOTE =
  'note: no studio is running for this project — only the import walk was checked. A canvas refused after its build (it uses a file another canvas owns) shows here while the studio is open.';

/** `/_index-data` → the refused files per canvas, keys design-root-relative. Anything else is ignored. */
export function refusedFromIndex(index: unknown): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (!index || typeof index !== 'object') return out;
  const rec = index as { designRoot?: unknown; canvasRefusedInputs?: unknown };
  const designRel = typeof rec.designRoot === 'string' && rec.designRoot ? rec.designRoot : '.design';
  const raw = rec.canvasRefusedInputs;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [key, list] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(list)) continue;
    const names = list.filter((n): n is string => typeof n === 'string' && n !== '');
    if (!names.length) continue;
    out.set(key.startsWith(`${designRel}/`) ? key.slice(designRel.length + 1) : key, names);
  }
  return out;
}
