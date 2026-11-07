(() => {
  const s = document.querySelector('.dc-annot-scene > [data-type="sticky"]');
  const p = s?.querySelector('path');
  return {
    boxShadow: s ? getComputedStyle(s).boxShadow : null,
    pathFilter: p ? p.getAttribute('filter') : null,
    sceneDcZoom: getComputedStyle(document.querySelector('.dc-annot-scene')).getPropertyValue('--dc-zoom'),
    worldDcZoom: getComputedStyle(document.querySelector('.dc-world')).getPropertyValue('--dc-zoom'),
  };
})()
