import { describe, expect, it } from 'vitest';
import {
  buildServerInvitationPayload,
  buildServerInviteLink,
  consumeServerInvite,
  describeServerEndpoint,
  normalizeServerInviteEndpoint,
  parseServerInvitation,
  parseServerInviteHash,
  parseServerInviteText,
  redactServerSecrets,
  SERVER_INVITE_MAX_BYTES,
  ServerInviteError
} from './multiplayer-server-invite';

const ROOM = 'a'.repeat(32);
const SECRET = 'invite-secret-1';

function makePayload(overrides: { endpoint?: string; roomId?: string; secret?: string } = {}): string {
  const endpoint = overrides.endpoint ?? 'https://server.example.com';
  const roomId = overrides.roomId ?? ROOM;
  const secret = overrides.secret ?? SECRET;
  return `${endpoint}&code=${encodeURIComponent(`${roomId}.${secret}`)}`;
}

describe('server invitations', () => {
  it('round-trips a minimal invitation', () => {
    const raw = buildServerInvitationPayload({
      endpoint: 'https://server.example.com/',
      roomId: ROOM,
      secret: SECRET,
      title: null
    });
    expect(parseServerInvitation(raw)).toEqual({
      endpoint: 'https://server.example.com',
      roomId: ROOM,
      secret: SECRET,
      title: null
    });
  });

  it('keeps prefixed endpoints and omits unverified titles', () => {
    const raw = buildServerInvitationPayload({
      endpoint: 'https://example.com/party/',
      roomId: ROOM,
      secret: SECRET,
      title: 'Friday tunes'
    });
    const parsed = parseServerInvitation(raw);
    expect(parsed.endpoint).toBe('https://example.com/party');
    expect(parsed.title).toBeNull();
    const link = buildServerInviteLink(parsed, 'https://izci.example');
    expect(link).toContain('#party=https://example.com/party&code=');
  });

  it('accepts a bare invite code with the configured server URL', () => {
    expect(parseServerInviteText(`${ROOM}.${SECRET}`, 'https://server.example.com')).toEqual({
      endpoint: 'https://server.example.com',
      roomId: ROOM,
      secret: SECRET,
      title: null
    });
  });

  it('rejects oversized invitations and long titles', () => {
    expect(() => buildServerInvitationPayload({
      endpoint: 'https://server.example.com',
      roomId: ROOM,
      secret: SECRET,
      title: 'x'.repeat(121)
    })).toThrowError(ServerInviteError);
    expect(() => parseServerInvitation('A'.repeat(SERVER_INVITE_MAX_BYTES + 1))).toThrowError(
      expect.objectContaining({ code: 'too-large' })
    );
    expect(() =>
      buildServerInvitationPayload({
        endpoint: 'https://server.example.com',
        roomId: ROOM,
        secret: 'x'.repeat(513),
        title: null
      })
    ).toThrowError(expect.objectContaining({ code: 'bad-secret' }));
  });

  it('rejects bad rooms, secrets, and payload shapes', () => {
    expect(() => parseServerInvitation(makePayload({ roomId: 'nope' }))).toThrowError(
      expect.objectContaining({ code: 'bad-room' })
    );
    expect(() => parseServerInvitation(makePayload({ secret: '' }))).toThrowError(
      expect.objectContaining({ code: 'bad-secret' })
    );
    expect(() => parseServerInvitation(`${makePayload()}&extra=1`)).toThrowError(
      expect.objectContaining({ code: 'bad-payload' })
    );
    expect(() => parseServerInvitation('!!!')).toThrowError(
      expect.objectContaining({ code: 'bad-encoding' })
    );
    expect(() => parseServerInvitation(makePayload({ endpoint: 'nope' }))).toThrowError(
      expect.objectContaining({ code: 'bad-endpoint' })
    );
  });

  it('requires HTTPS outside loopback and rejects smuggled parts', () => {
    expect(() => normalizeServerInviteEndpoint('http://server.example.com')).toThrowError(
      expect.objectContaining({ code: 'bad-endpoint' })
    );
    expect(normalizeServerInviteEndpoint('http://127.0.0.1:8787/')).toBe('http://127.0.0.1:8787');
    expect(normalizeServerInviteEndpoint('http://localhost:8787/prefix/')).toBe(
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
      expect(() => normalizeServerInviteEndpoint(bad), bad).toThrowError(
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
    const parsed = consumeServerInvite(location, history);
    expect(parsed?.roomId).toBe(ROOM);
    expect(replaced).toBe('/');
    expect(consumeServerInvite({ hash: '', pathname: '/', search: '' }, history)).toBeNull();
    expect(parseServerInviteHash('#view=queue')).toBeNull();
  });

  it('strips the fragment even when the invitation is malformed', () => {
    let replaced = '';
    const history = { replaceState: (_a: unknown, _b: string, url: string) => {
      replaced = url;
    } };
    expect(() =>
      consumeServerInvite({ hash: '#party=!!!', pathname: '/', search: '' }, history)
    ).toThrowError(ServerInviteError);
    expect(replaced).toBe('/');
  });

  it('describes endpoints with ASCII hosts for suspicious Unicode', () => {
    const plain = describeServerEndpoint('https://server.example.com/prefix/');
    expect(plain).toEqual({
      authorityWithPrefix: 'server.example.com/prefix',
      asciiHost: null,
      suspicious: false
    });
    const tricky = describeServerEndpoint('https://münchen.example/party');
    expect(tricky.suspicious).toBe(true);
    expect(tricky.asciiHost).toContain('xn--');
  });

  it('redacts invitation material from diagnostics', () => {
    const raw = makePayload();
    const redacted = redactServerSecrets(`join failed: https://x/#party=${raw} secret="${SECRET}"`);
    expect(redacted).not.toContain(raw);
    expect(redacted).not.toContain(SECRET);
    expect(redacted).toContain('#party=[redacted]');
  });
});
