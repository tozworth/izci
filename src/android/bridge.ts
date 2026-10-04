interface AndroidMessageBridge {
  postMessage(message: string): void;
  onmessage: ((event: { data: string }) => void) | null;
}

const pending = new Map<string, { resolve(value: unknown): void; reject(reason: unknown): void; timeout: ReturnType<typeof setTimeout> }>();
let initialized = false;

export function invokeAndroid<T>(method: string, args: Record<string, unknown> = {}): Promise<T> {
  const bridge = (window as Window & { izciSaf?: AndroidMessageBridge }).izciSaf;
  if (!bridge) return Promise.reject(new Error('The Android file bridge is unavailable. Update Android System WebView.'));
  if (!initialized) {
    initialized = true;
    bridge.onmessage = (event) => {
      const response = JSON.parse(event.data) as { id: string; result?: unknown; error?: { name: string; message: string } };
      const request = pending.get(response.id);
      if (!request) return;
      pending.delete(response.id);
      clearTimeout(request.timeout);
      if (response.error) request.reject(new DOMException(response.error.message, response.error.name));
      else request.resolve(response.result);
    };
  }
  return new Promise<T>((resolve, reject) => {
    const id = crypto.randomUUID();
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new DOMException('Android file operation timed out. Please try again.', 'TimeoutError'));
    }, method.startsWith('pick') || method === 'requestFolderPermission' ? 10 * 60_000 : 120_000);
    pending.set(id, { resolve: (value) => resolve(value as T), reject, timeout });
    try { bridge.postMessage(JSON.stringify({ id, method, args })); }
    catch (error) { clearTimeout(timeout); pending.delete(id); reject(error); }
  });
}
