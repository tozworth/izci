/**
 * Oda logical focus controller.
 *
 * Owns the current focus ID, the active route's navigation model, the
 * normalized key-repeat loop, and the Back tap/hold distinction. The
 * composition root routes active-Oda keydown/keyup here before desktop
 * shortcuts so unmodified arrow keys never seek.
 */

import type { OdaHoldBackAction } from '$lib/types';
import {
  createOdaKeyRepeater,
  isOdaEditableTarget,
  isOdaRepeatableAction,
  normalizeOdaAction,
  type OdaAction,
  type OdaDirection
} from './oda-input';
import type { OdaFocusModel } from './oda-navigation';

export type OdaTransportAction = Extract<OdaAction, 'play-pause' | 'stop' | 'previous' | 'next'>;

export interface OdaFocusHandlers {
  onActivate(focusId: string | null): void;
  onBack(): void;
  onHoldBack(): void;
  onTransport(action: OdaTransportAction): void;
}

interface CreateOdaFocusControllerOptions {
  getWrap(): boolean;
  getRepeatInitialDelayMs(): number;
  getRepeatIntervalMs(): number;
  getHoldBack(): { action: OdaHoldBackAction; thresholdMs: number };
  onFocusChange(focusId: string | null): void;
  schedule?(callback: () => void, delayMs: number): number;
  cancel?(handle: number): void;
}

function isTransportAction(action: OdaAction): action is OdaTransportAction {
  return action === 'play-pause' || action === 'stop' || action === 'previous' || action === 'next';
}

export function createOdaFocusController({
  getWrap,
  getRepeatInitialDelayMs,
  getRepeatIntervalMs,
  getHoldBack,
  onFocusChange,
  schedule = (callback, delayMs) => setTimeout(callback, delayMs) as unknown as number,
  cancel = (handle) => clearTimeout(handle)
}: CreateOdaFocusControllerOptions) {
  let model: OdaFocusModel | null = null;
  let focusId: string | null = null;
  let handlers: OdaFocusHandlers | null = null;
  let holdTimer: number | null = null;
  let holdFired = false;

  const repeater = createOdaKeyRepeater({
    getInitialDelayMs: getRepeatInitialDelayMs,
    getIntervalMs: getRepeatIntervalMs,
    onRepeat: (action) => move(action as OdaDirection)
  });

  function setFocus(next: string | null): void {
    if (focusId === next) return;
    focusId = next;
    onFocusChange(next);
  }

  function move(direction: OdaDirection): void {
    if (!model) return;
    const next = model.resolveMove(focusId, direction, getWrap());
    setFocus(next);
  }

  function clearHold(): void {
    if (holdTimer !== null) {
      cancel(holdTimer);
      holdTimer = null;
    }
  }

  function startBackHold(): void {
    clearHold();
    holdFired = false;
    const holdBack = getHoldBack();
    holdTimer = schedule(() => {
      holdTimer = null;
      if (holdBack.action !== 'return-home') return;
      holdFired = true;
      handlers?.onHoldBack();
    }, Math.max(0, Math.round(holdBack.thresholdMs)));
  }

  return {
    setModel(next: OdaFocusModel | null): void {
      model = next;
    },
    setHandlers(next: OdaFocusHandlers | null): void {
      handlers = next;
    },
    setFocus,
    getFocus(): string | null {
      return focusId;
    },
    move,
    /** Returns true when the event was consumed as Oda navigation. */
    handleKeydown(event: KeyboardEvent): boolean {
      const action = normalizeOdaAction(event);
      if (!action) return false;

      // Native controls own their keys, but Back and the media transport keys
      // must still reach Oda while a slider/select/toggle has DOM focus.
      if (isOdaEditableTarget(event.target) && action !== 'back' && !isTransportAction(action)) {
        return false;
      }

      if (isOdaRepeatableAction(action)) {
        if (!model) return false;
        const performNow = repeater.begin(event, action);
        if (performNow) move(action as OdaDirection);
        return true;
      }

      repeater.end();

      if (event.repeat) {
        // Activation and Back ignore key-repeat to prevent duplicate firing.
        return true;
      }

      if (action === 'ok') {
        // No model means a route with native controls (e.g. Options content).
        if (!model) return false;
        handlers?.onActivate(focusId);
        return true;
      }
      if (action === 'back') {
        startBackHold();
        return true;
      }
      if (isTransportAction(action)) {
        handlers?.onTransport(action);
        return true;
      }
      return false;
    },
    handleKeyup(event: KeyboardEvent): void {
      const action = normalizeOdaAction(event);
      if (!action) return;

      if (isOdaRepeatableAction(action)) {
        repeater.end();
        return;
      }

      if (action === 'back') {
        clearHold();
        if (holdFired) {
          holdFired = false;
          return;
        }
        handlers?.onBack();
      }
    },
    endRepeat(): void {
      repeater.end();
      clearHold();
    }
  };
}

export type OdaFocusController = ReturnType<typeof createOdaFocusController>;
