import { createAbortError, ContextCancelledError } from "./context";
import { semaphore, type Semaphore } from "./semaphore";

/**
 * One unit of structured asynchronous work owned by a task group.
 *
 * The supplied signal is aborted when the group is cancelled or when a sibling
 * fails. Operations are expected to pass it to cancellable work they start.
 */
export type GroupOperation<T> = (signal: AbortSignal) => T | Promise<T>;

/** Options controlling a structured task group. */
export type GroupOptions = {
  /** Maximum number of child operations allowed to execute at once. */
  concurrency?: number;
  /** Optional parent signal. Aborting it cancels the whole group. */
  signal?: AbortSignal;
};

/**
 * Structured owner for a dynamic set of concurrent operations.
 *
 * A group has fail-fast semantics: the first child failure aborts all siblings.
 * `wait()` closes the group to new children, waits for every started child to
 * settle, and then rethrows the first failure/cancellation reason.
 */
export interface TaskGroup {
  /** Signal shared by all children and aborted when the group is cancelled. */
  readonly signal: AbortSignal;
  /** Number of children that have been started but have not settled yet. */
  readonly running: number;
  /** Whether new child operations may still be started. */
  readonly accepting: boolean;

  /** Starts one child operation owned by this group. */
  spawn<T>(operation: GroupOperation<T>): Promise<T>;

  /** Cancels this group and every cooperative child operation. */
  cancel(reason?: unknown): void;

  /**
   * Closes the group to new work and waits until every started child settles.
   * Rejects with the first child failure or cancellation reason.
   */
  wait(): Promise<void>;
}

type GroupWaiter = {
  resolve: () => void;
  reject: (error: Error) => void;
};

const normalizeError = (reason: unknown): Error => {
  if (reason instanceof Error) return reason;
  if (reason === undefined) return new ContextCancelledError("task group cancelled");
  return new ContextCancelledError(String(reason));
};

/**
 * Creates a structured task group.
 *
 * This is intentionally different from `Promise.all()`: the group owns child
 * lifetime, propagates cancellation, cancels siblings on failure, and can bound
 * execution without changing the operations themselves.
 */
export function group(options: GroupOptions = {}): TaskGroup {
  const { concurrency, signal: parentSignal } = options;

  if (concurrency !== undefined && (!Number.isInteger(concurrency) || concurrency <= 0)) {
    throw new RangeError("group concurrency must be a positive integer");
  }

  const controller = new AbortController();
  const gate: Semaphore | undefined = concurrency === undefined ? undefined : semaphore(concurrency);
  const waiters: GroupWaiter[] = [];

  let running = 0;
  let accepting = true;
  let firstError: Error | undefined;

  const settleWaiters = (): void => {
    if (running !== 0 || waiters.length === 0) return;

    const settled = waiters.splice(0, waiters.length);
    const error = firstError ?? (controller.signal.aborted ? createAbortError(controller.signal) : undefined);

    for (const waiter of settled) {
      if (error) waiter.reject(error);
      else waiter.resolve();
    }
  };

  const cancel = (reason: unknown = new ContextCancelledError("task group cancelled")): void => {
    if (!controller.signal.aborted) controller.abort(reason);
    settleWaiters();
  };

  const onParentAbort = (): void => cancel(parentSignal?.reason);
  let parentListenerAttached = false;
  const detachParent = (): void => {
    if (!parentListenerAttached) return;
    parentSignal?.removeEventListener("abort", onParentAbort);
    parentListenerAttached = false;
  };

  if (parentSignal?.aborted) {
    onParentAbort();
  } else if (parentSignal) {
    parentSignal.addEventListener("abort", onParentAbort, { once: true });
    parentListenerAttached = true;
  }

  const finishChild = (): void => {
    running -= 1;
    if (!accepting && running === 0) detachParent();
    settleWaiters();
  };

  const spawn = <T>(operation: GroupOperation<T>): Promise<T> => {
    if (typeof operation !== "function") {
      return Promise.reject(new TypeError("group operation must be a function"));
    }
    if (!accepting) {
      return Promise.reject(new Error("task group is closed"));
    }
    if (controller.signal.aborted) {
      return Promise.reject(createAbortError(controller.signal));
    }

    running += 1;

    const child = (async () => {
      let release: (() => void) | undefined;
      try {
        if (gate) release = await gate.acquire(controller.signal);
        if (controller.signal.aborted) throw createAbortError(controller.signal);
        return await operation(controller.signal);
      } catch (reason) {
        const error = normalizeError(reason);
        if (!firstError && !controller.signal.aborted) {
          firstError = error;
          controller.abort(error);
        } else if (!firstError && controller.signal.aborted) {
          firstError = normalizeError(controller.signal.reason ?? error);
        }
        throw error;
      } finally {
        release?.();
        finishChild();
      }
    })();

    // The group owns child failures even when callers choose to observe only wait().
    // Attaching a rejection observer avoids process-level unhandled-rejection noise
    // without changing the promise returned to the caller.
    void child.catch(() => undefined);
    return child;
  };

  const wait = (): Promise<void> => {
    accepting = false;

    if (running === 0) {
      detachParent();
      if (firstError) return Promise.reject(firstError);
      if (controller.signal.aborted) return Promise.reject(createAbortError(controller.signal));
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      waiters.push({ resolve, reject });
    });
  };

  return {
    get signal() {
      return controller.signal;
    },
    get running() {
      return running;
    },
    get accepting() {
      return accepting;
    },
    spawn,
    cancel,
    wait,
  };
}