function photoTrace() {
  if (window.__maudePhotoTrace) return window.__maudePhotoTrace;
  const events = [];
  window.__maudePhotoTrace = events;
  const record = (event) => {
    events.push({ at: Date.now(), ...event });
    if (events.length > 200) events.shift();
  };
  const original = window.fetch;
  window.fetch = async function (...args) {
    const url = String(args[0]?.url ?? args[0]);
    if (!url.includes('/_api/photo-edit')) return original.apply(this, args);
    const request = { url, method: args[1]?.method ?? 'GET', body: args[1]?.body };
    record({ event: 'request', ...request });
    try {
      const response = await original.apply(this, args);
      record({ event: 'response', ...request, status: response.status });
      return response;
    } catch (error) {
      record({ event: 'error', ...request, error: String(error) });
      throw error;
    }
  };
  for (const event of ['focus', 'blur', 'input', 'click']) {
    document.addEventListener(
      event,
      (e) => {
        if (!e.target.closest?.('[data-testid="photo-knobs"]')) return;
        record({ event, label: e.target.getAttribute('aria-label'), value: e.target.value });
      },
      true
    );
  }
  return events;
}
