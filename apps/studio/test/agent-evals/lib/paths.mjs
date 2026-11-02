// agent-evals/lib/paths.mjs — where the harness lives (no imports from the rest of the harness).

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** apps/studio/test/agent-evals */
export const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
/** the worktree root */
export const REPO_ROOT = join(HERE, '..', '..', '..', '..');
/** the released design plugin the live trial loads (`--plugin-dir`) */
export const DESIGN_PLUGIN = join(REPO_ROOT, 'plugins', 'design');
