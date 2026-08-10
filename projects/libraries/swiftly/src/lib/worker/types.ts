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
  main: (data: T) => R | Promise<R>;
  /** Additional named helper functions serialized alongside `main`. */
  functions?: Function[];
}

/**
 * Base contract for anything that can process a task and be finalized.
 */
export interface TaskRunner<T = any, R = any> {
  /** Submits one value for worker-side processing. */
  run: (data: T, signal?: AbortSignal) => Promise<R>;
  /** Terminates the underlying worker resources. */
  dispose: () => Promise<void>;
}

/**
 * Plain background-task runner backed by one dedicated worker.
 *
 * Created by `coroutine(mainTask)` and accepted by `compose(...)`.
 */
export interface Coroutine<T = any, R = T> extends TaskRunner<T, R> {}

/**
 * Terminal state of a long-lived actor.
 */
export type ActorExit =
  | { readonly reason: "stopped" }
  | { readonly reason: "error"; readonly error: Error };

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
 * Unlike `Coroutine`, an actor owns exactly one worker.
 */
export interface Actor {
  /** Stable actor name used for actor-to-actor addressing. */
  readonly name: string;

  /** `true` while the behavior loop is running. */
  readonly running: boolean;

  /** Resolves exactly once when the actor terminates. */
  readonly done: Promise<ActorExit>;
}


/** Restart policy for a supervised actor. */
export type SupervisorOptions = {
  /** Maximum number of restarts after worker failure. Defaults to 3. */
  readonly maxRestarts?: number;
  /** Delay before each restart in milliseconds. Defaults to 0. */
  readonly restartDelay?: number;
};

/**
 * Stable lifecycle owner for an actor that may be recreated after worker failure.
 *
 * The supervisor itself is the addressable handle. Its `done` promise settles only
 * when it is explicitly stopped or its restart budget is exhausted.
 */
export interface Supervisor extends Actor {
  /** Number of actor generations restarted after failure. */
  readonly restarts: number;
  /** Current actor generation, when one is running. */
  readonly current: Actor | undefined;
}
