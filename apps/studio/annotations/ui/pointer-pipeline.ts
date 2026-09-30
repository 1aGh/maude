/**
 * @file       annotations/ui/pointer-pipeline.ts — one pointer pipeline for the annotation layer
 * @scope      apps/studio/annotations/ui/pointer-pipeline.ts
 * @purpose    DDR-242 AD8 (Task 21). The layer used to install a document
 *             capture listener per interaction (select/drag/marquee, group
 *             resize, connector dots, right-click…), each with its own
 *             per-gesture pointermove/up listeners and its own copy of the
 *             "is this chrome?" skip-list. Which one won depended on the
 *             order effects happened to register, and a skip-list that missed
 *             one class turned a handle drag into a marquee (ce641b18) or an
 *             artboard drag into a lost selection (3db83a8a).
 *
 *             Here there is ONE set of document listeners. Stages are tried
 *             in explicit priority order (lowest first); the first to claim a
 *             pointerdown owns the gesture, and only that gesture sees the
 *             following moves and the release. `state` is the tool state
 *             machine's current node: `idle`, or the kind of the gesture in
 *             flight (`dragging`, `marquee`, `resizing`, `connecting`, …).
 *
 *             Pure DOM, React-free: the layer registers stages from effects.
 */

export interface Gesture {
  /** State-machine node while this gesture runs (`dragging`, `marquee`, …). */
  kind: string;
  move?(e: PointerEvent): void;
  up?(e: PointerEvent): void;
  /** Pointercancel, or a new pointerdown arriving before the release. */
  cancel?(e: PointerEvent | null): void;
}

/**
 * What a stage answers to a pointerdown:
 *   - a Gesture: claimed, the stage owns the moves and the release;
 *   - 'pass': claimed for someone else — the target's own handlers (a resize
 *     handle, a toolbar button, a text editor) run; no later stage does;
 *   - undefined / false: not mine, try the next stage.
 */
export type Claim = Gesture | 'pass' | undefined | false | void;

export interface Stage {
  /** Lower runs first. */
  priority: number;
  name: string;
  down(e: PointerEvent): Claim;
}

export interface PipelineTrace {
  stage: string;
  claim: 'gesture' | 'pass';
  kind?: string;
}

export class PointerPipeline {
  private stages: Stage[] = [];
  private active: { gesture: Gesture; pointerId: number } | null = null;
  private listeners: Array<[string, EventListener]> = [];
  private doc: Document | null = null;
  /** Last claim, for tooling and tests. */
  lastClaim: PipelineTrace | null = null;
  onState: ((state: string) => void) | null = null;

  get state(): string {
    return this.active?.gesture.kind ?? 'idle';
  }

  /** Register a stage; returns its unregister function. */
  add(stage: Stage): () => void {
    this.stages = [...this.stages, stage].sort((a, b) => a.priority - b.priority);
    return () => {
      this.stages = this.stages.filter((s) => s !== stage);
    };
  }

  attach(doc: Document): () => void {
    this.detach();
    this.doc = doc;
    const on = (type: string, fn: (e: PointerEvent) => void) => {
      const l = fn as unknown as EventListener;
      doc.addEventListener(type, l, true);
      this.listeners.push([type, l]);
    };
    on('pointerdown', (e) => this.down(e));
    on('pointermove', (e) => this.move(e));
    on('pointerup', (e) => this.up(e));
    on('pointercancel', (e) => this.cancel(e));
    return () => this.detach();
  }

  detach(): void {
    if (this.doc) {
      for (const [type, l] of this.listeners) this.doc.removeEventListener(type, l, true);
    }
    this.listeners = [];
    this.doc = null;
    this.end(null);
  }

  /** Start a gesture from outside a stage (a stage that claimed via 'pass' but still wants moves). */
  begin(pointerId: number, gesture: Gesture): void {
    this.end(null);
    this.active = { gesture, pointerId };
    this.onState?.(gesture.kind);
  }

  private end(e: PointerEvent | null): void {
    const a = this.active;
    if (!a) return;
    this.active = null;
    a.gesture.cancel?.(e);
    this.onState?.('idle');
  }

  private down(e: PointerEvent): void {
    // A second pointer (or a lost release) ends whatever was running.
    if (this.active) this.end(e);
    for (const stage of this.stages) {
      const claim = stage.down(e);
      if (!claim) continue;
      if (claim === 'pass') {
        this.lastClaim = { stage: stage.name, claim: 'pass' };
        return;
      }
      this.lastClaim = { stage: stage.name, claim: 'gesture', kind: claim.kind };
      this.active = { gesture: claim, pointerId: e.pointerId };
      this.onState?.(claim.kind);
      return;
    }
    this.lastClaim = null;
  }

  private move(e: PointerEvent): void {
    const a = this.active;
    if (a && e.pointerId === a.pointerId) a.gesture.move?.(e);
  }

  private up(e: PointerEvent): void {
    const a = this.active;
    if (!a || e.pointerId !== a.pointerId) return;
    this.active = null;
    a.gesture.up?.(e);
    this.onState?.('idle');
  }

  private cancel(e: PointerEvent): void {
    const a = this.active;
    if (!a || e.pointerId !== a.pointerId) return;
    this.end(e);
  }
}
