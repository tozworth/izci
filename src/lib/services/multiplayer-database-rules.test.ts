import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment
} from '@firebase/rules-unit-testing';
import { get, ref, set } from 'firebase/database';
import { MULTIPLAYER_PROTOCOL_VERSION } from './multiplayer-protocol';

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
        protocolVersion: MULTIPLAYER_PROTOCOL_VERSION,
        hostName: 'Scout host',
        createdAt: Date.now()
      }
    }));
    await assertSucceeds(set(ref(database, `multiplayer/rooms/${room}/peers/${clientUid}/host`), {
      description: { type: 'answer', sdp: 'answer-sdp' },
      createdAt: Date.now()
    }));
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
        protocolVersion: MULTIPLAYER_PROTOCOL_VERSION - 1,
        hostName: 'Outdated host',
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
    await assertSucceeds(get(ref(clientDatabase, `multiplayer/rooms/${room}/peers/${clientUid}/host`)));
    await assertFails(set(
      ref(otherDatabase, `multiplayer/rooms/${room}/peers/${clientUid}/client`),
      offer
    ));
    await assertFails(set(
      ref(clientDatabase, `multiplayer/rooms/${room}/peers/${clientUid}/host`),
      { description: { type: 'answer', sdp: 'forged' }, createdAt: Date.now() }
    ));
    await assertFails(get(ref(clientDatabase, `multiplayer/rooms/${room}/peers`)));
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
