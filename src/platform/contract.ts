import type { PlatformCapabilities, PlatformId } from './capabilities';
import type { PlatformFilesystem } from '$lib/services/platform-files-types';

/** Every build target provides the same surface; no target defines the others. */
export type Platform = typeof import('./web-shell') & {
  platformId: PlatformId;
  platformCapabilities: PlatformCapabilities;
  filesystem: PlatformFilesystem;
};

type ImplementsPlatform<T extends Platform> = T;
// These checks cover every implementation even when TypeScript selects PWA.
export type PlatformImplementations = [
  ImplementsPlatform<typeof import('./pwa/platform')>,
  ImplementsPlatform<typeof import('../desktop/platform')>,
  ImplementsPlatform<typeof import('../desktop/linux/platform')>,
  ImplementsPlatform<typeof import('../android/platform')>
];
