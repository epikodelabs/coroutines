import {
    background,
    channel,
    ChannelClosedError,
    ContextCancelledError,
    otherwise,
    receive,
    select,
    send,
    withCancel,
    withDeadline,
    withTimeout,
} from "../utils";
import { acquireBlobUrl, releaseBlobUrl } from "../worker/blob";
import type { WorkerProtocolMessage } from "../worker/messages";
import { buildActorWorkerRuntime } from "../worker/runtimes";
import { buildWorkerScript } from "../worker/script";
import type { Actor } from "../worker/types";

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
 * - `select(cases, ctx?)`: race channel operations fairly
 * - `background()`: root cancellation context
 * - `withCancel/withTimeout/withDeadline(...)`: derive cancellable contexts
 * - `ChannelClosedError` / `ContextCancelledError`: worker-side error classes
 */
export type WorkerConcurrency = {
  channel: typeof channel;
  receive: typeof receive;
  send: typeof send;
  otherwise: typeof otherwise;
  select: typeof select;
  background: typeof background;
  withCancel: typeof withCancel;
  withTimeout: typeof withTimeout;
  withDeadline: typeof withDeadline;
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
 * This includes direct messages from `main.outbox.send(...)` as well as actor-bus
 * deliveries routed through `main.bus`.
 */
export type WorkerInbox<Incoming = any> = {
  /** Receives the next message routed to this actor, or `undefined` if the inbox closes. */
  listen: (signal?: AbortSignal) => Promise<Incoming | undefined>;
};

/**
 * Actor-bus delivery target.
 */
export type ActorBusTarget = string | string[];

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

    /** Sends a request to an actor and awaits the response. */
    request<Q = any, D = any>(to: Actor | string, topic: string, payload: Q): Promise<D>;

    /** Stops the actor, terminates its worker, and releases resources. */
    stop(actor: Actor | string): Promise<void>;
  };

  inbox: {
    /** Subscribes to all actor-bus messages. */
    subscribe(handler: ActorBusHandler): () => void;
    /** Clears all global and direct bus listeners. */
    clear(): void;
  };
}

/** Sender name stamped onto actor-bus messages. */
export type ActorBusSender = string;

/**
 * Structured bus envelope exchanged between actors through a main-thread bus.
 */
export type ActorBusMessage<T = any> = {
  kind: "actor-bus";
  topic: string;
  payload: T;
  from?: ActorBusSender;
  to?: ActorBusTarget;
};

/**
 * Dispatch options for main-thread actor-bus publishing.
 */
export type ActorBusDispatchOptions = {
  /**
   * Stable sender name to stamp onto the routed message.
   */
  from?: ActorBusSender;
  /**
   * Includes the sender during broadcast delivery when `from` is set.
   */
  includeSelf?: boolean;
};

/**
 * Main-thread subscriber invoked for each routed bus envelope.
 */
export type ActorBusHandler<T = any> = (
  message: ActorBusMessage<T>
) => void | Promise<void>;

/**
 * Main-thread actor bus integrated into the actor messaging surface.
 *
 * Workers send direct messages through `utils.outbox.send(to, topic, payload)`,
 * while the main thread can publish or send through `main.bus`.
 */
export interface ActorBus {
  /**
   * Broadcasts a topic payload to every actor.
   */
  publish: <T = any>(
    topic: string,
    payload: T,
    options?: ActorBusDispatchOptions
  ) => void;
  /**
   * Sends a topic payload to one or more explicit actor names.
   */
  send: <T = any>(
    to: ActorBusTarget,
    topic: string,
    payload: T,
    options?: Pick<ActorBusDispatchOptions, "from">
  ) => void;
  /**
   * Routes a prebuilt actor-bus envelope.
   */
  dispatch: <T = any>(
    message: ActorBusMessage<T>,
    options?: Pick<ActorBusDispatchOptions, "includeSelf">
  ) => void;
  /**
   * Listens to all routed bus envelopes, or only to direct messages sent to a name.
   */
  listen: {
    <T = any>(handler: ActorBusHandler<T>): () => void;
    <T = any>(name: string, handler: ActorBusHandler<T>): () => void;
  };
  /**
   * Clears all actor registrations and listeners from the integrated bus.
   */
  clear: () => void;
}

/**
 * Utility functions available to actor workers.
 */
type WorkerUtilsCompatibility<_T> = {};

export type WorkerUtils<Q = any, D = any, Incoming = any, ToMain = any> = {
  concurrency: WorkerConcurrency;
  outbox: WorkerOutbox<Q, D>;
  inbox: WorkerInbox<Incoming>;
} & WorkerUtilsCompatibility<ToMain>;

/**
 * Actor behavior signature for autonomous entity mode.
 *
 * Receives a message, the current state, and worker utilities.
 * Returns the new state (or a Promise resolving to it).
 */
export interface ActorBehavior<S = any, Q = any, D = any, Incoming = any> {
  (msg: Incoming, state: S, utils: WorkerUtils<Q, D, Incoming>): Promise<S> | S;
}

/**
 * Public request/message metadata surfaced to advanced actor hooks.
 *
 * This intentionally exposes routing information rather than the full internal
 * worker protocol.
 */
export type ActorMessageContext = {
  /** Actor name that initiated the request or direct message, when known. */
  from?: string;
  /** Target name(s) for direct actor routing. */
  to?: ActorBusTarget;
  /** Topic associated with the routed request or message. */
  topic?: string;
};

/**
 * Request handler used by `utils.outbox.request(name, topic, payload)`.
 *
 * Keep this function small, or delegate to a `coroutine(...)` instance via
 * `request: dataWorker.run` when data resolution itself is expensive.
 */
export type ActorRequestHandler<Q = any, D = any> = (
  topic: string,
  request: Q,
  message: ActorMessageContext
) => Promise<D> | D;

/**
 * Registry of request handlers looked up by actor name.
 */
const actorRequestHandlers = new Map<string, ActorRequestHandler<any, any>>();

/**
 * Registers a main-thread request handler for a target actor name.
 * Workers call `utils.outbox.request(name, topic, payload)` — the handler
 * registered for `name` receives the call and returns the response.
 *
 * Register `"main"` to handle requests sent to the main thread.
 */
export function registerActorRequestHandler<Q = any, D = any>(
  name: string,
  handler: ActorRequestHandler<Q, D>
): () => void {
  actorRequestHandlers.set(name, handler);
  return () => actorRequestHandlers.delete(name);
}

/**
 * Removes a request handler previously registered for a name.
 */
export function unregisterActorRequestHandler(name: string): void {
  actorRequestHandlers.delete(name);
}

/**
 * Creates a typed actor-bus envelope.
 */
export function createActorBusMessage<T = any>(
  topic: string,
  payload: T,
  options?: { from?: string; to?: ActorBusTarget }
): ActorBusMessage<T> {
  return {
    kind: "actor-bus",
    topic,
    payload,
    from: options?.from,
    to: options?.to,
  };
}

/**
 * Checks whether a payload is an actor-bus envelope.
 */
export function isActorBusMessage<T = any>(value: unknown): value is ActorBusMessage<T> {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as ActorBusMessage<T>).kind === "actor-bus" &&
    typeof (value as ActorBusMessage<T>).topic === "string"
  );
}

const ACTOR_CONCURRENCY_RUNTIME = `
class __streamixChannelClosedError extends Error {
  constructor(message = "channel is closed") {
    super(message);
    this.name = "ChannelClosedError";
  }
}

class __streamixContextCancelledError extends Error {
  constructor(message = "context cancelled") {
    super(message);
    this.name = "ContextCancelledError";
  }
}

const __streamixCreateAbortError = (signal) => {
  const reason = signal?.reason;
  if (reason instanceof Error) return reason;
  return new __streamixContextCancelledError(reason ? String(reason) : undefined);
};

const __streamixChannelInternals = Symbol("streamix.channelInternals");

const __streamixChannel = (capacity = 0) => {
  if (!Number.isInteger(capacity) || capacity < 0) {
    throw new RangeError("channel capacity must be a non-negative integer");
  }

  const buffer = [];
  const receivers = [];
  const senders = [];
  let isClosed = false;

  const cleanupReceiver = (receiver) => {
    if (receiver.signal && receiver.abort) {
      receiver.signal.removeEventListener("abort", receiver.abort);
    }
  };

  const cleanupSender = (sender) => {
    if (sender.signal && sender.abort) {
      sender.signal.removeEventListener("abort", sender.abort);
    }
  };

  const removeReceiver = (receiver) => {
    const index = receivers.indexOf(receiver);
    if (index >= 0) receivers.splice(index, 1);
    cleanupReceiver(receiver);
  };

  const removeSender = (sender) => {
    const index = senders.indexOf(sender);
    if (index >= 0) senders.splice(index, 1);
    cleanupSender(sender);
  };

  const settleSelectedReceive = (receiver, value, ok) =>
    receiver.select.registration.settle({
      index: receiver.select.meta.index,
      caseRef: receiver.select.meta.caseRef,
      op: "receive",
      name: receiver.select.meta.name,
      value,
      ok,
    });

  const settleSelectedSend = (sender) =>
    sender.select.registration.settle({
      index: sender.select.meta.index,
      caseRef: sender.select.meta.caseRef,
      op: "send",
      name: sender.select.meta.name,
      ok: true,
    });

  const rejectSelectedWaiter = (waiter, error) =>
    waiter.select.registration.reject(error);

  const tryDispatchToWaitingReceiver = (value, senderSelectId) => {
    for (let index = 0; index < receivers.length; index++) {
      const receiver = receivers[index];
      const receiverSelectId = receiver.select?.registration.id;

      if (receiver.select?.registration.isSettled()) {
        receivers.splice(index, 1);
        cleanupReceiver(receiver);
        index -= 1;
        continue;
      }

      if (senderSelectId && receiverSelectId === senderSelectId) {
        continue;
      }

      receivers.splice(index, 1);
      cleanupReceiver(receiver);

      if (receiver.select) {
        if (!settleSelectedReceive(receiver, value, true)) {
          index -= 1;
          continue;
        }
      } else {
        receiver.resolve({ ok: true, value });
      }

      return true;
    }

    return false;
  };

  const tryAcquireFromWaitingSender = (receiverSelectId) => {
    for (let index = 0; index < senders.length; index++) {
      const sender = senders[index];
      const senderSelectId = sender.select?.registration.id;

      if (sender.select?.registration.isSettled()) {
        senders.splice(index, 1);
        cleanupSender(sender);
        index -= 1;
        continue;
      }

      if (receiverSelectId && senderSelectId === receiverSelectId) {
        continue;
      }

      senders.splice(index, 1);
      cleanupSender(sender);

      if (sender.select) {
        if (!settleSelectedSend(sender)) {
          index -= 1;
          continue;
        }
      } else {
        sender.resolve();
      }

      return { ok: true, value: sender.value };
    }

    if (isClosed) {
      return { ok: false, value: undefined };
    }

    return undefined;
  };

  const tryBufferWaitingSender = () => {
    for (let index = 0; index < senders.length; index++) {
      const sender = senders[index];

      if (sender.select?.registration.isSettled()) {
        senders.splice(index, 1);
        cleanupSender(sender);
        index -= 1;
        continue;
      }

      senders.splice(index, 1);
      cleanupSender(sender);

      if (sender.select) {
        if (!settleSelectedSend(sender)) {
          index -= 1;
          continue;
        }
      } else {
        sender.resolve();
      }

      buffer.push(sender.value);
      return true;
    }

    return false;
  };

  const tryPairWaitingSenderToReceiver = () => {
    for (let index = 0; index < senders.length; index++) {
      const sender = senders[index];
      const senderSelectId = sender.select?.registration.id;

      if (sender.select?.registration.isSettled()) {
        senders.splice(index, 1);
        cleanupSender(sender);
        index -= 1;
        continue;
      }

      if (!tryDispatchToWaitingReceiver(sender.value, senderSelectId)) {
        continue;
      }

      senders.splice(index, 1);
      cleanupSender(sender);

      if (sender.select) {
        if (!settleSelectedSend(sender)) {
          index -= 1;
          continue;
        }
      } else {
        sender.resolve();
      }

      return true;
    }

    return false;
  };

  const flushSenders = () => {
    while (senders.length > 0) {
      if (receivers.length > 0) {
        if (!tryPairWaitingSenderToReceiver()) {
          break;
        }
        continue;
      }

      if (capacity > 0 && buffer.length < capacity) {
        if (!tryBufferWaitingSender()) {
          break;
        }
        continue;
      }

      break;
    }
  };

  const sendValue = (value, signal) => {
    if (isClosed) return Promise.reject(new __streamixChannelClosedError());
    if (signal?.aborted) return Promise.reject(__streamixCreateAbortError(signal));

    if (tryDispatchToWaitingReceiver(value)) {
      return Promise.resolve();
    }

    if (capacity > 0 && buffer.length < capacity) {
      buffer.push(value);
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const sender = { value, resolve, reject, signal };
      if (signal) {
        sender.abort = () => {
          removeSender(sender);
          reject(__streamixCreateAbortError(signal));
        };
        signal.addEventListener("abort", sender.abort, { once: true });
      }
      senders.push(sender);
    });
  };

  const receiveValue = (signal) => {
    if (buffer.length > 0) {
      const value = buffer.shift();
      flushSenders();
      return Promise.resolve({ ok: true, value });
    }

    const matchedSender = tryAcquireFromWaitingSender();
    if (matchedSender) {
      return Promise.resolve(matchedSender);
    }

    if (isClosed) {
      return Promise.resolve({ ok: false, value: undefined });
    }

    if (signal?.aborted) return Promise.reject(__streamixCreateAbortError(signal));

    return new Promise((resolve, reject) => {
      const receiver = { resolve, reject, signal };
      if (signal) {
        receiver.abort = () => {
          removeReceiver(receiver);
          reject(__streamixCreateAbortError(signal));
        };
        signal.addEventListener("abort", receiver.abort, { once: true });
      }
      receivers.push(receiver);
    });
  };

  return {
    get capacity() {
      return capacity;
    },
    get size() {
      return buffer.length;
    },
    get closed() {
      return isClosed;
    },
    send: sendValue,
    async receive(signal) {
      const result = await receiveValue(signal);
      return result.ok ? result.value : undefined;
    },
    trySend(value) {
      if (isClosed) return false;
      if (tryDispatchToWaitingReceiver(value)) {
        return true;
      }
      if (capacity > 0 && buffer.length < capacity) {
        buffer.push(value);
        return true;
      }
      return false;
    },
    tryReceive() {
      if (buffer.length > 0) {
        const value = buffer.shift();
        flushSenders();
        return { ok: true, value };
      }
      const matchedSender = tryAcquireFromWaitingSender();
      if (matchedSender) {
        return matchedSender;
      }
      if (isClosed) return { ok: false, value: undefined };
      return undefined;
    },
    close() {
      if (isClosed) return;
      isClosed = true;

      while (receivers.length > 0) {
        const receiver = receivers.shift();
        cleanupReceiver(receiver);
        if (receiver.select) {
          settleSelectedReceive(receiver, undefined, false);
        } else {
          receiver.resolve({ ok: false, value: undefined });
        }
      }

      while (senders.length > 0) {
        const sender = senders.shift();
        cleanupSender(sender);
        const error = new __streamixChannelClosedError();
        if (sender.select) {
          rejectSelectedWaiter(sender, error);
        } else {
          sender.reject(error);
        }
      }
    },
    [__streamixChannelInternals]: {
      registerSelectReceive(registration, meta) {
        const receiver = {
          resolve() {},
          reject() {},
          select: { registration, meta },
        };
        receivers.push(receiver);
        return () => removeReceiver(receiver);
      },
      registerSelectSend(value, registration, meta) {
        if (isClosed) {
          registration.reject(new __streamixChannelClosedError());
          return () => {};
        }

        const sender = {
          value,
          resolve() {},
          reject() {},
          select: { registration, meta },
        };
        senders.push(sender);
        return () => removeSender(sender);
      },
    },
    async *[Symbol.asyncIterator]() {
      while (true) {
        const item = await receiveValue();
        if (!item.ok) return;
        yield item.value;
      }
    },
  };
};

const __streamixCreateContextFromState = (state) => {
  const done = new Promise((resolve) => {
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
    value(key) {
      if (state.values.has(key)) return state.values.get(key);
      return state.parent?.value(key);
    },
    withValue(key, value) {
      const values = new Map();
      values.set(key, value);
      return __streamixCreateContextFromState({
        controller: state.controller,
        values,
        parent: this,
      });
    },
  };
};

const __streamixBackground = () =>
  __streamixCreateContextFromState({ controller: new AbortController(), values: new Map() });

const __streamixWithCancel = (parent = __streamixBackground()) => {
  const controller = new AbortController();
  const onParentAbort = () => controller.abort(parent.reason ?? new __streamixContextCancelledError());

  if (parent.signal.aborted) {
    onParentAbort();
  } else {
    parent.signal.addEventListener("abort", onParentAbort, { once: true });
  }

  const ctx = __streamixCreateContextFromState({ controller, values: new Map(), parent });
  const cancel = (reason = new __streamixContextCancelledError()) => {
    parent.signal.removeEventListener("abort", onParentAbort);
    if (!controller.signal.aborted) controller.abort(reason);
  };

  return [ctx, cancel];
};

const __streamixWithTimeout = (parent, ms) => {
  const [ctx, cancel] = __streamixWithCancel(parent);
  const timer = setTimeout(() => cancel(new __streamixContextCancelledError("context timeout after " + ms + "ms")), ms);
  ctx.done.finally(() => clearTimeout(timer));
  return [ctx, cancel];
};

const __streamixWithDeadline = (parent, deadline) => {
  const time = typeof deadline === "number" ? deadline : deadline.getTime();
  return __streamixWithTimeout(parent, Math.max(0, time - Date.now()));
};

const __streamixRecv = (ch, name) => ({ op: "receive", channel: ch, name });
const __streamixSend = (ch, value, name) => ({ op: "send", channel: ch, value, name });
const __streamixOtherwise = (name = "default") => ({ op: "default", name });

const __streamixShuffledIndices = (length) => {
  const indices = Array.from({ length }, (_, i) => i);
  for (let i = length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices;
};

const __streamixSelect = async (cases, ctx = __streamixBackground()) => {
  if (ctx.signal.aborted) throw __streamixCreateAbortError(ctx.signal);

  const defaultIndex = cases.findIndex((item) => item.op === "default");
  const channelIndices = cases
    .map((_, i) => i)
    .filter((i) => cases[i].op !== "default");
  const randomOrder = __streamixShuffledIndices(channelIndices.length).map((j) => channelIndices[j]);

  for (const index of randomOrder) {
    const item = cases[index];
    if (item.op === "receive") {
      const result = item.channel.tryReceive();
      if (result) {
        return { index, case: item, op: item.op, name: item.name, value: result.value, ok: result.ok };
      }
    } else if (item.op === "send") {
      if (item.channel.closed) {
        throw new __streamixChannelClosedError();
      }
      if (item.channel.trySend(item.value)) {
        return { index, case: item, op: item.op, name: item.name, ok: true };
      }
    }
  }

  if (defaultIndex >= 0) {
    const item = cases[defaultIndex];
    return { index: defaultIndex, case: item, op: item.op, name: item.name, ok: true };
  }

  const selectId = Symbol("streamix.select");
  let settled = false;
  const cleanupFns = [];

  try {
    return await new Promise((resolve, reject) => {
      const registration = {
        id: selectId,
        isSettled: () => settled,
        settle: (outcome) => {
          if (settled) return false;
          settled = true;
          resolve({
            index: outcome.index,
            case: outcome.caseRef,
            op: outcome.op,
            name: outcome.name,
            value: outcome.value,
            ok: outcome.ok,
          });
          return true;
        },
        reject: (error) => {
          if (settled) return false;
          settled = true;
          reject(error);
          return true;
        },
      };

      const onContextAbort = () => {
        registration.reject(__streamixCreateAbortError(ctx.signal));
      };

      ctx.signal.addEventListener("abort", onContextAbort, { once: true });
      cleanupFns.push(() => ctx.signal.removeEventListener("abort", onContextAbort));

      for (const index of randomOrder) {
        if (settled) break;

        const item = cases[index];
        if (item.op === "default") continue;

        const internals = item.channel[__streamixChannelInternals];
        if (!internals) {
          registration.reject(new __streamixContextCancelledError("channel does not support select"));
          break;
        }

        const meta = { index, caseRef: item, name: item.name };
        const unregister =
          item.op === "receive"
            ? internals.registerSelectReceive(registration, meta)
            : internals.registerSelectSend(item.value, registration, meta);

        cleanupFns.push(unregister);
      }
    });
  } finally {
    while (cleanupFns.length > 0) {
      cleanupFns.pop()();
    }
  }
};

const __streamixConcurrency = Object.freeze({
  channel: __streamixChannel,
  receive: __streamixRecv,
  send: __streamixSend,
  otherwise: __streamixOtherwise,
  select: __streamixSelect,
  background: __streamixBackground,
  withCancel: __streamixWithCancel,
  withTimeout: __streamixWithTimeout,
  withDeadline: __streamixWithDeadline,
  ChannelClosedError: __streamixChannelClosedError,
  ContextCancelledError: __streamixContextCancelledError,
});
`;



const ACTOR_TERMINATION_TIMEOUT_MS = 100;
const ACTOR_STOPPED_ERROR_MESSAGE = "Actor stopped";

type PendingActorRequest<S> = {
  resolve: (value: S) => void;
  reject: (error: Error) => void;
};

const toErrorMessage = (
  error: unknown,
  fallback = "Actor request failed"
): string => (error instanceof Error ? error.message : error ? String(error) : fallback);

function postActorResponse(
  worker: Worker,
  message: Pick<WorkerProtocolMessage, "workerId" | "taskId" | "requestId"> &
    ({ type: "response"; payload: unknown } | { type: "error"; error: string })
) {
  worker.postMessage(message);
}

function handleRequest<Q>(
  message: WorkerProtocolMessage,
  sourceActor: Actor,
  worker: Worker
) {
  const { workerId, taskId, requestId, payload, topic } = message;
  const targets = normalizeActorBusTargets(message.to);

  if (targets.length !== 1) {
    postActorResponse(worker, {
      workerId,
      taskId,
      requestId,
      type: "error",
      error: "Actor request requires exactly one target",
    });
    return;
  }

  const targetName = targets[0];
  const handler = actorRequestHandlers.get(targetName);

  if (!handler) {
    postActorResponse(worker, {
      workerId,
      taskId,
      requestId,
      type: "error",
      error: `No actor request handler registered for "${targetName}"`,
    });
    return;
  }

  if (!topic) {
    postActorResponse(worker, {
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
        postActorResponse(worker, {
          workerId,
          taskId,
          requestId,
          type: "response",
          payload: resolved,
        });
      })
      .catch((err) => {
        postActorResponse(worker, {
          workerId,
          taskId,
          requestId,
          type: "error",
          error: toErrorMessage(err),
        });
      });
  } catch (err) {
    postActorResponse(worker, {
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
 * `actor(behavior, ...helpers)` returns a factory function that accepts
 * a stable actor name plus `initialState` and eagerly creates the worker.
 *
 * @example
 * ```ts
 * const counter = actor("counter", (msg, state, utils) => state + msg.payload.n, 0);
 * main.outbox.send(counter, "inc", { n: 1 });
 * const value = await main.outbox.request(counter, "inc", { n: 2 });
 * ```
 */
export function actor<S = any, Q = any, D = any, FromMain = any>(
  name: string,
  behavior: ActorBehavior<S, Q, D, FromMain>,
  initialState?: S,
  ...helpers: (Function | string)[]
): Actor {
  return createActor(name, behavior, initialState, helpers);
}

function createActor<S = any, Q = any, D = any, FromMain = any>(
  name: string,
  behavior: ActorBehavior<S, Q, D, FromMain>,
  initialState: S | undefined,
  helpers: (Function | string)[]
): Actor {
  if (!name || typeof name !== "string") {
    throw new Error("Actor name must be a non-empty string");
  }

  const functionHelpers = helpers.filter((h): h is Function => typeof h === "function");
  const stringHelpers = helpers.filter((h): h is string => typeof h === "string");

  const workerScript = buildWorkerScript({
    helpers: [ACTOR_CONCURRENCY_RUNTIME, ...stringHelpers],
    main: behavior as any,
    functions: functionHelpers,
    runtime: buildActorWorkerRuntime(),
  });

  const blobUrl = acquireBlobUrl(workerScript);
  const actorWorkerId = 1;
  const actorTaskId = String(actorWorkerId);

  let worker: Worker | null = null;
  let running = false;
  let nextRequestId = 1;
  const pendingRequests = new Map<string, PendingActorRequest<S>>();
  let shutdown$: Promise<void> | null = null;
  let finishShutdown: (() => void) | null = null;
  let shouldReleaseBlobUrl = false;
  let hasReleasedBlobUrl = false;

  worker = new Worker(blobUrl, { type: "module" });
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

  const rejectPendingRequests = (message = ACTOR_STOPPED_ERROR_MESSAGE) => {
    if (pendingRequests.size === 0) {
      return;
    }

    for (const { reject } of pendingRequests.values()) {
      reject(new Error(message));
    }

    pendingRequests.clear();
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

  const shutdown = (releaseBlobUrlOnExit: boolean) => {
    shouldReleaseBlobUrl ||= releaseBlobUrlOnExit;

    if (shutdown$) {
      releaseWorkerScript();
      return shutdown$;
    }

    running = false;
    rejectPendingRequests();
    unregisterActorBusTarget(actorRef);

    const activeWorker = worker;
    if (!activeWorker) {
      releaseWorkerScript();
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
        activeWorker.removeEventListener("message", handleMessage);
        activeWorker.removeEventListener("error", handleError);
        activeWorker.terminate();
        if (worker === activeWorker) {
          worker = null;
        }
        releaseWorkerScript();
        resolve();
      };

      const timeoutId = setTimeout(finalizeShutdown, ACTOR_TERMINATION_TIMEOUT_MS);
      finishShutdown = () => {
        clearTimeout(timeoutId);
        finalizeShutdown();
      };

      try {
        postToWorker(activeWorker, {
          taskId: actorTaskId,
          type: "stop",
        });
      } catch {
        finishShutdown();
      }
    });

    return shutdown$;
  };

  const handleMessage = (event: MessageEvent<WorkerProtocolMessage>) => {
    const msg = event.data;
    const { type, payload, requestId } = msg;

    if (type === "response" && requestId && pendingRequests.has(requestId)) {
      const { resolve } = pendingRequests.get(requestId)!;
      pendingRequests.delete(requestId);
      resolve(payload);
    } else if (type === "error" && requestId && pendingRequests.has(requestId)) {
      const { reject } = pendingRequests.get(requestId)!;
      pendingRequests.delete(requestId);
      reject(new Error(msg.error ?? "Actor request failed"));
    } else if (type === "request") {
      handleRequest(msg, actorRef, worker!);
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

  const handleError = () => {
    // Generic error handler, specific errors are handled within the message handler
  };

  worker.addEventListener("message", handleMessage);

  postToWorker(worker, {
    taskId: actorTaskId,
    payload: initialState,
    type: "init",
  });

  const actor: Actor = {
    name,

    get running() {
      return running;
    },
  };

  actorRef = actor;
  registerActorBusTarget(name, actorRef);

  const internals = {
    stop() {
      return shutdown(true);
    },
    post(msg: FromMain) {
      if (!worker || !running) {
        console.warn("Actor is not running; message dropped");
        return;
      }
      postToWorker(worker, {
        taskId: actorTaskId,
        payload: msg,
        type: "notify",
      });
    },

    request(topic: string, msg: FromMain): Promise<S> {
      if (!worker || !running) {
        return Promise.reject(new Error("Actor stopped"));
      }
      const id = String(nextRequestId++);
      return new Promise((resolve, reject) => {
        pendingRequests.set(id, { resolve, reject });
        postToWorker(worker!, {
          taskId: actorTaskId,
          payload: msg,
          requestId: id,
          type: "request",
          topic,
        });
      });
    },
  };

  actorInternalsMap.set(actor, internals);

  return actor;
}

type ActorBusRegistration = {
  actor: Actor;
  name: string;
};

const actorBusRegistrationsById = new Map<string, ActorBusRegistration>();
const actorBusRegistrationsByActor = new Map<Actor, ActorBusRegistration>();
const actorBusDirectListeners = new Map<string, Set<ActorBusHandler>>();
const actorBusListeners = new Set<ActorBusHandler>();

const actorInternalsMap = new WeakMap<Actor, { stop(): Promise<void>; post(msg: any): void; request(topic: string, msg: any): Promise<any> }>();

function resolveActorTarget(actorOrName: Actor | string): Actor | undefined {
  if (typeof actorOrName !== "string") {
    return actorOrName;
  }

  return actorBusRegistrationsById.get(actorOrName)?.actor;
}

function resolveActorBusTarget(to: Actor | string | string[]): string | string[] {
  if (Array.isArray(to)) {
    return to;
  }
  return typeof to === "string" ? to : to.name;
}

const normalizeActorBusTargets = (to?: ActorBusTarget): string[] => {
  if (!to) {
    return [];
  }

  return Array.isArray(to) ? [...to] : [to];
};

const warnAsyncActorBusFailure = (scope: string, error: unknown) => {
  console.warn(`${scope} failed:`, error);
};

function deliverActorBusMessage(actor: Actor, message: ActorBusMessage) {
  actorInternalsMap.get(actor)?.post(message);
}

function notifyActorBusSubscribers(message: ActorBusMessage) {
  const directHandlers = message.to
    ? normalizeActorBusTargets(message.to)
        .flatMap((name) => [...(actorBusDirectListeners.get(name) ?? [])])
    : [];
  const handlers = [...actorBusListeners, ...directHandlers];

  for (const handler of handlers) {
    Promise.resolve(handler(message)).catch((error) => {
      warnAsyncActorBusFailure("Actor bus subscriber", error);
    });
  }
}

function unregisterActorBusTarget(idOrActor: string | Actor) {
  const registration =
    typeof idOrActor === "string"
      ? actorBusRegistrationsById.get(idOrActor)
      : actorBusRegistrationsByActor.get(idOrActor);

  if (!registration) {
    return;
  }

  actorBusRegistrationsById.delete(registration.name);
  actorBusRegistrationsByActor.delete(registration.actor);
}

function registerActorBusTarget(
  name: string,
  actor: Actor
) {
  const existingRegistration = actorBusRegistrationsById.get(name);
  if (existingRegistration && existingRegistration.actor !== actor) {
    throw new Error(`Actor name "${name}" is already registered`);
  }

  unregisterActorBusTarget(actor);

  const registration: ActorBusRegistration = {
    actor,
    name,
  };

  actorBusRegistrationsById.set(name, registration);
  actorBusRegistrationsByActor.set(actor, registration);

  return () => unregisterActorBusTarget(actor);
}

function clearActorBusListeners() {
  actorBusDirectListeners.clear();
  actorBusListeners.clear();
  actorRequestHandlers.clear();
}

function dispatchActorBusMessage<T = any>(
  message: ActorBusMessage<T>,
  options?: { fromActor?: Actor; includeSelf?: boolean }
) {
  const from =
    message.from ??
    (options?.fromActor
      ? actorBusRegistrationsByActor.get(options.fromActor)?.name
      : undefined);

  const routedMessage =
    from && message.from !== from ? { ...message, from } : message;

  notifyActorBusSubscribers(routedMessage);

  const targets = normalizeActorBusTargets(routedMessage.to);
  if (targets.length > 0) {
    const seen = new Set<string>();

    for (const target of targets) {
      if (seen.has(target)) {
        continue;
      }

      seen.add(target);
      const registration = actorBusRegistrationsById.get(target);
      if (registration) {
        deliverActorBusMessage(registration.actor, routedMessage);
      }
    }

    return;
  }

  for (const registration of actorBusRegistrationsById.values()) {
    if (
      routedMessage.from &&
      !options?.includeSelf &&
      registration.name === routedMessage.from
    ) {
      continue;
    }

    deliverActorBusMessage(registration.actor, routedMessage);
  }
}

/**
 * Main-thread communication utility.
 *
 * Extends the worker-side `utils` structure:
 * - `main.outbox.send(to, topic, payload)` — fire-and-forget bus message
 * - `main.outbox.request(to, topic, payload)` — send request and await response
 * - `main.outbox.stop(actor)` — stop actor and release resources
 * - `main.inbox.subscribe(handler)` — subscribe to all actor-bus messages
 */
const subscribeMainInbox: Initiator["inbox"]["subscribe"] = (handler) => {
  actorBusListeners.add(handler);
  return () => actorBusListeners.delete(handler);
};

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
    request<Q = any, D = any>(to: Actor | string, topic: string, payload: Q): Promise<D> {
      const target = resolveActorTarget(to);
      if (!target) {
        return Promise.reject(new Error(`Unknown actor target "${String(to)}"`));
      }

      return actorInternalsMap.get(target)!.request(topic, payload);
    },

    /** Stops the actor, terminates its worker, and releases resources. */
    stop(actor: Actor | string): Promise<void> {
      const target = resolveActorTarget(actor);
      if (!target) {
        return Promise.reject(new Error(`Unknown actor target "${String(actor)}"`));
      }

      return actorInternalsMap.get(target)!.stop();
    },
  },

  inbox: {
    subscribe: subscribeMainInbox,

    clear: () => {
      clearActorBusListeners();
    },
  },
};
