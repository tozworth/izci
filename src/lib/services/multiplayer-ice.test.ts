import { describe, expect, it } from 'vitest';
import {
  resolveMultiplayerConnectionRoute
} from './multiplayer-ice';

describe('multiplayer ICE configuration', () => {
  it('identifies a direct selected candidate pair', () => {
    expect(resolveMultiplayerConnectionRoute([
      { id: 'transport', type: 'transport', selectedCandidatePairId: 'pair' },
      { id: 'pair', type: 'candidate-pair', localCandidateId: 'local', remoteCandidateId: 'remote' },
      { id: 'local', type: 'local-candidate', candidateType: 'host' },
      { id: 'remote', type: 'remote-candidate', candidateType: 'srflx' }
    ])).toBe('direct');
  });

  it('identifies a relayed selected candidate pair', () => {
    expect(resolveMultiplayerConnectionRoute([
      { id: 'pair', type: 'candidate-pair', localCandidateId: 'local', remoteCandidateId: 'remote', nominated: true, state: 'succeeded' },
      { id: 'local', type: 'local-candidate', candidateType: 'relay' },
      { id: 'remote', type: 'remote-candidate', candidateType: 'host' }
    ])).toBe('relayed');
  });
});
