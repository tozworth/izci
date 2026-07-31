import {
  DEFAULT_TROUBADOUR_OPTIONS_VIEW,
  isTroubadourOptionsViewName,
  type TroubadourOptionsViewName
} from './views';

const STORAGE_KEY = 'izci.troubadour-options-window-state';
const DEFAULT_WIDTH = 760;
const DEFAULT_HEIGHT = 560;

export interface TroubadourOptionsWindowState {
  activeView: TroubadourOptionsViewName;
  width: number;
  height: number;
  showAdvancedTweaks: boolean;
}

const DEFAULT_STATE: TroubadourOptionsWindowState = {
  activeView: DEFAULT_TROUBADOUR_OPTIONS_VIEW,
  width: DEFAULT_WIDTH,
  height: DEFAULT_HEIGHT,
  showAdvancedTweaks: false
};

function dimension(value: unknown, fallback: number, minimum: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum
    ? Math.round(value)
    : fallback;
}

export function getTroubadourOptionsWindowState(): TroubadourOptionsWindowState {
  if (typeof window === 'undefined') return DEFAULT_STATE;
  try {
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null') as Record<string, unknown> | null;
    return {
      activeView: isTroubadourOptionsViewName(stored?.activeView) ? stored.activeView : DEFAULT_STATE.activeView,
      width: dimension(stored?.width, DEFAULT_WIDTH, 480),
      height: dimension(stored?.height, DEFAULT_HEIGHT, 320),
      showAdvancedTweaks: stored?.showAdvancedTweaks === true
    };
  } catch {
    return DEFAULT_STATE;
  }
}

function persist(patch: Partial<TroubadourOptionsWindowState>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...getTroubadourOptionsWindowState(), ...patch }));
  } catch {
    // Options remain usable when lightweight window-state persistence is unavailable.
  }
}

export function rememberTroubadourOptionsActiveView(activeView: TroubadourOptionsViewName): void {
  persist({ activeView });
}

export function rememberTroubadourOptionsAdvancedVisibility(showAdvancedTweaks: boolean): void {
  persist({ showAdvancedTweaks });
}

export function rememberTroubadourOptionsWindowSize(width: number, height: number): void {
  persist({ width: dimension(width, DEFAULT_WIDTH, 480), height: dimension(height, DEFAULT_HEIGHT, 320) });
}
