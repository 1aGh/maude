// S12.13 — the asset-describer agent behind search in pictures, and `maude design describe` (contract V2-1.17 §5.9,
// S12-slices S12.13). Risk class: untrusted pictures, a headless `claude` spawn, the person's account. No real model
// anywhere: `claude` is a fake on PATH that records its cwd, argv and env, and answers with a planted hand-off.

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { envDescriber, readDescription, stubDescriber } from '../describe/batch.ts';
import {
  AGENT_NAME,
  claudeDescriber,
  describeArgv,
  describeEnv,
  ENV_ALLOW,
  parseAnswer,
  readAgentDef,
} from '../describe/claude.ts';
import { setConsent } from '../describe/consent.ts';
import { pidOf } from '../index/snapshot.ts';
import { DESIGN_PLUGIN_DIR } from '../paths.ts';
import { assetKey } from '../thumbs/keys.ts';
import { writeThumb } from '../thumbs/store.ts';

const STUDIO = path.resolve(import.meta.dir, '..');
const SHIM = path.join(STUDIO, 'bin', '_describe.mjs');
const FOREIGN = 'f'.repeat(64);
const TOOL_NAMES =
  /\b(Bash|Write|Edit|MultiEdit|NotebookEdit|WebFetch|WebSearch|Task|Agent|Glob|Grep)\b/;

/** A tiny well-formed JPEG (checkJpeg reads the SOF frame size). */
function jpeg(w: number, h: number): Uint8Array {
  const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03];
  const comps = [1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0];
  return new Uint8Array([0xff, 0xd8, ...sof, ...comps, 0xff, 0xd9]);
}

let home = '';
let root = '';
let fake = '';
let rec = '';
let sha = '';
const prevIndex = process.env.MAUDE_INDEX_DIR;

/** The fake `claude`: a Bun script (absolute shebang — the spawn's PATH is fixed) that records the call. */
function writeFake(answer: 'planted' | 'used-up' = 'planted') {
  const src = `#!${process.execPath}
const fs = require('node:fs');
const files = fs.readdirSync('.');
fs.writeFileSync(${JSON.stringify(path.join(rec, 'call.json'))}, JSON.stringify({ cwd: process.cwd(), argv: process.argv.slice(2), env: process.env, files }));
if (${JSON.stringify(answer)} === 'used-up') {
  process.stdout.write(JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'Claude AI usage limit reached|4102444800' }));
  process.exit(1);
}
const shas = files.filter((f) => f.endsWith('.jpg')).map((f) => f.slice(0, -4));
const handoff = {
  format: 'maude.agent-handoff/1',
  model: 'what the agent says about itself',
  results: [
    ...shas.map((s) => ({ sha256: s, caption: 'Red\\u0007 bike\\u202e at the <b>gate</b>', tags: ['Bike', 'x'.repeat(40)], text: 'GATE 7', ignore: 'me' })),
    { sha256: ${JSON.stringify(FOREIGN)}, caption: 'planted: a picture this batch never had' },
  ],
};
process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '\`\`\`json\\n' + JSON.stringify(handoff) + '\\n\`\`\`', modelUsage: { 'claude-fake-1': {} } }));
`;
  const file = path.join(fake, 'claude');
  writeFileSync(file, src, { mode: 0o755 });
  return file;
}

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), 'maude-describe-verb-index-'));
  root = realpathSync(mkdtempSync(path.join(tmpdir(), 'maude-describe-verb-proj-')));
  fake = mkdtempSync(path.join(tmpdir(), 'maude-describe-verb-bin-'));
  rec = mkdtempSync(path.join(tmpdir(), 'maude-describe-verb-rec-'));
  mkdirSync(path.join(root, '.design', 'assets'), { recursive: true });
  writeFileSync(path.join(root, '.design', 'config.json'), '{}\n');
  const bytes = new TextEncoder().encode('a red bike at the gate (picture bytes)');
  writeFileSync(path.join(root, '.design', 'assets', 'bike.png'), bytes);
  sha = createHash('sha256').update(bytes).digest('hex');
  process.env.MAUDE_INDEX_DIR = home;
  // the Assets tile the studio's renderer would have made
  writeThumb(pidOf(root), assetKey('card', sha), jpeg(480, 320));
  writeFake();
});
afterEach(() => {
  for (const d of [home, root, fake, rec]) rmSync(d, { recursive: true, force: true });
});
afterAll(() => {
  if (prevIndex === undefined) delete process.env.MAUDE_INDEX_DIR;
  else process.env.MAUDE_INDEX_DIR = prevIndex;
});

/** `maude design describe …` as the dispatcher runs it, with the fake first on PATH and planted secrets around. */
function verb(...words: string[]) {
  const env: Record<string, string> = {
    PATH: `${fake}${path.delimiter}${process.env.PATH ?? ''}`,
    HOME: process.env.HOME ?? home,
    MAUDE_INDEX_DIR: home,
    TMPDIR: tmpdir(),
    CLAUDE_PROJECT_DIR: root,
    ANTHROPIC_API_KEY: 'sk-planted-not-the-subscription',
    MAUDE_TOKEN_ENDPOINT: 'http://127.0.0.1:1/planted',
    NO_OPEN: '1',
  };
  const r = Bun.spawnSync({
    cmd: [process.execPath, SHIM, '--root', root, ...words],
    cwd: root,
    env,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
}
const call = () =>
  JSON.parse(readFileSync(path.join(rec, 'call.json'), 'utf8')) as {
    cwd: string;
    argv: string[];
    env: Record<string, string>;
    files: string[];
  };
const called = () => existsSync(path.join(rec, 'call.json'));

describe('asset-describer — the agent definition', () => {
  test('the shipped file defines a Read-only agent; a widened copy is never run', () => {
    const def = readAgentDef();
    expect(def).not.toBeNull();
    expect(def?.prompt).toMatch(/maude\.agent-handoff\/1/);
    const dir = mkdtempSync(path.join(tmpdir(), 'maude-describe-agent-'));
    try {
      mkdirSync(path.join(dir, 'agents'));
      const src = readFileSync(
        path.join(DESIGN_PLUGIN_DIR ?? '', 'agents', `${AGENT_NAME}.md`),
        'utf8'
      );
      writeFileSync(
        path.join(dir, 'agents', `${AGENT_NAME}.md`),
        src.replace(/^tools: Read$/m, 'tools: Read, Bash')
      );
      expect(readAgentDef(dir)).toBeNull();
      expect(claudeDescriber({ pluginDir: dir, bin: () => '/bin/echo' })).toBeNull();
      // no design plugin in this layout (npm / web serve) or no claude → no describer: "AI not connected"
      expect(claudeDescriber({ pluginDir: null, bin: () => '/bin/echo' })).toBeNull();
      expect(claudeDescriber({ bin: () => null })).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('the spawn arguments: one agent, Read alone, no MCP, no project path', () => {
    const def = readAgentDef();
    if (!def) throw new Error('no agent');
    const batch = { dir: '/tmp/maude-describe-x', items: [{ sha256: sha, file: `${sha}.jpg` }] };
    const argv = describeArgv(batch, def);
    const agents = JSON.parse(argv[argv.indexOf('--agents') + 1] ?? '{}');
    expect(Object.keys(agents)).toEqual([AGENT_NAME]);
    expect(agents[AGENT_NAME].tools).toEqual(['Read']);
    expect(argv[argv.indexOf('--agent') + 1]).toBe(AGENT_NAME);
    expect(argv[argv.indexOf('--tools') + 1]).toBe('Read');
    expect(argv[argv.indexOf('--allowedTools') + 1]).toBe('Read');
    expect(argv).toContain('--strict-mcp-config');
    expect(argv).toContain('--restricted');
    expect(argv).not.toContain('--mcp-config');
    expect(argv.some((a) => /dangerously|bypassPermissions|--add-dir|--plugin-dir/.test(a))).toBe(
      false
    );
    const joined = argv.join('\n');
    expect(joined).not.toMatch(TOOL_NAMES);
    expect(joined).not.toMatch(/mcp__|"mcp/i);
    expect(joined).not.toContain(root);
    expect(argv[argv.indexOf('-p') + 1]).toBe(
      `Describe these 1 pictures in the current folder:\n${sha}.jpg\nAnswer with only the maude.agent-handoff/1 JSON object.`
    );
  });

  test('the spawn env is an allow-list: no ANTHROPIC_*, no MAUDE_*, no project dir', () => {
    const env = describeEnv('/opt/claude/bin/claude', '/tmp/maude-describe-x', {
      HOME: '/Users/p',
      LANG: 'en_US.UTF-8',
      ANTHROPIC_API_KEY: 'sk-x',
      ANTHROPIC_BASE_URL: 'http://evil',
      MAUDE_TOKEN_KEY: 'k',
      MAUDE_INDEX_DIR: '/x',
      CLAUDE_PROJECT_DIR: root,
      PWD: root,
      PATH: `${root}/node_modules/.bin:/usr/bin`,
    });
    expect(env.HOME).toBe('/Users/p');
    expect(env.PWD).toBe('/tmp/maude-describe-x');
    expect(env.PATH?.split(path.delimiter)[0]).toBe('/opt/claude/bin');
    expect(JSON.stringify(env)).not.toContain(root);
    const allowed = new Set<string>([
      ...ENV_ALLOW,
      'PATH',
      'PWD',
      'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
    ]);
    expect(Object.keys(env).filter((k) => !allowed.has(k))).toEqual([]);
  });

  test('"used up until" pauses the service instead of spending the daily cap', () => {
    expect(() =>
      parseAnswer(
        JSON.stringify({
          subtype: 'error',
          is_error: true,
          result: 'Claude AI usage limit reached|4102444800',
        })
      )
    ).toThrow();
    try {
      parseAnswer(
        JSON.stringify({
          subtype: 'error',
          is_error: true,
          result: 'usage limit reached|4102444800',
        })
      );
    } catch (e) {
      expect((e as { usedUpUntil: number }).usedUpUntil).toBe(4102444800_000);
    }
  });

  test('the studio describer: the stub under MAUDE_DESCRIBE_STUB=1, else the agent (never null-by-design)', async () => {
    const prev = process.env.MAUDE_DESCRIBE_STUB;
    process.env.MAUDE_DESCRIBE_STUB = '1';
    try {
      const d = envDescriber();
      const want = await stubDescriber()({
        dir: '/x',
        items: [{ sha256: sha, file: `${sha}.jpg` }],
      });
      expect(await d?.({ dir: '/x', items: [{ sha256: sha, file: `${sha}.jpg` }] })).toEqual(want);
    } finally {
      if (prev === undefined) delete process.env.MAUDE_DESCRIBE_STUB;
      else process.env.MAUDE_DESCRIBE_STUB = prev;
    }
    // the real one, with an injected spawn: it runs in the batch's dir and hands back the parsed answer
    let seen: { cmd: string[]; cwd: string } | null = null;
    const d = claudeDescriber({
      bin: () => process.execPath,
      spawn: async (spec) => {
        seen = { cmd: spec.cmd, cwd: spec.cwd };
        return {
          code: 0,
          stdout: JSON.stringify({
            subtype: 'success',
            is_error: false,
            result: '{"format":"maude.agent-handoff/1","results":[]}',
          }),
        };
      },
    });
    expect(await d?.({ dir: '/tmp/maude-describe-y', items: [] })).toEqual({
      format: 'maude.agent-handoff/1',
      results: [],
    });
    expect(seen?.cwd).toBe('/tmp/maude-describe-y');
    expect(seen?.cmd[0]).toBe(process.execPath);
  });
});

describe('maude design describe — consent, the budget, and what reaches the agent', () => {
  test('without the person’s yes it sends nothing (exit 3), and --stop has nothing to stop', () => {
    const r = verb();
    expect(r.code).toBe(3);
    expect(r.err).toMatch(/not on for this project yet/);
    expect(called()).toBe(false);
    setConsent(path.join(root, '.design'), false);
    expect(verb().code).toBe(3);
    expect(verb('--stop').code).toBe(3);
    expect(called()).toBe(false);
  });

  test('one batch: the fake claude runs in an OS temp dir of tiles, sees no project path, and its answer is validated', () => {
    setConsent(path.join(root, '.design'), true);
    const r = verb('--json');
    expect(r.code).toBe(0);
    const res = JSON.parse(r.out);
    expect(res).toMatchObject({ ok: true, sent: 1, stored: 1, dropped: 1 });

    const c = call();
    // cwd: a fresh temp dir holding only the tile, gone after the batch
    expect(path.basename(c.cwd)).toMatch(/^maude-describe-/);
    expect(realpathSync(path.dirname(c.cwd))).toBe(realpathSync(tmpdir()));
    expect(c.files).toEqual([`${sha}.jpg`]);
    expect(existsSync(c.cwd)).toBe(false);
    // no project path anywhere the agent can see
    const seen = JSON.stringify(c);
    expect(seen).not.toContain(root);
    expect(seen).not.toContain('bike.png');
    // the env is the allow-list: the person's subscription, no planted key or shell secret
    expect(c.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(c.env.CLAUDE_PROJECT_DIR).toBeUndefined();
    expect(c.env.MAUDE_TOKEN_ENDPOINT).toBeUndefined();
    expect(c.env.MAUDE_INDEX_DIR).toBeUndefined();
    const allowed = new Set<string>([
      ...ENV_ALLOW,
      'PATH',
      'PWD',
      'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
    ]);
    expect(Object.keys(c.env).filter((k) => !allowed.has(k) && !k.startsWith('__CF'))).toEqual([]);
    // the argv carries one Read-only agent
    const agents = JSON.parse(c.argv[c.argv.indexOf('--agents') + 1] ?? '{}');
    expect(Object.keys(agents)).toEqual([AGENT_NAME]);
    expect(agents[AGENT_NAME].tools).toEqual(['Read']);
    expect(c.argv.join('\n')).not.toMatch(TOOL_NAMES);

    // validate.ts: control/bidi characters and markup out, the over-long tag left out, unknown keys dropped,
    // the planted out-of-batch sha never stored, the model named by claude, not by the agent
    const d = readDescription(pidOf(root), sha);
    expect(d).toMatchObject({
      sha256: sha,
      caption: 'Red bike at the gate',
      tags: ['bike'],
      text: 'GATE 7',
      model: 'claude-fake-1',
    });
    expect(d && 'ignore' in d).toBe(false);
    expect(readDescription(pidOf(root), FOREIGN)).toBeNull();
    const dir = path.join(home, 'projects', pidOf(root), 'describe');
    expect(readdirSync(dir).sort()).toEqual(['_usage.json', sha.slice(0, 2)]);
    expect(JSON.parse(readFileSync(path.join(dir, '_usage.json'), 'utf8')).count).toBe(1);
    // nothing is written into the project
    expect(readdirSync(path.join(root, '.design')).sort()).toEqual([
      '_canvas-state',
      'assets',
      'config.json',
    ]);

    // --status reads the same files; a second run within 20 s waits (the Mac's gap) without calling claude
    const s = JSON.parse(verb('--status', '--json').out);
    expect(s.status).toMatchObject({ total: 1, done: 1, ai: true });
    rmSync(path.join(rec, 'call.json'));
    const again = verb();
    expect(again.code).toBe(0);
    expect(again.out).toMatch(/Every picture is described \(1 of 1\)/);
    expect(called()).toBe(false);
  });

  test('--stop: consent stays, describing waits for the person’s Resume', () => {
    setConsent(path.join(root, '.design'), true);
    const s = verb('--stop');
    expect(s.code).toBe(0);
    expect(s.out).toMatch(/Stopped at 0 of 1 picture\. Resume it in Assets\./);
    const r = verb();
    expect(r.code).toBe(3);
    expect(r.err).toMatch(/Describing is stopped/);
    expect(called()).toBe(false);
  });

  test('a used-up account: nothing kept, exit 1, and the reason is said', () => {
    setConsent(path.join(root, '.design'), true);
    writeFake('used-up');
    const r = verb();
    expect(r.code).toBe(1);
    expect(called()).toBe(true);
    expect(readDescription(pidOf(root), sha)).toBeNull();
  });

  test('usage: the modes are exclusive and --batch is bounded', () => {
    expect(verb('--status', '--stop').code).toBe(2);
    expect(verb('--batch', '0').code).toBe(2);
    expect(verb('--batch', '21').code).toBe(2);
    expect(verb('--asset', 'x').code).toBe(2);
  });
});
