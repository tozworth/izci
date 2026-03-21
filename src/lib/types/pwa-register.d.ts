declare module 'virtual:pwa-register' {
  export function registerSW(options?: {
    immediate?: boolean;
    onRegisteredSW?: (
      swUrl: string,
      registration?: ServiceWorkerRegistration
    ) => void;
  }): (reloadPage?: boolean) => Promise<void>;
}
