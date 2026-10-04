import { getImportedFileSource } from '$lib/utils/file-sources';
import { nativeFilePath, type SelectedFolder } from '$lib/services/platform-files-types';

/** Preserve the folder's internal hierarchy, without copying its outer path. */
export function converterSources(files: File[], root?: SelectedFolder | 'drop') {
  return files.map(file => {
    const path = getImportedFileSource(file)?.path || file.webkitRelativePath || file.name;
    const parts = path.replaceAll('\\', '/').split('/').filter(Boolean);
    let rootDepth = 0;
    if (root === 'drop') rootDepth = 1;
    else if (root) {
      const nativeRoot = root.nativeFolder && nativeFilePath(root.nativeFolder);
      rootDepth = nativeRoot ? nativeRoot.split('/').filter(Boolean).length
        : parts[0]?.toLocaleLowerCase() === root.name.toLocaleLowerCase() ? 1 : 0;
    }
    return { file, path, outputDirectories: root ? parts.slice(rootDepth, -1) : [] };
  });
}
