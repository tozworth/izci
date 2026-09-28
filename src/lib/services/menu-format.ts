import type { MultiplayerDeliveryMode } from './multiplayer-protocol';
import type { MultiplayerAudioStatus, MultiplayerConnectionStatus } from '$lib/services/multiplayer-types';
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

export function formatAudioStat(receiveAudio: boolean, delivery: MultiplayerDeliveryMode, bitrateKbps: number | null, t: MenuTranslation): string {
  if (!receiveAudio) return t('main.multiplayer.audio.refused', { default: 'Refused' });
  if (delivery === 'source-file') return t('main.multiplayer.audio.sourceFile', { default: 'Source file' });
  if (delivery === 'render') {
    const label = t('main.multiplayer.audio.bufferedOpus', { default: 'Buffered Opus' });
    return bitrateKbps === null ? label : `${label} · ${bitrateKbps} kbps`;
  }
  return t('main.multiplayer.audio.disabled', { default: 'Host audio is off' });
}
