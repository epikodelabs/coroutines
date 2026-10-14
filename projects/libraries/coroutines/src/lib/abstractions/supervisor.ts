import { ContextCancelledError, createAbortError, sleep } from "../utils";
import type { Actor, ActorExit, ActorStopOptions, Supervisor, SupervisorOptions } from "../worker/types";
import { ActorStoppedError } from "./actor";

/**
 * Rejection carried by requests that reach a supervisor while it is
 * restarting or its ingress buffer is saturated.
 */
export class SupervisorBusyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SupervisorBusyError";
  }
}
import {
  getActorInternals,
  registerActorBusTarget,
  setActorInternals,
  tryActorInternals,
  unregisterActorBusTarget,
  warnAsyncActorBusFailure,
} from "./bus";

/**
 * Supervises an actor factory behind one stable addressable handle.
 *
 * A failed actor generation is recreated until `maxRestarts` is exhausted.
 * Normal stops are never restarted. The supervisor can be passed anywhere an
 * `Actor` is accepted by `main.outbox`, so callers never retain a stale actor
 * generation.
 */
export function supervisor(
  factory: () => Actor,
  options: SupervisorOptions = {},
): Supervisor {
  if (typeof factory !== "function") {
    throw new TypeError("supervisor factory must be a function");
  }

  const maxRestarts = options.maxRestarts ?? 3;
  const restartDelay = options.restartDelay ?? 0;
  const capacity = options.capacity ?? 0;

  if (!Number.isInteger(maxRestarts) || maxRestarts < 0) {
    throw new RangeError("supervisor maxRestarts must be a non-negative integer");
  }
  if (!Number.isFinite(restartDelay) || restartDelay < 0) {
    throw new RangeError("supervisor restartDelay must be a non-negative finite number");
  }
  if (!Number.isInteger(capacity) || capacity < 0) {
    throw new RangeError("supervisor capacity must be a non-negative integer");
  }

  type PendingIngress =
    | { kind: "post"; msg: any }
    | {
        kind: "request";
        topic: string;
        msg: any;
        signal?: AbortSignal;
        resolve: (value: any) => void;
        reject: (error: Error) => void;
        abort?: () => void;
      };

  const ingress: PendingIngress[] = [];
  let current: Actor | undefined;
  let restarts = 0;
  let totalDropped = 0;
  let stopping = false;
  let settled = false;
  let restartController: AbortController | undefined;
  let resolveDone!: (exit: ActorExit) => void;
  const done = new Promise<ActorExit>((resolve) => { resolveDone = resolve; });

  const cleanupPendingRequest = (entry: Extract<PendingIngress, { kind: "request" }>) => {
    if (entry.signal && entry.abort) {
      entry.signal.removeEventListener("abort", entry.abort);
    }
  };

  const rejectIngress = (error: Error) => {
    while (ingress.length > 0) {
      const entry = ingress.shift()!;
      if (entry.kind === "request") {
        cleanupPendingRequest(entry);
        entry.reject(error);
      }
    }
  };

  const settle = (exit: ActorExit) => {
    if (settled) return;
    settled = true;
    restartController?.abort(new ContextCancelledError("supervisor stopped"));
    restartController = undefined;
    unregisterActorBusTarget(handle);
    rejectIngress(
      exit.reason === "error"
        ? exit.error
        : new ActorStoppedError("supervisor stopped")
    );
    resolveDone(exit);
  };

  const flushIngress = () => {
    const active = current;
    if (!active?.running) return;

    while (ingress.length > 0 && current === active && active.running) {
      const entry = ingress.shift()!;
      if (entry.kind === "post") {
        try {
          tryActorInternals(active)?.post(entry.msg);
        } catch (error) {
          warnAsyncActorBusFailure("Supervisor buffered delivery", error);
        }
        continue;
      }

      cleanupPendingRequest(entry);
      if (entry.signal?.aborted) {
        entry.reject(createAbortError(entry.signal));
        continue;
      }

      const internals = tryActorInternals(active);
      if (!internals) {
        entry.reject(new Error("Supervised actor generation is unavailable"));
        continue;
      }

      internals
        .request(entry.topic, entry.msg, entry.signal)
        .then(entry.resolve, entry.reject);
    }
  };

  const scheduleRestart = async (failure: Error): Promise<void> => {
    let lastError = failure;

    while (!stopping && !settled) {
      if (restarts >= maxRestarts) {
        settle({ reason: "error", error: lastError });
        return;
      }

      restarts += 1;

      if (restartDelay > 0) {
        restartController = new AbortController();
        try {
          await sleep(restartDelay, restartController.signal);
        } catch (error) {
          if (stopping || settled) return;
          lastError = error instanceof Error ? error : new Error(String(error));
          continue;
        } finally {
          restartController = undefined;
        }
      }

      if (stopping || settled) return;

      // The stable supervisor owns the public name between generations.
      // `actor(name, ...)` also registers during construction, so temporarily
      // release that registration while the replacement is created. The
      // factory is synchronous, making this hand-off atomic with respect to
      // ordinary main-thread message dispatch.
      unregisterActorBusTarget(handle);

      let next: Actor | undefined;
      try {
        next = factory();
        assertReplacementName(next);

        bindCurrent(next);
        return;
      } catch (error) {
        if (next && current !== next) {
          await tryActorInternals(next)?.stop().catch(() => undefined);
        }

        lastError = error instanceof Error ? error : new Error(String(error));

        if (!stopping && !settled) {
          // A failed construction must not make the supervisor disappear from
          // name-based routing while another restart attempt is still allowed.
          unregisterActorBusTarget(first.name);
          registerActorBusTarget(first.name, handle);
        }
      }
    }
  };

  const bindCurrent = (next: Actor) => {
    assertReplacementName(next);

    // The generation registers itself during actor(); replace that public
    // registration with the stable supervisor handle before exposing it as
    // current. This keeps name routing transactional across restarts.
    unregisterActorBusTarget(next);
    registerActorBusTarget(first.name, handle);
    current = next;

    // Attach lifecycle observation before flushing buffered traffic. A
    // synchronous transport failure during flush can terminate the generation.
    void next.done.then((exit) => {
      if (current !== next || settled) return;
      totalDropped += next.dropped;
      current = undefined;

      if (stopping || exit.reason === "stopped") {
        settle({ reason: "stopped" });
        return;
      }

      void scheduleRestart(exit.error);
    });

    flushIngress();
  };

  const first = factory();

  const assertReplacementName = (next: Actor): void => {
    if (next.name !== first.name) {
      throw new Error(
        `supervisor replacement name must remain "${first.name}"; received "${next.name}"`,
      );
    }
  };

  const handle: Supervisor = {
    get name() {
      return first.name;
    },
    get running() {
      return current?.running ?? false;
    },
    get mailboxCapacity() {
      return current?.mailboxCapacity ?? first.mailboxCapacity;
    },
    get dropped() {
      return totalDropped + (current?.dropped ?? 0);
    },
    get current() {
      return current;
    },
    get restarts() {
      return restarts;
    },
    get capacity() {
      return capacity;
    },
    get pending() {
      return ingress.length;
    },
    done,
  };

  const enqueue = (entry: PendingIngress): boolean => {
    if (settled || stopping || capacity === 0 || ingress.length >= capacity) {
      return false;
    }
    ingress.push(entry);
    return true;
  };

  const requestRejectionError = (): Error =>
    settled || stopping
      ? new ActorStoppedError("Supervised actor is stopped")
      : new SupervisorBusyError(
          capacity === 0
            ? "Supervised actor is restarting"
            : "Supervisor ingress capacity exceeded"
        );

  setActorInternals(handle, {
    stop: async (options?: ActorStopOptions) => {
      if (settled) return;
      stopping = true;
      restartController?.abort(new ContextCancelledError("supervisor stopped"));
      restartController = undefined;
      const active = current;
      if (active) {
        await tryActorInternals(active)?.stop(options);
      } else {
        settle({ reason: "stopped" });
      }
      await done;
    },
    post: (msg: any) => {
      const active = current;
      if (active?.running) {
        tryActorInternals(active)?.post(msg);
        return;
      }

      if (!enqueue({ kind: "post", msg })) {
        console.warn(
          settled || stopping
            ? "Supervised actor is stopped; message dropped"
            : capacity === 0
              ? "Supervised actor is restarting; message dropped"
              : "Supervisor ingress capacity exceeded; message dropped"
        );
      }
    },
    request: (topic: string, msg: any, signal?: AbortSignal) => {
      const active = current;
      if (active?.running) {
        return getActorInternals(active).request(topic, msg, signal);
      }
      if (signal?.aborted) {
        return Promise.reject(createAbortError(signal));
      }
      if (settled || stopping) {
        return Promise.reject(new ActorStoppedError("Supervised actor is stopped"));
      }
      if (capacity === 0 || ingress.length >= capacity) {
        return Promise.reject(requestRejectionError());
      }

      return new Promise((resolve, reject) => {
        const entry: Extract<PendingIngress, { kind: "request" }> = {
          kind: "request",
          topic,
          msg,
          signal,
          resolve,
          reject,
        };

        if (signal) {
          entry.abort = () => {
            const index = ingress.indexOf(entry);
            if (index < 0) return;
            ingress.splice(index, 1);
            cleanupPendingRequest(entry);
            reject(createAbortError(signal));
          };
          signal.addEventListener("abort", entry.abort, { once: true });
        }

        if (!enqueue(entry)) {
          cleanupPendingRequest(entry);
          reject(requestRejectionError());
        }
      });
    },
  });

  bindCurrent(first);
  return handle;
}


export type { Supervisor, SupervisorOptions } from "../worker/types";