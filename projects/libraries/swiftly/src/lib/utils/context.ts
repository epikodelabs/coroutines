import { scheduleWorkerTimer } from "../worker/timer";

/**
 * Thrown when a context is cancelled or times out.
 */
export class ContextCancelledError extends Error {
  constructor(message = "context cancelled") {
    super(message);
    this.name = "ContextCancelledError";
  }
}

/**
 * Cancellation scope used by Swiftly coordination primitives.
 *
 * A context carries only lifecycle state: its `AbortSignal`, completion promise,
 * and terminal reason. Application data should be passed explicitly through
 * ordinary JavaScript values rather than hidden in the cancellation tree.
 */
export type Context = {
  /** Abort signal that becomes aborted when the context is cancelled. */
  readonly signal: AbortSignal;
  /** Promise that resolves when the context is cancelled. */
  readonly done: Promise<void>;
  /** The cancellation reason, if any. */
  readonly reason: unknown;
};

/**
 * Function that cancels a context, optionally supplying a reason.
 */
export type Cancel = (reason?: unknown) => void;

/**
 * Creates an abort error from an `AbortSignal`'s reason.
 */
export const createAbortError = (signal?: AbortSignal): Error => {
  const reason = signal?.reason;
  if (reason instanceof Error) return reason;
  return new ContextCancelledError(reason ? String(reason) : undefined);
};

const createContext = (controller: AbortController): Context => {
  const signal = controller.signal;
  const done = new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
    } else {
      signal.addEventListener("abort", () => resolve(), { once: true });
    }
  });

  return {
    signal,
    done,
    get reason() {
      return signal.reason;
    },
  };
};

const backgroundContext = createContext(new AbortController());

/**
 * Returns Swiftly's immutable root cancellation context.
 *
 * The background context never cancels, so one shared instance avoids creating
 * an AbortController and never-settling completion promise for every default
 * coordination call.
 */
export const background = (): Context => backgroundContext;

/**
 * Derives a cancellable child context from a parent.
 *
 * The child is automatically cancelled when the parent is cancelled.
 */
export function withCancel(parent: Context = background()): [Context, Cancel] {
  const controller = new AbortController();
  const onParentAbort = () =>
    controller.abort(parent.reason ?? new ContextCancelledError());

  if (parent.signal.aborted) {
    onParentAbort();
  } else {
    parent.signal.addEventListener("abort", onParentAbort, { once: true });
  }

  const ctx = createContext(controller);
  const cancel: Cancel = (reason = new ContextCancelledError()) => {
    parent.signal.removeEventListener("abort", onParentAbort);
    if (!controller.signal.aborted) controller.abort(reason);
  };

  return [ctx, cancel];
}

/**
 * Derives a child context that automatically cancels after a timeout.
 */
export function withTimeout(parent: Context, ms: number): [Context, Cancel] {
  if (!Number.isFinite(ms) || ms < 0) {
    throw new RangeError("timer duration must be a finite non-negative number");
  }

  const [ctx, cancel] = withCancel(parent);

  try {
    const timer = scheduleWorkerTimer(
      ms,
      () => cancel(new ContextCancelledError(`context timeout after ${ms}ms`)),
      (error) => cancel(error),
    );
    ctx.done.finally(() => timer.cancel());
    return [ctx, cancel];
  } catch (error) {
    cancel(error);
    throw error;
  }
}

/**
 * Derives a child context that automatically cancels at a specific deadline.
 */
export function withDeadline(
  parent: Context,
  deadline: Date | number,
): [Context, Cancel] {
  const time = typeof deadline === "number" ? deadline : deadline.getTime();
  const remaining = time - Date.now();

  if (remaining <= 0) {
    const [ctx, cancel] = withCancel(parent);
    cancel(new ContextCancelledError("context deadline exceeded"));
    return [ctx, cancel];
  }

  return withTimeout(parent, remaining);
}