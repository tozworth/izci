import { DEFAULT_OPTIONS_VIEW, isOptionsViewName, type OptionsViewName } from '../../options/views';

const STORAGE_KEY = 'izci.options-window-state';

export interface OptionsWindowState {
  activeView: OptionsViewName;
  showAdvancedTweaks: boolean;
}

const defaultState: OptionsWindowState = {
  activeView: DEFAULT_OPTIONS_VIEW,
  showAdvancedTweaks: false
};

function normalizeState(value: unknown): OptionsWindowState {
  if (!value || typeof value !== 'object') {
    return defaultState;
  }

  const candidate = value as Partial<OptionsWindowState>;
  return {
    activeView: isOptionsViewName(candidate.activeView) ? candidate.activeView : DEFAULT_OPTIONS_VIEW,
    showAdvancedTweaks: candidate.showAdvancedTweaks === true
  };
}

export function getOptionsWindowState(): OptionsWindowState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? normalizeState(JSON.parse(raw)) : defaultState;
  } catch {
    return defaultState;
  }
}

function persist(state: OptionsWindowState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Options remain usable when local storage is unavailable.
  }
}

export function rememberOptionsActiveView(activeView: OptionsViewName): void {
  persist({ ...getOptionsWindowState(), activeView });
}

export function rememberShowAdvancedTweaks(showAdvancedTweaks: boolean): void {
  persist({ ...getOptionsWindowState(), showAdvancedTweaks });
}
