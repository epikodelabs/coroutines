import { createAbortError } from "./context";

/**
 * Stateful broadcast signal for coordinating concurrent work.
 *
 * A concurrency event has two states: set and clear. Calling `set()` releases
 * every current waiter and keeps the event set, so future `wait()` calls
 * complete immediately. Calling `clear()` returns it to the blocking state.
 *
 * Unlike a channel, an event does not transfer values or consume readiness.
 * It represents shared readiness that any number of participants may observe.
 */
export interface ConcurrencyEvent {
  /** Whether the event is currently set. */
  readonly isSet: boolean;
  /** Number of callers currently blocked in `wait()`. */
  readonly waiting: number;

  /** Sets the event and releases every current waiter. */
  set(): void;

  /** Clears the event. Future waiters block until the next `set()`. */
  clear(): void;

  /**
   * Waits until the event is set.
   *
   * Resolves immediately when already set. Cancelling one waiter removes only
   * that waiter and does not change the event state or affect other waiters.
   */
  wait(signal?: AbortSignal): Promise<void>;
}

type EventWaiter = {
  resolve: () => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  abort?: () => void;
};

/**
 * Creates a reusable manual-reset concurrency event.
 *
 * @param initiallySet Whether the event should begin in the set state.
 */
export function event(initiallySet = false): ConcurrencyEvent {
  if (typeof initiallySet !== "boolean") {
    throw new TypeError("event initial state must be a boolean");
  }

  let isSet = initiallySet;
  const waiters: EventWaiter[] = [];

  const cleanup = (waiter: EventWaiter): void => {
    if (waiter.signal && waiter.abort) {
      waiter.signal.removeEventListener("abort", waiter.abort);
    }
  };

  const set = (): void => {
    if (isSet) {
      return;
    }

    isSet = true;
    const released = waiters.splice(0, waiters.length);
    for (const waiter of released) {
      cleanup(waiter);
      waiter.resolve();
    }
  };

  const clear = (): void => {
    isSet = false;
  };

  const wait = (signal?: AbortSignal): Promise<void> => {
    if (signal?.aborted) {
      return Promise.reject(createAbortError(signal));
    }

    if (isSet) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      const waiter: EventWaiter = { resolve, reject, signal };

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

      // `AbortSignal` can only transition synchronously from user code, but the
      // event itself may be set by re-entrant code while the waiter is being
      // registered. Re-checking here keeps registration state deterministic.
      if (isSet) {
        const index = waiters.indexOf(waiter);
        if (index >= 0) {
          waiters.splice(index, 1);
          cleanup(waiter);
          resolve();
        }
      }
    });
  };

  return {
    get isSet() {
      return isSet;
    },
    get waiting() {
      return waiters.length;
    },
    set,
    clear,
    wait,
  };
}