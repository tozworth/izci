// Desktop assets are embedded in izci.exe and replaced by rebuilding the executable.
export function registerSW() {
  return async (_reloadPage?: boolean): Promise<void> => {};
}
