// R2-P2 (audit F27) — clicking the tab of the panel that is already showing does nothing. The panel header's
// own Hide icon is the one way to close it; the active tab used to close the whole left panel too.
import { describe, expect, test } from 'bun:test';
import { PanelTabs } from '../client/shell/dock.jsx';

function findAll(node: any, pred: (n: any) => boolean, out: any[] = []): any[] {
  if (node == null || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const c of node) findAll(c, pred, out);
    return out;
  }
  if (pred(node)) out.push(node);
  findAll(node.props?.children, pred, out);
  return out;
}
const tab = (tree: any, id: string) =>
  findAll(tree, (n) => n.props?.['data-testid'] === `panel-tab-${id}`)[0];

describe('PanelTabs — the active tab is not a toggle', () => {
  const picked: string[] = [];
  const tree = PanelTabs({
    side: 'left',
    ids: ['tree', 'layers', 'assets'],
    activeId: 'tree',
    onPick: (id: string) => picked.push(id),
    onFold: () => {},
  });
  test('clicking the active tab picks nothing', () => {
    tab(tree, 'tree').props.onClick();
    expect(picked).toEqual([]);
  });
  test('clicking another tab still picks it', () => {
    tab(tree, 'layers').props.onClick();
    expect(picked).toEqual(['layers']);
  });
});
