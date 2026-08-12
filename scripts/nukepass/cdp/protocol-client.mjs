const DEFAULT_COMMAND_TIMEOUT_MS = 15_000;

function eventKey(method, sessionId = '') {
  return `${sessionId}:${method}`;
}

export class CdpConnection {
  #nextId = 1;
  #pending = new Map();
  #listeners = new Map();
  #allListeners = new Set();
  #closeListeners = new Set();
  #closed = false;

  constructor(socket, commandTimeoutMs = DEFAULT_COMMAND_TIMEOUT_MS) {
    this.socket = socket;
    this.commandTimeoutMs = commandTimeoutMs;

    socket.addEventListener('message', (event) => {
      void this.#handleMessage(event.data);
    });
    socket.addEventListener('close', () => this.#handleClose(new Error('CDP socket closed')));
    socket.addEventListener('error', () => this.#handleClose(new Error('CDP socket failed')));
  }

  static async connect(url, options = {}) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Timed out connecting to ${url}`)),
        options.connectTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS);
      socket.addEventListener('open', () => {
        clearTimeout(timeout);
        resolve();
      }, { once: true });
      socket.addEventListener('error', () => {
        clearTimeout(timeout);
        reject(new Error(`Failed to connect to ${url}`));
      }, { once: true });
    });
    return new CdpConnection(socket, options.commandTimeoutMs);
  }

  async #handleMessage(raw) {
    const text = typeof raw === 'string'
      ? raw
      : raw instanceof Blob
        ? await raw.text()
        : Buffer.from(raw).toString('utf8');
    const message = JSON.parse(text);

    if (message.id !== undefined) {
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      this.#pending.delete(message.id);
      clearTimeout(pending.timeout);
      if (message.error) {
        pending.reject(new Error(`${pending.method}: ${message.error.message}`));
      } else {
        pending.resolve(message.result ?? {});
      }
      return;
    }

    if (!message.method) return;
    for (const listener of this.#allListeners) listener(message);
    const listeners = this.#listeners.get(eventKey(message.method, message.sessionId));
    if (listeners) {
      for (const listener of listeners) listener(message.params ?? {}, message);
    }
  }

  #handleClose(error) {
    if (this.#closed) return;
    this.#closed = true;
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.#pending.clear();
    for (const listener of this.#closeListeners) listener(error);
    this.#closeListeners.clear();
  }

  send(method, params = {}, sessionId) {
    if (this.#closed) return Promise.reject(new Error('CDP socket is closed'));
    const id = this.#nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`Timed out waiting for CDP command ${method}`));
      }, this.commandTimeoutMs);
      this.#pending.set(id, { method, resolve, reject, timeout });
      this.socket.send(JSON.stringify(payload));
    });
  }

  on(method, listener, sessionId) {
    const key = eventKey(method, sessionId);
    const listeners = this.#listeners.get(key) ?? new Set();
    listeners.add(listener);
    this.#listeners.set(key, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.#listeners.delete(key);
    };
  }

  onAny(listener) {
    this.#allListeners.add(listener);
    return () => this.#allListeners.delete(listener);
  }

  waitFor(method, options = {}) {
    const timeoutMs = options.timeoutMs ?? this.commandTimeoutMs;
    return new Promise((resolve, reject) => {
      const dispose = this.on(method, (params, message) => {
        if (options.predicate && !options.predicate(params, message)) return;
        clearTimeout(timeout);
        dispose();
        this.#closeListeners.delete(handleClose);
        resolve(params);
      }, options.sessionId);
      const handleClose = (error) => {
        clearTimeout(timeout);
        dispose();
        reject(error);
      };
      this.#closeListeners.add(handleClose);
      const timeout = setTimeout(() => {
        dispose();
        this.#closeListeners.delete(handleClose);
        reject(new Error(`Timed out waiting for CDP event ${method}`));
      }, timeoutMs);
    });
  }

  close() {
    this.#handleClose(new Error('CDP connection closed'));
    this.socket.close();
  }
}
