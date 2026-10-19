// sec-a M1 (wave-A defender) — the canvas (DDR-054, untrusted) and every other HTTP writer can no
// longer forge, change or remove a vote or a ballot through the board routes. Only the vote door
// (routes/votes.ts, in-process) writes them. Proven from the CANVAS origin and from the MAIN origin,
// over the op batch AND the whole-board PUT. A stamp — the person's own reaction — still lands.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Subprocess } from 'bun';
import { ballotId } from '../annotations/elements/ballot.model.ts';
import { canonical, parseBoard, serializeBoard } from '../annotations/schema.ts';
import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

describe('sec-a M1 — votes and ballots change only through the vote door', () => {
  let proc: Subprocess;
  let port: number;
  let canvasOrigin: string;
  let written: string;
  const file = '.design/ui/VoteDoor.tsx';
  let voteId: string;
  let me: string;

  beforeAll(async () => {
    const sb = makeSandbox();
    writeFileSync(
      join(sb.designRoot, 'ui', 'VoteDoor.tsx'),
      'export default () => <DCArtboard id="a" label="Matná" width={100} height={100} />;\n'
    );
    written = join(sb.designRoot, 'ui-votedoor.annotations.json');
    port = nextPort();
    proc = await bootServer(sb.root, port, { MAUDE_NO_AUTOBUILD: '1' });
    canvasOrigin = JSON.parse(
      readFileSync(join(sb.designRoot, '_server.json'), 'utf8')
    ).canvasOrigin;
    const main = `http://localhost:${port}`;
    const post = (path: string, body: unknown) =>
      fetch(`${main}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    const start = await post('/_api/votes/start', { file, targets: ['ab:a', 'ab:b'] });
    expect(start.status).toBe(201);
    voteId = (await start.json()).vote.id;
    const cast = await post('/_api/votes/ballot', { file, id: voteId, picks: { 'ab:a': 2 } });
    expect(cast.status).toBe(200);
    me = (await (await fetch(`${main}/_api/votes?file=${encodeURIComponent(file)}`)).json()).me;
  });
  afterAll(async () => {
    await killProc(proc);
  });

  const main = () => `http://localhost:${port}`;
  const boardText = () => readFileSync(written, 'utf8');
  const els = () => parseBoard(boardText()).elements;
  const ops = (base: string, list: unknown[]) =>
    fetch(`${base}/_api/annotations/ops`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file, actionId: 'canvas-1', ops: list }),
    });
  const put = (base: string, board: string, extra: Record<string, unknown> = {}) =>
    fetch(`${base}/_api/annotations`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file, board, ...extra }),
    });

  test('the op batch: every vote / ballot change is 403 from both origins; nothing is written', async () => {
    const mine = ballotId(voteId, me);
    const forged = canonical({
      id: ballotId(voteId, 'Mallory'),
      type: 'ballot',
      index: 'z0',
      vote: voteId,
      voter: 'Mallory',
      picks: { 'ab:b': 3 },
    });
    const before = boardText();
    for (const base of [canvasOrigin, main()]) {
      for (const list of [
        [{ op: 'put', el: forged }],
        [{ op: 'patch', id: mine, set: { picks: { 'ab:b': 2 } } }],
        [{ op: 'delete', id: mine }],
        [{ op: 'patch', id: voteId, set: { state: 'ended', tallies: { 'ab:b': 40 } } }],
        [{ op: 'delete', id: voteId }],
      ]) {
        const r = await ops(base, list);
        expect(r.status).toBe(403);
      }
    }
    expect(boardText()).toBe(before);
  });

  test('a stamp and a sticky from the canvas still land (the person’s own marks)', async () => {
    const stamp = canonical({
      id: 'stamp-ab-a-you-heart',
      type: 'stamp',
      index: 'y0',
      x: 0,
      y: 0,
      w: 28,
      h: 28,
      kind: 'heart',
      target: 'ab:a',
    });
    const sticky = canonical({
      id: 's_door01',
      type: 'sticky',
      index: 'y1',
      x: 0,
      y: 0,
      w: 120,
      h: 120,
      text: 'hi',
    });
    const r = await ops(canvasOrigin, [
      { op: 'put', el: stamp },
      { op: 'put', el: sticky },
    ]);
    expect(r.status).toBe(200);
    expect(els().some((e) => e.id === 'stamp-ab-a-you-heart')).toBe(true);
  });

  test('the whole-board PUT: a body that changes a vote or a ballot is refused, from both origins', async () => {
    const before = boardText();
    const now = els();
    const noBallot = serializeBoard(now.filter((e) => e.type !== 'ballot'));
    const stuffed = serializeBoard(
      now.map((e) => (e.type === 'ballot' ? { ...e, picks: { 'ab:b': 3 } } : e))
    );
    for (const base of [canvasOrigin, main()]) {
      expect((await put(base, noBallot)).status).toBe(400); // replace without the ballot
      expect((await put(base, stuffed)).status).toBe(400); // replace with other picks
      expect((await put(base, stuffed, { base: before })).status).toBe(400); // a merge
    }
    expect(boardText()).toBe(before);
    // the same PUT with the votes untouched still writes
    const plus = serializeBoard([
      ...now,
      canonical({
        id: 's_door02',
        type: 'sticky',
        index: 'y2',
        x: 0,
        y: 0,
        w: 120,
        h: 120,
        text: 'ok',
      }),
    ]);
    expect((await put(canvasOrigin, plus, { base: before })).status).toBe(204);
    expect(els().some((e) => e.id === 's_door02')).toBe(true);
  });

  test('C1(c) — End names the artboards from the canvas source, not from the request', async () => {
    const r = await fetch(`${main()}/_api/votes/end`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file, id: voteId, labels: { 'ab:a': 'PLANTED' } }),
    });
    expect(r.status).toBe(200);
    const txt = String(els().find((e) => e.type === 'text' && /·/.test(String(e.text)))?.text);
    expect(txt.split('\n')[0]).toBe('Matná · 2');
    expect(txt).not.toContain('PLANTED');
  });
});
