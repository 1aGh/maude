// REPO / HERE without the Playwright import — pair.mjs and mkpairs.mjs (ImageMagick only) run locally where node_modules may be absent.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(HERE, '../../../../../../..');
