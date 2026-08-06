import { ChiptuneJsPlayer, type Chiptune3Config } from 'chiptune3';
import { logError, logInfo, logWarning } from '$lib/services/logging';

const PLAYER_INIT_TIMEOUT_MS = 10_000;
export async function createChiptunePlayer(config: Chiptune3Config): Promise<ChiptuneJsPlayer> {
  const hasAudioContext =
    typeof window === 'undefined' ||
    typeof window.AudioContext === 'function' ||
    typeof (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ===
      'function';
  if (config.context !== false && !hasAudioContext) {
    logWarning('decode', 'AudioContext unavailable — chiptune playback will not work');
  }

  const player = new ChiptuneJsPlayer(config);

  return new Promise<ChiptuneJsPlayer>((resolve, reject) => {
    let settled = false;
    const timeoutId = window.setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      logError('decode', 'Chiptune3 AudioWorklet did not initialize', {
        error: `Timed out after ${PLAYER_INIT_TIMEOUT_MS}ms`
      });
      reject(new Error('Chiptune3 AudioWorklet did not initialize.'));
    }, PLAYER_INIT_TIMEOUT_MS);

    player.onInitialized(() => {
      if (settled) {
        return;
      }

      settled = true;
      window.clearTimeout(timeoutId);
      logInfo('decode', 'Chiptune player initialized');
      resolve(player);
    });

    player.onError((error) => {
      if (settled) {
        return;
      }

      settled = true;
      window.clearTimeout(timeoutId);
      logError('decode', 'Chiptune3 failed to initialize', { error: String(error.type) });
      reject(new Error(`Chiptune3 failed to initialize: ${error.type}`));
    });
  });
}
