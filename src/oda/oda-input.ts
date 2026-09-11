/**
 * Oda input normalization and key-repeat handling.
 *
 * Remote/keyboard aliases are normalized here so device-specific keys never
 * leak into Oda components. The repeater implements the persisted
 * initial-delay / repeat-interval behavior with injectable timers so it can be
 * tested without a browser.
 */

export type OdaAction =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'ok'
  | 'back'
  | 'play-pause'
  | 'stop'
  | 'previous'
  | 'next';

export type OdaDirection = Extract<OdaAction, 'up' | 'down' | 'left' | 'right'>;

export interface OdaKeyEventLike {
  key: string;
  repeat?: boolean;
}

const REPEATING_ACTIONS: ReadonlySet<OdaAction> = new Set(['up', 'down', 'left', 'right']);

export function isOdaRepeatableAction(action: OdaAction): boolean {
  return REPEATING_ACTIONS.has(action);
}

/** Actions whose activation must ignore key-repeat to avoid double firing. */
export function shouldIgnoreOdaRepeat(action: OdaAction): boolean {
  return !isOdaRepeatableAction(action);
}

/**
 * Text-editing and native form controls own their keys before Oda navigation:
 * Backspace must delete text, arrows must adjust sliders/selects, and so on.
 */
export function isOdaEditableTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tagName = target.tagName;
  return tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT';
}

/** Map a raw keyboard/media/remote key event onto a logical Oda action. */
export function normalizeOdaAction(event: OdaKeyEventLike): OdaAction | null {
  switch (event.key) {
    case 'ArrowUp':
      return 'up';
    case 'ArrowDown':
      return 'down';
    case 'ArrowLeft':
      return 'left';
    case 'ArrowRight':
      return 'right';
    case 'Enter':
    case ' ':
    case 'Spacebar':
    case 'OK':
    case 'Select':
      return 'ok';
    case 'Escape':
    case 'Esc':
    case 'Backspace':
    case 'BrowserBack':
    case 'GoBack':
    case 'Back':
      return 'back';
    case 'MediaPlayPause':
    case 'MediaPlay':
    case 'MediaPause':
    case 'PlayPause':
      return 'play-pause';
    case 'MediaStop':
    case 'Stop':
      return 'stop';
    case 'MediaTrackPrevious':
    case 'MediaPreviousTrack':
    case 'TrackPrevious':
      return 'previous';
    case 'MediaTrackNext':
    case 'MediaNextTrack':
    case 'TrackNext':
      return 'next';
    default:
      return null;
  }
}

interface OdaKeyRepeaterOptions {
  getInitialDelayMs(): number;
  getIntervalMs(): number;
  onRepeat(action: OdaAction): void;
  schedule?(callback: () => void, delayMs: number): number;
  cancel?(handle: number): void;
}

/**
 * Implements press-and-hold repeat for directional actions using the persisted
 * delay/interval instead of the platform's native key repeat.
 */
export function createOdaKeyRepeater({
  getInitialDelayMs,
  getIntervalMs,
  onRepeat,
  schedule = (callback, delayMs) => setTimeout(callback, delayMs) as unknown as number,
  cancel = (handle) => clearTimeout(handle)
}: OdaKeyRepeaterOptions) {
  let handle: number | null = null;
  let activeAction: OdaAction | null = null;

  function clear(): void {
    if (handle !== null) {
      cancel(handle);
      handle = null;
    }
    activeAction = null;
  }

  function scheduleRepeat(action: OdaAction, delayMs: number): void {
    handle = schedule(() => {
      handle = null;
      if (activeAction !== action) return;
      onRepeat(action);
      scheduleRepeat(action, Math.max(1, Math.round(getIntervalMs())));
    }, Math.max(0, Math.round(delayMs)));
  }

  return {
    /**
     * Call on keydown. Returns true when the caller should perform the
     * movement immediately: repeatable action, not an OS repeat event.
     */
    begin(event: OdaKeyEventLike, action: OdaAction): boolean {
      if (!isOdaRepeatableAction(action)) return false;
      if (event.repeat) return false;
      clear();
      activeAction = action;
      scheduleRepeat(action, getInitialDelayMs());
      return true;
    },
    end(): void {
      clear();
    },
    isHolding(): boolean {
      return activeAction !== null;
    }
  };
}

export type OdaKeyRepeater = ReturnType<typeof createOdaKeyRepeater>;
