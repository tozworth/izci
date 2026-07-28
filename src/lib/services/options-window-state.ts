import { DEFAULT_OPTIONS_VIEW, isOptionsViewName, type OptionsViewName } from '../../options/views';

const STORAGE_KEY = 'izci.options-window-state';
const DEFAULT_WIDTH = 680;
const DEFAULT_HEIGHT = 460;
const MIN_WIDTH = 480;
const MIN_HEIGHT = 320;

export interface OptionsWindowState {
  activeView: OptionsViewName;
  width: number;
  height: number;
  showAdvancedTweaks: boolean;
}

const defaultState: OptionsWindowState = {
  activeView: DEFAULT_OPTIONS_VIEW,
  width: DEFAULT_WIDTH,
  height: DEFAULT_HEIGHT,
  showAdvancedTweaks: false
};

function normalizeDimension(value: unknown, fallback: number, minimum: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum
    ? Math.round(value)
    : fallback;
}

function normalizeState(value: unknown): OptionsWindowState {
  if (!value || typeof value !== 'object') {
    return defaultState;
  }

  const candidate = value as Partial<OptionsWindowState>;
  return {
    activeView: isOptionsViewName(candidate.activeView) ? candidate.activeView : DEFAULT_OPTIONS_VIEW,
    width: normalizeDimension(candidate.width, DEFAULT_WIDTH, MIN_WIDTH),
    height: normalizeDimension(candidate.height, DEFAULT_HEIGHT, MIN_HEIGHT),
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

export function rememberOptionsWindowSize(width: number, height: number): void {
  persist({
    ...getOptionsWindowState(),
    width: normalizeDimension(width, DEFAULT_WIDTH, MIN_WIDTH),
    height: normalizeDimension(height, DEFAULT_HEIGHT, MIN_HEIGHT)
  });
}

export function rememberShowAdvancedTweaks(showAdvancedTweaks: boolean): void {
  persist({ ...getOptionsWindowState(), showAdvancedTweaks });
}
