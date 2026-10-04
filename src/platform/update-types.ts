export type PwaUpdateCheckStatus = 'idle' | 'checking' | 'available' | 'up-to-date' | 'failed';

export interface PwaUpdateCheckState {
  status: PwaUpdateCheckStatus;
  lastSuccessfulCheck: number | null;
}

