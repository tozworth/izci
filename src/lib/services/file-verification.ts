import { createChiptunePlayer } from '$lib/services/chiptune-loader';
import { logDebug, logInfo, logWarning } from '$lib/services/logging';
import { trackSettings } from '$lib/stores/track-settings';
import {
  inferExtension,
  inferKind,
  markFileAsModule
} from '$lib/utils/files';
import type { ChiptuneJsPlayer } from 'chiptune3';

const MODULE_VERIFICATION_TIMEOUT_MS = 10_000;

interface PrepareImportedFilesOptions {
  verifyUnknownFiles?: boolean;
  verifyModuleFile?: (file: File) => Promise<boolean>;
}

function disposeVerificationPlayer(player: ChiptuneJsPlayer): void {
  try {
    player.stop();
  } catch {
    // Ignore teardown failures after a verification attempt.
  }

  try {
    player.gain.disconnect();
  } catch {
    // Ignore disconnect failures after a verification attempt.
  }

  void player.context.close().catch(() => undefined);
}

export async function verifyModuleFile(file: File): Promise<boolean> {
  if (typeof window === 'undefined') {
    return false;
  }

  logDebug('decode', 'Verifying unknown file as module', { name: file.name, size: file.size, extension: inferExtension(file.name) });
  let player: ChiptuneJsPlayer | null = null;

  try {
    player = await createChiptunePlayer({});
    const buffer = await file.arrayBuffer();

    return await new Promise<boolean>((resolve) => {
      let settled = false;

      const finish = (accepted: boolean) => {
        if (settled) {
          return;
        }

        settled = true;
        window.clearTimeout(timeoutId);
        if (player) {
          disposeVerificationPlayer(player);
          player = null;
        }
        if (accepted) logInfo('decode', 'Unknown file verified as module', { name: file.name });
        else logWarning('decode', 'Unknown file is not a playable module', { name: file.name });
        resolve(accepted);
      };

      const timeoutId = window.setTimeout(() => finish(false), MODULE_VERIFICATION_TIMEOUT_MS);

      player?.setVol(0);
      player?.onMetadata(() => finish(true));
      player?.onError(() => finish(false));

      try {
        player?.play(buffer);
        player?.pause();
      } catch {
        finish(false);
      }
    });
  } catch (error) {
    if (player) {
      disposeVerificationPlayer(player);
    }
    logWarning('decode', 'Unknown-file module verification failed', { name: file.name, error });
    return false;
  }
}

export async function prepareImportedFiles(
  files: FileList | File[],
  options: PrepareImportedFilesOptions = {}
): Promise<File[]> {
  const verifyUnknownFiles =
    options.verifyUnknownFiles ?? trackSettings.getSnapshot().verifyAddedFiles;
  const verify = options.verifyModuleFile ?? verifyModuleFile;
  const acceptedFiles: File[] = [];

  for (const file of Array.from(files)) {
    if (inferKind(inferExtension(file.name))) {
      acceptedFiles.push(file);
      continue;
    }

    if (verifyUnknownFiles && !(await verify(file))) {
      continue;
    }

    markFileAsModule(file);
    acceptedFiles.push(file);
  }

  return acceptedFiles;
}
