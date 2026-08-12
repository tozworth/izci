import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { CdpConnection } from './protocol-client.mjs';

class FakeSocket extends EventEmitter {
  addEventListener(name, listener) {
    this.on(name, listener);
  }

  send(payload) {
    this.sent = JSON.parse(payload);
  }

  close() {
    this.emit('close');
  }

  receive(message) {
    this.emit('message', { data: JSON.stringify(message) });
  }
}

test('correlates commands and preserves flattened session identity', async () => {
  const socket = new FakeSocket();
  const connection = new CdpConnection(socket, 100);
  const result = connection.send('Page.enable', {}, 'session-a');
  assert.deepEqual(socket.sent, {
    id: 1,
    method: 'Page.enable',
    params: {},
    sessionId: 'session-a'
  });
  socket.receive({ id: 1, result: { enabled: true }, sessionId: 'session-a' });
  assert.deepEqual(await result, { enabled: true });
  connection.close();
});

test('matches events by method and session and times out missing events', async () => {
  const socket = new FakeSocket();
  const connection = new CdpConnection(socket, 30);
  const event = connection.waitFor('Page.loadEventFired', { sessionId: 'session-a' });
  socket.receive({ method: 'Page.loadEventFired', params: { timestamp: 1 }, sessionId: 'session-b' });
  socket.receive({ method: 'Page.loadEventFired', params: { timestamp: 2 }, sessionId: 'session-a' });
  assert.deepEqual(await event, { timestamp: 2 });
  await assert.rejects(connection.waitFor('Never.happens'), /Timed out/);
  connection.close();
});

test('rejects outstanding commands when the socket is lost', async () => {
  const socket = new FakeSocket();
  const connection = new CdpConnection(socket, 100);
  const result = connection.send('Runtime.evaluate');
  const event = connection.waitFor('Page.loadEventFired');
  socket.emit('close');
  await assert.rejects(result, /socket closed/);
  await assert.rejects(event, /socket closed/);
});
