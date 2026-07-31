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
 * A cancellation context inspired by Go's `context.Context`.
 *
 * Carries an `AbortSignal`, a `done` promise, cancellation reason,
 * and an optional key/value bag for request-scoped data.
 */
export type Context = {
  /** Abort signal that becomes aborted when the context is cancelled. */
  readonly signal: AbortSignal;
  /** Promise that resolves when the context is cancelled. */
  readonly done: Promise<void>;
  /** The cancellation reason, if any. */
  readonly reason: unknown;
  /** Retrieves a value stored in the context by key. */
  value<T = unknown>(key: unknown): T | undefined;
  /** Returns a child context with an additional key/value pair. */
  withValue<T = unknown>(key: unknown, value: T): Context;
};

/**
 * Function that cancels a context, optionally supplying a reason.
 */
export type Cancel = (reason?: unknown) => void;

type ContextState = {
  controller: AbortController;
  values: Map<unknown, unknown>;
  parent?: Context;
};

/**
 * Creates an abort error from an `AbortSignal`'s reason.
 *
 * @param signal The abort signal to extract the reason from.
 * @returns An `Error` instance representing the abort reason.
 */
export const createAbortError = (signal?: AbortSignal): Error => {
  const reason = signal?.reason;
  if (reason instanceof Error) return reason;
  return new ContextCancelledError(reason ? String(reason) : undefined);
};

const createContextFromState = (state: ContextState): Context => {
  const done = new Promise<void>((resolve) => {
    if (state.controller.signal.aborted) {
      resolve();
    } else {
      state.controller.signal.addEventListener("abort", () => resolve(), { once: true });
    }
  });

  return {
    get signal() {
      return state.controller.signal;
    },
    done,
    get reason() {
      return state.controller.signal.reason;
    },
    value<T = unknown>(key: unknown): T | undefined {
      if (state.values.has(key)) return state.values.get(key) as T;
      return state.parent?.value<T>(key);
    },
    withValue<T = unknown>(key: unknown, value: T): Context {
      const values = new Map<unknown, unknown>();
      values.set(key, value);
      return createContextFromState({
        controller: state.controller,
        values,
        parent: this,
      });
    },
  };
};

/**
 * Creates a root context that is not derived from any parent.
 *
 * @returns A new background `Context`.
 */
export const background = (): Context =>
  createContextFromState({ controller: new AbortController(), values: new Map() });

/**
 * Derives a cancellable child context from a parent.
 *
 * The child is automatically cancelled when the parent is cancelled.
 *
 * @param parent The parent context. Defaults to `background()`.
 * @returns A tuple of `[childContext, cancel]`.
 */
export function withCancel(parent: Context = background()): [Context, Cancel] {
  const controller = new AbortController();
  const onParentAbort = () => controller.abort(parent.reason ?? new ContextCancelledError());

  if (parent.signal.aborted) {
    onParentAbort();
  } else {
    parent.signal.addEventListener("abort", onParentAbort, { once: true });
  }

  const ctx = createContextFromState({ controller, values: new Map(), parent });
  const cancel: Cancel = (reason = new ContextCancelledError()) => {
    parent.signal.removeEventListener("abort", onParentAbort);
    if (!controller.signal.aborted) controller.abort(reason);
  };
  return [ctx, cancel];
}

/**
 * Derives a child context that automatically cancels after a timeout.
 *
 * @param parent The parent context.
 * @param ms Timeout in milliseconds.
 * @returns A tuple of `[childContext, cancel]`.
 */
export function withTimeout(parent: Context, ms: number): [Context, Cancel] {
  const [ctx, cancel] = withCancel(parent);
  const timer = setTimeout(() => cancel(new ContextCancelledError(`context timeout after ${ms}ms`)), ms);
  ctx.done.finally(() => clearTimeout(timer));
  return [ctx, cancel];
}

/**
 * Derives a child context that automatically cancels at a specific deadline.
 *
 * @param parent The parent context.
 * @param deadline A `Date` or timestamp (in milliseconds) when the context should cancel.
 * @returns A tuple of `[childContext, cancel]`.
 */
export function withDeadline(parent: Context, deadline: Date | number): [Context, Cancel] {
  const time = typeof deadline === "number" ? deadline : deadline.getTime();
  return withTimeout(parent, Math.max(0, time - Date.now()));
}
