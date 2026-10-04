export const PUBLIC_PWA_ORIGIN = 'https://izci.xn--ala-hsa.net';

const packagedOrigins = new Set(['https://tauri.localhost', 'https://appassets.androidplatform.net']);

/** Packaged pages have private origins that another device cannot navigate to. */
export function invitationOrigin(origin?: string, defaultOrigin?: string): string {
  const candidate = origin ?? defaultOrigin ?? (typeof window === 'undefined' ? '' : window.location.origin);
  return (packagedOrigins.has(candidate) ? PUBLIC_PWA_ORIGIN : candidate).replace(/\/+$/, '');
}

export function packagedInvitationOrigin(origin?: string): string {
  return invitationOrigin(origin, PUBLIC_PWA_ORIGIN);
}
