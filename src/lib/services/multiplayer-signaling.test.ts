import { describe, expect, it } from 'vitest';
import {
  isNewSignalOfferForPeer,
  isSignalAnswerForOffer
} from './multiplayer-signaling';

const offer = {
  name: 'Phone',
  platform: 'Android',
  description: { type: 'offer' as const, sdp: 'offer-sdp' },
  createdAt: 42
};

describe('multiplayer signaling attempt correlation', () => {
  it('accepts a new offer from an existing Firebase peer identity', () => {
    expect(isNewSignalOfferForPeer(offer, 41)).toBe(true);
    expect(isNewSignalOfferForPeer(offer, 42)).toBe(false);
  });

  it('rejects stale answers left by an earlier connection attempt', () => {
    expect(isSignalAnswerForOffer({
      description: { type: 'answer', sdp: 'old-answer' },
      createdAt: 41
    }, offer.createdAt)).toBe(false);
    expect(isSignalAnswerForOffer({
      description: { type: 'answer', sdp: 'current-answer' },
      createdAt: 42
    }, offer.createdAt)).toBe(true);
  });
});
