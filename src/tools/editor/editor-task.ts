/** Yield to input/paint instead of extending a long audio job's microtask chain. */
export async function yieldEditorTask(signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  const scheduler = (globalThis as typeof globalThis & {
    scheduler?: { yield(): Promise<void> };
  }).scheduler;
  if (scheduler?.yield) await scheduler.yield();
  else await new Promise<void>((resolve) => setTimeout(resolve, 0));
  signal?.throwIfAborted();
}
