/**
 * Internal queued-work scheduler for execution paths that actually queue work.
 *
 * Priority is preferential, not absolute: after 32 bypasses the oldest waiting
 * item is promoted once. This bounds starvation while preserving strict FIFO
 * among equal priorities and normal priority ordering under ordinary load.
 */
export const MAX_PRIORITY_BYPASSES = 32;

export interface ScheduledItem {
  priority: number;
  sequence: number;
  bypasses: number;
}

/** Removes and returns the next scheduled item from `queue`. */
export function takeNextScheduled<T extends ScheduledItem>(queue: T[]): T | undefined {
  if (queue.length === 0) return undefined;

  let bestIndex = -1;
  let oldestStarvedSequence = Number.POSITIVE_INFINITY;

  for (let index = 0; index < queue.length; index++) {
    const item = queue[index];
    if (
      item.bypasses >= MAX_PRIORITY_BYPASSES &&
      item.sequence < oldestStarvedSequence
    ) {
      bestIndex = index;
      oldestStarvedSequence = item.sequence;
    }
  }

  if (bestIndex < 0) {
    bestIndex = 0;
    for (let index = 1; index < queue.length; index++) {
      const candidate = queue[index];
      const best = queue[bestIndex];
      if (
        candidate.priority > best.priority ||
        (candidate.priority === best.priority && candidate.sequence < best.sequence)
      ) {
        bestIndex = index;
      }
    }
  }

  const [selected] = queue.splice(bestIndex, 1);
  for (const item of queue) {
    item.bypasses += 1;
  }
  return selected;
}