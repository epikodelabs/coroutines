import { createAbortError, ContextCancelledError } from "./context";

/**
 * Thrown when a group no longer accepts children: after `wait()`/`settle()`,
 * explicit cancellation, or the first child failure.
 */
export class GroupClosedError extends Error {
  constructor(message = "task group is closed") {
    super(message);
    this.name = "GroupClosedError";
  }
}

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
 * Every accepted child is owned immediately. With bounded concurrency, excess
 * children wait in the group's FIFO queue and their operation does not start
 * until an execution slot becomes free.
 *
 * A group has fail-fast semantics: the first child failure aborts running
 * siblings and cancels queued children before they start. `wait()` and
 * `settle()` both close the group to new children and wait until every accepted
 * child has settled.
 */
export interface TaskGroup {
  /** Signal shared by all children and aborted when the group is cancelled. */
  readonly signal: AbortSignal;
  /**
   * Number of accepted children that have not settled yet.
   *
   * This includes both actively executing and queued children.
   */
  readonly running: number;
  /** Whether new child operations may still be accepted. */
  readonly accepting: boolean;

  /** Accepts one child operation owned by this group. */
  spawn<T>(operation: GroupOperation<T>): Promise<T>;

  /** Cancels this group and every cooperative child operation. */
  cancel(reason?: unknown): void;

  /**
   * Closes the group and waits until every accepted child settles.
   * Rejects with the group-level failure/cancellation reason.
   */
  wait(): Promise<void>;

  /**
   * Closes the group and waits until every accepted child settles without
   * throwing. Outcomes are returned in spawn order.
   */
  settle(): Promise<GroupReport>;
}

type GroupWaiter = {
  resolve: (report: GroupReport) => void;
};

type QueuedChild = {
  operation: GroupOperation<any>;
  outcomeIndex: number;
  resolve: (value: any) => void;
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
 * lifetime, propagates cancellation, cancels siblings on failure, queues excess
 * bounded work itself, and can report the terminal state of every owned child.
 */
export function group(options: GroupOptions = {}): TaskGroup {
  const { concurrency, signal: parentSignal } = options;

  if (concurrency !== undefined && (!Number.isInteger(concurrency) || concurrency <= 0)) {
    throw new RangeError("group concurrency must be a positive integer");
  }

  const controller = new AbortController();
  const limit = concurrency ?? Number.POSITIVE_INFINITY;
  const queue: QueuedChild[] = [];
  const waiters: GroupWaiter[] = [];
  const outcomes: Array<GroupOutcome | undefined> = [];

  let active = 0;
  let running = 0;
  let accepting = true;
  let settlementRequested = false;
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

  const onParentAbort = (): void => cancel(parentSignal?.reason);
  let parentListenerAttached = false;
  const detachParent = (): void => {
    if (!parentListenerAttached) return;
    parentSignal?.removeEventListener("abort", onParentAbort);
    parentListenerAttached = false;
  };

  const finishOwnedChild = (): void => {
    running -= 1;
    if (!accepting && running === 0) detachParent();
    settleWaiters();
  };

  const cancelQueued = (): void => {
    if (queue.length === 0) return;

    const reason = normalizeError(controller.signal.reason);
    const cancelled = queue.splice(0, queue.length);
    for (const child of cancelled) {
      outcomes[child.outcomeIndex] = { status: "cancelled", reason };
      child.reject(reason);
      finishOwnedChild();
    }
  };

  const cancel = (
    reason: unknown = new ContextCancelledError("task group cancelled"),
  ): void => {
    accepting = false;
    if (!controller.signal.aborted) controller.abort(reason);
    cancelQueued();
    if (running === 0) detachParent();
    settleWaiters();
  };

  if (parentSignal?.aborted) {
    onParentAbort();
  } else if (parentSignal) {
    parentSignal.addEventListener("abort", onParentAbort, { once: true });
    parentListenerAttached = true;
  }

  const fail = (error: Error, outcomeIndex: number): void => {
    if (firstError || controller.signal.aborted) return;

    firstError = error;
    accepting = false;
    outcomes[outcomeIndex] = { status: "rejected", error };
    controller.abort(error);
    cancelQueued();
  };

  const pump = (): void => {
    while (
      active < limit &&
      queue.length > 0 &&
      !controller.signal.aborted
    ) {
      const child = queue.shift()!;
      active += 1;

      void (async () => {
        try {
          const value = await child.operation(controller.signal);
          outcomes[child.outcomeIndex] = { status: "fulfilled", value };
          child.resolve(value);
        } catch (reason) {
          const error = normalizeError(reason);
          const alreadyCancelled = controller.signal.aborted;

          if (!firstError && !alreadyCancelled) {
            fail(error, child.outcomeIndex);
          } else {
            const cancellationReason = normalizeError(
              controller.signal.reason ?? error,
            );
            outcomes[child.outcomeIndex] = {
              status: "cancelled",
              reason: cancellationReason,
            };
          }

          child.reject(error);
        } finally {
          active -= 1;
          finishOwnedChild();
          pump();
        }
      })();
    }
  };

  const spawn = <T>(operation: GroupOperation<T>): Promise<T> => {
    if (typeof operation !== "function") {
      return Promise.reject(new TypeError("group operation must be a function"));
    }
    if (settlementRequested) {
      return Promise.reject(new GroupClosedError());
    }
    if (controller.signal.aborted) {
      return Promise.reject(createAbortError(controller.signal));
    }
    if (!accepting) {
      return Promise.reject(new GroupClosedError());
    }

    const outcomeIndex = outcomes.length;
    outcomes.push(undefined);
    running += 1;

    const child = new Promise<T>((resolve, reject) => {
      queue.push({
        operation,
        outcomeIndex,
        resolve,
        reject,
      });
      pump();
    });

    // The group owns child failures even when callers choose to observe only
    // wait()/settle(). The returned promise still preserves the child result.
    void child.catch(() => undefined);
    return child;
  };

  const settle = (): Promise<GroupReport> => {
    settlementRequested = true;
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