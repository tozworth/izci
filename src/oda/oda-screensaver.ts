export function shuffleScreensaverItems<T>(
  items: readonly T[],
  random: () => number = Math.random,
  previous?: T
): T[] {
  const shuffled = [...items];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  if (shuffled.length > 1 && previous !== undefined && shuffled[0] === previous) {
    [shuffled[0], shuffled[1]] = [shuffled[1], shuffled[0]];
  }

  return shuffled;
}

export function randomScreensaverOffset(random: () => number = Math.random): number {
  return Math.round(random() * 1000) / 10;
}
