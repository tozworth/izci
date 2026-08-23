interface MobileNavigatorLike {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
  userAgentData?: {
    mobile?: boolean;
  };
}

const MOBILE_USER_AGENT_PATTERN =
  /Android|webOS|iPhone|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i;

export function isMobileNavigator(navigatorLike: MobileNavigatorLike | null | undefined): boolean {
  if (!navigatorLike) return false;

  if (navigatorLike.userAgentData?.mobile === true) return true;

  const userAgent = navigatorLike.userAgent ?? '';
  if (MOBILE_USER_AGENT_PATTERN.test(userAgent)) return true;

  // iPadOS deliberately identifies itself as macOS in desktop-class browsing mode.
  return navigatorLike.platform === 'MacIntel' && (navigatorLike.maxTouchPoints ?? 0) > 1;
}

export function initializeMobileDocument(
  navigatorLike: MobileNavigatorLike | null | undefined =
    typeof navigator === 'undefined' ? null : navigator,
  root: HTMLElement | null = typeof document === 'undefined' ? null : document.documentElement
): boolean {
  const mobile = isMobileNavigator(navigatorLike);

  if (root) {
    root.dataset.izciMobile = mobile ? 'true' : 'false';
  }

  return mobile;
}
