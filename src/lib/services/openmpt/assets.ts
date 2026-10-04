import wasmUrl from '$lib/vendor/libopenmpt/libopenmpt.wasm?url';

export { wasmUrl };

let bytes: Promise<ArrayBuffer> | undefined;
export function loadOpenMptBytes(): Promise<ArrayBuffer> {
  if (bytes) return bytes;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  bytes = fetch(wasmUrl, { signal: controller.signal }).then((response) => {
    if (!response.ok) throw new Error(`Unable to load libopenmpt (${response.status}).`);
    return response.arrayBuffer();
  }).catch((error) => {
    bytes = undefined;
    throw error;
  }).finally(() => clearTimeout(timer));
  return bytes;
}
