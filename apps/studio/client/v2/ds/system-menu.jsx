// client/v2/ds/system-menu.jsx — S10.13: a pinned system row's own menu (13 · ds-multi-menu).
//
//   Open Alligators brand system                       ↵
//   Use for new canvases                  now Alligators brand
//   Switch canvases to another system…                 (S10.14)
//   Preview in…                                        (S10.14)
//   Check the system                                   (S10.19)
//
// Pure: the model of the rows. A row whose registry action is not registered yet (the switch / preview /
// check rows belong to later slices) is simply absent — hidden, never a dead row — and the server keeps
// judging every write (`POST /_api/ds/default` wants Can edit on the whole project).

/**
 * @param {{ row: { dsName: string, systemLabel?: string, label?: string, isDefault?: boolean },
 *           rows?: { dsName: string, systemLabel?: string, label?: string, isDefault?: boolean }[],
 *           canEdit?: boolean, has?: (id: string) => boolean }} a
 * @returns {{ id: string, label: string, note?: string, keys?: string, disabled?: boolean,
 *             action: { id: string, params: object } }[]}
 */
export function systemMenuItems({ row, rows = [], canEdit = true, has = () => false }) {
  const nameOf = (r) => r.systemLabel || r.label || r.dsName;
  const many = rows.length > 1;
  const current = rows.find((r) => r.isDefault);
  const items = [
    {
      id: 'open',
      label: `Open ${nameOf(row)}`,
      keys: '↵',
      action: { id: 'ds.go-to', params: { ds: row.dsName } },
    },
  ];
  // one system is the default by being the only one: nothing to choose
  if (many && canEdit) {
    items.push(
      row.isDefault
        ? {
            id: 'default',
            label: 'Default for new canvases',
            note: 'this one',
            disabled: true,
            action: { id: 'ds.set-default', params: { ds: row.dsName } },
          }
        : {
            id: 'default',
            label: 'Use for new canvases',
            ...(current ? { note: `now ${nameOf(current)}` } : {}),
            action: { id: 'ds.set-default', params: { ds: row.dsName } },
          }
    );
  }
  if (many && canEdit && has('ds.switch'))
    items.push({
      id: 'switch',
      label: 'Switch canvases to another system…',
      action: { id: 'ds.switch', params: { from: row.dsName } },
    });
  if (many && has('ds.preview'))
    items.push({
      id: 'preview',
      label: 'Preview in…',
      action: { id: 'ds.preview', params: { from: row.dsName } },
    });
  // S10.15b — a system that needs bringing up (the row's amber dot) offers it here too
  if (row.amber && canEdit && has('ds.upgrade'))
    items.push({
      id: 'upgrade',
      label: 'Bring it up to the schema…',
      note: row.amber.title,
      action: { id: 'ds.upgrade', params: { ds: row.dsName } },
    });
  // S10.19 — running the check is Can edit (it keeps a file under `_state/`); a viewer reads the last answer in the panel
  if (canEdit && has('ds.check-system'))
    items.push({
      id: 'check',
      label: 'Check the system',
      action: { id: 'ds.check-system', params: { ds: row.dsName } },
    });
  return items;
}
