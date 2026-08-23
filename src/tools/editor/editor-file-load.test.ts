import { describe, expect, it } from 'vitest';
import { createEditorFileLoadCoordinator } from './editor-file-load';

describe('editor file-load coordination', () => {
  it('aborts and invalidates a superseded load', () => {
    const coordinator = createEditorFileLoadCoordinator();
    const first = coordinator.begin();
    const second = coordinator.begin();

    expect(first.signal.aborted).toBe(true);
    expect(first.isCurrent()).toBe(false);
    expect(second.signal.aborted).toBe(false);
    expect(second.isCurrent()).toBe(true);
  });

  it('does not let an older load finish the current load', () => {
    const coordinator = createEditorFileLoadCoordinator();
    const first = coordinator.begin();
    const second = coordinator.begin();

    first.finish();
    expect(second.isCurrent()).toBe(true);

    second.finish();
    expect(second.isCurrent()).toBe(false);
  });

  it('aborts and invalidates the current load on cancellation', () => {
    const coordinator = createEditorFileLoadCoordinator();
    const load = coordinator.begin();

    coordinator.cancel();

    expect(load.signal.aborted).toBe(true);
    expect(load.isCurrent()).toBe(false);
  });
});
