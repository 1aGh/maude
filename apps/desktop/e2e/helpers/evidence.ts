import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { browser } from '@wdio/globals';

// Per-run evidence sink. Same convention as `/flow:scenario` / scenario-runner:
//   .ai/device/scenario-runs/<scenario>/<YYYY-MM-DD-HHMM>/        ← run root (gitignored)
//     report.md                                                   ← the one thing a human reads
//     native-desktop/step-NN-<label>.png                          ← per-platform screenshots
// RUN_DIR (the run root) is set in wdio.conf.ts.
const RUN_DIR = process.env.MAUDE_E2E_RUN_DIR ?? join(process.cwd(), '_e2e-evidence');
const SHOTS_DIR = join(RUN_DIR, 'native-desktop');
let step = 0;

function ensureDirs(): void {
  if (!existsSync(SHOTS_DIR)) mkdirSync(SHOTS_DIR, { recursive: true });
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** What `startReport` hands back: the section a later `capture(report, label)` files its shot under. */
export interface Report {
  title: string;
}

/**
 * Write the report header once at the start of a scenario (or of one section of it) and return the
 * section handle. A scenario that does not need the handle ignores it: `capture(label)` still works.
 */
export function startReport(title: string): Report {
  ensureDirs();
  appendFileSync(
    join(RUN_DIR, 'report.md'),
    `# ${title}\n\nRun: ${new Date().toISOString()}\n\n| # | Step | Screenshot |\n|---|------|------------|\n`
  );
  return { title };
}

/**
 * Screenshot the webview + append a row to report.md. Returns the file path.
 * `capture('label')` or `capture(report, 'label')` — the report from `startReport` names the section
 * in the file name, so two sections of one scenario that reuse a label do not overwrite each other.
 */
export async function capture(label: string): Promise<string>;
export async function capture(report: Report, label: string): Promise<string>;
export async function capture(a: string | Report, b?: string): Promise<string> {
  ensureDirs();
  step += 1;
  const label = typeof a === 'string' ? a : (b as string);
  const section = typeof a === 'string' ? '' : `${slugify(a.title)}-`;
  const name = `step-${String(step).padStart(2, '0')}-${section}${slugify(label)}.png`;
  const file = join(SHOTS_DIR, name);
  await browser.saveScreenshot(file);
  // report.md sits at the run root; screenshots live in native-desktop/.
  appendFileSync(
    join(RUN_DIR, 'report.md'),
    `| ${step} | ${label} | ![](native-desktop/${name}) |\n`
  );
  return file;
}

export function runDir(): string {
  return RUN_DIR;
}
