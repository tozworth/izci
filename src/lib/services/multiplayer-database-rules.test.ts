import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment
} from '@firebase/rules-unit-testing';
import { get, ref, set } from 'firebase/database';
import { MULTIPLAYER_PROTOCOL_MAJOR, MULTIPLAYER_PROTOCOL_MINOR } from './multiplayer-protocol';

const emulatorAvailable = Boolean(process.env.FIREBASE_DATABASE_EMULATOR_HOST);
const describeWithEmulator = emulatorAvailable ? describe : describe.skip;

describeWithEmulator('multiplayer Realtime Database rules', () => {
  let environment: RulesTestEnvironment;
  const projectId = 'izci-multiplayer-rules-test';
  const room = 'a1b2c3d4';
  const hostUid = 'host-user';
  const clientUid = 'client-user';

  beforeAll(async () => {
    environment = await initializeTestEnvironment({
      projectId,
      database: {
        rules: readFileSync(new URL('../../../database.rules.json', import.meta.url), 'utf8')
      }
    });
  });

  afterAll(async () => {
    await environment?.cleanup();
  });

  it('keeps rooms private from unauthenticated visitors', async () => {
    const database = environment.unauthenticatedContext().database();
    await assertFails(get(ref(database, `multiplayer/rooms/${room}/meta`)));
  });

  it('lets the host create the room and own all host signaling', async () => {
    const database = environment.authenticatedContext(hostUid).database();
    await assertSucceeds(set(ref(database, `multiplayer/rooms/${room}`), {
      meta: {
        hostUid,
        protocolMajor: MULTIPLAYER_PROTOCOL_MAJOR,
        protocolMinor: MULTIPLAYER_PROTOCOL_MINOR,
        hostName: 'Scout host',
        turnRelay: true,
        createdAt: Date.now()
      }
    }));
    await assertSucceeds(set(ref(database, `multiplayer/rooms/${room}/peers/${clientUid}/host`), {
      description: { type: 'answer', sdp: 'answer-sdp' },
      createdAt: Date.now()
    }));
    await assertSucceeds(set(
      ref(database, `multiplayer/rooms/${room}/peers/${clientUid}/hostCandidates/c000`),
      { candidate: 'candidate:host', sdpMid: '0', sdpMLineIndex: 0 }
    ));
    await assertSucceeds(set(ref(database, `multiplayer/rooms/${room}/peers/${clientUid}/host`), {
      error: 'host-full',
      createdAt: Date.now()
    }));
  });

  it('rejects signaling rooms from older protocol versions', async () => {
    const database = environment.authenticatedContext(hostUid).database();
    await assertFails(set(ref(database, 'multiplayer/rooms/z9y8x7w6'), {
      meta: {
        hostUid,
        protocolMajor: MULTIPLAYER_PROTOCOL_MAJOR + 1,
        hostName: 'Outdated host',
        turnRelay: false,
        createdAt: Date.now()
      }
    }));
  });

  it('limits a client to its own offer and its own answer read', async () => {
    const clientDatabase = environment.authenticatedContext(clientUid).database();
    const otherDatabase = environment.authenticatedContext('other-client').database();
    const offer = {
      name: 'Living room phone',
      platform: 'Android',
      description: { type: 'offer', sdp: 'offer-sdp' },
      createdAt: Date.now()
    };

    await assertSucceeds(get(ref(clientDatabase, `multiplayer/rooms/${room}/meta`)));
    await assertSucceeds(set(
      ref(clientDatabase, `multiplayer/rooms/${room}/peers/${clientUid}/client`),
      offer
    ));
    await assertSucceeds(set(
      ref(clientDatabase, `multiplayer/rooms/${room}/peers/${clientUid}/clientCandidates/c000`),
      { candidate: 'candidate:client', sdpMid: '0', sdpMLineIndex: 0 }
    ));
    await assertSucceeds(get(ref(clientDatabase, `multiplayer/rooms/${room}/peers/${clientUid}/host`)));
    await assertFails(set(
      ref(otherDatabase, `multiplayer/rooms/${room}/peers/${clientUid}/client`),
      offer
    ));
    await assertFails(set(
      ref(otherDatabase, `multiplayer/rooms/${room}/peers/${clientUid}/clientCandidates/c001`),
      { candidate: 'candidate:forged', sdpMid: '0', sdpMLineIndex: 0 }
    ));
    await assertFails(set(
      ref(clientDatabase, `multiplayer/rooms/${room}/peers/${clientUid}/host`),
      { description: { type: 'answer', sdp: 'forged' }, createdAt: Date.now() }
    ));
    await assertFails(set(
      ref(clientDatabase, `multiplayer/rooms/${room}/peers/${clientUid}/clientCandidates/invalid`),
      { candidate: '', sdpMid: '0', sdpMLineIndex: 0 }
    ));
    await assertFails(get(ref(clientDatabase, `multiplayer/rooms/${room}/peers`)));
  });

  it('scopes encrypted TURN credential exchange to the host and requesting client', async () => {
    const hostDatabase = environment.authenticatedContext(hostUid).database();
    const clientDatabase = environment.authenticatedContext(clientUid).database();
    const otherDatabase = environment.authenticatedContext('other-client').database();
    const request = {
      requestId: 'a'.repeat(24),
      publicKey: 'A'.repeat(88),
      createdAt: Date.now()
    };
    const response = {
      requestId: request.requestId,
      publicKey: 'B'.repeat(88),
      iv: 'C'.repeat(16),
      ciphertext: 'D'.repeat(256),
      createdAt: Date.now()
    };

    await assertSucceeds(set(ref(
      clientDatabase,
      `multiplayer/rooms/${room}/peers/${clientUid}/credentialRequest`
    ), request));
    await assertSucceeds(set(ref(
      hostDatabase,
      `multiplayer/rooms/${room}/peers/${clientUid}/credentialResponse`
    ), response));
    await assertSucceeds(get(ref(
      clientDatabase,
      `multiplayer/rooms/${room}/peers/${clientUid}/credentialResponse`
    )));
    await assertFails(set(ref(
      otherDatabase,
      `multiplayer/rooms/${room}/peers/${clientUid}/credentialRequest`
    ), request));
    await assertFails(get(ref(
      otherDatabase,
      `multiplayer/rooms/${room}/peers/${clientUid}/credentialResponse`
    )));
  });

  it('lets only paired clients discover the host current room', async () => {
    const hostDatabase = environment.authenticatedContext(hostUid).database();
    const clientDatabase = environment.authenticatedContext(clientUid).database();
    const otherDatabase = environment.authenticatedContext('other-client').database();
    await assertSucceeds(set(
      ref(hostDatabase, `multiplayer/hosts/${hostUid}/paired/${clientUid}`),
      { name: 'Phone', platform: 'Android', pairedAt: Date.now() }
    ));
    await assertSucceeds(set(ref(hostDatabase, `multiplayer/hosts/${hostUid}/directory`), {
      currentRoom: room,
      hostName: 'Scout host',
      protocolMajor: MULTIPLAYER_PROTOCOL_MAJOR,
      protocolMinor: MULTIPLAYER_PROTOCOL_MINOR,
      updatedAt: Date.now()
    }));

    await assertSucceeds(get(ref(clientDatabase, `multiplayer/hosts/${hostUid}/directory`)));
    await assertFails(get(ref(otherDatabase, `multiplayer/hosts/${hostUid}/directory`)));
    await assertFails(set(
      ref(clientDatabase, `multiplayer/hosts/${hostUid}/paired/${clientUid}`),
      { name: 'Forged', platform: 'Android', pairedAt: Date.now() }
    ));
  });

  it('rejects arbitrary client payloads', async () => {
    const database = environment.authenticatedContext(clientUid).database();
    await assertFails(set(
      ref(database, `multiplayer/rooms/${room}/peers/${clientUid}/client`),
      { name: 'Client', platform: 'Android', description: { type: 'offer' }, createdAt: Date.now(), library: ['nope'] }
    ));
    await assertFails(set(
      ref(database, `multiplayer/rooms/${room}/peers/${clientUid}/client`),
      {
        name: 'Client',
        platform: 'Android',
        description: { type: 'offer', sdp: 'offer-sdp', payload: 'nope' },
        createdAt: Date.now()
      }
    ));
    await assertFails(set(
      ref(database, `multiplayer/rooms/${room}/peers/${clientUid}/client`),
      {
        name: 'Client',
        platform: 'Android',
        description: { type: 'offer', sdp: 'x'.repeat(50_001) },
        createdAt: Date.now()
      }
    ));
    expect(true).toBe(true);
  });
});
