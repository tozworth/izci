/**
 * Sidekick integration test: real Go router plus production browser
 * transport helpers (HTTP + sockets). RTC is mocked with fake SDP strings;
 * the test walks login, join, offer/answer/candidates, release,
 * cancellation, and server switch.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createSidekickSession,
  fetchSidekickInfo,
  fetchSidekickIce,
  createSidekickRoom,
  deleteSidekickRoom,
  joinSidekickRoom,
  mintSidekickSocketTicket,
  normalizeSidekickEndpoint,
  recreateSidekickRoom,
  SidekickError
} from './multiplayer-sidekick-http';
import {
  connectSidekickSocket,
  type SidekickEnvelope,
  type SidekickSocketHandle
} from './multiplayer-sidekick-socket';
import { decodeSidekickMessage } from './multiplayer-sidekick-protocol';

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === 'object') resolve(address.port);
        else reject(new Error('no port'));
      });
    });
  });
}

async function waitForHealth(base: string, timeoutMs = 20_000): Promise<void> {
  const start = Date.now();
  for (;;) {
    try {
      const response = await fetch(`${base}/healthz`, { redirect: 'error' });
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    if (Date.now() - start > timeoutMs) throw new Error('sidekick did not become healthy');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

let child: ChildProcess | null = null;
let endpoint = '';
let hostKeyHex = '';

beforeAll(async () => {
  const port = await freePort();
  const dir = mkdtempSync(join(tmpdir(), 'izci-sidekick-test-'));
  hostKeyHex = randomBytes(32).toString('hex');
  const keyPath = join(dir, 'host-key');
  writeFileSync(keyPath, `${hostKeyHex}\n`);
  const configPath = join(dir, 'config.json');
  writeFileSync(
    configPath,
    JSON.stringify({
      listen: `127.0.0.1:${port}`,
      publicBaseUrl: `http://127.0.0.1:${port}`,
      pathPrefix: '',
      allowedOrigins: [],
      hostKeyFile: keyPath,
      trustedProxies: [],
      description: 'test',
      contact: 'test@example.com',
      iceUrls: [],
      limits: {
        maxRooms: 32,
        maxPeersPerRoom: 8,
        maxPendingAttemptsPerRoom: 8
      }
    })
  );
  child = spawn('go', ['run', './cmd/izci-sidekick', 'serve', '--config', configPath], {
    cwd: join(process.cwd(), 'sidekick'),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stderr?.on('data', () => undefined);
  child.stdout?.on('data', () => undefined);
  endpoint = `http://127.0.0.1:${port}`;
  await waitForHealth(endpoint);
}, 60_000);

afterAll(async () => {
  if (child) {
    child.kill('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 500));
    child.kill('SIGKILL');
    child = null;
  }
});

function openSocket(ticket: string): Promise<{ handle: SidekickSocketHandle; messages: SidekickEnvelope[] }> {
  const messages: SidekickEnvelope[] = [];
  const url = `${normalizeSidekickEndpoint(endpoint)}/v1/socket`.replace('http://', 'ws://');
  const handle = connectSidekickSocket(
    url,
    ticket,
    {
      onMessage(envelope) {
        messages.push(envelope);
      },
      onClose() {
        // Signaling close is owned by the session layer.
      },
      onError() {
        // Transport errors surface per-message in this test.
      }
    },
    {}
  );
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('socket did not become ready')), 8_000);
    const poll = setInterval(() => {
      if (handle.role) {
        clearTimeout(timer);
        clearInterval(poll);
        resolve({ handle, messages });
      }
    }, 25);
  });
}

async function waitFor(
  messages: SidekickEnvelope[],
  match: (envelope: SidekickEnvelope) => boolean,
  label: string,
  timeoutMs = 8_000
): Promise<SidekickEnvelope> {
  const start = Date.now();
  for (;;) {
    const found = messages.find(match);
    if (found) return found;
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe('sidekick integration through production helpers', () => {
  it('serves info with the app protocol version', async () => {
    const info = await fetchSidekickInfo(endpoint);
    expect(info.signalingVersion).toBe(1);
    expect(info.appProtocolMajor).toBe(1);
    expect(info.appCapabilities).toContain("source-file");
  });

  it('rejects wrong invitations indistinguishably and admits a valid join', async () => {
    const session = await createSidekickSession(endpoint, hostKeyHex);
    const room = await createSidekickRoom(endpoint, session.sessionToken, 4);
    const badSecret = Buffer.from(randomBytes(32)).toString('base64url');
    await expect(
      joinSidekickRoom(endpoint, room.roomId, badSecret, 'test-nonce-1')
    ).rejects.toMatchObject({ code: 'room-unavailable' });
    const join = await joinSidekickRoom(endpoint, room.roomId, room.invitationSecret, 'test-nonce-2');
    expect(join.attemptId).toMatch(/^[0-9a-f]{32}$/);
  });

  it('walks offer/answer/candidates/release between host and guest', async () => {
    const session = await createSidekickSession(endpoint, hostKeyHex);
    const room = await createSidekickRoom(endpoint, session.sessionToken, 4);
    const hostTicket = await mintSidekickSocketTicket(endpoint, session.sessionToken, room.roomId);
    const { handle: host, messages: hostMessages } = await openSocket(hostTicket.ticket);

    const join = await joinSidekickRoom(endpoint, room.roomId, room.invitationSecret, 'full-exchange-1');
    await waitFor(hostMessages, (m) => m.type === 'peer.requested', 'peer.requested');
    const guestTicket = join.socketTicket;
    const { handle: guest, messages: guestMessages } = await openSocket(guestTicket);

    host.send('accept', undefined, join.attemptId);
    await waitFor(guestMessages, (m) => m.type === 'peer.accepted', 'peer.accepted');

    const offerSdp = 'v=0\no=guest 1 1 IN IP4 192.0.2.1\ns=izci\n';
    guest.send('offer', { sdp: offerSdp }, join.attemptId);
    const offer = await waitFor(hostMessages, (m) => m.type === 'offer', 'offer');
    expect((offer.payload as { sdp: string }).sdp).toBe(offerSdp);

    const answerSdp = 'v=0\no=host 1 1 IN IP4 192.0.2.2\ns=izci\n';
    host.send('answer', { sdp: answerSdp }, join.attemptId);
    const answer = await waitFor(guestMessages, (m) => m.type === 'answer', 'answer');
    expect((answer.payload as { sdp: string }).sdp).toBe(answerSdp);

    guest.send('candidate', {
      candidate: 'candidate:1 1 udp 1 192.0.2.1 9 typ host',
      index: 0,
      sdpMid: 'audio',
      sdpMLineIndex: 0
    }, join.attemptId);
    const forwarded = await waitFor(hostMessages, (m) => m.type === 'candidate', 'guest candidate');
    expect((forwarded.payload as { index: number }).index).toBe(0);
    guest.send('candidates-end', undefined, join.attemptId);
    await waitFor(hostMessages, (m) => m.type === 'candidates-end', 'guest candidates-end');

    host.send('candidate', {
      candidate: 'candidate:1 1 udp 2 192.0.2.2 9 typ host',
      index: 0,
      sdpMid: 'audio',
      sdpMLineIndex: 0
    }, join.attemptId);
    await waitFor(guestMessages, (m) => m.type === 'candidate', 'host candidate');
    host.send('candidates-end', undefined, join.attemptId);
    await waitFor(guestMessages, (m) => m.type === 'candidates-end', 'host candidates-end');

    guest.send('connected', undefined, join.attemptId);
    host.send('connected', undefined, join.attemptId);
    await waitFor(guestMessages, (m) => m.type === 'peer.connected', 'guest peer.connected');
    await waitFor(hostMessages, (m) => m.type === 'peer.connected', 'host peer.connected');

    // The reservation survives: the connection token still mints tickets.
    const fresh = await mintSidekickSocketTicket(endpoint, join.connectionToken, null);
    expect(fresh.ticket.length).toBeGreaterThan(0);

    guest.send('release', undefined, join.attemptId);
    await waitFor(hostMessages, (m) => m.type === 'peer.released', 'peer.released');

    host.dispose();
    guest.dispose();
  });

  it('issues empty default ICE to hosts and admitted connections', async () => {
    const session = await createSidekickSession(endpoint, hostKeyHex);
    const room = await createSidekickRoom(endpoint, session.sessionToken, 4);
    const hostIce = await fetchSidekickIce(endpoint, session.sessionToken, room.roomId);
    expect(hostIce.iceServers).toEqual([]);
    expect(hostIce.expiresAt ?? null).toBeNull();

    const join = await joinSidekickRoom(endpoint, room.roomId, room.invitationSecret, 'ice-conn-1');
    const guestIce = await fetchSidekickIce(endpoint, join.connectionToken, null);
    expect(guestIce.iceServers).toEqual([]);

    // Connection bearers authorize only their own connection.
    await expect(fetchSidekickIce(endpoint, join.connectionToken, 'f'.repeat(32))).rejects.toMatchObject({
      code: 'unauthorized'
    });
    await expect(fetchSidekickIce(endpoint, 'bogus-bearer-token', null)).rejects.toMatchObject({
      code: 'unauthorized'
    });
  });

  it('recreates a dropped room with its saved IDs', async () => {
    const session = await createSidekickSession(endpoint, hostKeyHex);
    const room = await createSidekickRoom(endpoint, session.sessionToken, 4);
    // A server restart drops the room; the host rebuilds it atomically.
    await deleteSidekickRoom(endpoint, session.sessionToken, room.roomId);
    await expect(
      joinSidekickRoom(endpoint, room.roomId, room.invitationSecret, 'recreate-gone-1')
    ).rejects.toMatchObject({ code: 'room-unavailable' });
    const rebuilt = await recreateSidekickRoom(
      endpoint,
      session.sessionToken,
      { roomId: room.roomId, ownerSecret: room.ownerSecret, invitationSecret: room.invitationSecret },
      4
    );
    expect(rebuilt.roomId).toBe(room.roomId);
    expect(rebuilt.invitationSecret).toBe(room.invitationSecret);
    const join = await joinSidekickRoom(endpoint, room.roomId, room.invitationSecret, 'recreate-back-1');
    expect(join.attemptId).toMatch(/^[0-9a-f]{32}$/);
  });

  it('supports cancellation and server switch disposal', async () => {
    const session = await createSidekickSession(endpoint, hostKeyHex);
    const room = await createSidekickRoom(endpoint, session.sessionToken, 4);
    const controller = new AbortController();
    const joinPromise = joinSidekickRoom(endpoint, room.roomId, room.invitationSecret, 'cancel-1', controller.signal);
    controller.abort(new Error('switched server'));
    await expect(joinPromise).rejects.toThrow();

    const join = await joinSidekickRoom(endpoint, room.roomId, room.invitationSecret, 'switch-1');
    const { handle: first } = await openSocket(join.socketTicket);
    expect(first.role).toBe('guest');
    // Server switch disposes the old socket before new results attach.
    first.dispose();
    const fresh = await mintSidekickSocketTicket(endpoint, join.connectionToken, null);
    const { handle: second } = await openSocket(fresh.ticket);
    expect(second.role).toBe('guest');
    second.dispose();
  });

  it('decodes every shared fixture with the production decoder', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const dir = join(process.cwd(), 'tests', 'multiplayer-sidekick-contract');
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.json')) continue;
      const data = readFileSync(join(dir, name), 'utf8');
      const decoded = decodeSidekickMessage(data);
      if (name.startsWith('valid-')) expect(decoded.ok, name).toBe(true);
      else expect(decoded.ok, name).toBe(false);
    }
    void SidekickError;
  });
});
