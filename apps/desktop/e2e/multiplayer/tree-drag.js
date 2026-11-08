// biome-ignore lint/correctness/noUnusedVariables: Read verbatim and invoked inside the browser by the E2E driver.
async function treeDragGesture({ source, destination }) {
  const from = document.querySelector(source);
  let to = document.querySelector(destination);
  if (!from) throw new Error('Tree drag source/destination absent');
  const dataTransfer = new DataTransfer();
  const send = (node, type) => {
    const r = node.getBoundingClientRect();
    node.dispatchEvent(
      new DragEvent(type, {
        bubbles: true,
        cancelable: true,
        dataTransfer,
        clientX: r.x + r.width / 2,
        clientY: r.y + r.height / 2,
      })
    );
  };
  if (!to && !document.querySelector('[data-rows][data-drawn]'))
    throw new Error('Tree drag source/destination absent');
  send(from, 'dragstart');
  await new Promise((done) => setTimeout(done, 30));
  // The Canvases panel draws only the rows near the viewport: a drop target far from the source is not in the
  // document yet. Scroll the list the way a held drag does at its edge until the row is drawn (the payload
  // rides in the drag's data, so the source row may leave the window meanwhile).
  const list = document.querySelector('[data-rows][data-drawn]');
  if (!to && list) {
    for (let step = 0; step < 80 && !to; step++) {
      const before = list.scrollTop;
      list.scrollTop = step === 0 ? 0 : before + Math.max(80, list.clientHeight * 0.8);
      await new Promise((done) => setTimeout(done, 120));
      to = document.querySelector(destination);
      if (step > 0 && list.scrollTop === before) break;
    }
  }
  if (!to) throw new Error('Tree drag source/destination absent');
  send(to, 'dragenter');
  send(to, 'dragover');
  await new Promise((done) => setTimeout(done, 30));
  send(to, 'drop');
  send(from, 'dragend');
}
