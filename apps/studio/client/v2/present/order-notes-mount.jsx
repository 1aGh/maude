// client/v2/present/order-notes-mount.jsx — V2-5 A4 (S3.5): the shell's mount of the "Order and notes…"
// sheet. The sheet builds its model once per open from `artboards`, so the mount reads them first
// (order-notes-artboards.js: the index row + the canvas .meta.json, in canvas order) and only then
// renders it. Nothing renders while they load — the sheet's own "loading" covers its read.

import { useEffect, useState } from 'react';
import { loadOrderNotesArtboards } from './order-notes-artboards.js';
import { OrderNotesSheet } from './order-notes-sheet.jsx';

export function OrderNotesMount({ path, canvasName, onClose, load = loadOrderNotesArtboards }) {
  const [artboards, setArtboards] = useState(null);
  useEffect(() => {
    let off = false;
    setArtboards(null);
    load(path).then((a) => {
      if (!off) setArtboards(a);
    });
    return () => {
      off = true;
    };
  }, [path, load]);
  if (!artboards) return null;
  return (
    <OrderNotesSheet file={path} canvasName={canvasName} artboards={artboards} onClose={onClose} />
  );
}
