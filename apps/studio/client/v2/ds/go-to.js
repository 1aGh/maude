// client/v2/ds/go-to.js — S10.8: `ds.go-to` (S10 §2.2): open the Design system canvas, focus an artboard, select a
// token or a master. Pure: the plan only. The shell opens the tab and re-posts the messages on the same ladder as
// `maude design open` (client/ui-open.js), because a freshly opened canvas mounts its listener late.

import { canvasDsSystem } from '../../canvas-url.js';

export const DS_SECTIONS = Object.freeze([
  'brand',
  'colour',
  'type',
  'space',
  'motion',
  'components',
  'patterns',
]);

const TOKEN = /^--[A-Za-z0-9_-]{1,128}$/;
const COMPONENT = /^[A-Za-z][A-Za-z0-9]{0,63}$/;

/**
 * @param {{ ds?: string, section?: string, token?: string, component?: string }} params
 * @param {any} cfg  the shell config (designSystems, canvasDesignSystems)
 * @param {string | null} activePath  the canvas open now: the system it follows is the default
 * @returns {{ ds: string, converted: boolean, file: string, artboard: string | null, selector: string | null } | null}
 */
export function dsGoToPlan(params, cfg, activePath = null) {
  const p = params && typeof params === 'object' ? params : {};
  const systems = Array.isArray(cfg?.designSystems) ? cfg.designSystems : [];
  const entry =
    (typeof p.ds === 'string' && systems.find((d) => d.name === p.ds)) ||
    (activePath ? canvasDsSystem(activePath, cfg) : null) ||
    systems[0] ||
    null;
  if (!entry?.path) return null;
  const token = typeof p.token === 'string' && TOKEN.test(p.token) ? p.token : null;
  const component =
    typeof p.component === 'string' && COMPONENT.test(p.component) ? p.component : null;
  const section =
    typeof p.section === 'string' && DS_SECTIONS.includes(p.section)
      ? p.section
      : component
        ? 'components'
        : null;
  return {
    // S10.13 — an unconverted system has no Design system canvas to open (Q6): the shell shows today's v1 view
    ds: entry.name,
    converted: cfg?.dsConverted?.[entry.name] === true,
    file: `${entry.path.replace(/\/+$/, '')}/design-system.tsx`,
    artboard: section ? `ds-${section}` : null,
    // names that passed the patterns above: nothing here can close the attribute selector
    selector: token
      ? `[data-ds-token="${token}"]`
      : component
        ? `[data-ds-master="${component}"]`
        : null,
  };
}

/** The canvas messages of a plan, in the order `ui-open` posts them. */
export function dsGoToPosts(plan) {
  const posts = [];
  if (plan?.artboard)
    posts.push({
      dgn: 'run-action',
      v: 1,
      id: 'view.zoom-to-artboard',
      params: { id: plan.artboard },
    });
  if (plan?.selector) posts.push({ dgn: 'select-by-selector', v: 1, selector: plan.selector });
  return posts;
}
