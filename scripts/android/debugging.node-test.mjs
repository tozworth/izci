import test from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
import { connectCdp } from './cdp.mjs';
import { checkDebugApk } from './debug-build.mjs';

class FakeSocket extends EventTarget {
  static instance;
  sent = [];
  constructor() {
    super();
    FakeSocket.instance = this;
    queueMicrotask(() => this.dispatchEvent(new Event('open')));
  }
  send(message) { this.sent.push(JSON.parse(message)); }
  deliver(message) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) })); }
  close() { this.dispatchEvent(new Event('close')); }
}
const connect = () => connectCdp('ws://test', { WebSocketImpl: FakeSocket, timeoutMs: 100 });

test('CDP correlates concurrent replies while delivering breakpoint events', async () => {
  const cdp = await connect();
  try {
    const socket = FakeSocket.instance;
    const paused = cdp.waitFor('Debugger.paused', { predicate: (event) => event.reason === 'other' });
    const enable = cdp.send('Debugger.enable');
    const source = cdp.send('Debugger.getScriptSource', { scriptId: '42' });
    socket.deliver({ id: 2, result: { scriptSource: 'readable();' } });
    socket.deliver({ method: 'Debugger.paused', params: { reason: 'other', callFrames: [{ callFrameId: 'frame' }] } });
    socket.deliver({ id: 1, result: { debuggerId: 'debugger' } });
    assert.deepEqual(await source, { scriptSource: 'readable();' });
    assert.deepEqual(await enable, { debuggerId: 'debugger' });
    assert.equal((await paused).callFrames[0].callFrameId, 'frame');
  } finally { cdp.close(); }
});

test('disconnect rejects commands and breakpoint waits instead of hanging', async () => {
  const cdp = await connect();
  const command = assert.rejects(cdp.send('Debugger.enable'), /disconnected/);
  const event = assert.rejects(cdp.waitFor('Debugger.paused'), /disconnected/);
  FakeSocket.instance.close();
  await Promise.all([command, event]);
  await assert.rejects(cdp.send('Debugger.resume'), /disconnected/);
});

test('CDP protocol errors and timeouts report the failed operation', async () => {
  const cdp = await connect();
  try {
    const rejected = assert.rejects(cdp.send('Debugger.setBreakpoint'), /Debugger.setBreakpoint: invalid location/);
    FakeSocket.instance.deliver({ id: 1, error: { message: 'invalid location' } });
    await rejected;
    await assert.rejects(cdp.send('Debugger.pause', {}, { timeoutMs: 5 }), /Debugger.pause timed out/);
    await assert.rejects(cdp.waitFor('Debugger.paused', { timeoutMs: 5 }), /Waiting for Debugger.paused timed out/);
  } finally { cdp.close(); }
});

test('event predicates can ignore unrelated pauses and fail cleanly', async () => {
  const cdp = await connect();
  try {
    const matched = cdp.waitFor('Debugger.paused', { predicate: (event) => event.reason === 'breakpoint' });
    FakeSocket.instance.deliver({ method: 'Debugger.paused', params: { reason: 'other' } });
    FakeSocket.instance.deliver({ method: 'Debugger.paused', params: { reason: 'breakpoint' } });
    assert.equal((await matched).reason, 'breakpoint');
    const rejected = assert.rejects(cdp.waitFor('Debugger.paused', { predicate: () => { throw new Error('bad predicate'); } }), /bad predicate/);
    FakeSocket.instance.deliver({ method: 'Debugger.paused', params: {} });
    await rejected;
  } finally { cdp.close(); }
});

test('emulator APK validation rejects stale optimized or mapless web assets', () => {
  const makeApk = (metadata) => zipSync({ 'assets/web/android-debug.json': strToU8(JSON.stringify(metadata)) });
  const debug = { development: true, minified: false, sourcemaps: true };
  assert.deepEqual(checkDebugApk(makeApk(debug)), debug);
  for (const metadata of [{ ...debug, minified: true }, { ...debug, development: false }, { ...debug, sourcemaps: false }]) {
    assert.throws(() => checkDebugApk(makeApk(metadata)), /Run npm run android:build/);
  }
  assert.throws(() => checkDebugApk(zipSync({ 'assets/web/index.html': strToU8('old build') })), /Run npm run android:build/);
});
