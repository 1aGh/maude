// When a chat counts as "finished" — the ping behind the AI-finished notification, the Dock badge
// and the dot in the chat list. Pure state, so it is testable without a socket.
//
// A connection replays its CURRENT busy state the moment anyone subscribes (`onBusy` calls the
// listener with `busy` straight away), so "not busy" alone is not the end of a turn: on every
// project load that replay used to ping "AI finished" with no AI run at all. A turn ends only on a
// busy → not-busy change. Background work (a subagent, a task the AI left running) can outlive the
// turn (claude-agent-acp #773, issue #177): then the ping waits until it drains.
//
// Hooks (all optional): dot(on) — the chat's busy dot; aggregate(busy) — this chat's share of the
// app-wide busy state; finished() — the ping; refresh() — reload the chat list.
export function createFinishTracker(hooks = {}) {
  const call = (name, ...args) => hooks[name]?.(...args);
  let toolsActive = false; // a tool (e.g. a subagent) is still running
  let tasksActive = false; // a background task is still running
  let bgActive = false; // either of the two
  let busyNow = false; // the prompt turn itself is in flight
  let deferredFinish = false; // a turn (or background work) ended while something still ran

  const background = () => {
    bgActive = toolsActive || tasksActive;
    call('aggregate', busyNow || bgActive);
    if (deferredFinish && !bgActive && !busyNow) {
      deferredFinish = false;
      call('dot', false);
      call('finished');
      call('refresh');
    }
  };

  return {
    activity(activeTools) {
      toolsActive = activeTools.length > 0;
      background();
    },
    tasks(list) {
      tasksActive = list.length > 0;
      if (tasksActive && !busyNow) {
        // work started outside a turn (a follow-up the AI began on its own): lit until it ends
        deferredFinish = true;
        call('dot', true);
      }
      background();
    },
    busy(busy) {
      const wasBusy = busyNow;
      busyNow = busy;
      call('aggregate', busyNow || bgActive);
      if (busy) {
        deferredFinish = false; // a new turn supersedes any pending drain ping
        call('dot', true);
        return;
      }
      if (!wasBusy) return; // the subscribe-time replay of an idle chat, not the end of a turn
      // Turn ended. If background work is still draining, keep the dot lit and hold the ping.
      if (bgActive) {
        deferredFinish = true;
        call('refresh');
      } else {
        call('dot', false);
        call('finished');
        call('refresh');
      }
    },
  };
}
