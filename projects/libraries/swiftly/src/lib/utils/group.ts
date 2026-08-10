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

/** Terminal outcome of one child, ordered by spawn order in a group report. */
export type GroupOutcome<T = unknown> =
  | { readonly status: "fulfilled"; readonly value: T }
  | { readonly status: "rejected"; readonly error: Error }
  | { readonly status: "cancelled"; readonly reason: Error };

/**
 * Non-throwing structured completion report.
 *
 * `error` is the group-level reason that `wait()` would throw: the first child
 * failure, explicit cancellation, or parent cancellation.
 */
export interface GroupReport {
  readonly outcomes: readonly GroupOutcome[];
  readonly error?: Error;
}

/**
 * Structured owner for a dynamic set of concurrent operations.
 *
 * A group has fail-fast semantics: the first child failure aborts all siblings.
 * `wait()` and `settle()` both close the group to new children and wait until
 * every started child has settled.
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
   * Closes the group and waits until every started child settles.
   * Rejects with the group-level failure/cancellation reason.
   */
  wait(): Promise<void>;

  /**
   * Closes the group and waits until every started child settles without
   * throwing. Outcomes are returned in spawn order.
   */
  settle(): Promise<GroupReport>;
}

type GroupWaiter = {
  resolve: (report: GroupReport) => void;
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
 * lifetime, propagates cancellation, cancels siblings on failure, can bound
 * execution, and can report the terminal state of every owned child.
 */
export function group(options: GroupOptions = {}): TaskGroup {
  const { concurrency, signal: parentSignal } = options;

  if (concurrency !== undefined && (!Number.isInteger(concurrency) || concurrency <= 0)) {
    throw new RangeError("group concurrency must be a positive integer");
  }

  const controller = new AbortController();
  const gate: Semaphore | undefined = concurrency === undefined ? undefined : semaphore(concurrency);
  const waiters: GroupWaiter[] = [];
  const outcomes: Array<GroupOutcome | undefined> = [];

  let running = 0;
  let accepting = true;
  let firstError: Error | undefined;
  let finalReport: GroupReport | undefined;

  const groupError = (): Error | undefined =>
    firstError ??
    (controller.signal.aborted ? createAbortError(controller.signal) : undefined);

  const createReport = (): GroupReport => {
    if (finalReport) return finalReport;
    finalReport = Object.freeze({
      outcomes: Object.freeze(
        outcomes.map((outcome) => {
          if (!outcome) {
            throw new Error("task group settled with an incomplete child outcome");
          }
          return outcome;
        }),
      ),
      error: groupError(),
    });
    return finalReport;
  };

  const settleWaiters = (): void => {
    if (running !== 0 || waiters.length === 0) return;

    const report = createReport();
    const settled = waiters.splice(0, waiters.length);
    for (const waiter of settled) waiter.resolve(report);
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

    const outcomeIndex = outcomes.length;
    // Reserve the slot so completion order can never affect report ordering.
    outcomes.push(undefined);
    running += 1;

    const child = (async () => {
      let release: (() => void) | undefined;
      try {
        if (gate) release = await gate.acquire(controller.signal);
        if (controller.signal.aborted) throw createAbortError(controller.signal);

        const value = await operation(controller.signal);
        outcomes[outcomeIndex] = { status: "fulfilled", value };
        return value;
      } catch (reason) {
        const error = normalizeError(reason);
        const alreadyCancelled = controller.signal.aborted;

        if (!firstError && !alreadyCancelled) {
          firstError = error;
          outcomes[outcomeIndex] = { status: "rejected", error };
          controller.abort(error);
        } else {
          const cancellationReason = normalizeError(controller.signal.reason ?? error);
          outcomes[outcomeIndex] = {
            status: "cancelled",
            reason: cancellationReason,
          };
        }

        throw error;
      } finally {
        release?.();
        finishChild();
      }
    })();

    // The group owns child failures even when callers choose to observe only
    // wait()/settle(). The returned promise still preserves the child result.
    void child.catch(() => undefined);
    return child;
  };

  const settle = (): Promise<GroupReport> => {
    accepting = false;

    if (running === 0) {
      detachParent();
      return Promise.resolve(createReport());
    }

    return new Promise<GroupReport>((resolve) => {
      waiters.push({ resolve });
    });
  };

  const wait = async (): Promise<void> => {
    const report = await settle();
    if (report.error) throw report.error;
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
    settle,
  };
}
