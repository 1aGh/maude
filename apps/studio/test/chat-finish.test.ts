// The "AI finished" ping fires only when a turn really ends — never on the subscribe-time replay
// of an idle chat (2.0.4 .app check: every project load notified "AI finished" with no AI run).
import { describe, expect, test } from 'bun:test';
import { createFinishTracker } from '../client/panels/chat-finish.js';

function rig() {
  const log: string[] = [];
  const t = createFinishTracker({
    finished: () => log.push('finished'),
    dot: (on: boolean) => log.push(`dot:${on}`),
  });
  return { t, pings: () => log.filter((l) => l === 'finished').length, log };
}

describe('chat finish tracker', () => {
  test('the replay of an idle chat on subscribe is not a finished turn', () => {
    const { t, pings } = rig();
    t.busy(false); // onBusy replays the current state straight away
    t.activity([]);
    t.tasks([]);
    t.busy(false); // a reconnect replays it again
    expect(pings()).toBe(0);
  });

  test('a turn that ends pings once', () => {
    const { t, pings } = rig();
    t.busy(false);
    t.busy(true);
    t.busy(false);
    expect(pings()).toBe(1);
    t.busy(false); // a replay after the end does not ping again
    expect(pings()).toBe(1);
  });

  test('background work holds the ping until it drains', () => {
    const { t, pings } = rig();
    t.busy(true);
    t.activity([{ id: 'subagent' }]);
    t.busy(false);
    expect(pings()).toBe(0);
    t.activity([]);
    expect(pings()).toBe(1);
  });

  test('a background task the AI starts on its own pings when it ends', () => {
    const { t, pings, log } = rig();
    t.busy(false);
    t.tasks([{ id: 'bg' }]);
    expect(log).toContain('dot:true');
    expect(pings()).toBe(0);
    t.tasks([]);
    expect(pings()).toBe(1);
  });
});
