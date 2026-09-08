import { describe, expect, it } from 'vitest';
import {
  forgetSidekickInvitation,
  forgetSidekickServer,
  rememberSidekickRecent,
  rememberSidekickServer,
  sidekickRecents,
  sidekickServers
} from './multiplayer-sidekick-recents';

const ROOM = 'b'.repeat(32);

describe('sidekick recents', () => {
  it('remembers servers newest-first and forgets them with their recents', () => {
    sidekickServers.set([]);
    sidekickRecents.set([]);
    rememberSidekickServer('https://one.example/', 'One');
    rememberSidekickServer('https://two.example/prefix', 'Two');
    const servers = sidekickServers.getSnapshot();
    expect(servers.map((entry) => entry.endpoint)).toEqual([
      'https://two.example/prefix',
      'https://one.example'
    ]);
    rememberSidekickRecent({
      endpoint: 'https://one.example',
      roomId: ROOM,
      displayName: 'Party',
      invitationSecret: 'secret-1',
      ownerSecret: null
    }, { rememberInvitation: true });
    forgetSidekickServer('https://one.example/');
    expect(sidekickServers.getSnapshot()).toHaveLength(1);
    expect(sidekickRecents.getSnapshot()).toHaveLength(0);
    sidekickServers.set([]);
    sidekickRecents.set([]);
  });

  it('keeps invitations only when Remember was chosen', () => {
    sidekickRecents.set([]);
    rememberSidekickRecent({
      endpoint: 'https://one.example',
      roomId: ROOM,
      displayName: 'Party',
      invitationSecret: 'secret-1',
      ownerSecret: 'owner-1'
    });
    expect(sidekickRecents.getSnapshot()[0]).toMatchObject({
      invitationSecret: null,
      ownerSecret: null
    });
    rememberSidekickRecent({
      endpoint: 'https://one.example',
      roomId: ROOM,
      displayName: 'Party',
      invitationSecret: 'secret-1',
      ownerSecret: 'owner-1'
    }, { rememberInvitation: true });
    expect(sidekickRecents.getSnapshot()[0]).toMatchObject({
      invitationSecret: 'secret-1',
      ownerSecret: 'owner-1'
    });
    forgetSidekickInvitation('https://one.example', ROOM);
    expect(sidekickRecents.getSnapshot()).toHaveLength(0);
  });

  it('drops invalid entries and caps the list', () => {
    sidekickRecents.set('not-a-list' as unknown as never);
    expect(sidekickRecents.getSnapshot()).toEqual([]);
    for (let i = 0; i < 12; i += 1) {
      rememberSidekickRecent({
        endpoint: `https://${i}.example`,
        roomId: ROOM,
        displayName: `Room ${i}`,
        invitationSecret: null,
        ownerSecret: null
      });
    }
    expect(sidekickRecents.getSnapshot()).toHaveLength(8);
    sidekickRecents.set([]);
  });
});
