import { createAbortError, ContextCancelledError } from "./context";
import { createDefinitionExecutor, isCoroutineDefinition } from "../worker/definition";
import type { Coroutine, Executor, ExecutorOptions } from "../worker/types";
import type { TaskRunControl } from "./transfer";

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
  /**
   * Failure policy for this group.
   *
   * `"propagate"` (default) is the structured-concurrency rule: a child
   * failure fails this group and — for a child scope — propagates to the
   * parent, which cancels sibling work and makes `parent.wait()` reject.
   *
   * `"isolate"` suppresses upward propagation: this group's failures stay
   * local, so a parent can contain recoverable background work. The parent
   * still awaits this group's completion and still cancels it on its own
   * cancellation.
   */
  failure?: "propagate" | "isolate";
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
   * This includes actively executing children, queued children, and child
   * scopes created via `group()`.
   */
  readonly running: number;
  /** Whether new child operations may still be accepted. */
  readonly accepting: boolean;

  /** Accepts one child operation owned by this group. */
  spawn<T>(operation: GroupOperation<T>): Promise<T>;

  /**
   * Creates a worker-pool executor for a coroutine definition.
   *
   * The pool's lifetime belongs to this group: `settle()`/`wait()` stop it
   * from accepting new runs, drain admitted runs, and terminate its workers;
   * cancellation disposes it immediately. Runs submitted after the group
   * closed reject with `GroupClosedError`. Executors created by an ancestor
   * group survive this group's settlement — reuse them across child scopes
   * by lifting ownership to the nearest shared parent.
   */
  executor<T, R>(definition: Coroutine<T, R>, options?: ExecutorOptions): Executor<T, R>;

  /**
   * Creates a child scope of this group.
   *
   * The child is aborted when this group is cancelled, and this group's
   * `settle()`/`wait()` close the child to new spawns and await its full
   * settlement (including its executor pools). By default child failures
   * propagate to this group and fail it; pass `{ failure: "isolate" }` to
   * contain a recoverable background scope. The child's own cancellation and
   * settlement are local to the child.
   */
  group(options?: GroupOptions): TaskGroup;

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

/**
 * Internal handle shared between a group and its parent scope.
 */
type GroupInternals = {
  readonly controller: AbortController;
  readonly cancel: (reason?: unknown) => void;
  readonly fail: (error: Error) => void;
  readonly beginSettlement: () => void;
  readonly adoptScope: (child: GroupInternals) => void;
  /** Resolves when the group is closed and fully quiescent (children and executor pools). */
  readonly whenDrained: Promise<void>;
};

const normalizeError = (reason: unknown): Error => {
  if (reason instanceof Error) return reason;
  if (reason === undefined) return new ContextCancelledError("task group cancelled");
  return new ContextCancelledError(String(reason));
};

function createGroup(
  options: GroupOptions = {},
  scopeParent?: GroupInternals,
): { group: TaskGroup; internals: GroupInternals } {
  const { concurrency, signal: parentSignal, failure = "propagate" } = options;

  if (concurrency !== undefined && (!Number.isInteger(concurrency) || concurrency <= 0)) {
    throw new RangeError("group concurrency must be a positive integer");
  }
  if (failure !== "propagate" && failure !== "isolate") {
    throw new RangeError('group failure must be "propagate" or "isolate"');
  }

  const isolateFailure = failure === "isolate";

  const controller = new AbortController();
  const limit = concurrency ?? Number.POSITIVE_INFINITY;
  const queue: QueuedChild[] = [];
  const waiters: GroupWaiter[] = [];
  const outcomes: Array<GroupOutcome | undefined> = [];
  const executors: Executor[] = [];
  const childScopes: GroupInternals[] = [];

  let active = 0;
  let running = 0;
  let accepting = true;
  let settlementRequested = false;
  let drainsStarted = false;
  let drainsPending = 0;
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

  const drainedResolvers: Array<() => void> = [];
  const whenDrained = new Promise<void>((resolve) => {
    drainedResolvers.push(resolve);
  });
  const checkDrained = (): void => {
    if (running === 0 && drainsPending === 0 && (settlementRequested || !accepting)) {
      for (const resolve of drainedResolvers.splice(0)) resolve();
    }
  };

  const settleWaiters = (): void => {
    if (running !== 0 || drainsPending !== 0 || waiters.length === 0) return;

    const report = createReport();
    const settled = waiters.splice(0, waiters.length);
    for (const waiter of settled) waiter.resolve(report);
    checkDrained();
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
    checkDrained();
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

  const startExecutorDrains = (): void => {
    if (drainsStarted) return;
    drainsStarted = true;

    for (const executor of executors) {
      drainsPending += 1;
      void executor
        .close()
        .catch(() => undefined)
        .finally(() => {
          drainsPending -= 1;
          settleWaiters();
          checkDrained();
        });
    }
  };

  const disposeExecutors = (): void => {
    for (const executor of executors) {
      void executor.dispose().catch(() => undefined);
    }
  };

  const cancel = (
    reason: unknown = new ContextCancelledError("task group cancelled"),
  ): void => {
    accepting = false;
    if (!controller.signal.aborted) controller.abort(reason);
    cancelQueued();
    disposeExecutors();
    if (running === 0) detachParent();
    settleWaiters();
    checkDrained();
  };

  if (parentSignal?.aborted) {
    onParentAbort();
  } else if (parentSignal) {
    parentSignal.addEventListener("abort", onParentAbort, { once: true });
    parentListenerAttached = true;
  }

  const fail = (error: Error, outcomeIndex?: number): void => {
    if (firstError || controller.signal.aborted) return;

    firstError = error;
    accepting = false;
    if (outcomeIndex !== undefined) {
      outcomes[outcomeIndex] = { status: "rejected", error };
    }
    controller.abort(error);
    cancelQueued();
    disposeExecutors();
    if (!isolateFailure) scopeParent?.fail(error);
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

  const executor = <T, R>(
    definition: Coroutine<T, R>,
    options: ExecutorOptions = {},
  ): Executor<T, R> => {
    if (!isCoroutineDefinition(definition)) {
      throw new TypeError(
        "executor requires a definition created by coroutine() or compose()",
      );
    }
    if (settlementRequested) throw new GroupClosedError();
    if (controller.signal.aborted) throw createAbortError(controller.signal);
    if (!accepting) throw new GroupClosedError();

    const pool = createDefinitionExecutor(definition, options);
    executors.push(pool);

    // The wrapper re-checks the group state so group closure always surfaces
    // as GroupClosedError instead of the pool's internal RunnerClosedError.
    const run = (data: T, control?: TaskRunControl): Promise<R> => {
      if (settlementRequested) return Promise.reject(new GroupClosedError());
      if (controller.signal.aborted) return Promise.reject(createAbortError(controller.signal));
      if (!accepting) return Promise.reject(new GroupClosedError());
      return pool.run(data, control);
    };

    return {
      get size() {
        return pool.size;
      },
      run,
      close: pool.close,
      dispose: pool.dispose,
    };
  };

  const beginSettlement = (): void => {
    if (settlementRequested) return;
    settlementRequested = true;
    accepting = false;
    startExecutorDrains();
    for (const child of childScopes) child.beginSettlement();
    checkDrained();
  };

  const settle = (): Promise<GroupReport> => {
    beginSettlement();

    if (running === 0 && drainsPending === 0) {
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

  const adoptScope = (child: GroupInternals): void => {
    running += 1;
    void child.whenDrained.then(() => {
      running -= 1;
      if (!accepting && running === 0) detachParent();
      settleWaiters();
      checkDrained();
    });
  };

  const internals: GroupInternals = {
    controller,
    cancel,
    fail,
    beginSettlement,
    adoptScope,
    whenDrained,
  };

  const createChildScope = (childOptions: GroupOptions = {}): TaskGroup => {
    const child = createGroup(childOptions, internals);
    childScopes.push(child.internals);

    const onParentAbortChild = (): void =>
      child.internals.cancel(controller.signal.reason);
    if (controller.signal.aborted) {
      onParentAbortChild();
    } else {
      controller.signal.addEventListener("abort", onParentAbortChild, { once: true });
    }
    void child.internals.whenDrained.then(() => {
      controller.signal.removeEventListener("abort", onParentAbortChild);
    });

    if (settlementRequested) {
      child.internals.beginSettlement();
    }

    adoptScope(child.internals);
    return child.group;
  };

  return {
    group: {
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
      executor,
      group: createChildScope,
      cancel,
      wait,
      settle,
    },
    internals,
  };
}

/**
 * Creates a structured task group.
 *
 * This is intentionally different from `Promise.all()`: the group owns child
 * lifetime, propagates cancellation, cancels siblings on failure, queues excess
 * bounded work itself, can report the terminal state of every owned child, and
 * owns the worker pools of its executors.
 */
export function group(options: GroupOptions = {}): TaskGroup {
  return createGroup(options).group;
}
