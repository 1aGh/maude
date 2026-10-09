// Preloaded by every `bun test` in apps/studio (bunfig.toml). V2-2.9 diagnostics and the V2-2.17
// project index persist to machine caches under ~/.maude; a test — or any server it spawns, which
// inherits process.env — must never write the person's real ones. One throwaway dir per test
// process unless the environment already names its own.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'maude-test-machine-'));
process.env.MAUDE_LOG_DIR ??= join(root, 'logs');
process.env.MAUDE_INDEX_DIR ??= join(root, 'index');
