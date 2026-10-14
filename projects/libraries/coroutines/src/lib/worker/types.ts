import type { TaskRunControl } from "../utils/transfer";

declare const __coroutineBrand: unique symbol;

/**
 * Immutable worker-task definition produced by `coroutine()` or `compose()`.
 *
 * A definition is pure executable code and metadata — it owns no workers,
 * accepts no runs, and has no lifecycle. It is an opaque branded handle; its
 * script internals are held privately by the library.
 */
export interface Coroutine<I = any, O = I> {
  readonly [__coroutineBrand]: true;
}

/**
 * Base contract for anything that can process a task and be finalized.
 */
export interface Executor<T = any, R = any> {
  /** Number of workers this executor currently owns (idle plus active). */
  readonly size: number;
  /** Submits one value for worker-side processing. */
  run: (data: T, control?: TaskRunControl) => Promise<R>;
  /**
   * Stops accepting new work, drains already-admitted work, then releases resources.
   * Repeated calls share the same lifecycle completion.
   */
  close: () => Promise<void>;
  /**
   * Immediately terminates resources and rejects queued/active work.
   * Use `close()` when admitted work should be allowed to finish.
   */
  dispose: () => Promise<void>;
}

/**
 * Any run-shaped step accepted by `pipeline()`.
 */
export interface Runnable<T = any, R = any> {
  run: (data: T, control?: TaskRunControl) => Promise<R>;
}

/**
 * Main-thread sequencing of runnable steps.
 *
 * A pipeline owns nothing: it orders execution only. The steps' worker pools
 * and lifetimes belong to their groups.
 */
export interface Pipeline<T = any, R = any> {
  run: (data: T, control?: TaskRunControl) => Promise<R>;
}

/**
 * Options for a group-owned executor pool.
 */
export type ExecutorOptions = {
  /** Maximum number of workers this executor may own concurrently. */
  readonly maxWorkers?: number;
  /** Terminates workers that stay idle longer than this many milliseconds. */
  readonly idleTimeout?: number;
};

/**
 * Thrown when a task runner refuses work because it was closed or disposed.
 * Graceful `close()` and immediate `dispose()` share this failure type.
 */
export class RunnerClosedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunnerClosedError";
  }
}

/**
 * Terminal state of a long-lived actor.
 */
export type ActorExit =
  | { readonly reason: "stopped" }
  | { readonly reason: "error"; readonly error: Error };


/** Bounded mailbox policy for an actor generation. */
export type ActorOptions = {
  /** Maximum number of messages allowed to wait behind the currently executing behavior. Omit for the legacy unbounded mailbox. */
  readonly capacity?: number;
};

/**
 * Long-lived stateful worker with bidirectional messaging.
 *
 * `Actor` is an opaque handle to a persistent behavior loop running in a
 * dedicated worker. Messaging is done through the `main` utility:
 * `main.outbox.send(actorOrName, topic, msg)`, `main.outbox.request(actorOrName, topic, msg)`,
 * and `main.inbox.subscribe(handler)`.
 *
 * Lifecycle is managed through the bus — call `main.outbox.stop(actorOrName)`
 * to stop the actor and release resources.
 *
 * Unlike `Coroutine`, an actor owns persistent worker identity and state.
 */
export interface Actor {
  /** Stable actor name used for actor-to-actor addressing. */
  readonly name: string;

  /** `true` while the behavior loop is running. */
  readonly running: boolean;

  /** Configured bounded mailbox capacity, or `undefined` for an unbounded mailbox. */
  readonly mailboxCapacity: number | undefined;

  /** Number of one-way messages dropped because a bounded mailbox was saturated. */
  readonly dropped: number;

  /** Resolves exactly once when the actor terminates. */
  readonly done: Promise<ActorExit>;
}


/** Restart policy for a supervised actor. */
export type SupervisorOptions = {
  /** Maximum number of restart attempts after actor failure. Defaults to 3. */
  readonly maxRestarts?: number;
  /** Delay before each restart attempt in milliseconds. Defaults to 0. */
  readonly restartDelay?: number;
  /**
   * Number of sends/requests that may wait while no actor generation is running.
   * Defaults to 0, preserving fail-fast behavior unless buffering is explicit.
   */
  readonly capacity?: number;
};

/** Options for stopping an actor. */
export type ActorStopOptions = {
  /**
   * Lets the actor finish every already-admitted mailbox message before
   * exiting. Messages that arrive during the drain are refused; requests
   * receive `ActorStoppedError`.
   */
  readonly drain?: boolean;
  /**
   * Hard-terminate fallback in milliseconds. A stopping worker normally
   * reports its own exit; this timer only bounds a stuck stop. Defaults
   * to 100ms.
   */
  readonly graceMs?: number;
};

/**
 * Stable lifecycle owner for an actor that may be recreated after worker failure.
 *
 * The supervisor itself is the addressable handle. Its `done` promise settles only
 * when it is explicitly stopped or its restart budget is exhausted.
 */
export interface Supervisor extends Actor {
  /** Number of restart attempts consumed after actor failure. */
  readonly restarts: number;
  /** Current actor generation, when one is running. */
  readonly current: Actor | undefined;
  /** Configured restart-window ingress capacity. */
  readonly capacity: number;
  /** Number of sends/requests currently waiting for a replacement generation. */
  readonly pending: number;
}