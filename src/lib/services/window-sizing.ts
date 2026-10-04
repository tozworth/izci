import { applyWindowBounds, readWindowGeometry } from '$platform';
import type { WindowBounds, WindowGeometry } from './window-geometry';

// Video and Now Playing share one native window. Serialize their async native
// operations so a rapid enter/exit cannot restore before growth finishes.
let pending = Promise.resolve();

export function createTemporaryWindowSizer(
  resolveBounds: (geometry: WindowGeometry) => WindowBounds | null
) {
  let restoreBounds: WindowBounds | null = null;
  let revision = 0;

  function enqueue(action: (current: number) => Promise<void>): Promise<void> {
    const current = ++revision;
    pending = pending.then(() => action(current)).catch((error) => {
      console.error('Could not resize the player window.', error);
    });
    return pending;
  }

  return {
    ensure(): Promise<void> {
      return enqueue(async (current) => {
        if (current !== revision) return;
        const geometry = await readWindowGeometry();
        if (!geometry || current !== revision) return;
        const bounds = resolveBounds(geometry);
        if (!bounds) return;
        restoreBounds ??= {
          left: Math.round(geometry.screenX), top: Math.round(geometry.screenY),
          width: Math.round(geometry.outerWidth), height: Math.round(geometry.outerHeight)
        };
        await applyWindowBounds(bounds);
      });
    },
    restore(): Promise<void> {
      return enqueue(async (current) => {
        if (!restoreBounds || current !== revision) return;
        await applyWindowBounds(restoreBounds);
        restoreBounds = null;
      });
    }
  };
}
