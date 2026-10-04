export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export interface AppInstallState {
  available: boolean;
  showHint: boolean;
}

export interface AppInstallEnvironment {
  window?: Window;
  isInstalled?: () => boolean;
}

