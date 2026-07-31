import {
  DEFAULT_TROUBADOUR_OPTIONS_VIEW,
  isTroubadourOptionsViewName,
  type TroubadourOptionsViewName
} from './views';

const STORAGE_KEY = 'izci.troubadour-options-window-state';

export interface TroubadourOptionsWindowState {
  activeView: TroubadourOptionsViewName;
  showAdvancedTweaks: boolean;
}

const DEFAULT_STATE: TroubadourOptionsWindowState = {
  activeView: DEFAULT_TROUBADOUR_OPTIONS_VIEW,
  showAdvancedTweaks: false
};

export function getTroubadourOptionsWindowState(): TroubadourOptionsWindowState {
  if (typeof window === 'undefined') return DEFAULT_STATE;
  try {
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null') as Record<string, unknown> | null;
    return {
      activeView: isTroubadourOptionsViewName(stored?.activeView) ? stored.activeView : DEFAULT_STATE.activeView,
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
