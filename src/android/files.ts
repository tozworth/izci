import type { NativeFilesystem, NativeFolderReference } from '$lib/services/platform-files-types';
import { registerImportedFile } from '$lib/utils/files';
import { invokeAndroid } from './bridge';
import { createSafFile, type SafDocument } from './saf-file';

function importDocument(document: SafDocument): File {
  return registerImportedFile(createSafFile(document), { nativeFile: { uri: document.uri }, path: document.path ?? document.name });
}

export const nativeFilesystem: NativeFilesystem = {
  referenceScheme: 'content:',
  async pickFiles() { return (await invokeAndroid<SafDocument[]>('pickFiles')).map(importDocument); },
  pickFolder() { return invokeAndroid<NativeFolderReference>('pickFolder'); },
  async readFolder(folder, maxDepth) {
    const documents = await invokeAndroid<SafDocument[]>('readFolder', { uri: folder.uri, maxDepth });
    return documents.map(importDocument);
  },
  queryFolderPermission(folder, probe) { return invokeAndroid('queryFolderPermission', { uri: folder.uri, probe }); },
  requestFolderPermission(folder) { return invokeAndroid('requestFolderPermission', { uri: folder.uri }); },
  async materializeFile(reference) { return importDocument(await invokeAndroid<SafDocument>('statFile', { uri: reference.uri })); }
};
