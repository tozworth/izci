/// <reference types="vite/client" />

interface Window {
  /** Set by the native shell before the packaged app loads. */
  __izciBuiltinSignaling?: boolean;
}
