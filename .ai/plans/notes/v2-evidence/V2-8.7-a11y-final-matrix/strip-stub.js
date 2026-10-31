(() => {
  const q = new URLSearchParams(location.search);
  const names = ['e2e-fixture', 'Studio redesign', 'Pricing page', 'Launch video', 'Docs site', 'Brand kit', 'Mobile app', 'Print run', 'Cloud: Team board'];
  const dots = [null, 'needs-you', 'working', 'done', null, null, null, null, null];
  const state = {
    tabs: names.map((name, i) => ({ label: `p-${i + 1}`, name, dot: dots[i], resting: i === 6 })),
    active: q.get('active') || 'p-1',
    home: { label: 'home' },
    overview: q.get('overview') === '1',
  };
  window.__TAURI__ = {
    core: {
      Channel: class {},
      invoke: (cmd) => (cmd === 'tabs_state' ? Promise.resolve(state) : Promise.resolve()),
    },
  };
})();
