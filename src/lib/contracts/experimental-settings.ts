export interface ExperimentalSettings {
  multiplayer: boolean;
  izciName: string;
  multiplayerWaitForClients: boolean;
  multiplayerSynchronizedPlayback: boolean;
  multiplayerSyncLeadTimeMs: number;
  multiplayerAutoHost: boolean;
  multiplayerRestoreLastSession: boolean;
  multiplayerTurnUrl: string;
  multiplayerTurnSecret: string;
  multiplayerTurnCredentialHours: number;
  multiplayerForceTurn: boolean;
  multiplayerFreeplay: boolean;
  multiplayerStreamAudio: boolean;
  multiplayerFileTransferLimitMiB: number;
  multiplayerOpusBitrateKbps: number;
  multiplayerAudioBufferMs: number;
  multiplayerRenderCacheLimitMiB: number;
  multiplayerRenderDiskCacheEnabled: boolean;
  multiplayerRenderDiskCacheLimitMiB: number;
  multiplayerMaxListeners: number;
}
