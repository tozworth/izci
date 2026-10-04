/** A CDP session that stays connected while a debugging script waits or steps. */
export async function connectCdp(url, { timeoutMs = 30_000, WebSocketImpl = WebSocket } = {}) {
  const socket = new WebSocketImpl(url);
  const pending = new Map();
  const listeners = new Map();
  const waiters = new Set();
  let nextId = 0;
  let closed = false;
  let rejectOpening;
  const stop = (error) => {
    if (closed) return;
    closed = true;
    rejectOpening?.(error);
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(error); }
    pending.clear();
    for (const reject of [...waiters]) reject(error);
    listeners.clear();
  };
  socket.addEventListener('close', () => stop(new Error('WebView debugger disconnected.')));
  socket.addEventListener('error', () => {
    stop(new Error('WebView debugger connection failed.'));
    socket.close();
  });
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.id !== undefined) {
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) request.reject(new Error(`${request.method}: ${message.error.message}`));
      else request.resolve(message.result);
    } else {
      for (const listener of [...(listeners.get(message.method) || [])]) listener(message.params);
    }
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      stop(new Error('WebView debugger connection timed out.'));
      socket.close();
    }, timeoutMs);
    rejectOpening = (error) => { clearTimeout(timer); reject(error); };
    socket.addEventListener('open', () => {
      clearTimeout(timer);
      rejectOpening = null;
      resolve();
    }, { once: true });
  });
  const on = (method, listener) => {
    if (closed) throw new Error('WebView debugger disconnected.');
    if (!listeners.has(method)) listeners.set(method, new Set());
    listeners.get(method).add(listener);
    return () => listeners.get(method)?.delete(listener);
  };
  return {
    send(method, params = {}, options = {}) {
      if (closed) return Promise.reject(new Error('WebView debugger disconnected.'));
      return new Promise((resolve, reject) => {
        const id = ++nextId;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`${method} timed out.`));
        }, options.timeoutMs ?? timeoutMs);
        pending.set(id, { resolve, reject, timer, method });
        try { socket.send(JSON.stringify({ id, method, params })); }
        catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
      });
    },
    on,
    // Register before the command/action that triggers the event to avoid races.
    waitFor(method, { predicate = () => true, timeoutMs: eventTimeout = timeoutMs } = {}) {
      if (closed) return Promise.reject(new Error('WebView debugger disconnected.'));
      return new Promise((resolve, reject) => {
        let off;
        let timer;
        const finish = (error, value) => {
          off?.();
          clearTimeout(timer);
          waiters.delete(cancel);
          error ? reject(error) : resolve(value);
        };
        const cancel = (error) => finish(error);
        off = on(method, (params) => {
          try { if (predicate(params)) finish(null, params); }
          catch (error) { finish(error); }
        });
        waiters.add(cancel);
        timer = setTimeout(() => finish(new Error(`Waiting for ${method} timed out.`)), eventTimeout);
      });
    },
    close() {
      stop(new Error('WebView debugger disconnected.'));
      socket.close();
    }
  };
}
