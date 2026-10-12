import type { TaskRunControl, WorkerTaskResult, WorkerTaskUtils } from "../utils/transfer";

/**
 * Task descriptor ready to be baked into a worker blob.
 *
 * `main` and `functions` are the single source of truth.
 * String forms are derived on demand via `serializeScript()`.
 */
export interface CoroutineScript<T = any, R = any> {
  /** Raw worker-side snippets injected before the serialized functions. */
  helpers?: string[];
  /** Main task body executed inside the worker. */
  main: (data: T, utils: WorkerTaskUtils) => WorkerTaskResult<R> | Promise<WorkerTaskResult<R>>;
  /** Additional named helper functions serialized alongside `main`. */
  functions?: Function[];
}

/**
 * Base contract for anything that can process a task and be finalized.
 */
export interface TaskRunner<T = any, R = any> {
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
 * Stateless background-task runner backed by an elastic reusable worker list.
 *
 * Created by `coroutine(mainTask)` and accepted by `compose(...)`.
 */
export interface Coroutine<T = any, R = T> extends TaskRunner<T, R> {}

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