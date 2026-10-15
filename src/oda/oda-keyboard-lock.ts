/**
 * Chromium Keyboard Lock for Oda's Escape-to-go-back.
 *
 * While Oda owns DOM fullscreen, the browser reserves Escape to leave
 * fullscreen: `preventDefault()` on the keydown cannot stop it, so an Escape
 * from Oda Options would just unfullscreen the window instead of navigating
 * back to the waterfall. Locking `Escape` (Chromium-only) routes the key to
 * the page so Oda's normal Back handling owns it.
 *
 * Everything here degrades safely: non-Chromium browsers, denied requests
 * and missing fullscreen all fall back to the browser default. Leaving
 * fullscreen also ends the Oda session.
 */

interface OdaKeyboardApi {
  lock?: (keys: string[]) => Promise<void>;
  unlock?: () => void;
}

function keyboardApi(): OdaKeyboardApi | null {
  if (typeof navigator === 'undefined') return null;
  const api = (navigator as Navigator & { keyboard?: OdaKeyboardApi }).keyboard;
  return api ?? null;
}

/** Request exclusive Escape delivery. Safe no-op unless Oda owns fullscreen. */
export function lockOdaEscapeKey(): void {
  try {
    if (typeof document === 'undefined' || !document.fullscreenElement) return;
    const api = keyboardApi();
    if (!api || typeof api.lock !== 'function') return;
    const result = api.lock(['Escape']);
    if (result && typeof result.catch === 'function') {
      result.catch(() => {
        // Rejected (permissions, non-Chromium): Escape keeps its browser
        // default, so leaving fullscreen also exits Oda.
      });
    }
  } catch {
    // Never let an exotic API break Oda entry.
  }
}

/** Release a lock taken by `lockOdaEscapeKey`. Safe no-op when absent. */
export function unlockOdaEscapeKey(): void {
  try {
    keyboardApi()?.unlock?.();
  } catch {
    // Best effort only.
  }
}
