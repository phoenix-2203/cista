/** Asking back a few words of the recovery phrase, to be sure it was written down. */

/** `count` distinct word positions (0-based), in order, chosen at random. */
export function pickPositions(words: number, count = 3, random: (n: number) => number = randomBelow): number[] {
  const picked = new Set<number>();
  while (picked.size < Math.min(count, words)) picked.add(random(words));
  return [...picked].sort((a, b) => a - b);
}

function randomBelow(n: number): number {
  const x = crypto.getRandomValues(new Uint32Array(1))[0]!;
  return x % n;
}

/** Does the typed word match? Case and surrounding spaces don't matter. */
export const sameWord = (typed: string, word: string) => typed.trim().toLowerCase() === word.toLowerCase();
