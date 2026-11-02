window.__TAURI__ = {
  core: {
    invoke: (cmd) => {
      if (cmd === 'plugin:app|version') return Promise.resolve('2.0.0-rc.1');
      return Promise.reject(new Error('a11y-stub: ' + cmd));
    },
  },
  event: { listen: () => Promise.resolve(() => {}) },
  window: {},
  path: {},
  app: {},
};
