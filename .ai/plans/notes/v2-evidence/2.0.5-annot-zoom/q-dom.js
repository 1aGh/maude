(() => {
  const scene = document.querySelector('.dc-annot-scene');
  const pick = (t) => [...scene.children].find((c) => (c.getAttribute('data-an-type') || c.className).includes(t));
  const s = (el) => (el ? el.outerHTML.slice(0, 1500) : null);
  const world = document.querySelector('.dc-world');
  const wcs = getComputedStyle(world);
  const scs = getComputedStyle(scene);
  // how many scene children intersect the viewport
  const vw = innerWidth, vh = innerHeight;
  let onScreen = 0;
  for (const c of scene.children) {
    const r = c.getBoundingClientRect();
    if (r.right > 0 && r.bottom > 0 && r.left < vw && r.top < vh) onScreen++;
  }
  const sceneRect = scene.getBoundingClientRect();
  return {
    attrsOfFirst: [...scene.children].slice(0, 3).map((c) => [...c.attributes].map((a) => a.name + '=' + a.value.slice(0, 80))),
    sticky: s(pick('sticky')),
    arrow: s(pick('arrow')),
    section: s(pick('section')),
    text: s(pick('text')),
    shape: s(pick('shape')),
    world: { style: world.getAttribute('style'), willChange: wcs.willChange, contain: wcs.contain },
    scene: { style: scene.getAttribute('style'), contain: scs.contain, pos: scs.position, rect: [sceneRect.width, sceneRect.height] },
    onScreen, total: scene.children.length, vw, vh,
    annotCss: document.getElementById('dc-annot-css')?.textContent.length,
  };
})()
