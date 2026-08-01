import type {
  TroubadourDockRegionId,
  TroubadourDockZoneId
} from '$lib/stores/troubadour-workspace';

export interface TroubadourDockGuide {
  id: TroubadourDockRegionId;
  icon: string;
  label: string;
  split: 'horizontal' | 'vertical';
  zones: readonly [TroubadourDockZoneId, TroubadourDockZoneId];
  zoneLabels: readonly [string, string];
}
