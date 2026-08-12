import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assertScenarioEntrypoints } from './catalog.mjs';

function build(...paths) {
  return { files: paths.map((path) => ({ path })) };
}

const catalog = {
  scenarios: [
    { id: 'main', path: '/', ready: 'main-hydrated' },
    { id: 'options', path: '/options.html', ready: 'options-mounted' }
  ]
};

describe('CDP scenario catalog', () => {
  it('accepts an exact entrypoint set regardless of order or non-HTML assets', () => {
    assert.doesNotThrow(() => assertScenarioEntrypoints(
      catalog,
      build('options.html', 'assets/main.js', 'index.html')
    ));
  });

  it('rejects missing, extra, and duplicate entrypoint paths', () => {
    assert.throws(
      () => assertScenarioEntrypoints(catalog, build('index.html')),
      /entrypoint mismatch/
    );
    assert.throws(
      () => assertScenarioEntrypoints(catalog, build('index.html', 'options.html', 'extra.html')),
      /entrypoint mismatch/
    );
    assert.throws(
      () => assertScenarioEntrypoints({
        scenarios: [...catalog.scenarios, { id: 'duplicate', path: '/', ready: 'duplicate' }]
      }, build('index.html', 'options.html')),
      /duplicate entrypoint paths/
    );
  });
});
