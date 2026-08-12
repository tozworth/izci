import { ChiptuneJsPlayer, type Chiptune3Config } from 'chiptune3';
import { logError, logInfo } from '$lib/logging/api';

const PLAYER_INIT_TIMEOUT_MS = 10_000;
export async function createChiptunePlayer(config: Chiptune3Config): Promise<ChiptuneJsPlayer> {
  const player = new ChiptuneJsPlayer(config);

  return new Promise<ChiptuneJsPlayer>((resolve, reject) => {
    let settled = false;
    const timeoutId = window.setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      logError('decode', 'Chiptune AudioWorklet initialization timed out', { timeoutMs: PLAYER_INIT_TIMEOUT_MS });
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
      logError('decode', 'Chiptune player failed to initialize', { type: error.type });
      reject(new Error(`Chiptune3 failed to initialize: ${error.type}`));
    });
  });
}
