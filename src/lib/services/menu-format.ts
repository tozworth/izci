import type { MultiplayerAudioStatus, MultiplayerConnectionStats, MultiplayerConnectionStatus } from '$lib/services/multiplayer-types';
import type { MultiplayerConnectionRoute } from '$lib/services/multiplayer-ice';

export type MenuTranslation = (id: string | { id: string; locale?: string; format?: string; default?: string; values?: Record<string, string | number | boolean | Date | null | undefined> }, options?: { locale?: string; format?: string; default?: string; values?: Record<string, string | number | boolean | Date | null | undefined> }) => string;

function formatRouteLabel(route: MultiplayerConnectionRoute | null, t: MenuTranslation): string | null {
  return route === 'direct'
    ? t('main.multiplayer.route.direct', { default: 'Direct' })
    : route === 'relayed'
      ? t('main.multiplayer.route.relayed', { default: 'Relayed' })
      : null;
}

export function formatMultiplayerAudioStatusLabel(
  status: MultiplayerAudioStatus,
  route: MultiplayerConnectionRoute | null,
  bitrateKbps: number | null,
  t: MenuTranslation
): string {
  const stateLabel = status === 'playing'
    ? t('main.multiplayer.audio.listening', { default: 'Listening' })
    : status === 'ready'
      ? t('main.multiplayer.audio.ready', { default: 'Audio ready' })
    : status === 'blocked'
      ? t('main.multiplayer.audio.blocked', { default: 'Audio needs permission' })
      : status === 'refused'
        ? t('main.multiplayer.audio.refused', { default: 'Audio refused' })
      : status === 'disabled'
        ? t('main.multiplayer.audio.disabled', { default: 'Host audio is off' })
        : status === 'unavailable'
            ? t('main.multiplayer.audio.unavailable', { default: 'Audio unavailable' })
            : t('main.multiplayer.audio.connecting', { default: 'Audio connecting...' });
  const routeLabel = formatRouteLabel(route, t);
  return [stateLabel, routeLabel, status === 'playing' && bitrateKbps !== null ? `${bitrateKbps} kbps` : null]
    .filter(Boolean)
    .join(' · ');
}

export function formatConnectionStat(connectionStatus: MultiplayerConnectionStatus, route: MultiplayerConnectionRoute | null, t: MenuTranslation): string {
  const routeLabel = formatRouteLabel(route, t);
  return [connectionStatus, routeLabel].filter(Boolean).join(' · ') || '—';
}

export function formatAudioStat(receiveAudio: boolean, stats: MultiplayerConnectionStats | null, bitrateKbps: number | null, t: MenuTranslation): string {
  if (!receiveAudio) return t('main.multiplayer.audio.refused', { default: 'Refused' });
  return [
    stats?.codec,
    bitrateKbps === null ? null : `${bitrateKbps} kbps`
  ].filter(Boolean).join(' · ') || '—';
}

export function formatPacketLoss(lost?: number, received?: number, percent?: number | null): string {
  if (lost === undefined || received === undefined) return '—';
  return `${lost} / ${received + lost}${percent === null || percent === undefined ? '' : ` · ${percent}%`}`;
}

export function formatBytes(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let scaled = value;
  let unit = 0;
  while (scaled >= 1000 && unit < units.length - 1) {
    scaled /= 1000;
    unit += 1;
  }
  return `${scaled >= 100 || unit === 0 ? Math.round(scaled) : Math.round(scaled * 10) / 10} ${units[unit]}`;
}

export function formatTimingStat(stats: MultiplayerConnectionStats | null): string {
  const jitter = stats?.jitterMs;
  const rtt = stats?.roundTripTimeMs;
  return `${jitter === null || jitter === undefined ? '—' : `${jitter} ms`} · ${rtt === null || rtt === undefined ? '—' : `${rtt} ms`}`;
}
