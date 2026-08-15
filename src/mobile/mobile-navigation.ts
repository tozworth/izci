import type { WorkspaceTab } from '$lib/types';
import type { SwipeDirection } from './tab-swipe';

export type MobileDestination = 'queue' | 'library' | 'now-playing' | 'lyrics' | 'details';

export const MOBILE_DESTINATIONS: MobileDestination[] = [
  'queue',
  'library',
  'now-playing',
  'lyrics',
  'details'
];

export function getMobileDestination(
  activeTab: WorkspaceTab,
  nowPlayingActive: boolean
): MobileDestination {
  if (nowPlayingActive) return 'now-playing';
  if (activeTab === 'queue' || activeTab === 'library' || activeTab === 'lyrics' || activeTab === 'details') {
    return activeTab;
  }
  return 'details';
}

export function resolveMobileSwipeDestination(
  current: MobileDestination,
  direction: SwipeDirection
): MobileDestination | null {
  const currentIndex = MOBILE_DESTINATIONS.indexOf(current);
  return MOBILE_DESTINATIONS[currentIndex + direction] ?? null;
}
