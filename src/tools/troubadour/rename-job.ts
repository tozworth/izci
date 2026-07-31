import { fingerprintFile, fingerprintsMatch } from '$lib/services/media-metadata/fingerprint';
import type { MediaFileFingerprint } from '$lib/services/media-metadata/types';
import { sanitizeFilename, validateFilename, type FilenameRules } from './rename-template';

export type RenameVerification = 'size' | 'metadata' | 'hash';

export interface RenameSource {
  id: string;
  file: File;
  fileHandle: FileSystemFileHandle | null;
  parentHandle: FileSystemDirectoryHandle | null;
  path: string;
  proposedBaseName: string;
  extension: string;
  missingTokens?: string[];
  expectedLastModified: number;
  expectedSize: number;
  expectedFingerprint?: MediaFileFingerprint;
}

export interface RenamePreviewRow extends RenameSource {
  proposedName: string;
  proposedPath: string;
  enabled: boolean;
  problems: string[];
  warnings: string[];
}

export interface RenameJobResult {
  id: string;
  success: boolean;
  originalPath: string;
  path: string;
  name: string;
  file: File;
  fileHandle: FileSystemFileHandle;
  error?: string;
}

function pathDirectory(path: string): string {
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return slash >= 0 ? path.slice(0, slash) : '';
}

function notFound(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === 'NotFoundError'
    : error instanceof Error && /not found/i.test(error.message);
}

async function destinationExists(parent: FileSystemDirectoryHandle, name: string): Promise<boolean> {
  try {
    await parent.getFileHandle(name);
    return true;
  } catch (error) {
    if (notFound(error)) return false;
    throw error;
  }
}

async function queryWritePermission(source: RenameSource): Promise<FileSystemPermissionState> {
  const handles = [source.parentHandle, source.fileHandle].filter(
    (handle): handle is FileSystemFileHandle | FileSystemDirectoryHandle => handle !== null
  );
  let state: FileSystemPermissionState = 'granted';
  for (const handle of handles) {
    if (!handle.queryPermission) continue;
    try {
      const current = await handle.queryPermission({ mode: 'readwrite' });
      if (current === 'denied') return 'denied';
      if (current === 'prompt') state = 'prompt';
    } catch {
      return 'denied';
    }
  }
  return state;
}

function extensionForRules(extension: string, rules: FilenameRules): string {
  const clean = extension.replace(/^\./, '');
  if (rules.extensionCase === 'lower') return clean.toLocaleLowerCase();
  if (rules.extensionCase === 'upper') return clean.toLocaleUpperCase();
  return clean;
}

function destinationKey(path: string, name: string): string {
  return `${pathDirectory(path).normalize('NFC').toLocaleLowerCase()}\u0000${name.normalize('NFC').toLocaleLowerCase()}`;
}

async function sourceMatchesPreview(source: RenameSource, current: File): Promise<boolean> {
  if (!source.expectedFingerprint) {
    return current.size === source.expectedSize && current.lastModified === source.expectedLastModified;
  }
  return fingerprintsMatch(source.expectedFingerprint, await fingerprintFile(current));
}

export async function buildRenamePreview(
  sources: RenameSource[],
  rules: FilenameRules = {}
): Promise<RenamePreviewRow[]> {
  const rows = await Promise.all(sources.map(async (source): Promise<RenamePreviewRow> => {
    const extension = extensionForRules(source.extension, rules);
    const sanitized = sanitizeFilename(source.proposedBaseName, rules);
    const proposedName = `${sanitized.name}.${extension}`;
    const directory = pathDirectory(source.path);
    const problems = [...validateFilename(proposedName)];
    const warnings = sanitized.changed ? [...sanitized.problems] : [];
    if (source.missingTokens?.length) {
      const missing = `missing:${source.missingTokens.join(',')}`;
      if (rules.missingTokenPolicy === 'empty') warnings.push(missing);
      else problems.push(missing);
    }
    if (!source.fileHandle) problems.push('missing-file-handle');
    if (!source.parentHandle) problems.push('missing-parent-handle');
    if (source.fileHandle && source.parentHandle) {
      const current = await source.fileHandle.getFile().catch(() => null);
      if (!current || !await sourceMatchesPreview(source, current)) {
        problems.push('source-changed');
      }
      const permission = await queryWritePermission(source);
      if (permission === 'prompt') problems.push('permission-required');
      if (permission === 'denied') problems.push('permission-denied');
      if (permission !== 'denied'
        && proposedName.toLocaleLowerCase() !== source.file.name.toLocaleLowerCase()
        && await destinationExists(source.parentHandle, proposedName)) {
        problems.push('destination-exists');
      }
    }
    if (proposedName === source.file.name) warnings.push('unchanged');
    if (proposedName.toLocaleLowerCase() === source.file.name.toLocaleLowerCase()
      && proposedName !== source.file.name) {
      warnings.push('case-only');
      const movable = source.fileHandle as (FileSystemFileHandle & { move?: (name: string) => Promise<void> }) | null;
      if (typeof movable?.move !== 'function') problems.push('case-only-rename-unavailable');
    }
    return {
      ...source,
      proposedName,
      proposedPath: directory ? `${directory}/${proposedName}` : proposedName,
      enabled: problems.length === 0 && proposedName !== source.file.name,
      problems,
      warnings
    };
  }));

  if (rules.collisionPolicy === 'counter') {
    const used = new Set<string>();
    for (const row of rows) {
      const collisionProblems = new Set(['destination-exists', 'case-only-rename-unavailable']);
      let collides = row.problems.some((problem) => collisionProblems.has(problem));
      collides ||= used.has(destinationKey(row.proposedPath, row.proposedName));
      if (collides && row.parentHandle) {
        const extension = extensionForRules(row.extension, rules);
        const baseName = row.proposedName.slice(0, -(extension.length + 1));
        let counter = 2;
        let proposedName = row.proposedName;
        do {
          proposedName = `${baseName} (${counter}).${extension}`;
          counter += 1;
        } while (used.has(destinationKey(row.path, proposedName))
          || await destinationExists(row.parentHandle, proposedName));
        row.proposedName = proposedName;
        const directory = pathDirectory(row.path);
        row.proposedPath = directory ? `${directory}/${proposedName}` : proposedName;
        row.problems = row.problems.filter((problem) => !collisionProblems.has(problem));
        row.warnings = [...row.warnings, 'collision-counter'];
      }
      used.add(destinationKey(row.proposedPath, row.proposedName));
      row.enabled = row.problems.length === 0 && row.proposedName !== row.file.name;
    }
    return rows;
  }

  const destinations = new Map<string, RenamePreviewRow[]>();
  for (const row of rows) {
    const key = destinationKey(row.proposedPath, row.proposedName);
    destinations.set(key, [...(destinations.get(key) ?? []), row]);
  }
  return rows.map((row) => destinations.get(destinationKey(row.proposedPath, row.proposedName))!.length > 1
    ? { ...row, enabled: false, problems: [...row.problems, 'duplicate-destination'] }
    : row);
}

async function verifyCopiedFile(
  source: File,
  destination: File,
  verification: RenameVerification,
  signal?: AbortSignal
): Promise<void> {
  if (destination.size !== source.size) throw new Error('The copied file failed size verification.');
  if (verification === 'size') return;
  if (verification === 'metadata') {
    const [sourceFingerprint, destinationFingerprint] = await Promise.all([
      fingerprintFile(source),
      fingerprintFile(destination)
    ]);
    if (sourceFingerprint.sampleHash !== destinationFingerprint.sampleHash) {
      throw new Error('The copied file failed content verification.');
    }
    return;
  }
  const chunkBytes = 1024 * 1024;
  for (let offset = 0; offset < source.size; offset += chunkBytes) {
    if (signal?.aborted) throw new DOMException('Rename cancelled.', 'AbortError');
    const end = Math.min(source.size, offset + chunkBytes);
    const [sourceChunk, destinationChunk] = await Promise.all([
      source.slice(offset, end).arrayBuffer(),
      destination.slice(offset, end).arrayBuffer()
    ]);
    const left = new Uint8Array(sourceChunk);
    const right = new Uint8Array(destinationChunk);
    if (left.length !== right.length || left.some((byte, index) => byte !== right[index])) {
      throw new Error('The copied file failed full content verification.');
    }
  }
}

async function copyThenRemove(
  row: RenamePreviewRow,
  signal?: AbortSignal,
  verification: RenameVerification = 'metadata'
): Promise<{ handle: FileSystemFileHandle; file: File }> {
  const parent = row.parentHandle!;
  if (await destinationExists(parent, row.proposedName)) throw new Error('The rename destination already exists.');
  const target = await parent.getFileHandle(row.proposedName, { create: true });
  try {
    const writable = await target.createWritable?.();
    if (!writable) throw new Error('The destination is not writable.');
    if (signal?.aborted) throw new DOMException('Rename cancelled.', 'AbortError');
    const streamWritable = writable as unknown as WritableStream<Uint8Array>;
    if (typeof row.file.stream === 'function' && typeof streamWritable.getWriter === 'function') {
      await row.file.stream().pipeTo(streamWritable, signal ? { signal } : undefined);
    } else {
      await writable.write(row.file);
      await writable.close();
    }
    const copied = await target.getFile();
    await verifyCopiedFile(row.file, copied, verification, signal);
    if (!parent.removeEntry) throw new Error('The browser cannot remove the original after copying.');
    await parent.removeEntry(row.file.name);
    return { handle: target, file: copied };
  } catch (error) {
    await parent.removeEntry?.(row.proposedName).catch(() => undefined);
    throw error;
  }
}

export async function applyRename(
  row: RenamePreviewRow,
  signal?: AbortSignal,
  verification: RenameVerification = 'metadata'
): Promise<RenameJobResult> {
  if (!row.enabled || row.problems.length) throw new Error('The rename row did not pass preflight.');
  if (signal?.aborted) throw new DOMException('Rename cancelled.', 'AbortError');
  try {
    const current = await row.fileHandle!.getFile();
    if (!await sourceMatchesPreview(row, current)) {
      throw new Error('The source changed after preview.');
    }
    if (await queryWritePermission(row) !== 'granted') {
      throw new Error('Write access is required before renaming.');
    }
    const movable = row.fileHandle as FileSystemFileHandle & {
      move?: (name: string) => Promise<void>;
    };
    let fileHandle: FileSystemFileHandle;
    let file: File;
    if (typeof movable.move === 'function') {
      await movable.move(row.proposedName);
      fileHandle = row.fileHandle!;
      file = await fileHandle.getFile();
      await verifyCopiedFile(current, file, verification, signal);
    } else {
      ({ handle: fileHandle, file } = await copyThenRemove({ ...row, file: current }, signal, verification));
    }
    return {
      id: row.id,
      success: true,
      originalPath: row.path,
      path: row.proposedPath,
      name: row.proposedName,
      file,
      fileHandle
    };
  } catch (error) {
    return {
      id: row.id,
      success: false,
      originalPath: row.path,
      path: row.path,
      name: row.file.name,
      file: row.file,
      fileHandle: row.fileHandle!,
      error: error instanceof Error ? error.message : 'Rename failed.'
    };
  }
}
