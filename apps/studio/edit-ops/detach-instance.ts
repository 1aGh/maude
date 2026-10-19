// edit-ops/detach-instance.ts — S2.17: `component.detach` (ed-comp-instance: "Detach keeps this exact look
// as a plain frame. Nothing breaks; it stops following <Tlačítko>.").
//
// Two kinds of instance, one verb:
//   · a LINKED design-system instance (`<Button …>` from `@maude/ds`): the id-carrying element is replaced
//     by the plain markup it renders to — the canvas MEASURED that and sends it as `tree`
//     (editing/instance-tree.ts); this file validates and prints it (instance-tree.ts). Same classes,
//     same inline style as authored (token references stay `var(--…)`), same id: the look is identical
//     and the element is no longer a component. `@maude/ds` names nothing else uses any more leave the
//     import. A repeat (`.map()`, a component used elsewhere) refuses: it would change the other places.
//   · a LOCAL component's usage: the existing clone-the-definition detach (`applyDetachComponent`, the
//     engine behind `/_api/detach-component`) — one usage is repointed at its own copy.
//
// params  tree     the rendered subtree (linked instances only)
//         rendered how many nodes carry this id in the artboard (the canvas counts; > 1 = a repeat)
// targets[0]  the instance (or, for a local component, an element inside its usage).

import MagicString from 'magic-string';
import { parseSync } from 'oxc-parser';
import { applyDetachComponent, CanvasEditError, resolveEditScope } from '../canvas-edit.ts';
import { walkIdElements } from '../element-ids.ts';
import { topLevelNames } from './insert-component.ts';
import { readInstance } from './instance-model.ts';
import { printTree, sanitizeTree, TreeRefusal } from './instance-tree.ts';
import { dropImport, stillUsed } from './swap-variant.ts';
import type { EditOp, ResolvedEditOp } from './types.ts';

const fail = (req: ResolvedEditOp, message: string): never => {
  throw new CanvasEditError(message, { canvas: req.file, id: req.targets[0]?.element ?? '' });
};

const lineIndentAt = (source: string, at: number): string => {
  const ls = source.lastIndexOf('\n', at - 1) + 1;
  return /^[ \t]*/.exec(source.slice(ls, at))?.[0] ?? '';
};

export const componentDetach: EditOp = {
  id: 'component.detach',
  apply(source, req) {
    const target = req.targets[0];
    if (!target || req.targets.length !== 1) return fail(req, 'Select one instance to detach.');
    const id = target.element;
    const f = readInstance(source, req.file, id);

    if (!f) {
      // a local component's usage: clone its definition for this one place. The dispatcher already
      // resolved an element inside a reused component to its USAGE's id; the engine wants an id inside
      // the definition and the usage's position among its siblings, so find both.
      let inner = id;
      let at = target.occurrence;
      const walk = walkIdElements(source, req.file);
      const usage = walk.ok ? walk.elements.find((e) => e.id === id) : undefined;
      if (walk.ok && usage && /^[A-Z]/.test(usage.tag)) {
        const def = walk.elements.find((e) => e.component === usage.tag && e.id);
        if (def?.id) {
          inner = def.id;
          at = walk.elements.filter((e) => e.tag === usage.tag).indexOf(usage);
        }
      }
      try {
        return { source: applyDetachComponent(req.file, source, inner, at).source };
      } catch (e) {
        if (e instanceof CanvasEditError) {
          // the engine's words are for the log; a person is told what the object is
          if (/not part of a reused component/.test(e.message))
            return fail(req, 'This is not an instance of a component.');
          return fail(req, 'This component cannot be detached from here.');
        }
        throw e;
      }
    }

    const rendered = Number.isSafeInteger(req.params.rendered)
      ? (req.params.rendered as number)
      : 1;
    if (f.repeats || rendered > 1)
      return fail(
        req,
        'This one repeats; detach it where it is written, not from one of its copies.'
      );
    const scope = resolveEditScope(req.file, source, id, 1);
    if (scope.scope === 'shared')
      return fail(
        req,
        `This sits in ${scope.componentName ?? 'a component'} used in ${scope.affects} places; detach that first.`
      );

    let tree: ReturnType<typeof sanitizeTree>;
    try {
      tree = sanitizeTree(req.params.tree, id);
    } catch (e) {
      if (e instanceof TreeRefusal) return fail(req, e.message);
      throw e;
    }

    const unit = source.includes('\n\t') ? '\t' : '  ';
    const indent = lineIndentAt(source, f.host.start);
    const jsx = printTree(tree, indent, unit);
    const parsedBefore = parseSync(
      req.file.endsWith('.tsx') ? req.file : `${req.file}.tsx`,
      source,
      {
        sourceType: 'module',
      }
    );
    const dsNames = [...topLevelNames(parsedBefore.program)]
      .filter(([, k]) => k === 'ds')
      .map(([n]) => n);

    const s = new MagicString(source);
    s.overwrite(f.host.start, f.host.end, jsx);
    let out = s.toString();
    for (const name of dsNames) {
      if (stillUsed(source, req.file, name) && !stillUsed(out, req.file, name))
        out = dropImport(out, req.file, name);
    }
    return { source: out };
  },
};
