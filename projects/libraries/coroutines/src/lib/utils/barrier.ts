import { createAbortError } from "./context";

/**
 * Reusable synchronization barrier for phased concurrent work.
 *
 * Each call to `wait()` joins the current generation. Once the configured
 * number of participants has arrived, every waiter is released and the
 * barrier automatically advances to the next generation.
 */
export interface Barrier {
  /** Number of arrivals required to release one barrier generation. */
  readonly participants: number;
  /** Number of participants currently waiting in this generation. */
  readonly waiting: number;

  /**
   * Arrives at the barrier and waits for the remaining participants.
   *
   * Cancelling the supplied signal withdraws this arrival while the barrier is
   * still waiting, so a later participant must take its place.
   */
  wait(signal?: AbortSignal): Promise<void>;
}

type BarrierWaiter = {
  resolve: () => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  abort?: () => void;
};

/**
 * Creates a reusable synchronization barrier.
 *
 * @param participants Number of arrivals required to release each generation.
 */
export function barrier(participants: number): Barrier {
  if (!Number.isInteger(participants) || participants <= 0) {
    throw new RangeError("barrier participants must be a positive integer");
  }

  let waiters: BarrierWaiter[] = [];

  const cleanup = (waiter: BarrierWaiter): void => {
    if (waiter.signal && waiter.abort) {
      waiter.signal.removeEventListener("abort", waiter.abort);
    }
  };

  const releaseGeneration = (): void => {
    const completed = waiters;
    waiters = [];

    for (const waiter of completed) {
      cleanup(waiter);
      waiter.resolve();
    }
  };

  const wait = (signal?: AbortSignal): Promise<void> => {
    if (signal?.aborted) {
      return Promise.reject(createAbortError(signal));
    }

    return new Promise<void>((resolve, reject) => {
      const waiter: BarrierWaiter = { resolve, reject, signal };

      if (signal) {
        waiter.abort = () => {
          const index = waiters.indexOf(waiter);
          if (index < 0) {
            return;
          }

          waiters.splice(index, 1);
          cleanup(waiter);
          reject(createAbortError(signal));
        };
        signal.addEventListener("abort", waiter.abort, { once: true });
      }

      waiters.push(waiter);
      if (waiters.length === participants) {
        releaseGeneration();
      }
    });
  };

  return {
    get participants() {
      return participants;
    },
    get waiting() {
      return waiters.length;
    },
    wait,
  };
}