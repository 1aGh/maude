// r2-e2e-fix — one local identity needs ONE answer to "who is this Mac". `gitCurrentUser` cached a flag before
// its `git config user.name` finished, so a second caller during that spawn got '' and `localAuthor` fell back
// to the OS account. Seen in the desktop e2e (modes-present, rc.1 F08): at boot the shell's `/_api/git-user`
// lost that race and read the account name ("iagh") while every later comment was signed with the git name
// ("1aGh") — the panel's Mine read 0 and the row did not say "You".

import { describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createApi } from '../api.ts';
import { type Context, createBus } from '../context.ts';
import { makeSandbox } from './_helpers.ts';

function rig() {
  const { root, designRoot } = makeSandbox();
  mkdirSync(join(designRoot, 'ui'), { recursive: true });
  const env = {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
  };
  Bun.spawnSync(['git', 'init', '-q'], { cwd: root, env });
  Bun.spawnSync(['git', 'config', 'user.name', 'Ada Tester'], { cwd: root, env });
  writeFileSync(join(designRoot, 'ui/A.tsx'), 'export default function A(){return <main/>}');
  const ctx: Context = {
    cfg: {} as Context['cfg'],
    projectLabel: 'git-user-once',
    bus: createBus(),
    paths: {
      repoRoot: root,
      designRel: '.design',
      designRoot,
      serverInfoFile: join(designRoot, '_server.json'),
      activeFile: join(designRoot, '_active.json'),
      commentsDir: join(designRoot, '_comments'),
      canvasStateDir: join(designRoot, '_canvas-state'),
      historyDir: join(designRoot, '_history'),
      tokensUrlRel: '',
      systemDirRel: 'system',
    },
  };
  return createApi(ctx, { onCommentsChanged() {}, onAnnotationsChanged() {} });
}

describe('gitCurrentUser answers every caller the same name', () => {
  test('two callers while the first git spawn is still running both get the git name', async () => {
    const api = rig();
    const [a, b, c] = await Promise.all([
      api.gitCurrentUser(),
      api.gitCurrentUser(),
      api.gitCurrentUser(),
    ]);
    expect([a, b, c]).toEqual(['Ada Tester', 'Ada Tester', 'Ada Tester']);
  });

  test('a later caller reads the cached answer', async () => {
    const api = rig();
    expect(await api.gitCurrentUser()).toBe('Ada Tester');
    expect(await api.gitCurrentUser()).toBe('Ada Tester');
  });
});
