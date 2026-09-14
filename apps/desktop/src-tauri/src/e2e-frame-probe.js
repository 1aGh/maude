// Loaded ONLY by an explicitly opted-in debug build. The probe reads the
// canvas's own DOM and drives bounded DOM gestures across postMessage; it never disables
// same-origin enforcement or gives the canvas access to Tauri commands.
(() => {
  const protocol = 'maude-e2e-frame-probe-v1';
  const loopback = (url) => {
    try {
      const host = new URL(url).hostname;
      return ['localhost', '127.0.0.1', '[::1]'].includes(host) || host.endsWith('.localhost');
    } catch {
      return false;
    }
  };
  if (!['http:', 'https:'].includes(location.protocol) || !loopback(location.href)) return;
  if (window === window.top) {
    const pending = new Map();
    let sequence = 0;
    window.addEventListener('message', (event) => {
      const data = event.data;
      if (data?.protocol !== protocol || data.kind !== 'response') return;
      const request = pending.get(data.id);
      if (!request || event.source !== request.source || event.origin !== request.origin) return;
      clearTimeout(request.timer);
      pending.delete(data.id);
      request.resolve(data.result);
    });
    Object.defineProperty(window, '__maudeE2EFrameProbe', {
      value: (selector, operation = 'read', value = null) =>
        new Promise((resolve) => {
          const frame = document.querySelector('[data-testid="canvas-frame"]');
          if (!frame?.contentWindow || !frame.src || !loopback(frame.src))
            return resolve({ error: 'Active canvas frame unavailable', visible: false });
          const blocker = document.querySelector(
            '[data-testid="canvas-load-error"], .st-canvas-loading'
          );
          if (blocker && blocker.getBoundingClientRect().height > 0)
            return resolve({
              error: 'Canvas obscured by shell loading/error overlay',
              visible: false,
            });
          if (frame.getBoundingClientRect().height === 0)
            return resolve({ error: 'Active canvas frame hidden', visible: false });
          const id = ++sequence;
          const origin = new URL(frame.src).origin;
          const timer = setTimeout(() => {
            pending.delete(id);
            resolve({ error: 'Active canvas probe response timed out', visible: false });
          }, 1000);
          pending.set(id, { resolve, timer, source: frame.contentWindow, origin });
          frame.contentWindow.postMessage(
            { protocol, kind: 'request', id, selector, operation, value },
            origin
          );
        }),
    });
    return;
  }
  window.addEventListener('message', async (event) => {
    const data = event.data;
    if (
      event.source !== window.parent ||
      !loopback(event.origin) ||
      data?.protocol !== protocol ||
      data.kind !== 'request'
    )
      return;
    if (typeof data.selector !== 'string' || data.selector.length > 512) return;
    let result = null;
    try {
      const element = document.querySelector(data.selector);
      if (element) {
        // Synthetic DOM input is the native harness convention. These actions
        // enter the same UI handlers as WebDriver input; no store/API mutation,
        // arbitrary JavaScript evaluation or production instrumentation exists.
        const argument = data.value;
        const tick = () => new Promise((resolve) => setTimeout(resolve, 25));
        if (data.operation === 'dropFile') {
          if (
            typeof argument?.base64 !== 'string' ||
            argument.base64.length > 2_800_000 ||
            !/^[\w.-]{1,128}$/.test(argument.name ?? '') ||
            !['image/png', 'image/jpeg', 'image/svg+xml', 'video/mp4', 'video/webm'].includes(
              argument.type
            )
          )
            throw new Error('Unsupported test file payload');
          const binary = atob(argument.base64);
          const transfer = new DataTransfer();
          transfer.items.add(
            new File([Uint8Array.from(binary, (c) => c.charCodeAt(0))], argument.name, {
              type: argument.type,
            })
          );
          const box = element.getBoundingClientRect();
          for (const type of ['dragover', 'drop']) {
            element.dispatchEvent(
              new DragEvent(type, {
                bubbles: true,
                cancelable: true,
                dataTransfer: transfer,
                clientX: box.left + box.width * 0.5,
                clientY: box.top + box.height * 0.5,
              })
            );
          }
          await tick();
        }
        if (data.operation === 'click') element.click();
        if (data.operation === 'key' && typeof argument?.key === 'string') {
          element.dispatchEvent(
            new KeyboardEvent('keydown', {
              key: argument.key,
              bubbles: true,
              cancelable: true,
              shiftKey: argument.shift === true,
              metaKey: argument.meta === true,
            })
          );
        }
        if (
          data.operation === 'editText' &&
          typeof argument === 'string' &&
          element.isContentEditable
        ) {
          element.focus();
          const selection = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(element);
          selection.removeAllRanges();
          selection.addRange(range);
          document.execCommand('insertText', false, argument);
        }
        if (['pointer', 'doubleClick'].includes(data.operation)) {
          const box = element.getBoundingClientRect();
          const x = box.left + box.width * (Number.isFinite(argument?.x) ? argument.x : 0.5);
          const y = box.top + box.height * (Number.isFinite(argument?.y) ? argument.y : 0.5);
          const dx = Number.isFinite(argument?.dx) ? argument.dx : 0;
          const dy = Number.isFinite(argument?.dy) ? argument.dy : 0;
          const dispatch = (type, px, py, buttons, detail = 1) => {
            const options = {
              bubbles: true,
              cancelable: true,
              view: window,
              clientX: px,
              clientY: py,
              button: 0,
              buttons,
              detail,
              pointerId: 1,
              pointerType: 'mouse',
              isPrimary: true,
            };
            element.dispatchEvent(
              type.startsWith('pointer')
                ? new PointerEvent(type, options)
                : new MouseEvent(type, options)
            );
          };
          dispatch('pointerdown', x, y, 1);
          dispatch('mousedown', x, y, 1);
          await tick();
          if (dx || dy) {
            for (let step = 1; step <= 5; step++) {
              dispatch('pointermove', x + (dx * step) / 5, y + (dy * step) / 5, 1);
              await tick();
            }
          }
          dispatch('pointerup', x + dx, y + dy, 0);
          dispatch('mouseup', x + dx, y + dy, 0);
          if (!dx && !dy) dispatch('click', x, y, 0);
          if (data.operation === 'doubleClick') {
            dispatch('mousedown', x, y, 1, 2);
            dispatch('mouseup', x, y, 0, 2);
            dispatch('click', x, y, 0, 2);
            dispatch('dblclick', x, y, 0, 2);
          }
          await tick();
        }
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        result = {
          text: element.textContent,
          visible:
            rect.width > 0 &&
            rect.height > 0 &&
            style.visibility !== 'hidden' &&
            style.display !== 'none',
          rect: rect.toJSON(),
          matches: Array.from(document.querySelectorAll(data.selector))
            .slice(0, 1000)
            .map((node) => ({
              id: node.getAttribute('data-id'),
              tool: node.getAttribute('data-tool'),
            })),
        };
        if (element instanceof HTMLVideoElement) {
          // Playback/seek affect this test viewer only, never shared project state.
          if (data.operation === 'play') {
            element.muted = true;
            await element.play();
          }
          if (data.operation === 'pause') element.pause();
          if (data.operation === 'seek' && Number.isFinite(data.value))
            element.currentTime = data.value;
          Object.assign(result, {
            width: element.videoWidth,
            height: element.videoHeight,
            time: element.currentTime,
            duration: element.duration,
            readyState: element.readyState,
            paused: element.paused,
            seeking: element.seeking,
            mediaError: element.error?.code ?? null,
          });
        }
        if (element instanceof HTMLImageElement)
          Object.assign(result, {
            width: element.naturalWidth,
            height: element.naturalHeight,
            complete: element.complete,
          });
        let decodedSvgImage = null;
        if (element instanceof SVGImageElement) {
          result.href = element.href.baseVal;
          if (result.href && !result.href.startsWith('blob:')) {
            decodedSvgImage = new Image();
            decodedSvgImage.src = element.href.baseVal;
            await decodedSvgImage.decode();
            Object.assign(result, {
              width: decodedSvgImage.naturalWidth,
              height: decodedSvgImage.naturalHeight,
              complete: true,
              decodeSource: 'visible SVG image href decoded in this canvas origin',
            });
          }
        }
        if (
          decodedSvgImage ||
          (element instanceof HTMLImageElement && element.complete && element.naturalWidth) ||
          (element instanceof HTMLVideoElement && element.readyState >= 2)
        ) {
          const canvas = document.createElement('canvas');
          const raster = decodedSvgImage ?? element;
          canvas.width = raster instanceof HTMLImageElement ? raster.naturalWidth : 1;
          canvas.height = raster instanceof HTMLImageElement ? raster.naturalHeight : 1;
          const ctx = canvas.getContext('2d');
          try {
            ctx.drawImage(raster, 0, 0, canvas.width, canvas.height);
            result.pixel = Array.from(ctx.getImageData(0, 0, 1, 1).data);
          } catch (error) {
            result.pixelError = String(error);
          }
        }
      }
    } catch (error) {
      result = { error: String(error) };
    }
    event.source.postMessage({ protocol, kind: 'response', id: data.id, result }, event.origin);
  });
})();
