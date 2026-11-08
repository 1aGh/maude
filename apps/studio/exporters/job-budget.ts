// The wall-clock budget of one export job (#128 T3.7b).
//
// A job's render timeout bounds RENDER time. A cloud video can sit in the render service's queue
// behind another video (one video renders at a time), and that wait is not the job's work: it
// must not spend the job's own budget, or a long video that waited its turn is aborted before it
// has run for as long as it was promised. So the budget has a pause: while the service says
// "waiting" the budget stands still, but the waiting is itself bounded — `maxPauseMs` in total —
// so a queue that never moves still ends the job.
//
// `onExpire` is told which limit ran out: `budget` (it rendered for too long) or `queue` (it
// waited for too long).

export type BudgetExpiry = 'budget' | 'queue';

export interface JobBudget {
  /** Arm the budget: the render started. */
  start(): void;
  /** The job is waiting in a queue: the budget stands still, the queue ceiling runs. */
  pause(): void;
  /** It runs again: the rest of the budget runs. */
  resume(): void;
  /** Disarm everything (the job ended). */
  stop(): void;
}

export function createJobBudget(o: {
  /** how long the job may RUN */
  budgetMs: number;
  /** how long, in total, it may WAIT in a queue */
  maxPauseMs: number;
  onExpire: (why: BudgetExpiry) => void;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (h: ReturnType<typeof setTimeout>) => void;
}): JobBudget {
  const now = o.now ?? Date.now;
  const setT = o.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearT = o.clearTimer ?? ((h) => clearTimeout(h));

  let spent = 0; // running time so far
  let waited = 0; // queue time so far
  let since = 0; // when the current stretch (running or paused) began
  let state: 'idle' | 'running' | 'paused' | 'stopped' = 'idle';
  let timer: ReturnType<typeof setTimeout> | undefined;

  const disarm = () => {
    if (timer !== undefined) clearT(timer);
    timer = undefined;
  };
  const fire = (why: BudgetExpiry) => {
    timer = undefined;
    if (state === 'stopped') return;
    state = 'stopped';
    o.onExpire(why);
  };
  const arm = () => {
    disarm();
    if (state === 'running') timer = setT(() => fire('budget'), Math.max(0, o.budgetMs - spent));
    else if (state === 'paused')
      timer = setT(() => fire('queue'), Math.max(0, o.maxPauseMs - waited));
  };
  const settle = () => {
    const t = now();
    if (state === 'running') spent += t - since;
    else if (state === 'paused') waited += t - since;
    since = t;
  };

  return {
    start() {
      if (state !== 'idle') return;
      state = 'running';
      since = now();
      arm();
    },
    pause() {
      if (state !== 'running') return;
      settle();
      state = 'paused';
      arm();
    },
    resume() {
      if (state !== 'paused') return;
      settle();
      state = 'running';
      arm();
    },
    stop() {
      state = 'stopped';
      disarm();
    },
  };
}
