import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export { evidenceDir, repo } from '../paths.mjs';
export const own = dirname(fileURLToPath(import.meta.url));
