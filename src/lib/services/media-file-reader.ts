import { useAndroidFileSnapshot } from '$lib/utils/file-read-policy';

export type ReadFileBytes = (offset: number, length: number) => Promise<Uint8Array>;

const SNAPSHOT_BUDGET_BYTES = 32 * 1024 * 1024;
interface Snapshot {
  bytes: Promise<Uint8Array>;
  size: number;
  readers: number;
}
const snapshots = new Map<string, Snapshot>();
let reservedBytes = 0;

// Only active read operations own snapshots. Reserve bytes before starting I/O,
// including pending reads, so concurrent jobs cannot exceed the budget. Track
// identity plus file version shares a read across fresh FSA File wrappers.
export async function withMediaFileReader<T>(
  file: File, trackId: string, read: (readBytes: ReadFileBytes) => Promise<T>
): Promise<T> {
  const key = JSON.stringify([trackId, file.size, file.lastModified]);
  let snapshot = useAndroidFileSnapshot(file.size) ? snapshots.get(key) : undefined;
  if (!snapshot && useAndroidFileSnapshot(file.size) && reservedBytes + file.size <= SNAPSHOT_BUDGET_BYTES) {
    snapshot = { bytes: file.arrayBuffer().then((bytes) => new Uint8Array(bytes)), size: file.size, readers: 0 };
    void snapshot.bytes.catch(() => undefined);
    snapshots.set(key, snapshot);
    reservedBytes += file.size;
  }
  if (snapshot) snapshot.readers++;
  const activeSnapshot = snapshot;
  const readBytes: ReadFileBytes = async (offset, length) => {
    const start = Math.max(0, offset);
    const end = Math.min(file.size, start + Math.max(0, length));
    if (end <= start) return new Uint8Array();
    if (activeSnapshot) return (await activeSnapshot.bytes).subarray(start, end);
    return new Uint8Array(await file.slice(start, end).arrayBuffer());
  };
  try {
    return await read(readBytes);
  } finally {
    if (snapshot && --snapshot.readers === 0) {
      // Retain the reservation until pending I/O settles, even if a parser
      // finishes without consuming its snapshot.
      void snapshot.bytes.finally(() => {
        if (snapshots.get(key) !== snapshot || snapshot.readers !== 0) return;
        snapshots.delete(key);
        reservedBytes -= snapshot.size;
      }).catch(() => undefined);
    }
  }
}
