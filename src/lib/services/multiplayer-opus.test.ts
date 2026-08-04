import { describe, expect, it } from 'vitest';
import { enableOpusStereo } from './multiplayer-opus';

describe('multiplayer Opus negotiation', () => {
  it('requests stereo while preserving existing Opus parameters', () => {
    const description = enableOpusStereo({
      type: 'offer',
      sdp: [
        'v=0',
        'm=audio 9 UDP/TLS/RTP/SAVPF 111',
        'a=rtpmap:111 opus/48000/2',
        'a=fmtp:111 minptime=10;stereo=0;useinbandfec=1;sprop-stereo=0',
        ''
      ].join('\r\n')
    });

    expect(description.sdp).toContain(
      'a=fmtp:111 minptime=10;useinbandfec=1;stereo=1;sprop-stereo=1\r\n'
    );
  });

  it('adds an Opus format line when the browser did not provide one', () => {
    const description = enableOpusStereo({
      type: 'answer',
      sdp: 'v=0\nm=audio 9 UDP/TLS/RTP/SAVPF 109\na=rtpmap:109 opus/48000/2\n'
    });

    expect(description.sdp).toContain(
      'a=rtpmap:109 opus/48000/2\na=fmtp:109 stereo=1;sprop-stereo=1\n'
    );
  });

  it('leaves descriptions without Opus unchanged', () => {
    const description = { type: 'offer', sdp: 'v=0\n' } as const;
    expect(enableOpusStereo(description)).toBe(description);
  });
});
