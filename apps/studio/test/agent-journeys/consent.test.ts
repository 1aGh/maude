// S12.16 (lead decision v2-S12.16-lanes-allow-named-prompt-verbs) — what the journey lanes answer to
// a permission card. Nobody answers one, except for a prompt-tier verb the journey JSON names in
// `allow`. No model, no studio: the pure answer, the lane plans, and the journeys' own lists.
import { expect, test } from 'bun:test';

import { MAUDE_DEFAULT_ALLOWED_TOOLS } from '../../acp/bridge.ts';
import { GRADERS } from './graders.mjs';
import { planAcp } from './lanes/acp.mjs';
import { allowRules, answerCard, commandAllowed, lintAllow } from './lanes/consent.mjs';
import { planTerminal } from './lanes/terminal.mjs';
import { lintJourney, loadJourneys } from './run.mjs';

const card = (command: string | null, kinds = ['allow_once', 'allow_always', 'reject_once']) => ({
  toolCall: { toolCallId: 't1', title: command ?? 'Read', rawInput: command ? { command } : {} },
  options: kinds.map((kind) => ({ optionId: kind, kind, name: kind })),
});
const ALLOW = ['maude design history restore', 'maude design comments reply'];

test('a card for a verb the journey does not name is refused; a named one gets the one-time allow', () => {
  const yes = answerCard(ALLOW, card('maude design history restore ui/Greeting.tsx @last-good'));
  expect(yes).toMatchObject({ allow: true, optionId: 'allow_once' });
  expect(answerCard(ALLOW, card('maude design comments reply c_1 --body "Done"')).allow).toBe(true);
  for (const command of [
    'maude design export png ui/A.tsx', // prompt-tier, but not named by this journey
    'maude design ds publish maude',
    'maude design history restore-all', // the verb is a whole word, not a prefix
    'maude design history', // shorter than the named verb
    'maude design history restore ui/A.tsx; rm -rf .design', // a second command rides along
    'maude design history restore ui/A.tsx && maude design export png ui/A.tsx',
    'maude design history restore ui/A.tsx | tee out',
    'maude design history restore $(cat x)',
    'maude design history restore ui/A.tsx > ../x',
    'curl -s http://127.0.0.1:4399/_api/history/restore',
  ]) {
    const no = answerCard(ALLOW, card(command));
    expect(no.allow, command).toBe(false);
    expect(no.optionId, command).toBe('reject_once');
  }
  // no allow list (every journey but the four) refuses even a prompt-tier verb
  expect(answerCard([], card('maude design history restore ui/A.tsx')).allow).toBe(false);
  // not a Bash card at all (an Edit, a Read): refused
  expect(answerCard(ALLOW, card(null)).allow).toBe(false);
  // never the standing allow, and no one-time option offered means a refusal
  expect(
    answerCard(ALLOW, card('maude design history restore a', ['allow_always', 'reject_once']))
  ).toMatchObject({ allow: false, optionId: 'reject_once' });
  expect(commandAllowed(ALLOW, 'maude design comments reply')).toBe(true);
});

test('allow entries are verbs only; a malformed list fails the journey shape', () => {
  expect(lintAllow(undefined)).toEqual([]);
  expect(lintAllow(ALLOW)).toEqual([]);
  expect(lintAllow([])).not.toEqual([]);
  expect(lintAllow(['maude design export png ui/A.tsx --out x'])).not.toEqual([]);
  expect(lintAllow(['rm -rf /'])).not.toEqual([]);
  expect(lintAllow(['maude design ds publish', 'maude design ds publish'])).not.toEqual([]);
});

test('the four journeys name their verbs; the lanes carry exactly that list', () => {
  const js = Object.fromEntries(loadJourneys('all').map((j) => [j.id, j]));
  // curl-local: create / rename / trash a canvas are the studio's own routes, reached through it (S12.16 live)
  expect(js.S1.allow).toEqual(['maude design history restore', 'maude design curl-local']);
  expect(js.S9.allow).toEqual(['maude design comments reply', 'maude design comments resolve']);
  expect(js.S10.allow).toEqual(['maude design ds pending', 'maude design ds publish']);
  expect(js.S8.allow).toEqual(['maude design export']);
  for (const id of ['S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S11'])
    expect(js[id].allow).toBeUndefined();
  for (const j of Object.values(js)) {
    expect(lintJourney(j), j.id).toEqual([]);
    const t = planTerminal(j, { project: '/p', trialDir: '/t', env: { PATH: '' } });
    const args = t.turns[0].args;
    const from = args.indexOf('--allowedTools') + 1;
    expect(args.slice(from, args.indexOf('--permission-mode')), j.id).toEqual([
      ...MAUDE_DEFAULT_ALLOWED_TOOLS,
      ...allowRules(j),
    ]);
    expect(planAcp(j, { project: '/p' }).allow, j.id).toEqual(j.allow ?? []);
  }
  expect(allowRules(js.S1)).toEqual([
    'Bash(maude design history restore:*)',
    'Bash(maude design curl-local:*)',
  ]);
});

test('S9: the comments grader wants the reply to say what changed', () => {
  const thread = (body: string) => [
    { id: 'c1', status: 'resolved', thread: [{ authorKind: 'ai', body }] },
  ];
  const g = { path: 'ui/A.tsx', ids: ['c1'], replyHas: { c1: 'Save everything' } };
  const o = (body: string) => ({ comments: () => thread(body) });
  expect(GRADERS.comments(g, o('Done: it says “Save everything”.') as never).pass).toBe(true);
  expect(GRADERS.comments(g, o('Done.') as never).pass).toBe(false);
});
