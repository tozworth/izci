import { describe, expect, it } from 'vitest';
import {
  forgetServerInvitation,
  forgetServerServer,
  getRememberedServerInvitation,
  rememberServerRecent,
  rememberServerServer,
  serverRecents,
  serverServers
} from './multiplayer-server-recents';

const ROOM = 'b'.repeat(32);

describe('server recents', () => {
  it('remembers servers newest-first and forgets them with their recents', () => {
    serverServers.set([]);
    serverRecents.set([]);
    rememberServerServer('https://one.example/', 'One');
    rememberServerServer('https://two.example/prefix', 'Two');
    const servers = serverServers.getSnapshot();
    expect(servers.map((entry) => entry.endpoint)).toEqual([
      'https://two.example/prefix',
      'https://one.example'
    ]);
    rememberServerRecent({
      endpoint: 'https://one.example',
      roomId: ROOM,
      displayName: 'Party',
      invitationSecret: 'secret-1',
      ownerSecret: null
    }, { rememberInvitation: true });
    forgetServerServer('https://one.example/');
    expect(serverServers.getSnapshot()).toHaveLength(1);
    expect(serverRecents.getSnapshot()).toHaveLength(0);
    serverServers.set([]);
    serverRecents.set([]);
  });

  it('keeps invitations only when Remember was chosen', () => {
    serverRecents.set([]);
    rememberServerRecent({
      endpoint: 'https://one.example',
      roomId: ROOM,
      displayName: 'Party',
      invitationSecret: 'secret-1',
      ownerSecret: 'owner-1'
    });
    expect(serverRecents.getSnapshot()[0]).toMatchObject({
      invitationSecret: null,
      ownerSecret: null
    });
    rememberServerRecent({
      endpoint: 'https://one.example',
      roomId: ROOM,
      displayName: 'Party',
      invitationSecret: 'secret-1',
      ownerSecret: 'owner-1'
    }, { rememberInvitation: true });
    expect(serverRecents.getSnapshot()[0]).toMatchObject({
      invitationSecret: 'secret-1',
      ownerSecret: 'owner-1'
    });
    expect(getRememberedServerInvitation('https://one.example/', ROOM)).toBe('secret-1');
    expect(getRememberedServerInvitation('https://other.example', ROOM)).toBeNull();
    forgetServerInvitation('https://one.example', ROOM);
    expect(serverRecents.getSnapshot()).toHaveLength(0);
    expect(getRememberedServerInvitation('https://one.example', ROOM)).toBeNull();
  });

  it('drops invalid entries and caps the list', () => {
    serverRecents.set('not-a-list' as unknown as never);
    expect(serverRecents.getSnapshot()).toEqual([]);
    for (let i = 0; i < 12; i += 1) {
      rememberServerRecent({
        endpoint: `https://${i}.example`,
        roomId: ROOM,
        displayName: `Room ${i}`,
        invitationSecret: null,
        ownerSecret: null
      });
    }
    expect(serverRecents.getSnapshot()).toHaveLength(8);
    serverRecents.set([]);
  });
});
