/**
 * Authenticated server ICE cache. Hosts fetch with their bearer per room,
 * guests with their connection token; results are reused until a minute
 * before TURN expiry (STUN-only and empty configs cache for ten minutes).
 * A fresh attempt therefore renegotiates with valid credentials without an
 * extra round trip per peer, while expiry still refreshes in time.
 */
import { fetchServerIce } from './multiplayer-server-http';
import { createServerRtcConfiguration } from './multiplayer-ice';

interface CachedIce {
  config: RTCConfiguration;
  refreshAt: number;
}

const cache = new Map<string, CachedIce>();
const STALE_CACHE_CAP = 32;

export async function getServerRtcConfig(args: {
  endpoint: string;
  bearer: string;
  roomId: string | null;
  cacheKey: string;
  forceRelay: boolean;
  signal?: AbortSignal;
}): Promise<RTCConfiguration> {
  const cached = cache.get(args.cacheKey);
  if (cached && Date.now() < cached.refreshAt) return cached.config;
  const ice = await fetchServerIce(args.endpoint, args.bearer, args.roomId, args.signal);
  const config = createServerRtcConfiguration(ice.iceServers, { forceRelay: args.forceRelay });
  let refreshAt = Date.now() + 10 * 60 * 1_000;
  if (ice.expiresAt) {
    const expires = Date.parse(ice.expiresAt);
    if (Number.isFinite(expires)) refreshAt = expires - 60 * 1_000;
  }
  cache.set(args.cacheKey, { config, refreshAt });
  while (cache.size > STALE_CACHE_CAP) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return config;
}

export function clearServerIceCache(cacheKey?: string): void {
  if (cacheKey) cache.delete(cacheKey);
  else cache.clear();
}
