import { describe, expect, it } from 'vitest';
import {
  buildSidekickInvitationPayload,
  buildSidekickInviteLink,
  consumeSidekickInvite,
  describeSidekickEndpoint,
  normalizeSidekickInviteEndpoint,
  parseSidekickInvitation,
  parseSidekickInviteHash,
  parseSidekickInviteText,
  redactSidekickSecrets,
  SIDEKICK_INVITE_MAX_BYTES,
  SidekickInviteError
} from './multiplayer-sidekick-invite';

const ROOM = 'a'.repeat(32);
const SECRET = 'invite-secret-1';

function makePayload(overrides: { endpoint?: string; roomId?: string; secret?: string } = {}): string {
  const endpoint = overrides.endpoint ?? 'https://sidekick.example.com';
  const roomId = overrides.roomId ?? ROOM;
  const secret = overrides.secret ?? SECRET;
  return `${endpoint}&code=${encodeURIComponent(`${roomId}.${secret}`)}`;
}

describe('sidekick invitations', () => {
  it('round-trips a minimal invitation', () => {
    const raw = buildSidekickInvitationPayload({
      endpoint: 'https://sidekick.example.com/',
      roomId: ROOM,
      secret: SECRET,
      title: null
    });
    expect(parseSidekickInvitation(raw)).toEqual({
      endpoint: 'https://sidekick.example.com',
      roomId: ROOM,
      secret: SECRET,
      title: null
    });
  });

  it('keeps prefixed endpoints and omits unverified titles', () => {
    const raw = buildSidekickInvitationPayload({
      endpoint: 'https://example.com/party/',
      roomId: ROOM,
      secret: SECRET,
      title: 'Friday tunes'
    });
    const parsed = parseSidekickInvitation(raw);
    expect(parsed.endpoint).toBe('https://example.com/party');
    expect(parsed.title).toBeNull();
    const link = buildSidekickInviteLink(parsed, 'https://izci.example');
    expect(link).toContain('#party=https://example.com/party&code=');
  });

  it('accepts a bare invite code with the configured sidekick URL', () => {
    expect(parseSidekickInviteText(`${ROOM}.${SECRET}`, 'https://sidekick.example.com')).toEqual({
      endpoint: 'https://sidekick.example.com',
      roomId: ROOM,
      secret: SECRET,
      title: null
    });
  });

  it('rejects oversized invitations and long titles', () => {
    expect(() => buildSidekickInvitationPayload({
      endpoint: 'https://sidekick.example.com',
      roomId: ROOM,
      secret: SECRET,
      title: 'x'.repeat(121)
    })).toThrowError(SidekickInviteError);
    expect(() => parseSidekickInvitation('A'.repeat(SIDEKICK_INVITE_MAX_BYTES + 1))).toThrowError(
      expect.objectContaining({ code: 'too-large' })
    );
    expect(() =>
      buildSidekickInvitationPayload({
        endpoint: 'https://sidekick.example.com',
        roomId: ROOM,
        secret: 'x'.repeat(513),
        title: null
      })
    ).toThrowError(expect.objectContaining({ code: 'bad-secret' }));
  });

  it('rejects bad rooms, secrets, and payload shapes', () => {
    expect(() => parseSidekickInvitation(makePayload({ roomId: 'nope' }))).toThrowError(
      expect.objectContaining({ code: 'bad-room' })
    );
    expect(() => parseSidekickInvitation(makePayload({ secret: '' }))).toThrowError(
      expect.objectContaining({ code: 'bad-secret' })
    );
    expect(() => parseSidekickInvitation(`${makePayload()}&extra=1`)).toThrowError(
      expect.objectContaining({ code: 'bad-payload' })
    );
    expect(() => parseSidekickInvitation('!!!')).toThrowError(
      expect.objectContaining({ code: 'bad-encoding' })
    );
    expect(() => parseSidekickInvitation(makePayload({ endpoint: 'nope' }))).toThrowError(
      expect.objectContaining({ code: 'bad-endpoint' })
    );
  });

  it('requires HTTPS outside loopback and rejects smuggled parts', () => {
    expect(() => normalizeSidekickInviteEndpoint('http://sidekick.example.com')).toThrowError(
      expect.objectContaining({ code: 'bad-endpoint' })
    );
    expect(normalizeSidekickInviteEndpoint('http://127.0.0.1:8787/')).toBe('http://127.0.0.1:8787');
    expect(normalizeSidekickInviteEndpoint('http://localhost:8787/prefix/')).toBe(
      'http://localhost:8787/prefix'
    );
    for (const bad of [
      'https://user:pass@example.com',
      'https://example.com/?x=1',
      'https://example.com/#frag',
      'https://example.com:99999',
      'https://example.com//double',
      'https://example.com/v1/socket',
      'https://example.com/prefix/v1/rooms'
    ]) {
      expect(() => normalizeSidekickInviteEndpoint(bad), bad).toThrowError(
        expect.objectContaining({ code: 'bad-endpoint' })
      );
    }
  });

  it('consumes the fragment and strips secrets from the address bar', () => {
    const raw = makePayload();
    let replaced = '';
    const location = { hash: `#party=${raw}`, pathname: '/', search: '' };
    const history = { replaceState: (_a: unknown, _b: string, url: string) => {
      replaced = url;
    } };
    const parsed = consumeSidekickInvite(location, history);
    expect(parsed?.roomId).toBe(ROOM);
    expect(replaced).toBe('/');
    expect(consumeSidekickInvite({ hash: '', pathname: '/', search: '' }, history)).toBeNull();
    expect(parseSidekickInviteHash('#view=queue')).toBeNull();
  });

  it('strips the fragment even when the invitation is malformed', () => {
    let replaced = '';
    const history = { replaceState: (_a: unknown, _b: string, url: string) => {
      replaced = url;
    } };
    expect(() =>
      consumeSidekickInvite({ hash: '#party=!!!', pathname: '/', search: '' }, history)
    ).toThrowError(SidekickInviteError);
    expect(replaced).toBe('/');
  });

  it('describes endpoints with ASCII hosts for suspicious Unicode', () => {
    const plain = describeSidekickEndpoint('https://sidekick.example.com/prefix/');
    expect(plain).toEqual({
      authorityWithPrefix: 'sidekick.example.com/prefix',
      asciiHost: null,
      suspicious: false
    });
    const tricky = describeSidekickEndpoint('https://münchen.example/party');
    expect(tricky.suspicious).toBe(true);
    expect(tricky.asciiHost).toContain('xn--');
  });

  it('redacts invitation material from diagnostics', () => {
    const raw = makePayload();
    const redacted = redactSidekickSecrets(`join failed: https://x/#party=${raw} secret="${SECRET}"`);
    expect(redacted).not.toContain(raw);
    expect(redacted).not.toContain(SECRET);
    expect(redacted).toContain('#party=[redacted]');
  });
});
