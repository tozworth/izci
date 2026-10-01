export const BUBBLE_STATE_EVENT = 'izci:desktop-tray-bubble-state';
export const BUBBLE_READY_EVENT = 'izci:desktop-tray-bubble-ready';
export const BUBBLE_REQUEST_EVENT = 'izci:desktop-tray-bubble-request';
export const BUBBLE_DISMISS_EVENT = 'izci:desktop-tray-bubble-dismiss';
export const BUBBLE_DURATION_MS = 5000;
export const BUBBLE_FADE_MS = 140;

export interface TrackBubble { id: string; title: string; artist: string }
export interface TrackBubbleUpdate { track: TrackBubble | null; announce: boolean }
