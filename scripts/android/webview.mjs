import { device, pause } from './tools.mjs';

export async function withWebView(action) {
  let socket;
  const deadline = Date.now() + 15_000;
  while (!socket && Date.now() < deadline) {
    const pid = device(['shell', 'pidof', 'app.izci.android']).stdout.trim().split(' ')[0];
    const sockets = device(['shell', 'cat', '/proc/net/unix']).stdout;
    socket = sockets.match(new RegExp(`@(webview_devtools_remote_${pid})\\b`))?.[1];
    if (!socket) await pause(250);
  }
  if (!socket) throw new Error('No izci WebView debug socket. Launch the debug APK first.');
  const port = device(['forward', 'tcp:0', `localabstract:${socket}`]).stdout.trim();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`WebView discovery failed: ${response.status}`);
    const targets = await response.json();
    const target = targets.find((item) => item.type === 'page' && item.url.startsWith('https://appassets.androidplatform.net/'));
    if (!target) throw new Error('izci page is not ready in the WebView.');
    return await action(target);
  } finally {
    device(['forward', '--remove', `tcp:${port}`], { allowFailure: true });
  }
}

export function evaluate(target, expression) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    let finished = false;
    const timer = setTimeout(() => finish(new Error('WebView evaluation timed out after 30 seconds.')), 30_000);
    function finish(error, value) {
      if (finished) return;
      finished = true;
      clearTimeout(timer); ws.close(); error ? reject(error) : resolve(value);
    }
    ws.addEventListener('error', () => finish(new Error('WebView debugger connection failed.')));
    ws.addEventListener('close', () => finish(new Error('WebView debugger disconnected.')));
    ws.addEventListener('open', () => ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: {
      expression, awaitPromise: true, returnByValue: true, userGesture: true
    } })));
    ws.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data);
      if (message.id !== 1) return;
      if (message.error) return finish(new Error(message.error.message));
      const { result, exceptionDetails } = message.result;
      if (exceptionDetails) return finish(new Error(exceptionDetails.exception?.description || exceptionDetails.text));
      finish(null, result.value ?? result.unserializableValue ?? result.description);
    });
  });
}
