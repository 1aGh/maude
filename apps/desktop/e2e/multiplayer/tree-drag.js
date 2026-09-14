// biome-ignore lint/correctness/noUnusedVariables: Read verbatim and invoked inside the browser by the E2E driver.
async function treeDragGesture({ source, destination }) {
  const from = document.querySelector(source);
  const to = document.querySelector(destination);
  if (!from || !to) throw new Error('Tree drag source/destination absent');
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
  send(from, 'dragstart');
  await new Promise((done) => setTimeout(done, 30));
  send(to, 'dragenter');
  send(to, 'dragover');
  await new Promise((done) => setTimeout(done, 30));
  send(to, 'drop');
  send(from, 'dragend');
}
