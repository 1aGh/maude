(() => {
  const scene = document.querySelector('.dc-annot-scene');
  const pick = (t) => scene.querySelector(`:scope > [data-type="${t}"]`);
  const s = (el) => (el ? el.outerHTML.slice(0, 1400) : null);
  const per = {};
  for (const c of scene.children) {
    const t = c.getAttribute('data-type');
    per[t] = per[t] || { n: 0, nodes: 0, svg: 0, filter: 0, shadow: 0 };
    per[t].n++;
    per[t].nodes += c.querySelectorAll('*').length + 1;
    per[t].svg += c.querySelectorAll('svg *').length;
    for (const d of [c, ...c.querySelectorAll('*')]) {
      const cs = getComputedStyle(d);
      if (cs.filter !== 'none') per[t].filter++;
      if (cs.boxShadow !== 'none') per[t].shadow++;
    }
  }
  return { per, sticky: s(pick('sticky')), arrow: s(pick('arrow')), section: s(pick('section')), shape: s(pick('shape')) };
})()
