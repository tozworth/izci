import { readable } from 'svelte/store';

// Host snapshots are event-driven. Advance their presentation clock between
// messages without changing the authoritative transport state.
export const multiplayerDisplayNow = readable(Date.now(), (set) => {
  const timer = window.setInterval(() => set(Date.now()), 250);
  return () => window.clearInterval(timer);
});
