import { createAbortError } from "./context";

/**
 * Releases one semaphore permit.
 *
 * Release functions are idempotent so cleanup code can safely call them more
 * than once without increasing the semaphore capacity.
 */
export type SemaphoreRelease = () => void;

/**
 * Counting semaphore for bounding arbitrary asynchronous concurrency.
 *
 * Unlike a channel, a semaphore does not transfer values. It controls how many
 * callers may enter a concurrent section at once. Waiting acquirers are served
 * in FIFO order.
 */
export interface Semaphore {
  /** Maximum number of permits managed by this semaphore. */
  readonly capacity: number;
  /** Number of permits that can be acquired immediately. */
  readonly available: number;
  /** Number of callers currently waiting for a permit. */
  readonly waiting: number;

  /**
   * Acquires one permit, waiting when all permits are in use.
   *
   * The returned release function must be called when the protected work
   * finishes. A waiting acquisition can be cancelled with an `AbortSignal`.
   */
  acquire(signal?: AbortSignal): Promise<SemaphoreRelease>;

  /**
   * Attempts to acquire one permit without waiting.
   *
   * Returns `undefined` when no permit is immediately available.
   */
  tryAcquire(): SemaphoreRelease | undefined;
}

type Waiter = {
  resolve: (release: SemaphoreRelease) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  abort?: () => void;
};

/**
 * Creates a fair counting semaphore.
 *
 * @param capacity Maximum number of concurrent permit holders.
 * @returns A semaphore with FIFO acquisition order.
 */
export function semaphore(capacity: number): Semaphore {
  if (!Number.isInteger(capacity) || capacity <= 0) {
    throw new RangeError("semaphore capacity must be a positive integer");
  }

  let available = capacity;
  const waiters: Waiter[] = [];

  const removeWaiter = (waiter: Waiter): void => {
    const index = waiters.indexOf(waiter);
    if (index >= 0) {
      waiters.splice(index, 1);
    }
    if (waiter.signal && waiter.abort) {
      waiter.signal.removeEventListener("abort", waiter.abort);
    }
  };

  const createRelease = (): SemaphoreRelease => {
    let released = false;

    return () => {
      if (released) {
        return;
      }
      released = true;

      while (waiters.length > 0) {
        const waiter = waiters.shift()!;
        if (waiter.signal && waiter.abort) {
          waiter.signal.removeEventListener("abort", waiter.abort);
        }
        if (waiter.signal?.aborted) {
          waiter.reject(createAbortError(waiter.signal));
          continue;
        }

        waiter.resolve(createRelease());
        return;
      }

      available += 1;
    };
  };

  const tryAcquire = (): SemaphoreRelease | undefined => {
    if (available <= 0 || waiters.length > 0) {
      return undefined;
    }

    available -= 1;
    return createRelease();
  };

  const acquire = (signal?: AbortSignal): Promise<SemaphoreRelease> => {
    if (signal?.aborted) {
      return Promise.reject(createAbortError(signal));
    }

    const release = tryAcquire();
    if (release) {
      return Promise.resolve(release);
    }

    return new Promise<SemaphoreRelease>((resolve, reject) => {
      const waiter: Waiter = { resolve, reject, signal };

      if (signal) {
        waiter.abort = () => {
          removeWaiter(waiter);
          reject(createAbortError(signal));
        };
        signal.addEventListener("abort", waiter.abort, { once: true });
      }

      waiters.push(waiter);
    });
  };

  return {
    get capacity() {
      return capacity;
    },
    get available() {
      return available;
    },
    get waiting() {
      return waiters.length;
    },
    acquire,
    tryAcquire,
  };
}
