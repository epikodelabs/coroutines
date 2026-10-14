import {
    background,
    channel,
    ChannelClosedError,
    ContextCancelledError,
    createAbortError,
    otherwise,
    operation,
    receive,
    select,
    send,
    sleep,
    withCancel,
    withDeadline,
    withTimeout,
} from "../utils";
import { acquireBlobUrl, releaseBlobUrl } from "../worker/blob";
import type { WorkerProtocolMessage } from "../worker/messages";
import { createModuleWorker } from "../worker/module";
import { buildActorWorkerRuntime } from "../worker/runtimes";
import { ACTOR_CONCURRENCY_RUNTIME } from "../worker/concurrency";
import { buildWorkerScript } from "../worker/script";
import type { Actor, ActorExit, ActorOptions, ActorStopOptions } from "../worker/types";
import {
  clearActorBusListeners,
  createActorBusMessage,
  dispatchActorBusMessage,
  getActorInternals,
  getActorRequestHandler,
  isActorBusMessage,
  normalizeActorBusTargets,
  registerActorBusTarget,
  resolveActorBusTarget,
  resolveActorTarget,
  setActorInternals,
  subscribeActorBus,
  unregisterActorBusTarget,
} from "./bus";
import type {
  ActorBusDispatchOptions,
  ActorBusHandler,
  ActorBusMessage,
  ActorBusTarget,
} from "./bus";
export type { Actor, ActorExit, ActorOptions, Supervisor, SupervisorOptions } from "../worker/types";
export {
  createActorBusMessage,
  isActorBusMessage,
  registerActorRequestHandler,
  unregisterActorRequestHandler,
} from "./bus";
export type {
  ActorBusDispatchOptions,
  ActorBusHandler,
  ActorBusMessage,
  ActorBusSender,
  ActorBusTarget,
  ActorMessageContext,
  ActorRequestHandler,
} from "./bus";

/**
 * Concurrency utils injected into actor workers.
 *
 * These are the worker-side coroutine primitives available inside
 * `actor((msg, state, utils) => ...)`.
 *
 * They mirror the standalone concurrency API, but are pre-injected into the
 * actor worker so behaviors can coordinate background tasks without importing
 * anything from the main thread.
 *
 * - `channel(capacity?)`: create a worker-local async channel
 * - `receive(ch, name?)` / `send(ch, value, name?)`: build `select(...)` cases
 * - `otherwise(name?)`: default `select(...)` branch
 * - `operation(run, name?)`: cancellable async `select(...)` contender
 * - `select(cases, ctx?)`: race channel and async operations fairly
 * - `background()`: root cancellation context
 * - `withCancel/withTimeout/withDeadline(...)`: derive cancellable contexts
 * - `sleep(ms, signal?)`: suspend on the actor worker event loop
 * - `ChannelClosedError` / `ContextCancelledError`: worker-side error classes
 */
export type WorkerConcurrency = {
  channel: typeof channel;
  receive: typeof receive;
  send: typeof send;
  otherwise: typeof otherwise;
  operation: typeof operation;
  select: typeof select;
  background: typeof background;
  withCancel: typeof withCancel;
  withTimeout: typeof withTimeout;
  withDeadline: typeof withDeadline;
  sleep: typeof sleep;
  ChannelClosedError: typeof ChannelClosedError;
  ContextCancelledError: typeof ContextCancelledError;
};

/**
 * Outbox API exposed to actor workers.
 *
 * This handles targeted requests plus direct sends.
 */
export type WorkerOutbox<Q = any, D = any> = {
  /** Sends a request to one named target and awaits a response. Use `"main"` for the source actor's main-thread side. */
  request: (to: ActorBusTarget, topic: string, payload: Q) => Promise<D>;
  /** Sends a direct bus message to one or more named actor targets. */
  send: <T = any>(to: ActorBusTarget, topic: string, payload: T) => void;
};

/**
 * Inbox API for receiving messages routed to the actor worker.
 *
 * `listen()` consumes the next bus message that arrives while the behavior
 * is suspended: a message is delivered exactly once, either to a waiting
 * `listen()` or as the next behavior invocation — never both. The message
 * that triggered the current behavior is consumed by the behavior loop and
 * is never returned by `listen()`.
 */
export type WorkerInbox<Incoming = any> = {
  /** Consumes the next message routed to this actor, or `undefined` if the inbox closes. */
  listen: (signal?: AbortSignal) => Promise<Incoming | undefined>;
};

/**
 * Main-thread communication interface.
 *
 * `Initiator` describes the public shape of `main` so that consumers can
 * reference it explicitly rather than deriving it via `typeof main`.
 */
export interface Initiator {
  outbox: {
    /** Broadcasts a topic payload to every named actor through the actor bus. */
    publish<T = any>(topic: string, payload: T, options?: ActorBusDispatchOptions): void;

    /** Sends a one-way bus message to one or more named actor targets. */
    send<T = any>(to: Actor | string | string[], topic: string, payload: T, options?: Pick<ActorBusDispatchOptions, "from">): void;

    /**
     * Sends a request to an actor and awaits the response.
     *
     * Resolves with the value passed to `utils.reply(...)` by the behavior,
     * or with the behavior's new state when it does not reply explicitly.
     */
    request<Q = any, D = any>(to: Actor | string, topic: string, payload: Q, signal?: AbortSignal): Promise<D>;

    /** Stops the actor, terminates its worker, and releases resources. */
    stop(actor: Actor | string, options?: ActorStopOptions): Promise<void>;
  };

  inbox: {
    /** Subscribes to all actor-bus messages. */
    subscribe(handler: ActorBusHandler): () => void;
    /** Clears all global and direct bus listeners. */
    clear(): void;
  };
}

export type WorkerUtils<Q = any, D = any, Incoming = any> = {
  concurrency: WorkerConcurrency;
  outbox: WorkerOutbox<Q, D>;
  inbox: WorkerInbox<Incoming>;
  /**
   * Overrides the response payload for the request currently being handled.
   * Without it the response is the new state returned by the behavior.
   */
  reply: (value: D) => void;
};

/**
 * Actor behavior signature for autonomous entity mode.
 *
 * Receives a message, the current state, and worker utilities.
 * Returns the new state (or a Promise resolving to it).
 */
export interface ActorBehavior<S = any, Q = any, D = any, Incoming = any> {
  (msg: Incoming, state: S, utils: WorkerUtils<Q, D, Incoming>): Promise<S> | S;
}




const ACTOR_TERMINATION_TIMEOUT_MS = 100;
const ACTOR_STOPPED_ERROR_MESSAGE = "Actor stopped";

/**
 * Rejection carried when messaging an actor that has stopped, or when
 * in-flight requests are rejected because the actor is stopping.
 */
export class ActorStoppedError extends Error {
  constructor(message = ACTOR_STOPPED_ERROR_MESSAGE) {
    super(message);
    this.name = "ActorStoppedError";
  }
}

/**
 * Rejection carried by requests that arrive after a bounded actor mailbox is
 * saturated. Saturation never terminates the actor.
 */
export class ActorMailboxOverflowError extends Error {
  constructor(message = "Actor mailbox capacity exceeded") {
    super(message);
    this.name = "ActorMailboxOverflowError";
  }
}
let actorGenerationCounter = 0;

type PendingActorRequest<S> = {
  resolve: (value: S) => void;
  reject: (error: Error) => void;
  cleanup?: () => void;
};

const toErrorMessage = (
  error: unknown,
  fallback = "Actor request failed"
): string => (error instanceof Error ? error.message : error ? String(error) : fallback);

/**
 * Rebuilds typed rejections from error data that crossed the worker protocol.
 * The protocol carries an `errorName` alongside the message; known classes
 * regain their identity so callers can branch with instanceof. The
 * message-based fallback keeps compatibility with workers built before
 * `errorName` existed.
 */
const toRequestRejection = (
  message: string | undefined,
  errorName: string | undefined,
): Error => {
  const text = message ?? "Actor request failed";
  const types: Record<string, new (m: string) => Error> = {
    ActorStoppedError,
    ActorMailboxOverflowError,
  };
  const typed = errorName ? types[errorName] : undefined;
  if (typed) return new typed(text);
  if (text === ACTOR_STOPPED_ERROR_MESSAGE) return new ActorStoppedError(text);
  if (text === "Actor mailbox capacity exceeded") {
    return new ActorMailboxOverflowError(text);
  }
  return new Error(text);
};

function postActorResponse(
  sourceActor: Actor,
  worker: Worker,
  message: Pick<WorkerProtocolMessage, "workerId" | "taskId" | "requestId"> &
    ({ type: "response"; payload: unknown } | { type: "error"; error: string })
): boolean {
  if (!sourceActor.running) {
    return false;
  }

  try {
    worker.postMessage(message);
    return true;
  } catch (error) {
    console.warn("Actor request response transport failed:", error);
    return false;
  }
}

function handleRequest<Q>(
  message: WorkerProtocolMessage,
  sourceActor: Actor,
  worker: Worker
) {
  const { workerId, taskId, requestId, payload, topic } = message;
  const targets = normalizeActorBusTargets(message.to);

  if (targets.length !== 1) {
    postActorResponse(sourceActor, worker, {
      workerId,
      taskId,
      requestId,
      type: "error",
      error: "Actor request requires exactly one target",
    });
    return;
  }

  const targetName = targets[0];
  const handler = getActorRequestHandler(targetName);

  if (!handler) {
    postActorResponse(sourceActor, worker, {
      workerId,
      taskId,
      requestId,
      type: "error",
      error: `No actor request handler registered for "${targetName}"`,
    });
    return;
  }

  if (!topic) {
    postActorResponse(sourceActor, worker, {
      workerId,
      taskId,
      requestId,
      type: "error",
      error: "Actor request requires a topic",
    });
    return;
  }

  try {
    const result = handler(topic, payload as Q, {
      from: sourceActor.name,
      to: message.to,
      topic,
    });
    Promise.resolve(result)
      .then((resolved) => {
        postActorResponse(sourceActor, worker, {
          workerId,
          taskId,
          requestId,
          type: "response",
          payload: resolved,
        });
      })
      .catch((err) => {
        postActorResponse(sourceActor, worker, {
          workerId,
          taskId,
          requestId,
          type: "error",
          error: toErrorMessage(err),
        });
      });
  } catch (err) {
    postActorResponse(sourceActor, worker, {
      workerId,
      taskId,
      requestId,
      type: "error",
      error: toErrorMessage(err),
    });
  }
}

/**
 * Creates an autonomous behavior-mode actor.
 *
 * `actor(name, behavior, initialState, ...helpers)` eagerly creates one
 * stable named actor worker and returns its handle.
 *
 * @example
 * ```ts
 * const counter = actor(
 *   "counter",
 *   (msg, state) =>
 *     msg.kind === "actor-bus" && msg.topic === "inc"
 *       ? state + msg.payload.n
 *       : state,
 *   0,
 * );
 * const value = await main.outbox.request(counter, "inc", { n: 2 });
 * await main.outbox.stop(counter);
 * ```
 */
export function actor<S = any, Q = any, D = any, FromMain = any>(
  name: string,
  behavior: ActorBehavior<S, Q, D, FromMain>,
  initialState?: S,
  ...helpers: (Function | string)[]
): Actor;
export function actor<S = any, Q = any, D = any, FromMain = any>(
  name: string,
  behavior: ActorBehavior<S, Q, D, FromMain>,
  initialState: S | undefined,
  options: ActorOptions,
  ...helpers: (Function | string)[]
): Actor;
export function actor<S = any, Q = any, D = any, FromMain = any>(
  name: string,
  behavior: ActorBehavior<S, Q, D, FromMain>,
  initialState?: S,
  optionsOrHelper?: ActorOptions | Function | string,
  ...remainingHelpers: (Function | string)[]
): Actor {
  const options =
    optionsOrHelper &&
    typeof optionsOrHelper === "object" &&
    !Array.isArray(optionsOrHelper)
      ? optionsOrHelper as ActorOptions
      : {};
  const helpers =
    typeof optionsOrHelper === "function" || typeof optionsOrHelper === "string"
      ? [optionsOrHelper, ...remainingHelpers]
      : remainingHelpers;

  return createActor(name, behavior, initialState, options, helpers);
}

function createActor<S = any, Q = any, D = any, FromMain = any>(
  name: string,
  behavior: ActorBehavior<S, Q, D, FromMain>,
  initialState: S | undefined,
  options: ActorOptions,
  helpers: (Function | string)[]
): Actor {
  if (!name || typeof name !== "string") {
    throw new Error("Actor name must be a non-empty string");
  }

  const capacity = options.capacity;
  if (capacity !== undefined && (!Number.isInteger(capacity) || capacity < 0)) {
    throw new RangeError("actor capacity must be a non-negative integer");
  }

  const functionHelpers = helpers.filter((h): h is Function => typeof h === "function");
  const stringHelpers = helpers.filter((h): h is string => typeof h === "string");

  const workerScript = buildWorkerScript({
    helpers: [ACTOR_CONCURRENCY_RUNTIME, ...stringHelpers],
    main: behavior as any,
    functions: functionHelpers,
    runtime: buildActorWorkerRuntime(capacity),
  });

  const blobUrl = acquireBlobUrl(workerScript);
  const actorWorkerId = ++actorGenerationCounter;
  const actorTaskId = `actor:${actorWorkerId}`;

  let worker: Worker | null = null;
  let running = false;
  let dropped = 0;
  let nextRequestId = 1;
  const pendingRequests = new Map<string, PendingActorRequest<S>>();
  let shutdown$: Promise<void> | null = null;
  let finishShutdown: (() => void) | null = null;
  let shouldReleaseBlobUrl = false;
  let hasReleasedBlobUrl = false;
  let requestedExit: ActorExit = { reason: "stopped" };
  let hasSettledDone = false;
  let resolveDone!: (exit: ActorExit) => void;
  const done = new Promise<ActorExit>((resolve) => {
    resolveDone = resolve;
  });

  const settleDone = () => {
    if (hasSettledDone) {
      return;
    }

    hasSettledDone = true;
    resolveDone(requestedExit);
  };

  try {
    worker = createModuleWorker(blobUrl);
  } catch (error) {
    releaseBlobUrl(workerScript);
    throw error;
  }

  (worker as any).__id = actorWorkerId;
  running = true;

  let actorRef: Actor;

  const releaseWorkerScript = () => {
    if (!shouldReleaseBlobUrl || hasReleasedBlobUrl) {
      return;
    }

    hasReleasedBlobUrl = true;
    releaseBlobUrl(workerScript);
  };

  const rejectPendingRequests = (reason: string | Error = ACTOR_STOPPED_ERROR_MESSAGE) => {
    if (pendingRequests.size === 0) {
      return;
    }

    const error = typeof reason === "string" ? new ActorStoppedError(reason) : reason;
    for (const { reject, cleanup } of pendingRequests.values()) {
      cleanup?.();
      reject(error);
    }

    pendingRequests.clear();
  };

  const takePendingRequest = (requestId: string) => {
    const pending = pendingRequests.get(requestId);
    if (!pending) return undefined;
    pendingRequests.delete(requestId);
    pending.cleanup?.();
    return pending;
  };

  const postToWorker = (
    target: Worker,
    message: Omit<WorkerProtocolMessage, "workerId">
  ) => {
    target.postMessage({
      workerId: actorWorkerId,
      ...message,
    });
  };

  const shutdown = (
    releaseBlobUrlOnExit: boolean,
    exit: ActorExit = { reason: "stopped" },
    options?: ActorStopOptions,
  ) => {
    shouldReleaseBlobUrl ||= releaseBlobUrlOnExit;
    if (!shutdown$) {
      requestedExit = exit;
    }

    if (shutdown$) {
      releaseWorkerScript();
      return shutdown$;
    }

    if (!options?.drain) {
      // Draining keeps the actor live on the main side until the stop
      // finalizes: behaviors still processing admitted messages may keep
      // sending to main and resolving requests. Inbound admission is refused
      // worker-side, and leftovers are rejected when the stop finalizes.
      running = false;
      rejectPendingRequests(exit.reason === "error" ? exit.error : ACTOR_STOPPED_ERROR_MESSAGE);
    }
    unregisterActorBusTarget(actorRef);

    const activeWorker = worker;
    if (!activeWorker) {
      releaseWorkerScript();
      settleDone();
      return Promise.resolve();
    }

    shutdown$ = new Promise<void>((resolve) => {
      let settled = false;

      const finalizeShutdown = () => {
        if (settled) {
          return;
        }

        settled = true;
        finishShutdown = null;
        running = false;
        rejectPendingRequests(exit.reason === "error" ? exit.error : ACTOR_STOPPED_ERROR_MESSAGE);
        activeWorker.removeEventListener("message", handleMessage);
        activeWorker.removeEventListener("error", handleError);
        activeWorker.terminate();
        if (worker === activeWorker) {
          worker = null;
        }
        releaseWorkerScript();
        settleDone();
        resolve();
      };

      const timeoutId = setTimeout(
        finalizeShutdown,
        options?.graceMs ?? ACTOR_TERMINATION_TIMEOUT_MS,
      );
      finishShutdown = () => {
        clearTimeout(timeoutId);
        finalizeShutdown();
      };

      try {
        postToWorker(activeWorker, {
          taskId: actorTaskId,
          type: "stop",
          drain: options?.drain === true,
        });
      } catch {
        finishShutdown();
      }
    });

    return shutdown$;
  };

  const failActor = (error: Error): void => {
    if (!running && shutdown$) return;
    running = false;
    rejectPendingRequests(error);
    unregisterActorBusTarget(actorRef);
    void shutdown(true, { reason: "error", error });
  };

  const handleMessage = (event: MessageEvent<WorkerProtocolMessage>) => {
    const msg = event.data;

    if (
      msg.workerId !== actorWorkerId ||
      msg.taskId !== actorTaskId
    ) {
      return;
    }

    const { type, payload, requestId } = msg;

    if (type === "response" && requestId) {
      takePendingRequest(requestId)?.resolve(payload);
    } else if (type === "error" && requestId) {
      takePendingRequest(requestId)?.reject(toRequestRejection(msg.error, msg.errorName));
    } else if (type === "error" && !requestId) {
      failActor(new Error(msg.error ?? "Actor behavior failed"));
    } else if (type === "overflow") {
      if (!running) return;
      dropped += 1;
      console.warn(`Actor "${name}" mailbox capacity exceeded; message dropped`);
    } else if (type === "request") {
      if (!running || !worker) return;
      handleRequest(msg, actorRef, worker);
    } else if (type === "notify") {
      if (!running) {
        return;
      }
      if (isActorBusMessage(payload)) {
        dispatchActorBusMessage(payload, { fromActor: actorRef });
        return;
      }
      // Non-bus notify payloads are ignored; behaviors receive messages via the inbox listen cycle.
    } else if (type === "stopped") {
      running = false;
      rejectPendingRequests();
      if (finishShutdown) {
        finishShutdown();
      } else {
        void shutdown(true);
      }
    }
  };

  const handleError = (event: ErrorEvent) => {
    if (!running) {
      return;
    }

    const error =
      event.error instanceof Error
        ? event.error
        : new Error(event.message || "Actor worker failed");

    failActor(error);
  };

  const actor: Actor = {
    name,

    get running() {
      return running;
    },

    get mailboxCapacity() {
      return capacity;
    },

    get dropped() {
      return dropped;
    },

    done,
  };

  actorRef = actor;

  worker.addEventListener("message", handleMessage);
  worker.addEventListener("error", handleError);

  try {
    postToWorker(worker, {
      taskId: actorTaskId,
      payload: initialState,
      mailboxCapacity: capacity,
      type: "init",
    });
  } catch (error) {
    worker.removeEventListener("message", handleMessage);
    worker.removeEventListener("error", handleError);
    worker.terminate();
    worker = null;
    running = false;
    hasReleasedBlobUrl = true;
    releaseBlobUrl(workerScript);
    throw error;
  }

  registerActorBusTarget(name, actorRef);

  const internals = {
    stop(options?: ActorStopOptions) {
      return shutdown(true, { reason: "stopped" }, options);
    },
    post(msg: FromMain) {
      if (!worker || !running) {
        console.warn("Actor is not running; message dropped");
        return;
      }

      try {
        postToWorker(worker, {
          taskId: actorTaskId,
          payload: msg,
          type: "notify",
        });
      } catch (reason) {
        const error = reason instanceof Error ? reason : new Error(String(reason));
        void shutdown(true, { reason: "error", error });
        throw error;
      }
    },

    request(topic: string, msg: FromMain, signal?: AbortSignal): Promise<S> {
      if (!worker || !running) {
        return Promise.reject(new ActorStoppedError());
      }
      if (signal?.aborted) {
        return Promise.reject(createAbortError(signal));
      }

      const id = String(nextRequestId++);
      return new Promise((resolve, reject) => {
        const onAbort = () => {
          const pending = takePendingRequest(id);
          if (!pending) return;
          reject(createAbortError(signal));
        };
        const cleanup = () => signal?.removeEventListener("abort", onAbort);

        pendingRequests.set(id, { resolve, reject, cleanup });
        signal?.addEventListener("abort", onAbort, { once: true });

        try {
          postToWorker(worker!, {
            taskId: actorTaskId,
            // Behaviors always receive bus envelopes, regardless of whether a
            // message arrived as a one-way send or a request.  Keeping this
            // shape consistent is what lets a behavior branch on `kind` and
            // `topic` for both forms of main-thread communication.
            payload: createActorBusMessage(topic, msg, {
              from: "main",
              to: name,
            }),
            requestId: id,
            type: "request",
            topic,
          });
        } catch (reason) {
          pendingRequests.delete(id);
          cleanup();
          const error = reason instanceof Error ? reason : new Error(String(reason));
          reject(error);
          void shutdown(true, { reason: "error", error });
        }
      });
    },
  };

  setActorInternals(actor, internals);

  return actor;
}



export const main: Initiator = {
  outbox: {
    /** Broadcasts a topic payload to every named actor through the actor bus. */
    publish<T = any>(
      topic: string,
      payload: T,
      options?: ActorBusDispatchOptions
    ): void {
      dispatchActorBusMessage(
        createActorBusMessage(topic, payload, { from: options?.from ?? "main" }),
        { includeSelf: options?.includeSelf }
      );
    },

    /** Sends a one-way bus message to one or more named actor targets. */
    send<T = any>(
      to: Actor | string | string[],
      topic: string,
      payload: T,
      options?: Pick<ActorBusDispatchOptions, "from">
    ): void {
      dispatchActorBusMessage(
        createActorBusMessage(topic, payload, { from: options?.from ?? "main", to: resolveActorBusTarget(to) as ActorBusTarget }),
        {}
      );
    },

    /** Sends a request to an actor and awaits the response. */
    request<Q = any, D = any>(to: Actor | string, topic: string, payload: Q, signal?: AbortSignal): Promise<D> {
      const target = resolveActorTarget(to);
      if (!target) {
        return Promise.reject(new Error(`Unknown actor target "${String(to)}"`));
      }

      return getActorInternals(target).request(topic, payload, signal);
    },

    /** Stops the actor, terminates its worker, and releases resources. */
    stop(actor: Actor | string, options?: ActorStopOptions): Promise<void> {
      const target = resolveActorTarget(actor);
      if (!target) {
        return Promise.reject(new Error(`Unknown actor target "${String(actor)}"`));
      }
      if (
        options?.graceMs !== undefined &&
        (!Number.isFinite(options.graceMs) || options.graceMs < 0)
      ) {
        return Promise.reject(
          new RangeError("actor stop graceMs must be a non-negative finite number"),
        );
      }

      return getActorInternals(target).stop(options);
    },
  },

  inbox: {
    subscribe: subscribeActorBus,

    clear: () => {
      clearActorBusListeners();
    },
  },
};
