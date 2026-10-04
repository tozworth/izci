import { moduleDecoder } from './openmpt/decoder';
import { logDebug, logInfo, logWarning } from '$lib/services/logging';
import { trackSettings } from '$lib/stores/track-settings';
import {
  inferExtension,
  inferKind,
  markFileAsModule
} from '$lib/utils/files';

interface PrepareImportedFilesOptions {
  verifyUnknownFiles?: boolean;
  verifyModuleFile?: (file: File) => Promise<boolean>;
}

export async function verifyModuleFile(file: File): Promise<boolean> {
  logDebug('decode', 'Verifying unknown file as module', { name: file.name, size: file.size, extension: inferExtension(file.name) });
  try {
    const accepted = await moduleDecoder.verify(await file.arrayBuffer());
    if (accepted) logInfo('decode', 'Unknown file verified as module', { name: file.name });
    else logWarning('decode', 'Unknown file is not a playable module', { name: file.name });
    return accepted;
  } catch (error) {
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
