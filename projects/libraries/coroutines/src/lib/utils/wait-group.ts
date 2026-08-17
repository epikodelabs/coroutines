import { createAbortError } from "./context";

/**
 * Dynamic completion counter for concurrent work.
 *
 * A wait group tracks a changing number of outstanding operations. Call
 * `add()` before starting work, `done()` exactly once when each operation
 * finishes, and `wait()` when another operation needs to observe completion.
 *
 * Unlike a barrier, participants do not have to arrive together and the number
 * of outstanding operations may grow while a generation is active.
 */
export interface WaitGroup {
  /** Number of operations that have not called `done()` yet. */
  readonly count: number;
  /** Number of callers currently blocked in `wait()`. */
  readonly waiting: number;

  /**
   * Adds outstanding work to the current generation.
   *
   * @param count Number of operations to add. Defaults to `1`.
   */
  add(count?: number): void;

  /**
   * Marks one outstanding operation as complete.
   *
   * Throws when called with no outstanding work so accounting bugs are not
   * silently hidden.
   */
  done(): void;

  /**
   * Waits until the current outstanding count reaches zero.
   *
   * If the count is already zero, resolves immediately. Cancelling the signal
   * only withdraws this waiter; it does not change the tracked work count.
   */
  wait(signal?: AbortSignal): Promise<void>;
}

type Waiter = {
  resolve: () => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  abort?: () => void;
};

/**
 * Creates a reusable wait group.
 *
 * The wait group naturally supports multiple generations: after the count
 * reaches zero and all current waiters are released, later `add()` calls begin
 * tracking a new set of work.
 */
export function waitGroup(): WaitGroup {
  let count = 0;
  const waiters: Waiter[] = [];

  const cleanup = (waiter: Waiter): void => {
    if (waiter.signal && waiter.abort) {
      waiter.signal.removeEventListener("abort", waiter.abort);
    }
  };

  const releaseWaiters = (): void => {
    const completed = waiters.splice(0, waiters.length);
    for (const waiter of completed) {
      cleanup(waiter);
      waiter.resolve();
    }
  };

  const add = (amount = 1): void => {
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new RangeError("wait group add count must be a positive integer");
    }

    count += amount;
  };

  const done = (): void => {
    if (count === 0) {
      throw new Error("wait group done called with no outstanding work");
    }

    count -= 1;
    if (count === 0) {
      releaseWaiters();
    }
  };

  const wait = (signal?: AbortSignal): Promise<void> => {
    if (signal?.aborted) {
      return Promise.reject(createAbortError(signal));
    }

    if (count === 0) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = { resolve, reject, signal };

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
    });
  };

  return {
    get count() {
      return count;
    },
    get waiting() {
      return waiters.length;
    },
    add,
    done,
    wait,
  };
}