export const ABOUT_TIPS = [
  { kind: 'tip', id: 'trayVolume' },
  { kind: 'tip', id: 'loadouts' },
  { kind: 'tip', id: 'subsongs' },
  { kind: 'tip', id: 'patternChannels' },
  { kind: 'tip', id: 'moduleTools' },
  { kind: 'tip', id: 'titleBar' },
  { kind: 'tip', id: 'mobile' },
  { kind: 'tip', id: 'chameleon' },
  { kind: 'tip', id: 'restorePlayback' },
  { kind: 'tip', id: 'raf' },
  { kind: 'tip', id: 'advancedTweaks' },
  { kind: 'tip', id: 'backups' },
  { kind: 'tip', id: 'interpolation' },
  { kind: 'tip', id: 'experimental' },
  { kind: 'tip', id: 'multiplayerCache' },
  { kind: 'tip', id: 'contextualTabs' },
  { kind: 'fact', id: 'name' },
  { kind: 'fact', id: 'gruvbox' },
  { kind: 'fact', id: 'keygen' },
  { kind: 'fact', id: 'developmentTime' },
  { kind: 'fact', id: 'bugs' }
] as const;

type AboutTip = typeof ABOUT_TIPS[number];

export function createAboutTipRotation(random = Math.random): () => AboutTip {
  let remaining: AboutTip[] = [];
  let previous: AboutTip | undefined;

  return () => {
    if (remaining.length === 0) {
      remaining = [...ABOUT_TIPS];
      for (let index = remaining.length - 1; index > 0; index -= 1) {
        const other = Math.floor(random() * (index + 1));
        [remaining[index], remaining[other]] = [remaining[other], remaining[index]];
      }
      // Entries are consumed from the end; avoid a repeat across shuffled rounds.
      const last = remaining.length - 1;
      if (remaining[last] === previous) {
        [remaining[0], remaining[last]] = [remaining[last], remaining[0]];
      }
    }

    previous = remaining.pop()!;
    return previous;
  };
}

// The Options module survives page navigation, so re-entering About advances the deck.
export const nextAboutTip = createAboutTipRotation();

export function splitTipEmphasis(content: string) {
  return content.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).map((text) => {
    if (text.startsWith('**') && text.endsWith('**')) {
      return { text: text.slice(2, -2), emphasis: 'strong' as const };
    }
    if (text.startsWith('*') && text.endsWith('*')) {
      return { text: text.slice(1, -1), emphasis: 'em' as const };
    }
    return { text, emphasis: 'none' as const };
  });
}
