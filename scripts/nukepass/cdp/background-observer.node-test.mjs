import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  enableBackgroundObservation,
  isOwnedBackgroundTarget
} from './background-observer.mjs';

function target() {
  return { console: [], runtimeExceptions: [], log: [], setupFailure: null };
}

describe('CDP background observation', () => {
  it('filters to owned service-worker, worker, shared-worker, and worklet targets', () => {
    const baseUrl = 'http://127.0.0.1:4000/';
    assert.equal(isOwnedBackgroundTarget({ type: 'service_worker', url: `${baseUrl}sw.js` }, baseUrl), true);
    assert.equal(isOwnedBackgroundTarget({ type: 'worker', url: `blob:${baseUrl}id` }, baseUrl), true);
    assert.equal(isOwnedBackgroundTarget({ type: 'page', url: baseUrl }, baseUrl), false);
    assert.equal(isOwnedBackgroundTarget({ type: 'worker', url: 'chrome-extension://id/worker.js' }, baseUrl), false);
  });

  it('installs listeners and enables domains before resuming a paused target', async () => {
    const operations = [];
    const connection = {
      on(method) {
        operations.push(`on:${method}`);
      },
      async send(method) {
        operations.push(`send:${method}`);
      }
    };
    await enableBackgroundObservation({
      connection,
      event: { sessionId: 'background-session' },
      target: target(),
      serializeArgument: (argument) => argument
    });

    const resumedAt = operations.indexOf('send:Runtime.runIfWaitingForDebugger');
    assert.ok(resumedAt > operations.indexOf('on:Runtime.consoleAPICalled'));
    assert.ok(resumedAt > operations.indexOf('on:Runtime.exceptionThrown'));
    assert.ok(resumedAt > operations.indexOf('on:Log.entryAdded'));
    assert.ok(resumedAt > operations.indexOf('send:Runtime.enable'));
    assert.ok(resumedAt > operations.indexOf('send:Log.enable'));
  });

  it('records setup failure but still releases a paused target', async () => {
    const operations = [];
    const observedTarget = target();
    const connection = {
      on() {},
      async send(method) {
        operations.push(method);
        if (method === 'Runtime.enable') throw new Error('domain unavailable');
      }
    };
    await enableBackgroundObservation({
      connection,
      event: { sessionId: 'background-session' },
      target: observedTarget,
      serializeArgument: (argument) => argument
    });

    assert.equal(observedTarget.setupFailure, 'domain unavailable');
    assert.equal(operations.at(-1), 'Runtime.runIfWaitingForDebugger');
  });
});
