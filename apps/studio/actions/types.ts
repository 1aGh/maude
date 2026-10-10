// actions/types.ts — the action + shortcut registry schema (Maude v2, V2-1.3 contract §5.2; V2-2.4).
//
// Data only: no React, no DOM, no closures. Erasable TypeScript only (no enum, namespace or
// parameter properties) so the shell bundle, the canvas runtime bundle, Bun and Node 24 (type
// stripping) can all import it. Handlers are bound per runtime by action id, never stored here.
//
// Owner: the lead (schema, resolver, menu tree, "?" layout). Per-area entries live in
// `defs/<area>.ts` (V2-1.3 §5.1).

/** Dotted '<area>.<verb>[-<object>]', lower kebab segments. Append-only (invariant 8). */
export type ActionId = string;

/** Hub roles (Gate 0 A6). A local project is 'owner'. */
export type Role = 'view' | 'comment' | 'edit' | 'owner';
export const ROLE_RANK: Readonly<Record<Role, number>> = { view: 0, comment: 1, edit: 2, owner: 3 };

/** Where the client runs — predicates name shells, never ad-hoc flags (rule 12). */
export type Shell = 'desktop' | 'browser' | 'cloud' | 'viewer' | 'embed' | 'home';

/** Shell-owned mode (V2-1.2). 'viewing' = the read-only slot in the Share cluster. */
export type Mode = 'edit' | 'preview' | 'present' | 'viewing';

/** What has keyboard focus — computed by the document that received the event (§5.3). */
export type Focus = 'text' | 'timeline' | 'canvas' | 'chrome' | 'modal';

/** Kind of the current selection (the C26 'selection' layer discriminant). */
export type SelKind =
  | 'none'
  | 'artboard'
  | 'object'
  | 'annotation'
  | 'video-artboard'
  | 'generated-image'
  | 'clip';

/** Resolution layers, highest priority first (Gate 0 C26). A focused text field is not a layer:
 *  it swallows the key unless the binding opts in (`inText`). */
export const LAYERS = ['timeline', 'selection', 'tools', 'global'] as const;
export type Layer = (typeof LAYERS)[number];

/**
 * Named runtime booleans a predicate may test. Closed set: adding one is a registry change.
 *
 * `selectFocused` / `rangeFocused` exist only for the V2-2.4 pure swap: v1's three shell key
 * listeners disagree on whether a focused `<select>` or `<input type=range>` is "typing" (the
 * global handler counts a range slider but not a select; the timeline transport the reverse; the
 * ⌫ guard counts both). They are deleted when §5.3's `computeFocus` tightens (S7 / V2-8.0).
 */
export type Fact =
  | 'native'
  | 'canvasOpen'
  | 'videoCanvas'
  | 'timelineVisible'
  | 'linkedHub'
  | 'aiConnected'
  | 'online'
  | 'hasShareLink'
  | 'canUndo'
  | 'canRedo'
  | 'presenting'
  | 'commentFocused'
  | 'selfHostedHub'
  | 'selectFocused'
  | 'rangeFocused';

/** Declarative predicate — serialisable into the manifest, evaluable in the shell, the iframe and
 *  (role half) the server. Every present field must hold (AND); `any` is an OR of sub-predicates. */
export interface Pred {
  minRole?: Role;
  shell?: Shell[];
  notShell?: Shell[];
  mode?: Mode[];
  focus?: Focus[];
  selection?: SelKind[];
  facts?: Fact[];
  notFacts?: Fact[];
  any?: Pred[];
}

/** Canonical chord, produced only by keys.ts: modifiers in macOS order ⌃⌥⇧⌘, then the key. */
export type Chord = string;

export interface KeyBinding {
  chord: Chord;
  layer: Layer;
  /** Binding-specific condition, on top of the action's `visible`. */
  when?: Pred;
  /** Fires while a text field has focus. Default: the chord has ⌘/⌃ and is not TEXT_RESERVED. */
  inText?: boolean;
  /** Fires while a modal (dialog / sheet / menu / popover) is open. Default false. */
  inModal?: boolean;
  /** Press-and-hold (Space = Hand). Taps and holds never compete. */
  hold?: boolean;
  /** Secondary key ("?" lists it as "or"); never the primary shown in menus or ⌘K. */
  alias?: boolean;
}

/** Which runtime owns the handler. */
export type Exec = 'shell' | 'canvas' | 'native' | 'server';

export type HelpGroup =
  | 'edit-tools'
  | 'preview-tools'
  | 'file'
  | 'canvas'
  | 'panels-ai'
  | 'objects'
  | 'timeline'
  | 'present';

export type NativeMenu = 'App' | 'File' | 'Edit' | 'View' | 'Window' | 'Help';

export interface ActionDef {
  id: ActionId;
  /** CONTRACT §3 words; one label on every surface. */
  label: string;
  /** 'place' = a navigable home (⌘K "Places"). */
  kind: 'command' | 'toggle' | 'tool' | 'place';
  /** maude-v2 icon name. */
  icon?: string;
  /** keys[0] is the primary (menus, ⌘K). */
  keys?: KeyBinding[];
  exec: Exec;
  /** Rule 12: the ONE visibility predicate set every surface calls. */
  visible?: Pred;
  /** Shown greyed when false — never hidden. */
  enabled?: Pred;
  /** May be invoked from the canvas iframe (§5.7). Legal only for effect 'none' (V2-1.11). */
  fromCanvas?: boolean;
  /** Non-menu homes: ids of kind:'place' actions. */
  homes?: ActionId[];
  /** "?" placement; the Advanced fold is derived (§5.10). */
  help?: { group: HelpGroup; order: number };
  native?: { menu: NativeMenu; order: number; predefined?: string };
  /** Old ids that still resolve here (append-only). */
  aliases?: ActionId[];
  /** ⌘K matching. */
  search?: { keywords?: string[]; hidden?: boolean };
  /** v1 display strings — deleted in V2-8.0. */
  legacy?: { palette?: string; menu?: string; sheet?: string };
  // V2-1.11 / V2-2.4b add: params, effect, minRole, server, undo, agent, askAI.
}

/** What the resolver needs of an action — the full `ActionDef`, or a row of the slim generated
 *  canvas keymap (`keymap.gen.ts`, no labels or docs). */
export type KeyedAction = Pick<
  ActionDef,
  'id' | 'exec' | 'visible' | 'enabled' | 'fromCanvas' | 'keys'
>;

/** "?" › Advanced › "Keys and tools that moved" (D1–D4, rule 13). Append-only. */
export interface MovedKey {
  was: string;
  now: string;
  note?: string;
  to?: ActionId;
}

export interface KeyCtx {
  role: Role;
  shell: Shell;
  mode: Mode;
  focus: Focus;
  selection: SelKind;
  facts: ReadonlySet<Fact>;
}
